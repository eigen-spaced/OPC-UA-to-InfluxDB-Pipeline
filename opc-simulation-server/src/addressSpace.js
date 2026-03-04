/**
 * @file addressSpace.js
 * @description Builds the OPC UA address space for the water treatment simulation.
 *              Creates all folders, variables, and sets up writable node handlers
 *              that feed client writes into the simulation state.
 */

"use strict";

const opcua = require("node-opcua");
const config = require("./config");
const { clampWithWarning, startScenario } = require("./simulation");

/**
 * Creates a read-only analog variable in the address space.
 * @param {opcua.Namespace} ns - Namespace
 * @param {opcua.UAObject} parent - Parent folder node
 * @param {string} name - Browse name
 * @param {opcua.DataType} dataType - OPC UA data type
 * @param {*} initialValue - Starting value
 * @param {string} [description] - Node description
 * @returns {opcua.UAVariable} The created variable
 */
function addReadOnlyVariable(ns, parent, name, dataType, initialValue, description) {
  return ns.addVariable({
    componentOf: parent,
    browseName: name,
    displayName: name,
    description: description || name,
    dataType,
    accessLevel: "CurrentRead",
    userAccessLevel: "CurrentRead",
    value: {
      dataType,
      value: initialValue,
    },
  });
}

/**
 * Creates a read-write numeric variable with a clamping write handler.
 * Uses the getter/setter pattern so client writes flow through the set function.
 * @param {opcua.Namespace} ns - Namespace
 * @param {opcua.UAObject} parent - Parent folder node
 * @param {string} name - Browse name
 * @param {opcua.DataType} dataType - OPC UA data type
 * @param {object} stateObj - The mutable state object containing the property
 * @param {string} stateKey - Property name on stateObj to read/write
 * @param {string} nodePath - Full path for logging (e.g. "TankFarm/Tank1/FillValve")
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {string} [description] - Node description
 * @returns {opcua.UAVariable} The created variable
 */
function addWritableVariable(ns, parent, name, dataType, stateObj, stateKey, nodePath, min, max, description) {
  return ns.addVariable({
    componentOf: parent,
    browseName: name,
    displayName: name,
    description: description || name,
    dataType,
    accessLevel: "CurrentRead | CurrentWrite",
    userAccessLevel: "CurrentRead | CurrentWrite",
    minimumSamplingInterval: config.simulation.defaultSamplingInterval,
    value: {
      get: () => new opcua.Variant({ dataType, value: stateObj[stateKey] }),
      set: (variant) => {
        const clamped = clampWithWarning(nodePath, variant.value, min, max);
        stateObj[stateKey] = clamped;
        return opcua.StatusCodes.Good;
      },
    },
  });
}

/**
 * Creates a writable boolean variable with a custom write handler.
 * @param {opcua.Namespace} ns - Namespace
 * @param {opcua.UAObject} parent - Parent folder node
 * @param {string} name - Browse name
 * @param {object} stateObj - The mutable state object containing the property
 * @param {string} stateKey - Property name on stateObj to read
 * @param {function} onWrite - Callback: (boolValue) => void, for custom write logic
 * @param {string} [description] - Node description
 * @returns {opcua.UAVariable} The created variable
 */
function addWritableBoolean(ns, parent, name, stateObj, stateKey, onWrite, description) {
  return ns.addVariable({
    componentOf: parent,
    browseName: name,
    displayName: name,
    description: description || name,
    dataType: opcua.DataType.Boolean,
    accessLevel: "CurrentRead | CurrentWrite",
    userAccessLevel: "CurrentRead | CurrentWrite",
    minimumSamplingInterval: config.simulation.defaultSamplingInterval,
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.Boolean, value: stateObj[stateKey] }),
      set: (variant) => {
        onWrite(!!variant.value);
        return opcua.StatusCodes.Good;
      },
    },
  });
}

/**
 * Builds a tank node subtree (Level, FillValve, DrainValve, HighHighAlarm, LowLowAlarm, Temperature).
 * @param {opcua.Namespace} ns - Namespace
 * @param {opcua.UAObject} parent - Parent folder (TankFarm)
 * @param {string} tankName - "Tank1" or "Tank2"
 * @param {object} state - Mutable tank simulation state
 * @returns {object} Map of UAVariable references keyed by field name
 */
function buildTankNodes(ns, parent, tankName, state) {
  const folder = ns.addFolder(parent, { browseName: tankName, displayName: tankName });
  const basePath = `TankFarm/${tankName}`;
  const nodes = {};

  nodes.level = addReadOnlyVariable(
    ns, folder, "Level", opcua.DataType.Double, state.level,
    `${tankName} level (0–100%)`
  );

  nodes.fillValve = addWritableVariable(
    ns, folder, "FillValve", opcua.DataType.Double, state, "fillValve",
    `${basePath}/FillValve`, 0.0, 100.0,
    `${tankName} fill valve opening (0–100%)`
  );

  nodes.drainValve = addWritableVariable(
    ns, folder, "DrainValve", opcua.DataType.Double, state, "drainValve",
    `${basePath}/DrainValve`, 0.0, 100.0,
    `${tankName} drain valve opening (0–100%)`
  );

  nodes.highHighAlarm = addReadOnlyVariable(
    ns, folder, "HighHighAlarm", opcua.DataType.Boolean, state.highHighAlarm,
    `${tankName} high-high level alarm (>= ${config.alarms.highHighThreshold}%)`
  );

  nodes.lowLowAlarm = addReadOnlyVariable(
    ns, folder, "LowLowAlarm", opcua.DataType.Boolean, state.lowLowAlarm,
    `${tankName} low-low level alarm (<= ${config.alarms.lowLowThreshold}%)`
  );

  nodes.temperature = addReadOnlyVariable(
    ns, folder, "Temperature", opcua.DataType.Double, state.temperature,
    `${tankName} water temperature (°C)`
  );

  return nodes;
}

/**
 * Builds a pump node subtree (Running, Speed, Current, RuntimeHours, Fault, FaultCode).
 * @param {opcua.Namespace} ns - Namespace
 * @param {opcua.UAObject} parent - Parent folder (PumpStation)
 * @param {string} pumpName - "Pump1" or "Pump2"
 * @param {object} state - Mutable pump simulation state
 * @returns {object} Map of UAVariable references keyed by field name
 */
function buildPumpNodes(ns, parent, pumpName, state) {
  const folder = ns.addFolder(parent, { browseName: pumpName, displayName: pumpName });
  const basePath = `PumpStation/${pumpName}`;
  const nodes = {};

  nodes.running = addWritableBoolean(
    ns, folder, "Running", state, "running",
    (v) => {
      if (v && state.fault) {
        console.log(`[SIM] Cannot start ${pumpName} — fault active (code ${state.faultCode}). Clear fault first.`);
        return;
      }
      state.running = v;
    },
    `${pumpName} run command (true = start, false = stop)`
  );

  nodes.speed = addWritableVariable(
    ns, folder, "Speed", opcua.DataType.Double, state, "speed",
    `${basePath}/Speed`, 0.0, 100.0,
    `${pumpName} speed setpoint (0–100%)`
  );

  nodes.current = addReadOnlyVariable(
    ns, folder, "Current", opcua.DataType.Double, state.current,
    `${pumpName} motor current draw (A)`
  );

  nodes.runtimeHours = addReadOnlyVariable(
    ns, folder, "RuntimeHours", opcua.DataType.Double, state.runtimeHours,
    `${pumpName} total runtime (hours)`
  );

  nodes.fault = addWritableBoolean(
    ns, folder, "Fault", state, "fault",
    (v) => {
      if (!v) {
        state.fault = false;
        state.faultCode = 0;
        console.log(`[SIM] ${pumpName} fault cleared by client`);
      }
    },
    `${pumpName} fault status (write false to reset)`
  );

  nodes.faultCode = addReadOnlyVariable(
    ns, folder, "FaultCode", opcua.DataType.Int32, state.faultCode,
    `${pumpName} fault code (0 = none, 1 = dry-run protection)`
  );

  return nodes;
}

/**
 * Builds the QualityMonitoring node subtree (pH, Turbidity, ChlorineResidual).
 * @param {opcua.Namespace} ns - Namespace
 * @param {opcua.UAObject} parent - Root simulation folder
 * @param {object} state - Mutable quality simulation state
 * @returns {object} Map of UAVariable references keyed by field name
 */
function buildQualityNodes(ns, parent, state) {
  const folder = ns.addFolder(parent, {
    browseName: "QualityMonitoring",
    displayName: "QualityMonitoring",
  });
  const nodes = {};

  nodes.pH = addReadOnlyVariable(
    ns, folder, "pH", opcua.DataType.Double, state.pH,
    "Water pH (normal range 6.5–8.5)"
  );

  nodes.turbidity = addReadOnlyVariable(
    ns, folder, "Turbidity", opcua.DataType.Double, state.turbidity,
    "Water turbidity (NTU)"
  );

  nodes.chlorine = addReadOnlyVariable(
    ns, folder, "ChlorineResidual", opcua.DataType.Double, state.chlorine,
    "Chlorine residual (mg/L)"
  );

  return nodes;
}

/**
 * Constructs the entire WaterTreatment address space.
 * @param {opcua.OPCUAServer} server - The OPC UA server instance
 * @param {object} simState - Complete simulation state from createSimulationState()
 * @returns {object} All node references organized by subsystem, for use in the update loop
 */
function buildAddressSpace(server, simState) {
  const addressSpace = server.engine.addressSpace;
  const ns = addressSpace.getOwnNamespace();

  // Root folder
  const root = ns.addFolder(addressSpace.rootFolder.objects, {
    browseName: "WaterTreatment",
    displayName: "WaterTreatment",
  });

  // TankFarm
  const tankFarmFolder = ns.addFolder(root, {
    browseName: "TankFarm",
    displayName: "TankFarm",
  });
  const tank1Nodes = buildTankNodes(ns, tankFarmFolder, "Tank1", simState.tank1);
  const tank2Nodes = buildTankNodes(ns, tankFarmFolder, "Tank2", simState.tank2);

  // PumpStation
  const pumpStationFolder = ns.addFolder(root, {
    browseName: "PumpStation",
    displayName: "PumpStation",
  });
  const pump1Nodes = buildPumpNodes(ns, pumpStationFolder, "Pump1", simState.pump1);
  const pump2Nodes = buildPumpNodes(ns, pumpStationFolder, "Pump2", simState.pump2);

  // QualityMonitoring
  const qualityNodes = buildQualityNodes(ns, root, simState.quality);

  // Scenario control nodes
  const scenarioControl = ns.addVariable({
    componentOf: root,
    browseName: "ScenarioControl",
    displayName: "ScenarioControl",
    description: "Write a scenario name to trigger a transition (normal, high_demand, fault)",
    dataType: opcua.DataType.String,
    accessLevel: "CurrentRead | CurrentWrite",
    userAccessLevel: "CurrentRead | CurrentWrite",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.String, value: simState.scenario.active }),
      set: (variant) => {
        const name = (variant.value || "").toString().trim();
        if (!startScenario(simState, name)) {
          return opcua.StatusCodes.BadOutOfRange;
        }
        return opcua.StatusCodes.Good;
      },
    },
  });

  const scenarioProgress = addReadOnlyVariable(
    ns, root, "ScenarioProgress", opcua.DataType.Double, 0.0,
    "Scenario transition progress (0.0–1.0)"
  );

  return { tank1Nodes, tank2Nodes, pump1Nodes, pump2Nodes, qualityNodes, scenarioControl, scenarioProgress };
}

/**
 * Pushes current simulation state into OPC UA variable nodes.
 * Called once per simulation tick to keep client-visible values in sync.
 * Only updates read-only nodes — writable nodes use getter/setter binding.
 * @param {object} nodes - Node references from buildAddressSpace()
 * @param {object} simState - Current simulation state
 */
function syncNodesToState(nodes, simState) {
  const { tank1Nodes, tank2Nodes, pump1Nodes, pump2Nodes, qualityNodes, scenarioProgress } = nodes;

  // Tank 1 (read-only fields)
  tank1Nodes.level.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.tank1.level });
  tank1Nodes.highHighAlarm.setValueFromSource({ dataType: opcua.DataType.Boolean, value: simState.tank1.highHighAlarm });
  tank1Nodes.lowLowAlarm.setValueFromSource({ dataType: opcua.DataType.Boolean, value: simState.tank1.lowLowAlarm });
  tank1Nodes.temperature.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.tank1.temperature });

  // Tank 2 (read-only fields)
  tank2Nodes.level.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.tank2.level });
  tank2Nodes.highHighAlarm.setValueFromSource({ dataType: opcua.DataType.Boolean, value: simState.tank2.highHighAlarm });
  tank2Nodes.lowLowAlarm.setValueFromSource({ dataType: opcua.DataType.Boolean, value: simState.tank2.lowLowAlarm });
  tank2Nodes.temperature.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.tank2.temperature });

  // Pump 1 (read-only fields)
  pump1Nodes.current.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.pump1.current });
  pump1Nodes.runtimeHours.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.pump1.runtimeHours });
  pump1Nodes.faultCode.setValueFromSource({ dataType: opcua.DataType.Int32, value: simState.pump1.faultCode });

  // Pump 2 (read-only fields)
  pump2Nodes.current.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.pump2.current });
  pump2Nodes.runtimeHours.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.pump2.runtimeHours });
  pump2Nodes.faultCode.setValueFromSource({ dataType: opcua.DataType.Int32, value: simState.pump2.faultCode });

  // Quality (all read-only)
  qualityNodes.pH.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.quality.pH });
  qualityNodes.turbidity.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.quality.turbidity });
  qualityNodes.chlorine.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.quality.chlorine });

  // Scenario progress
  scenarioProgress.setValueFromSource({ dataType: opcua.DataType.Double, value: simState.scenario.progress });
}

module.exports = { buildAddressSpace, syncNodesToState };
