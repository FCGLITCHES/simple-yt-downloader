"use strict";

const fs = require("fs");
const path = require("path");

const HISTORY_INDEX_VERSION = 1;
const MAX_HISTORY_ITEMS_PER_CLIENT = 500;

function createEmptyState() {
  return {
    version: HISTORY_INDEX_VERSION,
    clients: {},
  };
}

class HistoryIndex {
  constructor({ filePath, logger = require("../utils/logger").logger } = {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.state = createEmptyState();
    this._loadPromise = this.load();
  }

  async load() {
    if (!this.filePath) {
      return;
    }

    try {
      let exists;
      try {
        await fs.promises.access(this.filePath);
        exists = true;
      } catch {
        exists = false;
      }
      if (!exists) {
        return;
      }

      const raw = JSON.parse(await fs.promises.readFile(this.filePath, "utf8"));
      if (
        raw &&
        typeof raw === "object" &&
        raw.clients &&
        typeof raw.clients === "object"
      ) {
        this.state = {
          version: HISTORY_INDEX_VERSION,
          clients: raw.clients,
        };
      }
    } catch (error) {
      this.logger.error("[HistoryIndex] Failed to load history index:", error);
      this.state = createEmptyState();
    }
  }

  async save() {
    if (!this.filePath) {
      return;
    }

    try {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.promises.writeFile(
        this.filePath,
        JSON.stringify(this.state, null, 2),
      );
    } catch (error) {
      this.logger.error("[HistoryIndex] Failed to save history index:", error);
    }
  }

  ensureClient(clientId = "default") {
    if (!this.state.clients[clientId]) {
      this.state.clients[clientId] = {
        updatedAt: new Date().toISOString(),
        items: [],
      };
    }
    return this.state.clients[clientId];
  }

  inferType(entry) {
    if (entry.source === "instagram") {
      return "instagram";
    }

    if (entry.isPlaylistItem || entry.playlistId) {
      return "youtubePlaylists";
    }

    return "youtubeSingles";
  }

  normalizeEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const normalized = {
      clientId: entry.clientId || "default",
      name: entry.name || entry.title || entry.filename || "Download complete",
      path: entry.path || entry.downloadUrl || "",
      fullPath: entry.fullPath || "",
      size: entry.size || entry.actualSize || "",
      mtime: entry.mtime || new Date().toISOString(),
      type: entry.type || this.inferType(entry),
      source: entry.source || "youtube",
      thumbnail: entry.thumbnail || null,
      isPlaylistItem: entry.isPlaylistItem === true,
      playlistId: entry.playlistId || null,
      playlistTitle: entry.playlistTitle || null,
      format: entry.format || null,
      quality: entry.quality || null,
      filename: entry.filename || null,
    };

    if (!normalized.path && !normalized.fullPath) {
      return null;
    }

    return normalized;
  }

  getEntryKey(entry) {
    return entry.fullPath || entry.path || `${entry.name}:${entry.mtime}`;
  }

  async setClientItems(clientId, items) {
    const clientState = this.ensureClient(clientId);
    clientState.items = items.slice(0, MAX_HISTORY_ITEMS_PER_CLIENT);
    clientState.updatedAt = new Date().toISOString();
    await this.save();
    return this.getClientHistory(clientId);
  }

  async syncClientHistory(clientId, history = []) {
    const normalizedItems = history
      .map((item) => this.normalizeEntry({ ...item, clientId }))
      .filter(Boolean);

    return this.setClientItems(clientId, normalizedItems);
  }

  async recordDownload(entry) {
    const normalized = this.normalizeEntry(entry);
    if (!normalized) {
      return null;
    }

    const clientState = this.ensureClient(normalized.clientId);
    const existingIndex = clientState.items.findIndex(
      (item) => this.getEntryKey(item) === this.getEntryKey(normalized),
    );

    if (existingIndex >= 0) {
      clientState.items.splice(existingIndex, 1);
    }

    clientState.items.unshift(normalized);
    clientState.items = clientState.items.slice(
      0,
      MAX_HISTORY_ITEMS_PER_CLIENT,
    );
    clientState.updatedAt = new Date().toISOString();
    await this.save();
    return normalized;
  }

  buildSummary(items) {
    const summary = {
      singles: 0,
      playlists: 0,
      playlistVideos: 0,
      instagram: 0,
    };

    const playlistIds = new Set();

    for (const item of items) {
      if (item.source === "instagram") {
        summary.instagram += 1;
        continue;
      }

      if (item.isPlaylistItem && item.playlistId) {
        summary.playlistVideos += 1;
        playlistIds.add(item.playlistId);
        continue;
      }

      if (item.type === "youtubePlaylists" && item.playlistId) {
        summary.playlistVideos += 1;
        playlistIds.add(item.playlistId);
        continue;
      }

      summary.singles += 1;
    }

    summary.playlists = playlistIds.size;
    return summary;
  }

  getClientHistory(clientId = "default") {
    const clientState = this.ensureClient(clientId);
    const items = Array.isArray(clientState.items)
      ? clientState.items.slice()
      : [];
    return {
      updatedAt: clientState.updatedAt,
      items,
      summary: this.buildSummary(items),
    };
  }
}

module.exports = {
  HistoryIndex,
};
