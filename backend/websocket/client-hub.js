"use strict";

function createWebSocketHub({
  WebSocket,
  urlParser,
  state,
  onMessage,
  logger = require("../utils/logger").logger,
}) {
  function sendMessageToClient(clientId, messageObject) {
    const client = state.clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(messageObject));
      } catch (error) {
        logger.error(`Error sending message to ${clientId}:`, error);
      }
    }
  }

  function broadcast(messageObject) {
    for (const [clientId] of state.clients.entries()) {
      sendMessageToClient(clientId, messageObject);
    }
  }

  function hasAnyClientAutoUpdateEnabled() {
    if (state.clientAutoUpdateSettings.size === 0) {
      return true;
    }
    return Array.from(state.clientAutoUpdateSettings.values()).some(
      (enabled) => enabled === true,
    );
  }

  function attach(wss) {
    wss.on("connection", (ws, req) => {
      const parameters = urlParser.parse(req.url, true);
      const clientId = parameters.query.clientId;

      if (!clientId) {
        logger.log("Connection attempt without clientId. Closing.");
        ws.close();
        return;
      }

      state.clients.set(clientId, ws);
      logger.log(
        `Client connected: ${clientId}. Total clients: ${state.clients.size}`,
      );
      sendMessageToClient(clientId, {
        type: "status",
        message: "Successfully connected to the download server.",
      });

      ws.on("message", async (rawMessage) => {
        try {
          const messageData = JSON.parse(rawMessage.toString());
          await onMessage(clientId, messageData);
        } catch (error) {
          logger.error(`Failed to parse message from ${clientId}:`, error);
          sendMessageToClient(clientId, {
            type: "error",
            message: "Invalid message format received.",
          });
        }
      });

      ws.on("close", () => {
        state.clients.delete(clientId);
        state.clientAutoUpdateSettings.delete(clientId);
        logger.log(
          `Client disconnected: ${clientId}. Total clients: ${state.clients.size}`,
        );
      });

      ws.on("error", (error) => {
        logger.error(`WebSocket error for client ${clientId}:`, error);
      });
    });
  }

  return {
    attach,
    broadcast,
    hasAnyClientAutoUpdateEnabled,
    sendMessageToClient,
  };
}

module.exports = {
  createWebSocketHub,
};
