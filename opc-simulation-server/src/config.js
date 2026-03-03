/**
 * @file config.js
 * @description Central configuration for the OPC UA water treatment simulation server.
 *              All tunable parameters are exposed here for easy adjustment.
 */

"use strict";

const path = require("path");

/** @type {object} Server network and identity configuration */
const server = {
  /** TCP port the OPC UA server listens on */
  port: 4840,
  /** Resource path for the OPC UA endpoint */
  resourcePath: "/UA/WaterTreatment",
  /** Server URI used in OPC UA discovery */
  serverUri: "urn:WaterTreatmentSim",
  /** Human-readable server name */
  productName: "Water Treatment Simulation Server",
  /** Manufacturer for ServerStatus / BuildInfo */
  manufacturer: "OPC-UA-Sim-Lab",
  /** Product model string */
  model: "WaterTreatSim-1000",
  /** Serial number */
  serialNumber: "WTSIM-2025-001",
  /** Path to PKI certificate store (created on first run) */
  pkiDir: path.join(__dirname, "..", "pki"),
};

/** @type {object} Authentication credentials for username/password mode */
const auth = {
  username: "operator",
  password: "password123",
};

/** @type {object} OPC UA namespace configuration */
const namespace = {
  /** Namespace URI registered in the server address space */
  uri: "urn:WaterTreatmentSim",
};

/** @type {object} Simulation engine timing */
const simulation = {
  /** Milliseconds between simulation ticks */
  tickRateMs: 500,
  /** Default OPC UA sampling interval offered to clients (ms) */
  defaultSamplingInterval: 500,
};

/**
 * @type {object} Tank farm parameters
 * @property {object} tank1 - First tank configuration
 * @property {object} tank2 - Second tank configuration
 */
const tankFarm = {
  tank1: {
    /** Starting level (%) */
    initialLevel: 50.0,
    /** Starting temperature (°C) */
    initialTemperature: 22.0,
    /** Maximum fill rate (% per second at 100% valve opening) */
    maxFillRatePerSec: 2.0,
    /** Maximum drain rate (% per second at 100% valve opening, full tank) */
    maxDrainRatePerSec: 1.5,
    /** Temperature drift rate (°C per second, random walk) */
    temperatureDriftRate: 0.02,
    /** Temperature mean-reversion target (°C) */
    temperatureMean: 22.0,
    /** Temperature mean-reversion strength (0–1 per tick) */
    temperatureReversion: 0.005,
  },
  tank2: {
    initialLevel: 35.0,
    initialTemperature: 21.5,
    maxFillRatePerSec: 2.0,
    maxDrainRatePerSec: 1.5,
    temperatureDriftRate: 0.02,
    temperatureMean: 21.5,
    temperatureReversion: 0.005,
  },
};

/** @type {object} Alarm thresholds shared by both tanks */
const alarms = {
  /** Level (%) at which HighHigh alarm activates */
  highHighThreshold: 90.0,
  /** Level (%) at which HighHigh alarm clears (hysteresis) */
  highHighClear: 87.0,
  /** Level (%) at which LowLow alarm activates */
  lowLowThreshold: 10.0,
  /** Level (%) at which LowLow alarm clears (hysteresis) */
  lowLowClear: 13.0,
};

/**
 * @type {object} Pump station parameters
 * @property {object} pump1 - First pump configuration
 * @property {object} pump2 - Second pump configuration
 */
const pumpStation = {
  /** Tank level (%) below which pumps auto-stop for dry-run protection */
  dryRunProtectionLevel: 5.0,
  pump1: {
    /** Full-load current draw (A) */
    nominalCurrentAmps: 12.5,
    /** Standard deviation of current noise (A) */
    currentNoiseStdDev: 0.3,
    /** Which tank this pump draws from (for dry-run protection) */
    associatedTank: "tank1",
  },
  pump2: {
    nominalCurrentAmps: 15.0,
    currentNoiseStdDev: 0.4,
    associatedTank: "tank2",
  },
};

/** @type {object} CSV data logger configuration */
const logging = {
  /** Enable or disable CSV logging */
  enabled: true,
  /** Milliseconds between CSV rows */
  intervalMs: 10_000,
  /** Directory for log files (created automatically) */
  dir: path.join(__dirname, "..", "logs"),
};

/** @type {object} Water quality sensor parameters */
const quality = {
  pH: {
    /** Starting pH value */
    initial: 7.2,
    /** Mean-reversion target */
    mean: 7.2,
    /** Mean-reversion strength per tick */
    reversionRate: 0.003,
    /** Random walk noise standard deviation per tick */
    noiseStdDev: 0.01,
    /** Probability of a step disturbance per tick */
    stepDisturbanceProb: 0.002,
    /** Max magnitude of a step disturbance */
    stepDisturbanceMagnitude: 0.4,
    /** Minimum simulated value */
    min: 4.0,
    /** Maximum simulated value */
    max: 11.0,
  },
  turbidity: {
    /** Baseline turbidity (NTU) */
    baseline: 1.2,
    /** Noise around baseline (NTU std dev) */
    noiseStdDev: 0.1,
    /** Probability of a rain-event spike per tick */
    spikeProb: 0.001,
    /** Peak turbidity during a spike (NTU) */
    spikePeak: 15.0,
    /** Decay rate of spike per tick (multiplier, 0–1) */
    spikeDecay: 0.97,
    /** Minimum value */
    min: 0.0,
    /** Maximum value */
    max: 50.0,
  },
  chlorine: {
    /** Starting chlorine residual (mg/L) */
    initial: 1.5,
    /** Mean-reversion target (mg/L) */
    mean: 1.5,
    /** Mean-reversion strength per tick */
    reversionRate: 0.002,
    /** Noise std dev (mg/L) */
    noiseStdDev: 0.02,
    /** Minimum value */
    min: 0.0,
    /** Maximum value */
    max: 5.0,
  },
};

module.exports = {
  server,
  auth,
  namespace,
  simulation,
  logging,
  tankFarm,
  alarms,
  pumpStation,
  quality,
};
