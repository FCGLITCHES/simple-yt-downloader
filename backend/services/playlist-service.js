"use strict";

function createPlaylistService({
  runYtDlpCommand,
  sendMessageToClient,
  logger = require("../utils/logger").logger,
}) {
  async function getPlaylistItems(clientId, playlistUrl, playlistMetaId) {
    const args = [
      "--flat-playlist",
      "--print",
      "%(id)s\t%(title)s",
      playlistUrl,
    ];
    try {
      const { stdout } = await runYtDlpCommand(
        clientId,
        args,
        `playlist_info_${playlistMetaId}`,
        true,
      );
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim() !== "" && line.includes("\t"));
      const items = lines.map((line) => {
        const parts = line.split("\t");
        return { id: parts[0], title: parts[1] || "Untitled Video" };
      });

      if (
        items.length === 0 &&
        stdout.trim() !== "" &&
        !stdout.toLowerCase().includes("error")
      ) {
        sendMessageToClient(clientId, {
          type: "status",
          itemId: playlistMetaId,
          message:
            "Playlist seems empty or contains no downloadable video items.",
        });
      }

      return items;
    } catch (error) {
      logger.error(
        `[${playlistMetaId}] Error fetching playlist items: ${error.message}`,
      );
      sendMessageToClient(clientId, {
        type: "error",
        message: `Failed to get playlist items: ${error.message.substring(0, 100)}`,
        itemId: playlistMetaId,
      });
      throw error;
    }
  }

  async function getPlaylistTitle(clientId, playlistUrl, playlistMetaId) {
    const args = [
      "--flat-playlist",
      "--print",
      "%(playlist_title)s",
      playlistUrl,
    ];
    try {
      const { stdout } = await runYtDlpCommand(
        clientId,
        args,
        `playlist_title_${playlistMetaId}`,
        true,
      );
      const title = stdout.trim().split("\n")[0];
      return title || null;
    } catch (error) {
      logger.error(
        `[${playlistMetaId}] Error fetching playlist title: ${error.message}`,
      );
      return null;
    }
  }

  async function fetchPlaylistContext(clientId, playlistUrl, playlistMetaId) {
    const [items, title] = await Promise.all([
      getPlaylistItems(clientId, playlistUrl, playlistMetaId),
      getPlaylistTitle(clientId, playlistUrl, playlistMetaId),
    ]);

    return { items, title };
  }

  return {
    fetchPlaylistContext,
    getPlaylistItems,
    getPlaylistTitle,
  };
}

module.exports = {
  createPlaylistService,
};
