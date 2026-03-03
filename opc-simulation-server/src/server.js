/**
 * @file server.js
 * @description Entry point for the OPC UA Water Treatment Simulation Server.
 *              Initializes the OPC UA server with security policies, builds the
 *              address space, starts the simulation loop, and handles graceful shutdown.
 */

"use strict";

const opcua = require("node-opcua");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { buildAddressSpace, syncNodesToState } = require("./addressSpace");
const { createSimulationState, tick } = require("./simulation");
const { createLogger } = require("./logger");

/**
 * Ensures the PKI directory exists for certificate storage.
 */
function ensurePkiDir() {
  if (!fs.existsSync(config.server.pkiDir)) {
    fs.mkdirSync(config.server.pkiDir, { recursive: true });
    console.log(`[INIT] Created PKI directory at ${config.server.pkiDir}`);
  }
}

/**
 * Constructs and configures the OPC UA server instance.
 * @returns {opcua.OPCUAServer} Configured but not yet started server
 */
function createServer() {
  ensurePkiDir();

  const server = new opcua.OPCUAServer({
    port: config.server.port,
    resourcePath: config.server.resourcePath,

    buildInfo: {
      productName: config.server.productName,
      productUri: config.server.serverUri,
      manufacturerName: config.server.manufacturer,
      softwareVersion: "1.0.0",
      buildNumber: config.server.serialNumber,
      buildDate: new Date(),
    },

    serverInfo: {
      applicationUri: config.server.serverUri,
      productUri: config.server.serverUri,
      applicationName: { text: config.server.productName },
    },

    // Security policies: None, Basic256Sha256-Sign, Basic256Sha256-SignAndEncrypt
    securityPolicies: [
      opcua.SecurityPolicy.None,
      opcua.SecurityPolicy.Basic256Sha256,
    ],
    securityModes: [
      opcua.MessageSecurityMode.None,
      opcua.MessageSecurityMode.Sign,
      opcua.MessageSecurityMode.SignAndEncrypt,
    ],

    // PKI certificate configuration
    serverCertificateManager: new opcua.OPCUACertificateManager({
      automaticallyAcceptUnknownCertificate: true,
      rootFolder: config.server.pkiDir,
    }),

    // Allow anonymous + username/password
    allowAnonymous: true,
    userManager: {
      isValidUser: (userName, password) => {
        return (
          userName === config.auth.username && password === config.auth.password
        );
      },
    },

  });

  return server;
}

/**
 * Prints a formatted summary of all browseable nodes to the console.
 * @param {object} nodes - Node references from buildAddressSpace()
 */
function printNodeList(nodes) {
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│                    Browseable Nodes                        │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  const entries = [
    ["WaterTreatment/TankFarm/Tank1/Level",       "Double", "RO", "0–100 %"],
    ["WaterTreatment/TankFarm/Tank1/FillValve",    "Double", "RW", "0–100 %"],
    ["WaterTreatment/TankFarm/Tank1/DrainValve",   "Double", "RW", "0–100 %"],
    ["WaterTreatment/TankFarm/Tank1/HighHighAlarm", "Boolean", "RO", "—"],
    ["WaterTreatment/TankFarm/Tank1/LowLowAlarm",  "Boolean", "RO", "—"],
    ["WaterTreatment/TankFarm/Tank1/Temperature",   "Double", "RO", "°C"],
    ["WaterTreatment/TankFarm/Tank2/Level",       "Double", "RO", "0–100 %"],
    ["WaterTreatment/TankFarm/Tank2/FillValve",    "Double", "RW", "0–100 %"],
    ["WaterTreatment/TankFarm/Tank2/DrainValve",   "Double", "RW", "0–100 %"],
    ["WaterTreatment/TankFarm/Tank2/HighHighAlarm", "Boolean", "RO", "—"],
    ["WaterTreatment/TankFarm/Tank2/LowLowAlarm",  "Boolean", "RO", "—"],
    ["WaterTreatment/TankFarm/Tank2/Temperature",   "Double", "RO", "°C"],
    ["WaterTreatment/PumpStation/Pump1/Running",    "Boolean", "RW", "true/false"],
    ["WaterTreatment/PumpStation/Pump1/Speed",      "Double", "RW", "0–100 %"],
    ["WaterTreatment/PumpStation/Pump1/Current",    "Double", "RO", "A"],
    ["WaterTreatment/PumpStation/Pump1/RuntimeHours","Double", "RO", "hours"],
    ["WaterTreatment/PumpStation/Pump1/Fault",      "Boolean", "RW", "write false to clear"],
    ["WaterTreatment/PumpStation/Pump1/FaultCode",  "Int32",  "RO", "0=none, 1=dry-run"],
    ["WaterTreatment/PumpStation/Pump2/Running",    "Boolean", "RW", "true/false"],
    ["WaterTreatment/PumpStation/Pump2/Speed",      "Double", "RW", "0–100 %"],
    ["WaterTreatment/PumpStation/Pump2/Current",    "Double", "RO", "A"],
    ["WaterTreatment/PumpStation/Pump2/RuntimeHours","Double", "RO", "hours"],
    ["WaterTreatment/PumpStation/Pump2/Fault",      "Boolean", "RW", "write false to clear"],
    ["WaterTreatment/PumpStation/Pump2/FaultCode",  "Int32",  "RO", "0=none, 1=dry-run"],
    ["WaterTreatment/QualityMonitoring/pH",         "Double", "RO", "pH units"],
    ["WaterTreatment/QualityMonitoring/Turbidity",  "Double", "RO", "NTU"],
    ["WaterTreatment/QualityMonitoring/ChlorineResidual","Double","RO","mg/L"],
  ];

  for (const [nodePath, type, access, range] of entries) {
    const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
    console.log(
      `│ ${pad(nodePath, 46)} ${pad(type, 8)} ${pad(access, 3)} ${range}`
    );
  }

  console.log("└─────────────────────────────────────────────────────────────┘");
  console.log(`  Total: ${entries.length} nodes (RW = writable by clients)\n`);
}

/**
 * Main startup sequence.
 * Initializes server, builds address space, starts simulation, logs status.
 */
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  OPC UA Water Treatment Simulation Server");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const server = createServer();

  console.log("[INIT] Initializing OPC UA server...");
  await server.initialize();

  // Register namespace
  const ns = server.engine.addressSpace.getOwnNamespace();
  console.log(`[INIT] Namespace: ${ns.namespaceUri} (index ${ns.index})`);

  // Build address space
  const simState = createSimulationState();
  const nodes = buildAddressSpace(server, simState);
  console.log("[INIT] Address space constructed");

  // Start server
  await server.start();

  const endpointUrl = server.getEndpointUrl();
  console.log(`\n[READY] Server listening at: ${endpointUrl}`);
  console.log(`[READY] Port: ${config.server.port}`);

  // Print security policies
  console.log("\n[SECURITY] Active security policies:");
  const endpoints = server.endpoints.flatMap((ep) =>
    ep.endpointDescriptions()
  );
  const seen = new Set();
  for (const ep of endpoints) {
    const key = `${ep.securityPolicyUri} / ${opcua.MessageSecurityMode[ep.securityMode]}`;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`  • ${key}`);
    }
  }

  console.log("\n[AUTH] Anonymous access: enabled");
  console.log(`[AUTH] Username/password: ${config.auth.username} / ****`);

  printNodeList(nodes);

  // Start simulation loop
  let running = true;
  const simInterval = setInterval(() => {
    if (!running) return;
    tick(simState);
    syncNodesToState(nodes, simState);
  }, config.simulation.tickRateMs);

  console.log(
    `[SIM] Simulation running (tick rate: ${config.simulation.tickRateMs}ms)`
  );

  // Start CSV data logger
  const logger = createLogger();
  logger.start(simState);

  // Graceful shutdown
  async function shutdown(signal) {
    if (!running) return;
    running = false;
    console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);
    clearInterval(simInterval);
    logger.stop();
    try {
      await server.shutdown(1000);
      console.log("[SHUTDOWN] Server stopped cleanly.");
    } catch (err) {
      console.error("[SHUTDOWN] Error during shutdown:", err.message);
    }
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[FATAL] Server failed to start:", err);
  process.exit(1);
});
