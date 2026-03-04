/**
 * @file simulation.js
 * @description Physics engine for the water treatment simulation.
 *              Manages tank fill/drain dynamics, pump behavior, and water quality sensors.
 *              All state is held in-memory and updated on each tick.
 */

"use strict";

const config = require("./config");

/**
 * Generates a sample from a Gaussian (normal) distribution using the Box-Muller transform.
 * @param {number} mean - Distribution mean
 * @param {number} stdDev - Standard deviation
 * @returns {number} Random sample
 */
function gaussian(mean, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1 || 1e-10)) * Math.cos(2.0 * Math.PI * u2);
  return mean + stdDev * z;
}

/**
 * Clamps a value between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Creates the initial simulation state for a single tank.
 * @param {object} cfg - Tank configuration from config.tankFarm
 * @returns {object} Mutable tank state
 */
function createTankState(cfg) {
  return {
    level: cfg.initialLevel,
    fillValve: 0.0,
    drainValve: 0.0,
    temperature: cfg.initialTemperature,
    highHighAlarm: false,
    lowLowAlarm: false,
  };
}

/**
 * Creates the initial simulation state for a single pump.
 * @returns {object} Mutable pump state
 */
function createPumpState() {
  return {
    running: false,
    speed: 0.0,
    current: 0.0,
    runtimeHours: 0.0,
    fault: false,
    faultCode: 0,
  };
}

/**
 * Creates the initial simulation state for water quality sensors.
 * @returns {object} Mutable quality state
 */
function createQualityState() {
  return {
    pH: config.quality.pH.initial,
    turbidity: config.quality.turbidity.baseline,
    chlorine: config.quality.chlorine.initial,
    _turbiditySpike: 0.0, // internal: current spike magnitude
  };
}

/**
 * Scenario target definitions.
 * Each scenario maps writable state fields to their desired end-state values.
 */
const SCENARIOS = {
  normal: {
    "tank1.fillValve": 50, "tank1.drainValve": 30,
    "tank2.fillValve": 50, "tank2.drainValve": 30,
    "pump1.running": true, "pump1.speed": 50, "pump1.fault": false, "pump1.faultCode": 0,
    "pump2.running": true, "pump2.speed": 50,
  },
  high_demand: {
    "tank1.fillValve": 20, "tank1.drainValve": 100,
    "tank2.fillValve": 20, "tank2.drainValve": 100,
    "pump1.running": true, "pump1.speed": 100, "pump1.fault": false, "pump1.faultCode": 0,
    "pump2.running": true, "pump2.speed": 100,
  },
  fault: {
    "tank1.fillValve": 50, "tank1.drainValve": 30,
    "tank2.fillValve": 10, "tank2.drainValve": 95,
    "pump1.running": false, "pump1.speed": 0, "pump1.fault": true, "pump1.faultCode": 1,
    "pump2.running": true, "pump2.speed": 100,
  },
};

/** Duration of scenario transitions in seconds. */
const SCENARIO_DURATION_SEC = 30;

/**
 * Reads a dotted path (e.g. "tank1.fillValve") from the simulation state.
 */
function getStatePath(state, path) {
  const [obj, key] = path.split(".");
  return state[obj][key];
}

/**
 * Writes a value to a dotted path on the simulation state.
 */
function setStatePath(state, path, value) {
  const [obj, key] = path.split(".");
  state[obj][key] = value;
}

/**
 * Snapshots the current values for all fields referenced by a scenario's targets.
 */
function snapshotFields(state, targets) {
  const snap = {};
  for (const path of Object.keys(targets)) {
    snap[path] = getStatePath(state, path);
  }
  return snap;
}

/**
 * Validates and begins a scenario transition.
 * @param {object} state - Full simulation state (must include state.scenario)
 * @param {string} name - Scenario name (key of SCENARIOS)
 * @returns {boolean} true if started, false if invalid name
 */
function startScenario(state, name) {
  if (!SCENARIOS[name]) {
    console.warn(`[SCENARIO] Unknown scenario "${name}". Valid: ${Object.keys(SCENARIOS).join(", ")}`);
    return false;
  }
  const targets = SCENARIOS[name];
  state.scenario.active = name;
  state.scenario.targets = targets;
  state.scenario.progress = 0;
  state.scenario.startSnapshot = snapshotFields(state, targets);
  console.log(`[SCENARIO] Starting "${name}" transition (${SCENARIO_DURATION_SEC}s)`);
  return true;
}

/**
 * Advances the active scenario transition by one tick.
 * Numeric fields are linearly interpolated; booleans snap at progress >= 0.5.
 * @param {object} state - Full simulation state
 * @param {number} dt - Time step in seconds
 */
function updateScenario(state, dt) {
  const sc = state.scenario;
  if (!sc.targets) return;

  sc.progress = clamp(sc.progress + dt / SCENARIO_DURATION_SEC, 0, 1);

  for (const [path, target] of Object.entries(sc.targets)) {
    const start = sc.startSnapshot[path];
    if (typeof target === "boolean") {
      setStatePath(state, path, sc.progress >= 0.5 ? target : start);
    } else {
      setStatePath(state, path, start + (target - start) * sc.progress);
    }
  }

  if (sc.progress >= 1) {
    console.log(`[SCENARIO] "${sc.active}" transition complete`);
    sc.targets = null;
    sc.startSnapshot = null;
  }
}

/**
 * Creates the complete simulation state object.
 * @returns {object} Full simulation state with all subsystems
 */
function createSimulationState() {
  return {
    tank1: createTankState(config.tankFarm.tank1),
    tank2: createTankState(config.tankFarm.tank2),
    pump1: createPumpState(),
    pump2: createPumpState(),
    quality: createQualityState(),
    scenario: {
      active: "normal",
      targets: null,
      progress: 0,
      startSnapshot: null,
    },
  };
}

/**
 * Advances tank physics by one tick.
 * Level changes proportional to valve openings; drain follows sqrt(level) for gravity realism.
 * Temperature mean-reverts with random noise.
 * Alarms use hysteresis to avoid chatter.
 * @param {object} tank - Mutable tank state
 * @param {object} cfg - Tank configuration
 * @param {number} dt - Time step in seconds
 */
function updateTank(tank, cfg, dt) {
  // Fill rate: linear with valve opening
  const fillRate = (tank.fillValve / 100.0) * cfg.maxFillRatePerSec * dt;

  // Drain rate: proportional to valve opening and sqrt(level) for gravity
  const levelFactor = Math.sqrt(Math.max(tank.level, 0) / 100.0);
  const drainRate = (tank.drainValve / 100.0) * cfg.maxDrainRatePerSec * levelFactor * dt;

  tank.level = clamp(tank.level + fillRate - drainRate, 0.0, 100.0);

  // Temperature: Ornstein-Uhlenbeck process (mean-reverting random walk)
  const tempDrift = cfg.temperatureReversion * (cfg.temperatureMean - tank.temperature);
  const tempNoise = gaussian(0, cfg.temperatureDriftRate);
  tank.temperature = clamp(tank.temperature + tempDrift + tempNoise, 0.0, 60.0);

  // Alarms with hysteresis
  if (tank.level >= config.alarms.highHighThreshold) {
    tank.highHighAlarm = true;
  } else if (tank.level <= config.alarms.highHighClear) {
    tank.highHighAlarm = false;
  }

  if (tank.level <= config.alarms.lowLowThreshold) {
    tank.lowLowAlarm = true;
  } else if (tank.level >= config.alarms.lowLowClear) {
    tank.lowLowAlarm = false;
  }
}

/**
 * Advances pump physics by one tick.
 * Current draw scales with speed. Gaussian noise simulates electrical variation.
 * Runtime hours accumulate only when running. Dry-run protection auto-stops the pump.
 * @param {object} pump - Mutable pump state
 * @param {object} cfg - Pump configuration from config.pumpStation
 * @param {object} tank - Associated tank state (for dry-run protection)
 * @param {number} dt - Time step in seconds
 */
function updatePump(pump, cfg, tank, dt) {
  // Dry-run protection: stop pump if associated tank level is critically low
  if (pump.running && tank.level < config.pumpStation.dryRunProtectionLevel) {
    pump.running = false;
    pump.fault = true;
    pump.faultCode = 1; // Dry-run protection trip
    console.log(
      `[SIM] Pump dry-run protection activated (tank level ${tank.level.toFixed(1)}%)`
    );
  }

  if (pump.running && !pump.fault) {
    // Current scales linearly with speed, plus noise
    const baseCurrent = (pump.speed / 100.0) * cfg.nominalCurrentAmps;
    pump.current = Math.max(0, baseCurrent + gaussian(0, cfg.currentNoiseStdDev));

    // Accumulate runtime (dt is in seconds, convert to hours)
    pump.runtimeHours += dt / 3600.0;
  } else {
    pump.current = 0.0;
  }
}

/**
 * Advances water quality sensor physics by one tick.
 * pH: Ornstein-Uhlenbeck with occasional step disturbances.
 * Turbidity: baseline noise plus exponentially-decaying spike events.
 * Chlorine: Ornstein-Uhlenbeck.
 * @param {object} q - Mutable quality state
 * @param {number} dt - Time step in seconds (unused but available for future rate scaling)
 */
function updateQuality(q, dt) {
  const phCfg = config.quality.pH;
  const turbCfg = config.quality.turbidity;
  const clCfg = config.quality.chlorine;

  // pH: mean-reverting + noise + occasional step disturbance
  let phDrift = phCfg.reversionRate * (phCfg.mean - q.pH);
  let phNoise = gaussian(0, phCfg.noiseStdDev);
  let phStep = 0;
  if (Math.random() < phCfg.stepDisturbanceProb) {
    phStep = gaussian(0, phCfg.stepDisturbanceMagnitude);
  }
  q.pH = clamp(q.pH + phDrift + phNoise + phStep, phCfg.min, phCfg.max);

  // Turbidity: baseline + noise + spike events
  if (Math.random() < turbCfg.spikeProb) {
    q._turbiditySpike = turbCfg.spikePeak;
    console.log("[SIM] Rain event triggered — turbidity spike");
  }
  q._turbiditySpike *= turbCfg.spikeDecay;
  if (q._turbiditySpike < 0.05) q._turbiditySpike = 0;

  const turbBase = turbCfg.baseline + gaussian(0, turbCfg.noiseStdDev);
  q.turbidity = clamp(turbBase + q._turbiditySpike, turbCfg.min, turbCfg.max);

  // Chlorine residual: mean-reverting
  const clDrift = clCfg.reversionRate * (clCfg.mean - q.chlorine);
  const clNoise = gaussian(0, clCfg.noiseStdDev);
  q.chlorine = clamp(q.chlorine + clDrift + clNoise, clCfg.min, clCfg.max);
}

/**
 * Runs one complete simulation tick across all subsystems.
 * @param {object} state - Full simulation state from createSimulationState()
 */
function tick(state) {
  const dt = config.simulation.tickRateMs / 1000.0;

  updateScenario(state, dt);

  updateTank(state.tank1, config.tankFarm.tank1, dt);
  updateTank(state.tank2, config.tankFarm.tank2, dt);

  updatePump(state.pump1, config.pumpStation.pump1, state.tank1, dt);
  updatePump(state.pump2, config.pumpStation.pump2, state.tank2, dt);

  updateQuality(state.quality, dt);
}

/**
 * Clamps and logs a warning when a client writes an out-of-range value.
 * @param {string} nodeName - Human-readable node path for logging
 * @param {number} value - The value written by the client
 * @param {number} min - Minimum allowed
 * @param {number} max - Maximum allowed
 * @returns {number} The clamped value
 */
function clampWithWarning(nodeName, value, min, max) {
  if (value < min || value > max) {
    const clamped = clamp(value, min, max);
    console.warn(
      `[CLAMP] Client wrote ${value} to ${nodeName}, clamped to ${clamped} (range ${min}–${max})`
    );
    return clamped;
  }
  return value;
}

module.exports = {
  createSimulationState,
  tick,
  startScenario,
  clampWithWarning,
  clamp,
};
