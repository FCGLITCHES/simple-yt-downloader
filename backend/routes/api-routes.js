"use strict";

const os = require("os");
const path = require("path");
const { Resend } = require("resend");

function registerApiRoutes(
  app,
  {
    gracefulShutdown,
    checkAndUpdateTools,
    getToolVersion,
    getLastUpdateCheck,
    setLastUpdateCheck,
    ytdlpExecutable,
    ffmpegExecutable,
    getVideoInfo,
    historyIndex,
    getRecoverableDownloads,
    getScheduledDownloads,
    createScheduledDownload,
    deleteScheduledDownload,
    getFailedDownloads,
    retryFailedDownload,
    retryAllFailedDownloads,
    previewPlaylist,
    logger = require("../utils/logger").logger,
  },
) {
  app.post("/api/send-support-email", async (req, res) => {
    const { email, subject, message, type } = req.body;

    if (!process.env.RESEND_API_KEY) {
      return res
        .status(500)
        .json({ error: "Email service not configured (Missing API Key)" });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
      const data = await resend.emails.send({
        from: "GetVideosLocally <onboarding@resend.dev>",
        to: [process.env.SUPPORT_EMAIL || "youben2025@gmail.com"],
        subject: `[${type || "Support"}] ${subject || "No Subject"}`,
        reply_to: email,
        html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="margin: 0; padding: 0; background-color: #0f1020; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #ffffff;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f1020;">
                            <tr>
                                <td align="center" style="padding: 40px 20px;">
                                    <div style="max-width: 500px; width: 100%; background: transparent;">
                                        <div style="text-align: center; margin-bottom: 40px;">
                                            <img src="https://raw.githubusercontent.com/FCGLITCHES/simple-yt-downloader/main/assets/Logo%201.png" alt="GetVideosLocally" style="width: 64px; height: auto; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                                            <h1 style="margin: 20px 0 5px; font-size: 20px; font-weight: 600; letter-spacing: -0.5px;">Support Request</h1>
                                            <p style="margin: 0; color: #64748b; font-size: 14px;">Incoming message from user</p>
                                        </div>
                                        <div style="background-color: #1a1b2e; border: 1px solid #2d3748; border-radius: 16px; overflow: hidden;">
                                            <div style="padding: 20px 25px; border-bottom: 1px solid #2d3748; background-color: rgba(255,255,255,0.02);">
                                                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                    <tr>
                                                        <td style="padding-bottom: 8px; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Type</td>
                                                        <td align="right" style="padding-bottom: 8px;">
                                                            <span style="background-color: rgba(214, 0, 23, 0.2); color: #ff4d5e; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid rgba(214, 0, 23, 0.3);">${type || "Support"}</span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td style="color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">From</td>
                                                        <td align="right" style="color: #ffffff; font-size: 14px; font-weight: 500;">
                                                            ${email}
                                                        </td>
                                                    </tr>
                                                </table>
                                            </div>
                                            <div style="padding: 30px 25px;">
                                                <div style="font-size: 15px; line-height: 1.6; color: #e2e8f0; white-space: pre-wrap;">${message}</div>
                                            </div>
                                            <div style="padding: 20px 25px; background-color: #161725; border-top: 1px solid #2d3748; text-align: center;">
                                                <a href="mailto:${email}?subject=${encodeURIComponent(`Re: [${type || "Support"}] ${subject || "No Subject"}`)}&body=${encodeURIComponent(`Hi,\n\nThanks for contacting GetVideosLocally Support.\n\n[YOUR RESPONSE HERE]\n\nBest regards,\nGetVideosLocally Team`)}" style="display: inline-block; background-color: #d60017; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; transition: all 0.2s; box-shadow: 0 4px 12px rgba(214, 0, 23, 0.3);">
                                                    Reply to User
                                                </a>
                                            </div>
                                        </div>
                                        <div style="text-align: center; margin-top: 30px;">
                                            <p style="color: #475569; font-size: 12px; margin: 0;">
                                                Client ID: <span style="font-family: monospace; background: #1a1b2e; padding: 2px 6px; border-radius: 4px;">${req.body.clientId || "Unknown"}</span>
                                            </p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `,
      });

      logger.log("Email sent successfully:", data);
      res.status(200).json({ success: true, id: data.id });
    } catch (error) {
      logger.error("Failed to send email:", error);
      res.status(500).json({ error: error.message || "Failed to send email" });
    }
  });

  app.post("/video-info", async (req, res) => {
    const { url: videoUrl, clientId, source = "video" } = req.body;
    if (!videoUrl || !clientId) {
      return res.status(400).json({ error: "URL and Client ID are required." });
    }

    const tempItemId = `info_${source}_${Date.now()}`;
    try {
      const info = await getVideoInfo(clientId, videoUrl, tempItemId);
      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        source,
        availableQualities: info.availableQualities,
      });
    } catch (error) {
      logger.error(`Error in /video-info for ${videoUrl}:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch video info." });
    }
  });

  app.post("/playlist-preview", async (req, res) => {
    const { url: playlistUrl, clientId } = req.body || {};
    if (!playlistUrl || !clientId) {
      return res
        .status(400)
        .json({ error: "Playlist URL and clientId are required." });
    }

    try {
      const preview = await previewPlaylist(String(clientId), String(playlistUrl));
      res.json(preview);
    } catch (error) {
      logger.error("Error in /playlist-preview:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to preview playlist." });
    }
  });

  app.get("/history-index", (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    res.json(historyIndex.getClientHistory(String(clientId)));
  });

  app.post("/history-index/sync", async (req, res) => {
    const { clientId, history } = req.body || {};
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    try {
      const synced = await historyIndex.syncClientHistory(
        String(clientId),
        Array.isArray(history) ? history : [],
      );
      res.json(synced);
    } catch (error) {
      logger.error("[HistoryIndex] Failed to sync client history:", error);
      res.status(500).json({ error: "Failed to sync history index" });
    }
  });

  app.get("/recoverable-downloads", (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    res.json({
      items: getRecoverableDownloads(String(clientId)),
    });
  });

  app.get("/scheduled-downloads", (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    res.json({
      items: getScheduledDownloads(String(clientId)),
    });
  });

  app.post("/scheduled-downloads", async (req, res) => {
    const { clientId, ...requestData } = req.body || {};
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    try {
      const scheduled = await createScheduledDownload(String(clientId), requestData);
      res.json(scheduled);
    } catch (error) {
      logger.error("Error creating scheduled download:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to create scheduled download." });
    }
  });

  app.delete("/scheduled-downloads/:scheduleId", async (req, res) => {
    const clientId = req.query.clientId;
    const { scheduleId } = req.params;
    if (!clientId || !scheduleId) {
      return res.status(400).json({ error: "clientId and scheduleId are required" });
    }

    try {
      const deleted = await deleteScheduledDownload(String(clientId), String(scheduleId));
      res.json(deleted);
    } catch (error) {
      logger.error("Error deleting scheduled download:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to delete scheduled download." });
    }
  });

  app.get("/failed-downloads", (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    res.json({
      items: getFailedDownloads(String(clientId)),
    });
  });

  app.post("/failed-downloads/:itemId/retry", async (req, res) => {
    const { itemId } = req.params;
    const { clientId } = req.body || {};
    if (!clientId || !itemId) {
      return res.status(400).json({ error: "clientId and itemId are required" });
    }

    try {
      const result = await retryFailedDownload(String(clientId), String(itemId));
      res.json(result);
    } catch (error) {
      logger.error("Error retrying failed download:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to retry download." });
    }
  });

  app.post("/failed-downloads/retry-all", async (req, res) => {
    const { clientId } = req.body || {};
    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    try {
      const result = await retryAllFailedDownloads(String(clientId));
      res.json(result);
    } catch (error) {
      logger.error("Error retrying all failed downloads:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to retry failed downloads." });
    }
  });

  app.post("/shutdown", (req, res) => {
    res.json({ message: "Server shutting down..." });
    setTimeout(() => gracefulShutdown(), 100);
  });

  app.post("/update-tools", async (req, res) => {
    try {
      logger.log("🔄 Manual tool update request received");
      const result = await checkAndUpdateTools(true);
      res.json(result);
    } catch (error) {
      logger.error("❌ Error in manual update endpoint:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/tools-status", async (req, res) => {
    try {
      const ytdlpVersion = await getToolVersion(ytdlpExecutable);
      const ffmpegVersion = await getToolVersion(ffmpegExecutable);

      const ytdlpLastCheck = getLastUpdateCheck("ytdlp");
      const ffmpegLastCheck = getLastUpdateCheck("ffmpeg");

      res.json({
        ytdlp: {
          version: ytdlpVersion,
          lastUpdateCheck: ytdlpLastCheck,
          daysSinceLastCheck: Math.round(
            (Date.now() - ytdlpLastCheck) / (1000 * 60 * 60 * 24),
          ),
        },
        ffmpeg: {
          version: ffmpegVersion,
          lastUpdateCheck: ffmpegLastCheck,
          daysSinceLastCheck: Math.round(
            (Date.now() - ffmpegLastCheck) / (1000 * 60 * 60 * 24),
          ),
        },
      });
    } catch (error) {
      logger.error("❌ Error getting tools status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/force-update-tools", async (req, res) => {
    try {
      logger.log("🔄 Force update request received");
      setLastUpdateCheck("ytdlp");
      setLastUpdateCheck("ffmpeg");
      const result = await checkAndUpdateTools();
      res.json(result);
    } catch (error) {
      logger.error("❌ Error in force update endpoint:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/diagnostics", async (req, res) => {
    try {
      const packageJson = require(path.join(process.cwd(), "package.json"));
      const diagnostics = {
        timestamp: new Date().toISOString(),
        application: {
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
        },
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          osType: os.type(),
          osRelease: os.release(),
          osVersion: os.version(),
          totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
          cpuCount: os.cpus().length,
        },
        tools: {
          ytdlp: {
            version: await getToolVersion(ytdlpExecutable),
            path: ytdlpExecutable,
          },
          ffmpeg: {
            version: await getToolVersion(ffmpegExecutable),
            path: ffmpegExecutable,
          },
        },
        environment: {
          electron: process.versions.electron || "N/A",
          chrome: process.versions.chrome || "N/A",
          v8: process.versions.v8 || "N/A",
        },
        flags: {
          nodeEnv: process.env.NODE_ENV || "production",
          ytdlpPath: process.env.YTDLP_PATH || "default",
          ffmpegPath: process.env.FFMPEG_PATH || "default",
        },
      };

      const output = `# GetVideosLocally Diagnostics Bundle
Generated: ${diagnostics.timestamp}

## Application Information
- Name: ${diagnostics.application.name}
- Version: ${diagnostics.application.version}
- Description: ${diagnostics.application.description}

## System Information
- Platform: ${diagnostics.system.platform}
- Architecture: ${diagnostics.system.arch}
- Node.js Version: ${diagnostics.system.nodeVersion}
- OS: ${diagnostics.system.osType} ${diagnostics.system.osRelease}
- OS Version: ${diagnostics.system.osVersion}
- Total Memory: ${diagnostics.system.totalMemory}
- CPU Cores: ${diagnostics.system.cpuCount}

## Tool Versions
### yt-dlp
- Version: ${diagnostics.tools.ytdlp.version}
- Path: ${diagnostics.tools.ytdlp.path}

### FFmpeg
- Version: ${diagnostics.tools.ffmpeg.version}
- Path: ${diagnostics.tools.ffmpeg.path}

## Environment
- Electron Version: ${diagnostics.environment.electron}
- Chrome Version: ${diagnostics.environment.chrome}
- V8 Version: ${diagnostics.environment.v8}

## Configuration Flags
- NODE_ENV: ${diagnostics.flags.nodeEnv}
- YTDLP_PATH: ${diagnostics.flags.ytdlpPath}
- FFMPEG_PATH: ${diagnostics.flags.ffmpegPath}

---

**Note:** This diagnostics bundle contains only system and version information. No personal data, URLs, or sensitive information is included.
`;

      res.setHeader("Content-Type", "text/plain");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="diagnostics-${Date.now()}.txt"`,
      );
      res.send(output);
    } catch (error) {
      logger.error("❌ Error generating diagnostics:", error);
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = {
  registerApiRoutes,
};
