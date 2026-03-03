/**
 * @file logger.js
 * @description CSV data logger for the water treatment simulation.
 *              Writes a timestamped row of all numeric values at a configurable
 *              interval. Rolls to a new file at midnight (YYYY-MM-DD naming).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

const CSV_HEADER = [
  "timestamp",
  "tank1_level",
  "tank1_fill_valve",
  "tank1_drain_valve",
  "tank1_temperature",
  "tank2_level",
  "tank2_fill_valve",
  "tank2_drain_valve",
  "tank2_temperature",
  "pump1_speed",
  "pump1_current",
  "pump1_runtime_hours",
  "pump1_fault_code",
  "pump2_speed",
  "pump2_current",
  "pump2_runtime_hours",
  "pump2_fault_code",
  "quality_ph",
  "quality_turbidity",
  "quality_chlorine_residual",
].join(",");

/**
 * Formats a Date as YYYY-MM-DD using local time.
 * @param {Date} date
 * @returns {string}
 */
function dateStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date as an ISO 8601 string in local time with timezone offset.
 * @param {Date} date
 * @returns {string}
 */
function isoLocal(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}${sign}${hh}:${mm}`;
}

/**
 * Returns the full path for today's CSV log file.
 * @param {Date} now
 * @returns {string}
 */
function logFilePath(now) {
  return path.join(config.logging.dir, `simulation_${dateStamp(now)}.csv`);
}

/**
 * Creates a CSV data logger that snapshots simulation state to disk.
 * The logger manages its own write stream and handles date-rolling automatically.
 *
 * @returns {{ start: (simState: object) => void, stop: () => void }}
 */
function createLogger() {
  let stream = null;
  let currentDate = null;
  let interval = null;

  /**
   * Ensures the logs directory exists and opens (or rolls) the write stream
   * for the current date. Writes a CSV header if the file is new.
   * @param {Date} now
   */
  function ensureStream(now) {
    const today = dateStamp(now);
    if (currentDate === today && stream) return;

    // Close previous day's stream if rolling
    if (stream) {
      stream.end();
    }

    fs.mkdirSync(config.logging.dir, { recursive: true });

    const filePath = logFilePath(now);
    const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;

    stream = fs.createWriteStream(filePath, { flags: "a" });
    currentDate = today;

    if (!fileExists) {
      stream.write(CSV_HEADER + "\n");
    }

    console.log(`[LOG] Writing CSV to ${filePath}`);
  }

  /**
   * Writes one CSV row from the current simulation state.
   * @param {object} state - Simulation state from createSimulationState()
   */
  function writeRow(state) {
    const now = new Date();
    ensureStream(now);

    const row = [
      isoLocal(now),
      state.tank1.level.toFixed(4),
      state.tank1.fillValve.toFixed(2),
      state.tank1.drainValve.toFixed(2),
      state.tank1.temperature.toFixed(4),
      state.tank2.level.toFixed(4),
      state.tank2.fillValve.toFixed(2),
      state.tank2.drainValve.toFixed(2),
      state.tank2.temperature.toFixed(4),
      state.pump1.speed.toFixed(2),
      state.pump1.current.toFixed(4),
      state.pump1.runtimeHours.toFixed(6),
      state.pump1.faultCode,
      state.pump2.speed.toFixed(2),
      state.pump2.current.toFixed(4),
      state.pump2.runtimeHours.toFixed(6),
      state.pump2.faultCode,
      state.quality.pH.toFixed(4),
      state.quality.turbidity.toFixed(4),
      state.quality.chlorine.toFixed(4),
    ].join(",");

    stream.write(row + "\n");
  }

  return {
    /**
     * Starts the periodic CSV logger.
     * @param {object} simState - Live simulation state reference
     */
    start(simState) {
      if (!config.logging.enabled) {
        console.log("[LOG] CSV logging disabled in config");
        return;
      }

      // Write first row immediately, then at interval
      writeRow(simState);

      interval = setInterval(() => {
        writeRow(simState);
      }, config.logging.intervalMs);

      console.log(
        `[LOG] CSV logger started (interval: ${config.logging.intervalMs / 1000}s)`
      );
    },

    /**
     * Stops the logger and flushes the write stream.
     */
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (stream) {
        stream.end();
        stream = null;
        currentDate = null;
      }
      console.log("[LOG] CSV logger stopped");
    },
  };
}

module.exports = { createLogger };
