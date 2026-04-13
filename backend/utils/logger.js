"use strict";

const fs = require("fs");
const path = require("path");

/** @typedef {'debug'|'info'|'warn'|'error'} LogLevel */

const LEVELS = /** @type {const} */ ({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
});

const MAX_LOG_SIZE = 5 * 1024 * 1024;
const MAX_LOG_FILES = 3;
const LOG_FILE = path.join(__dirname, "..", "..", "data", "app.log");

let fileStream = null;

/**
 * Ensure the data directory and log file stream exist.
 */
function ensureFileStream() {
  if (fileStream) return;
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fileStream = fs.createWriteStream(LOG_FILE, {
      flags: "a",
      encoding: "utf8",
    });
    fileStream.on("error", () => {});
  } catch (_e) {
    fileStream = null;
  }
}

/**
 * Rotate log files if the current log exceeds MAX_LOG_SIZE.
 */
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size < MAX_LOG_SIZE) return;

    if (fileStream) {
      fileStream.end();
      fileStream = null;
    }

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(src)) {
        if (i === MAX_LOG_FILES - 1) {
          fs.unlinkSync(src);
        } else {
          fs.renameSync(src, dst);
        }
      }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    fileStream = fs.createWriteStream(LOG_FILE, {
      flags: "a",
      encoding: "utf8",
    });
    fileStream.on("error", () => {});
  } catch (_e) {
    // Rotation is best-effort
  }
}

class Logger {
  /**
   * @param {object} [options]
   * @param {LogLevel} [options.level='info'] - Minimum log level
   * @param {string} [options.context='server'] - Context prefix for log messages
   */
  constructor({ level = "info", context = "server" } = {}) {
    /** @type {LogLevel} */
    this.level = level;
    /** @type {string} */
    this.context = context;
  }

  /**
   * Create a child logger with a sub-context.
   * @param {string} childContext
   * @returns {Logger}
   */
  child(childContext) {
    const context = this.context
      ? `${this.context}:${childContext}`
      : childContext;
    return new Logger({ level: this.level, context });
  }

  /**
   * @param {LogLevel} level
   * @param {Array<*>} args
   */
  _log(level, args) {
    if (LEVELS[level] < LEVELS[this.level]) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]`;

    const parts = args.map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === "object" && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (_e) {
          return String(arg);
        }
      }
      return String(arg);
    });

    const message = `${prefix} ${parts.join(" ")}`;

    const streamFn =
      level === "error"
        ? process.stderr.write.bind(process.stderr)
        : process.stdout.write.bind(process.stdout);
    streamFn(message + "\n");

    ensureFileStream();
    if (fileStream && fileStream.writable) {
      fileStream.write(message + "\n");
    }

    rotateIfNeeded();
  }

  /**
   * Log at debug level.
   * @param {...*} args
   */
  debug(...args) {
    this._log("debug", args);
  }

  /**
   * Log at info level.
   * @param {...*} args
   */
  info(...args) {
    this._log("info", args);
  }

  /**
   * Log at warn level.
   * @param {...*} args
   */
  warn(...args) {
    this._log("warn", args);
  }

  /**
   * Log at error level.
   * @param {...*} args
   */
  error(...args) {
    this._log("error", args);
  }

  /**
   * Log at info level (alias for backward compatibility with console.log).
   * @param {...*} args
   */
  log(...args) {
    this._log("info", args);
  }
}

const logger = new Logger({
  level: process.env.LOG_LEVEL || "info",
  context: "server",
});

module.exports = { Logger, logger };
