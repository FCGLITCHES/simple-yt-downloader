// server.js - Backend logic for Simple YTD
const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const url = require('url'); // For parsing WebSocket connection URL
const os = require('os'); // For platform-specific operations if needed
const cluster = require('cluster');
const net = require('net');

// Add port availability check
async function getAvailablePort(preferredPort = 3000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(preferredPort, (err) => {
      if (err) {
        server.listen(0, (err) => {
          if (err) reject(err);
          else {
            const port = server.address().port;
            server.close(() => resolve(port));
          }
        });
      } else {
        server.close(() => resolve(preferredPort));
      }
    });
  });
}

// At the very top of server.js
console.log("[server.js] Server process started.");
console.log("[server.js] Received YTDLP_PATH from env: ", process.env.YTDLP_PATH);
console.log("[server.js] Received FFMPEG_PATH from env: ", process.env.FFMPEG_PATH);

(async () => {
  // Dynamically import open (ESM)
  const open = (await import('open')).default;
  // Dynamically import get-port (ESM)
  const getPort = (await import('get-port')).default;

  // Replace the current port assignment with:
  const PORT = process.env.PORT || await getAvailablePort(3000);
  let DOWNLOAD_DIR = path.join(__dirname, 'downloads');
  // Safety: Never allow app.asar or app.asa in the path
  if (DOWNLOAD_DIR.includes('app.asar') || DOWNLOAD_DIR.includes('app.asa')) {
    DOWNLOAD_DIR = path.join(process.resourcesPath || __dirname, 'downloads');
  }
  console.log('[server.js] FINAL DOWNLOAD_DIR:', DOWNLOAD_DIR);
  if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  // Use bin/yt-dlp.exe and bin/ffmpeg.exe if env not set and files exist
  let ytdlpExecutable = process.env.YTDLP_PATH;
  let ffmpegExecutable = process.env.FFMPEG_PATH;
  if (!ytdlpExecutable && fs.existsSync(path.join(__dirname, 'bin', 'yt-dlp.exe'))) {
    ytdlpExecutable = path.join(__dirname, 'bin', 'yt-dlp.exe');
  } else if (!ytdlpExecutable) {
    ytdlpExecutable = 'yt-dlp';
  }
  if (!ffmpegExecutable && fs.existsSync(path.join(__dirname, 'bin', 'ffmpeg.exe'))) {
    ffmpegExecutable = path.join(__dirname, 'bin', 'ffmpeg.exe');
  } else if (!ffmpegExecutable) {
    ffmpegExecutable = 'ffmpeg';
  }

  // Patch global variables if needed
  global.ytdlpExecutable = ytdlpExecutable;
  global.ffmpegExecutable = ffmpegExecutable;

  console.log("[server.js] Effective ytdlpExecutable: ", ytdlpExecutable);
  console.log("[server.js] Effective ffmpegExecutable: ", ffmpegExecutable);
  // ... rest of your server.js code

  // Dynamically import p-limit
  let pLimit;
  import('p-limit').then(module => {
      pLimit = module.default;
      // Initialize limiters after p-limit is loaded
      singleVideoProcessingLimit = pLimit(1); // Default to 1 for single videos initially
      playlistItemProcessingLimit = pLimit(3); // Default for items within a playlist
      console.log('p-limit loaded and limiters initialized.');
      console.log(`Using yt-dlp: ${ytdlpExecutable}`);
      console.log(`Using ffmpeg: ${ffmpegExecutable}`);
  }).catch(err => console.error("Failed to load p-limit:", err));


  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // --- Global State ---
  const clients = new Map(); // Stores connected WebSocket clients (clientId -> ws)
  const activeProcesses = new Map(); // Stores active yt-dlp/ffmpeg processes (itemId -> { ytdlpProc, ffmpegProc, tempFiles: [], cancelled: false })
  const downloadQueue = new Map(); // Stores item details before processing (itemId -> { clientId, videoUrl, format, quality, source, settings, isPlaylistItem, playlistIndex, status: 'queued' })

  let singleVideoProcessingLimit; // To be initialized after p-limit loads
  let playlistItemProcessingLimit; // To be initialized after p-limit loads


  // --- Middleware ---
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors({
      origin: '*', // Allow all origins for simplicity in local dev; restrict in production
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      allowedHeaders: 'Content-Type,Authorization',
  }));
  app.use(express.static(__dirname)); // Serves index.html, style.css, script.js, assets
  app.use('/downloads', express.static(DOWNLOAD_DIR, {
      setHeaders: (res, filePath) => {
          // Ensure correct headers for direct download links
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(filePath))}"`);
      }
  }));


  // --- WebSocket Handling ---
  wss.on('connection', (ws, req) => {
      const parameters = url.parse(req.url, true);
      const clientId = parameters.query.clientId;

      if (!clientId) {
          console.log('Connection attempt without clientId. Closing.');
          ws.close();
          return;
      }

      clients.set(clientId, ws);
      console.log(`Client connected: ${clientId}. Total clients: ${clients.size}`);
      sendMessageToClient(clientId, { type: 'status', message: 'Successfully connected to the download server.' });

      ws.on('message', async (rawMessage) => {
          console.log(`Received message from ${clientId}: ${rawMessage.toString().substring(0, 200)}`); // Log only part of message if too long
          try {
              const messageData = JSON.parse(rawMessage.toString()); // Ensure rawMessage is string
              const { type, itemId } = messageData;

              if (type === 'download_request') {
                  await handleDownloadRequest(clientId, messageData);
              } else if (type === 'cancel' && itemId) {
                  await handleCancelRequest(clientId, itemId);
              } else {
                  console.warn(`Unknown message type from ${clientId}: ${type}`);
              }
          } catch (parseError) {
              console.error(`Failed to parse message from ${clientId}: ${rawMessage.toString()}`, parseError);
              sendMessageToClient(clientId, { type: 'error', message: 'Invalid message format received.' });
          }
      });

      ws.on('close', () => {
          clients.delete(clientId);
          console.log(`Client disconnected: ${clientId}. Total clients: ${clients.size}`);
          // Optional: Iterate over activeProcesses and downloadQueue to cancel/cleanup items associated with this clientId
          // This is important if a client disconnects abruptly.
          // For now, processes might continue until completion or error unless explicitly cancelled.
      });

      ws.on('error', (error) => {
          console.error(`WebSocket error for client ${clientId}:`, error);
          // Consider removing client from map on error too
      });
  });

  function sendMessageToClient(clientId, messageObject) {
      const client = clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
          try {
              client.send(JSON.stringify(messageObject));
              // console.log(`Sent to ${clientId} (itemId: ${messageObject.itemId || 'N/A'}):`, messageObject.type, messageObject.message ? messageObject.message.substring(0,50) : '');
          } catch (error) {
              console.error(`Error sending message to ${clientId}:`, error);
          }
      }
  }

  // --- Download Request Handling ---
  async function handleDownloadRequest(clientId, requestData) {
      const { url: videoUrl, format, quality, source, playlistAction, concurrency, singleConcurrency, ...settings } = requestData;

      if (!videoUrl) {
          return sendMessageToClient(clientId, { type: 'error', message: 'Missing video URL.' });
      }
      if (!pLimit || !singleVideoProcessingLimit || !playlistItemProcessingLimit) { // Check if limiters are initialized
           return sendMessageToClient(clientId, { type: 'error', message: 'Server not ready (concurrency limiters not initialized). Please try again shortly.' });
      }


      const isPlaylist = source === 'youtube' && videoUrl.includes('list=');

      if (isPlaylist && playlistAction === 'full') {
          const playlistMetaId = `playlist_${source}_${Date.now()}`;
          // Store minimal info for the meta item, actual processing happens on individual items
          downloadQueue.set(playlistMetaId, { status: 'processing_playlist', title: `Playlist from ${videoUrl}`, source: source, clientId: clientId, isMeta: true });
          sendMessageToClient(clientId, { type: 'queued', itemId: playlistMetaId, title: `Fetching playlist: ${videoUrl}`, source });

          let playlistFolderPath = null;
          try {
              const items = await getPlaylistItems(clientId, videoUrl, playlistMetaId);
              if (downloadQueue.get(playlistMetaId)?.cancelled) {
                  console.log(`[${playlistMetaId}] Playlist processing cancelled before starting items.`);
                  downloadQueue.delete(playlistMetaId);
                  return;
              }
              sendMessageToClient(clientId, { type: 'status', itemId: playlistMetaId, message: `Found ${items.length} items in playlist. Queuing downloads...`, source });

              // Determine playlist folder name from playlist title (not first item)
              const playlistTitle = await getPlaylistTitle(clientId, videoUrl, playlistMetaId) || items[0]?.title || `Playlist_${Date.now()}`;
              playlistFolderPath = getUniqueFolderPath(DOWNLOAD_DIR, sanitizeFilename(playlistTitle));
              if (!fs.existsSync(playlistFolderPath)) fs.mkdirSync(playlistFolderPath, { recursive: true });

              // Update playlist concurrency limit if provided
              const newPlaylistConcurrency = parseInt(concurrency) || 3; // Default to 3
              if (playlistItemProcessingLimit.concurrency !== newPlaylistConcurrency) {
                  console.log(`Updating playlist item concurrency to: ${newPlaylistConcurrency}`);
                  playlistItemProcessingLimit = pLimit(newPlaylistConcurrency);
              }

              const downloadPromises = items.map((item, index) => {
                  const individualItemId = `${source}_${item.id}_${Date.now()}_${index}`;
                  const itemData = {
                      clientId, videoUrl: item.id, // Use item.id as the URL for individual processing
                      format, quality, source, settings,
                      isPlaylistItem: true, playlistIndex: index,
                      status: 'queued', parentPlaylistId: playlistMetaId,
                      title: item.title || `Video ${index + 1}`,
                      playlistFolderPath // Pass the SAME folder path to each item
                  };
                  downloadQueue.set(individualItemId, itemData);
                  sendMessageToClient(clientId, { 
                      type: 'queued', 
                      itemId: individualItemId, 
                      title: itemData.title, 
                      source, 
                      estimatedSize: "Fetching...",
                      isPlaylistItem: itemData.isPlaylistItem || false,
                      playlistIndex: itemData.playlistIndex || null
                  });

                  return playlistItemProcessingLimit(async () => {
                      if (downloadQueue.get(playlistMetaId)?.cancelled || downloadQueue.get(individualItemId)?.cancelled) {
                          sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Skipped due to cancellation.', itemId: individualItemId, source });
                          downloadQueue.delete(individualItemId);
                          return;
                      }
                      if (source === 'youtube') {
                          await processSingleVideo(clientId, individualItemId, itemData);
                      }
                      // Add other sources for playlist items if needed
                  });
              });
              await Promise.all(downloadPromises);
              if (!downloadQueue.get(playlistMetaId)?.cancelled) {
                  sendMessageToClient(clientId, { type: 'playlist_complete', message: 'All playlist items processed.', itemId: playlistMetaId, source });
              }
          } catch (error) {
              console.error(`Error processing playlist ${playlistMetaId}:`, error);
              if (!downloadQueue.get(playlistMetaId)?.cancelled) {
                  sendMessageToClient(clientId, { type: 'error', message: `Playlist processing error: ${error.message}`, itemId: playlistMetaId, source });
              }
          } finally {
              downloadQueue.delete(playlistMetaId);
          }
      } else { // Single video or single item from playlist (if playlistAction === 'single')
          const itemId = `${source}_${(videoUrl.split('v=')[1]?.split('&')[0] || videoUrl.split('/').pop()?.split('?')[0] || Date.now())}_${Math.random().toString(36).substring(2, 7)}`;
          const itemData = {
              clientId, videoUrl, format, quality, source, settings,
              isPlaylistItem: isPlaylist && playlistAction === 'single', // Mark if it's a single video from a playlist URL
              status: 'queued',
              title: `Video: ${videoUrl}` // Placeholder, will be updated by getVideoInfo
          };
          downloadQueue.set(itemId, itemData);
          sendMessageToClient(clientId, { type: 'queued', itemId: itemId, title: itemData.title, source, estimatedSize: "Fetching..." });


          // Update single video concurrency limit if provided and different
          const newSingleConcurrency = parseInt(singleConcurrency) || 1;
          if (singleVideoProcessingLimit.concurrency !== newSingleConcurrency) {
              console.log(`Updating single video concurrency to: ${newSingleConcurrency}`);
              singleVideoProcessingLimit = pLimit(newSingleConcurrency);
          }

          singleVideoProcessingLimit(async () => {
              if (downloadQueue.get(itemId)?.cancelled) {
                  sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Download cancelled before start.', itemId: itemId, source });
                  downloadQueue.delete(itemId);
                  return;
              }
              if (source === 'youtube') {
                  await processSingleVideo(clientId, itemId, itemData);
              } else if (source === 'instagram') {
                  await processInstagramVideo(clientId, itemId, itemData);
              } else {
                  sendMessageToClient(clientId, { type: 'error', message: `Unsupported source: ${source}`, itemId: itemId, source });
                  downloadQueue.delete(itemId);
              }
          });
      }
  }

  // --- Cancellation Handling ---
  async function handleCancelRequest(clientId, itemId) {
      sendMessageToClient(clientId, { type: 'status', message: 'Cancellation request received...', itemId });

      const queuedItem = downloadQueue.get(itemId);
      if (queuedItem) {
          queuedItem.cancelled = true;
          // If it's a playlist meta item, mark all its children as cancelled too
          if (queuedItem.isMeta) { // Check if it's the playlist meta item
              downloadQueue.forEach(item => {
                  if (item.parentPlaylistId === itemId) item.cancelled = true;
              });
          }
          sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Download cancelled from queue.', itemId });
          // No process to kill yet if it's only in queue. It will be skipped when its turn comes.
          return;
      }

      const processInfo = activeProcesses.get(itemId);
      if (processInfo) {
          processInfo.cancelled = true; // Mark for internal checks
          try {
              if (processInfo.ytdlpProc && processInfo.ytdlpProc.pid && !processInfo.ytdlpProc.killed) {
                  console.log(`[${itemId}] Terminating yt-dlp process (PID: ${processInfo.ytdlpProc.pid})`);
                  terminateProcessTree(processInfo.ytdlpProc.pid);
                  processInfo.ytdlpProc.killed = true; // Mark as killed to avoid re-killing
              }
              if (processInfo.ffmpegProc && processInfo.ffmpegProc.pid && !processInfo.ffmpegProc.killed) {
                  console.log(`[${itemId}] Terminating ffmpeg process (PID: ${processInfo.ffmpegProc.pid})`);
                  terminateProcessTree(processInfo.ffmpegProc.pid);
                  processInfo.ffmpegProc.killed = true;
              }
          } catch (killError) {
              console.error(`Error during process termination for ${itemId}:`, killError);
          }

          // Cleanup temporary files associated with this item
          processInfo.tempFiles?.forEach(filePathPattern => {
               // Glob to find actual temp files (since %(ext)s makes names variable)
              const glob = require('glob'); // Local require for utility
              const files = glob.sync(path.basename(filePathPattern), { cwd: path.dirname(filePathPattern) });
              files.forEach(file => {
                  const fullPath = path.join(path.dirname(filePathPattern), file);
                  if (fs.existsSync(fullPath)) {
                      try {
                          fs.unlinkSync(fullPath);
                          console.log(`[${itemId}] Deleted temp file on cancel: ${fullPath}`);
                      } catch (unlinkError) {
                          console.error(`[${itemId}] Error deleting temp file ${fullPath} on cancel:`, unlinkError);
                      }
                  }
              });
          });
          sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Download cancellation initiated.', itemId });
      } else {
          sendMessageToClient(clientId, { type: 'error', message: 'Item not found or already completed/cancelled.', itemId });
      }
  }

  function terminateProcessTree(pid) {
      console.log(`[terminateProcessTree] Attempting to terminate PID: ${pid}`);
      if (os.platform() === 'win32') {
          exec(`taskkill /PID ${pid} /T /F`, (error, stdout, stderr) => {
              if (error) console.error(`[terminateProcessTree] taskkill error for PID ${pid}: ${error.message}`);
              // if (stdout) console.log(`[terminateProcessTree] taskkill stdout for PID ${pid}: ${stdout}`); // Often noisy
              if (stderr && !stderr.toLowerCase().includes("could not be terminated") && !stderr.toLowerCase().includes("not found")) {
                   console.error(`[terminateProcessTree] taskkill stderr for PID ${pid}: ${stderr}`);
              }
          });
      } else { // For macOS and Linux
          try {
              // Send SIGTERM to the process group. The negative PID kills the group.
              // This requires the child process to be started in its own process group (e.g. {detached: true} on spawn for non-Windows)
              process.kill(-pid, 'SIGTERM');
              console.log(`[terminateProcessTree] Sent SIGTERM to process group ${-pid}`);
          } catch (err) {
              console.warn(`[terminateProcessTree] Error sending SIGTERM to process group ${-pid}: ${err.message}. Trying direct PID.`);
              try {
                  process.kill(pid, 'SIGTERM'); // Fallback to direct PID
                  console.log(`[terminateProcessTree] Sent SIGTERM to PID ${pid}`);
              } catch (e2) {
                  console.warn(`[terminateProcessTree] Error sending SIGTERM to PID ${pid}: ${e2.message}. Trying SIGKILL.`);
                  try {
                      process.kill(pid, 'SIGKILL'); // Force kill if SIGTERM fails
                      console.log(`[terminateProcessTree] Sent SIGKILL to PID ${pid}.`);
                  } catch (e3) {
                      console.error(`[terminateProcessTree] Error SIGKILLing PID ${pid}: ${e3.message}`);
                  }
              }
          }
      }
  }


  // --- Video Processing Logic ---
  function formatBytes(bytesInput, decimals = 2) {
      if (!bytesInput || bytesInput === 'N/A' || bytesInput === 'NA' || isNaN(parseFloat(bytesInput))) return null;
      const bytes = parseFloat(bytesInput);
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, Math.min(i, sizes.length - 1))).toFixed(dm)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
  }

  // Enhanced getVideoInfo with quality- and container-aware size estimation
  async function getVideoInfo(clientId, videoUrl, itemId, requestedQuality = 'highest', format = 'mp4') {
      const baseArgs = ['--no-playlist', '--skip-download', '--print-json', videoUrl];
      try {
          const { stdout } = await runYtDlpCommand(clientId, baseArgs, `info_${itemId}`, true);
          const info = JSON.parse(stdout.trim());
          const title = info.title || 'video';
          let estimatedSize = null;
          let thumbnail = info.thumbnail || null;
          // Calculate size based on requested quality and format/container
          if (info.formats && Array.isArray(info.formats)) {
              let selectedFormat = null;
              let selectedVideo = null;
              let selectedAudio = null;
              const audioContainers = new Set(['mp3','m4a','aac','wav','flac','opus']);
              const videoContainers = new Set(['mp4','mkv','webm','avi','mov']);
              if (audioContainers.has(format)) {
                  // For MP3, find best audio format
                  const audioFormats = info.formats.filter(f => f.acodec && f.acodec !== 'none');
                  if (audioFormats.length > 0) {
                      if (requestedQuality === 'highest') {
                          selectedFormat = audioFormats.reduce((best, current) => 
                              (current.abr || 0) > (best.abr || 0) ? current : best
                          );
                      } else {
                          const targetBitrate = parseInt(requestedQuality) || 128;
                          selectedFormat = audioFormats.find(f => (f.abr || 128) <= targetBitrate) || audioFormats[0];
                      }
                  }
                  // Estimate final container overhead; lossless formats bigger
                  if (selectedFormat) {
                      const baseSize = selectedFormat.filesize || selectedFormat.filesize_approx || null;
                      if (baseSize) {
                          const containerMultiplier = (format === 'flac' || format === 'wav') ? 1.15 : 1.05;
                          estimatedSize = Math.round(baseSize * containerMultiplier);
                      }
                  }
              } else if (videoContainers.has(format)) {
                  // For MP4, find best video format matching quality
                  const targetHeight = requestedQuality === 'highest' ? 9999 : parseInt(requestedQuality) || 720;
              const videoFormats = info.formats.filter(f => 
                      f.vcodec && f.vcodec !== 'none' && f.height && f.height <= targetHeight
                  );
                  if (videoFormats.length > 0) {
                      // Get the best quality that matches the target
                      selectedVideo = videoFormats.reduce((best, current) => 
                          (current.height || 0) > (best.height || 0) ? current : best
                      );
                      // Pick bestaudio
                      const audioFormats = info.formats.filter(f => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none');
                      if (audioFormats.length > 0) {
                          selectedAudio = audioFormats.reduce((best, current) => (current.abr || 0) > (best.abr || 0) ? current : best);
                      }
                      const videoSize = (selectedVideo && (selectedVideo.filesize || selectedVideo.filesize_approx)) || null;
                      let audioSize = (selectedAudio && (selectedAudio.filesize || selectedAudio.filesize_approx)) || null;
                      if (!audioSize && selectedAudio && info.duration && selectedAudio.abr) {
                          audioSize = Math.round((selectedAudio.abr * 1000 / 8) * info.duration);
                      }
                      if (videoSize) {
                          const base = videoSize + (audioSize || 0);
                          const containerOverhead = 0.06;
                          estimatedSize = Math.round(base * (1 + containerOverhead));
                      }
                  }
              }
              if (selectedFormat && selectedFormat.filesize) {
                  estimatedSize = selectedFormat.filesize;
              }
          }
          // Fallback to general filesize
          if (!estimatedSize) {
              estimatedSize = info.filesize || info.filesize_approx || null;
          }
          // If still no estimate, approximate from bitrate * duration
          if (!estimatedSize && (info.duration || 0) > 0 && (info.tbr || info.abr)) {
              const totalBitrateKbps = (info.tbr || 0) + (info.abr || 0);
              if (totalBitrateKbps > 0) {
                  const bytes = Math.round((totalBitrateKbps * 1000 / 8) * info.duration);
                  estimatedSize = bytes;
              }
          }
          if (estimatedSize) {
              logDetailed('info', itemId, `Estimated size for ${format} at ${requestedQuality}: ${formatBytes(estimatedSize)}`);
          }
          return {
              title,
              fileSize: estimatedSize,
              thumbnail,
              availableQualities: extractAvailableQualities(info.formats)
          };
      } catch (error) {
          logDetailed('error', itemId, `getVideoInfo Error for ${videoUrl}: ${error.message}`);
          // Fallback: try lightweight prints for title and thumbnail
          try {
              const { stdout: fallbackOut } = await runYtDlpCommand(
                  clientId,
                  ['--no-playlist', '--skip-download', '--print', '%(title)s', '--print', '%(thumbnail)s', videoUrl],
                  `info_fallback_${itemId}`,
                  true
              );
              const lines = fallbackOut.split('\n').map(l => l.trim()).filter(Boolean);
              const fallbackTitle = lines[0] || 'video';
              const fallbackThumb = lines[1] && lines[1].startsWith('http') ? lines[1] : null;
              return { title: fallbackTitle, fileSize: null, thumbnail: fallbackThumb, availableQualities: [] };
          } catch (fallbackErr) {
              sendMessageToClient(clientId, {
                  type: 'status',
                  message: 'Could not fetch video info, proceeding with defaults.',
                  itemId
              });
              return { title: 'video', fileSize: null, thumbnail: null, availableQualities: [] };
          }
      }
  }

  // Helper function to extract available qualities
  function extractAvailableQualities(formats) {
      if (!formats || !Array.isArray(formats)) return [];
      const qualities = new Set();
      formats.forEach(format => {
          if (format.height && format.height >= 240) {
              qualities.add(format.height);
          }
      });
      return Array.from(qualities).sort((a, b) => b - a);
  }

  // Parse speeds like "2.5 MiB/s" or "980 KiB/s" into bytes per second
  function parseSizeToBytesPerSec(speedStr) {
      try {
          const m = /([\d.]+)\s*(K|M|G)?i?B\/s/i.exec(speedStr || '');
          if (!m) return null;
          let v = parseFloat(m[1]);
          const unit = (m[2] || '').toUpperCase();
          if (unit === 'K') v *= 1024;
          else if (unit === 'M') v *= 1024 * 1024;
          else if (unit === 'G') v *= 1024 * 1024 * 1024;
          return Math.round(v);
      } catch { return null; }
  }

  // Parse sizes like "7.52GiB" or "680.1MiB" or "120KB" to bytes
  function parseHumanSize(sizeStr) {
      try {
          const m = /([\d.]+)\s*(K|M|G|T)?i?B/i.exec(sizeStr || '');
          if (!m) return null;
          let v = parseFloat(m[1]);
          const unit = (m[2] || '').toUpperCase();
          if (unit === 'K') v *= 1024;
          else if (unit === 'M') v *= 1024 * 1024;
          else if (unit === 'G') v *= 1024 * 1024 * 1024;
          else if (unit === 'T') v *= 1024 * 1024 * 1024 * 1024;
          return Math.round(v);
      } catch { return null; }
  }

  // Helper for detailed logging
  function logDetailed(level, itemId, message) {
      const prefix = `[${itemId}]`;
      if (level === 'info') {
          console.log(prefix, message);
      } else if (level === 'error') {
          console.error(prefix, message);
      } else {
          console.log(prefix, message);
      }
  }

  function sanitizeFilename(title) {
      if (!title) return 'downloaded_media';
      let sanitized = title.replace(/[<>:"/\\|?*~]/g, '_').replace(/\s+/g, '_');
      return sanitized.substring(0, 180);
  }

  function getUniqueFolderPath(basePath, baseName) {
      let folderPath = path.join(basePath, sanitizeFilename(baseName));
      let counter = 1;
      // Check if the base folder itself exists, if not, use it.
      if (!fs.existsSync(folderPath)) {
          return folderPath;
      }
      // If it exists, start appending numbers.
      let numberedFolderPath = path.join(basePath, `${sanitizeFilename(baseName)} (${counter})`);
      while (fs.existsSync(numberedFolderPath)) {
          counter++;
          numberedFolderPath = path.join(basePath, `${sanitizeFilename(baseName)} (${counter})`);
      }
      return numberedFolderPath;
  }


  async function processSingleVideo(clientId, itemId, itemData) {
      const { videoUrl, format, quality, source, settings, isPlaylistItem, playlistIndex } = itemData;
      let currentVideoTitle = itemData.title || 'video';
      let tempFilesCreated = [];

      const itemProcInfo = { ytdlpProc: null, ffmpegProc: null, tempFiles: tempFilesCreated, cancelled: false };
      activeProcesses.set(itemId, itemProcInfo);
      downloadQueue.delete(itemId);

      try {
          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Pre-cancelled processSingleVideo.`); return; }

          const videoInfo = await getVideoInfo(clientId, videoUrl, itemId, quality, format);
          currentVideoTitle = videoInfo.title || currentVideoTitle;
          const formattedEstimatedSize = videoInfo.fileSize ? formatBytes(videoInfo.fileSize) : null;
          sendMessageToClient(clientId, { 
              type: 'item_info', 
              itemId, 
              title: currentVideoTitle, 
              estimatedSize: formattedEstimatedSize, 
              source, 
              thumbnail: videoInfo.thumbnail,
              isPlaylistItem: itemData.isPlaylistItem || false,
              playlistIndex: itemData.playlistIndex || null
          });

          // Use settings.downloadFolder if provided and valid, else fallback
          let targetDir;
          if (isPlaylistItem && itemData.playlistFolderPath && fs.existsSync(itemData.playlistFolderPath)) {
              targetDir = itemData.playlistFolderPath;
          } else if (settings.downloadFolder && fs.existsSync(settings.downloadFolder)) {
              targetDir = settings.downloadFolder;
          } else {
              targetDir = itemData.playlistFolderPath || DOWNLOAD_DIR;
          }

          const finalBaseFilename = sanitizeFilename(currentVideoTitle);
          let outputTemplate;
          if (isPlaylistItem && itemData.playlistFolderPath) {
              if (settings.numerateFiles && playlistIndex !== null) {
                  const displayIndex = (playlistIndex + 1).toString();
                  outputTemplate = path.join(targetDir, `${source}_playlist_${displayIndex}_${finalBaseFilename}.%(ext)s`);
              } else {
                  outputTemplate = path.join(targetDir, `${source}_playlist_${finalBaseFilename}.%(ext)s`);
              }
          } else {
              outputTemplate = path.join(targetDir, `${source}_${finalBaseFilename}_${itemId}.%(ext)s`);
          }

          let finalFilePathValue;
          
          sendMessageToClient(clientId, { type: 'status', message: 'Starting optimized download...', itemId, source });

          const audioContainers = new Set(['mp3','m4a','aac','wav','flac','opus']);
          if (audioContainers.has(format)) {
              // OPTIMIZED MP3: Use yt-dlp's built-in extraction (much faster)
              const finalOutputFilename = outputTemplate.replace('%(ext)s', format);
              
               let mp3Args = [
                  '--extract-audio',
                  '--audio-format', format,
                  '--no-playlist',
                   '-o', outputTemplate,
                   '--verbose',
                  videoUrl
              ];
              
              // Add quality setting for MP3
              if (quality && quality !== 'highest' && !isNaN(parseInt(quality))) {
                  mp3Args.push('--audio-quality', quality + 'K');
              } else {
                  mp3Args.push('--audio-quality', '0'); // Best quality
              }
              
              // Add metadata if requested
              if (settings.searchTags) {
                  mp3Args.push('--embed-metadata');
              }
              
              // Add rate limiting only if specified and > 0
              if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) {
                  mp3Args.unshift('--limit-rate', `${settings.maxSpeed}K`);
              }
              
              if (settings.skipDuplicates && isPlaylistItem) {
                  mp3Args.unshift('--no-overwrites');
              }

              const { actualPath } = await runYtDlpCommand(clientId, mp3Args, itemId, false, itemProcInfo);
              finalFilePathValue = actualPath || finalOutputFilename;

          } else {
              // ENHANCED VIDEO: Precise quality selection with reliable MOV handling
              const requestedContainer = (format || 'mp4').toLowerCase();
              const downloadContainer = requestedContainer === 'mov' ? 'mp4' : requestedContainer;
              const finalOutputFilename = outputTemplate.replace('%(ext)s', requestedContainer);
              
              let formatString;
              if (quality === 'highest') {
                  // Get the absolute best quality available
                  formatString = 'bestvideo+bestaudio/best';
              } else {
                  const targetHeight = parseInt(quality);
                  if (!isNaN(targetHeight)) {
                      // Create a comprehensive format string with quality preferences
                      if (targetHeight >= 2160) {
                          // 4K: Prefer 4K, accept up to 8K, fallback to lower if needed
                          formatString = `bestvideo[height=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight+1080}]+bestaudio/bestvideo[height>=${targetHeight-360}]+bestaudio/bestvideo+bestaudio`;
                      } else if (targetHeight >= 1080) {
                          // 1080p: Prefer exact match, accept higher, fallback to 720p minimum
                          formatString = `bestvideo[height=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight+360}]+bestaudio/bestvideo[height>=${Math.max(720, targetHeight-360)}]+bestaudio/bestvideo+bestaudio`;
                      } else if (targetHeight >= 720) {
                          // 720p: Similar logic with 480p minimum fallback
                          formatString = `bestvideo[height=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight+240}]+bestaudio/bestvideo[height>=${Math.max(480, targetHeight-240)}]+bestaudio/bestvideo+bestaudio`;
                      } else {
                          // Lower qualities: More flexible fallback
                          formatString = `bestvideo[height<=${targetHeight+120}]+bestaudio/bestvideo+bestaudio`;
                      }
                  } else {
                      // Non-numeric quality (shouldn't happen, but just in case)
                      formatString = 'bestvideo+bestaudio/best';
                  }
              }

               // Build container-aware format preferences to avoid muxing errors
               const containerLower = downloadContainer;
               const targetHeight = quality === 'highest' ? null : parseInt(quality);

               if (containerLower === 'mp4' || containerLower === 'mov' || containerLower === 'avi') {
                   // Prefer MP4-friendly streams and AAC audio (avoid Opus in MP4/MOV)
                   const audioPref = "bestaudio[ext=m4a][acodec^=mp4a]/bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]";
                   if (!targetHeight) {
                       formatString = `bestvideo[ext=mp4]+${audioPref}/best[ext=mp4]/best`;
                   } else {
                       formatString = `bestvideo[ext=mp4][height<=${targetHeight}]+${audioPref}/best[ext=mp4]/best`;
                   }
               } else if (containerLower === 'webm') {
                   // Prefer WEBM-friendly streams
                   const audioPrefWebm = "bestaudio[acodec=opus]/bestaudio[ext=webm]";
                   if (!targetHeight) {
                       formatString = `bestvideo[ext=webm]+${audioPrefWebm}/best[ext=webm]/best`;
                   } else {
                       formatString = `bestvideo[ext=webm][height<=${targetHeight}]+${audioPrefWebm}/best[ext=webm]/best`;
                   }
               } else if (containerLower === 'mkv') {
                   // MKV is flexible; let yt-dlp choose best
                   // Keep previously computed formatString
               }

               // Debug log for final format string
               console.log(`[${itemId}] Quality requested: "${quality}", Container: ${containerLower}, Format string: "${formatString}"`);

               let mp4Args = [
                   '-f', formatString,
                   '--merge-output-format', downloadContainer,
                   '--no-playlist',
                   '-o', outputTemplate,
                   '--verbose',
                   videoUrl
               ];
               // Rely on global defaults; avoid duplicating flags here

               // For AVI, let yt-dlp recode. MOV is handled by explicit ffmpeg transcode below.
               if (requestedContainer === 'avi') {
                   mp4Args.push('--recode-video', 'avi');
               }
              
              // Add rate limiting only if specified and > 0
               if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) {
                  mp4Args.unshift('--limit-rate', `${settings.maxSpeed}K`);
               }
              
              if (settings.skipDuplicates && isPlaylistItem) {
                  mp4Args.unshift('--no-overwrites');
              }

              const qualityText = quality === 'highest' ? 'highest available quality' : `${quality}${isNaN(parseInt(quality)) ? '' : 'p'} quality`;
              sendMessageToClient(clientId, { type: 'status', message: `Downloading in ${qualityText}...`, itemId, source });
              const { actualPath } = await runYtDlpCommand(clientId, mp4Args, itemId, false, itemProcInfo);
              let downloadedPath = actualPath;
              // If AAC not provided and we ended up with Opus in MP4/MOV, transcode audio during MOV step or do a quick remux
              // We'll enforce audio codec in the MOV branch; for MP4 with Opus, do a quick audio transcode to AAC
              if (requestedContainer === 'mp4' && downloadedPath && fs.existsSync(downloadedPath) && downloadedPath.toLowerCase().endsWith('.mp4')) {
                  // Probe would be ideal, but as a safe guard: run ffmpeg copy video, transcode audio to AAC
                  const tempFixed = downloadedPath.replace(/\.mp4$/i, '.fixed.mp4');
                  const fixArgs = ['-y','-i', downloadedPath,'-c:v','copy','-c:a','aac','-b:a','192k', tempFixed];
                  try {
                      await runFFmpegCommand(clientId, fixArgs, itemId, itemProcInfo);
                      if (fs.existsSync(tempFixed)) {
                          try { fs.unlinkSync(downloadedPath); } catch {}
                          downloadedPath = tempFixed;
                      }
                  } catch {}
              }
              if (!downloadedPath || !fs.existsSync(downloadedPath)) {
                  throw new Error('Download step did not produce an output file.');
              }

              if (requestedContainer === 'mov') {
                  // Reliable MOV: transcode explicitly with ffmpeg
                  const targetMovPath = outputTemplate.replace('%(ext)s', 'mov');
                  const ffArgs = [
                      '-y',
                      '-i', downloadedPath,
                      '-c:v', 'libx264',
                      '-pix_fmt', 'yuv420p',
                      '-preset', 'medium',
                      '-movflags', '+faststart',
                      '-c:a', 'aac',
                      '-b:a', '192k',
                      targetMovPath
                  ];
                  await runFFmpegCommand(clientId, ffArgs, itemId, itemProcInfo);
                  finalFilePathValue = targetMovPath;
                  try { if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath); } catch {}
              } else {
                  finalFilePathValue = downloadedPath || finalOutputFilename;
              }
          }

          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled after download.`); return; }

          if (!finalFilePathValue || !fs.existsSync(finalFilePathValue)) {
              throw new Error("Processing failed, final file not found at: " + finalFilePathValue);
          }

          // Set file modification time to now
          try {
              const now = new Date();
              fs.utimesSync(finalFilePathValue, now, now);
          } catch (e) {
              console.error(`[${itemId}] Failed to set file modification time:`, e);
          }

          const actualFinalFilenameDisplay = path.basename(finalFilePathValue);
          const relativePathForLink = path.relative(DOWNLOAD_DIR, finalFilePathValue);
          const downloadLink = `/downloads/${encodeURIComponent(relativePathForLink.replace(/\\/g, '/'))}`;
          let actualSize = null;
          try {
              const stats = fs.statSync(finalFilePathValue);
              actualSize = formatBytes(stats.size);
          } catch (e) { console.error(`[${itemId}] Stat error for ${finalFilePathValue}:`, e); }

           sendMessageToClient(clientId, { 
              type: 'complete', 
              message: 'Download complete!', 
              downloadUrl: downloadLink, 
              filename: actualFinalFilenameDisplay, 
              actualSize: actualSize, 
              itemId, 
              source,
              downloadFolder: targetDir,
              fullPath: finalFilePathValue
          });

      } catch (error) {
          if (!itemProcInfo.cancelled) {
              console.error(`[${itemId}] Error in processSingleVideo for ${videoUrl}:`, error);
              sendMessageToClient(clientId, { type: 'error', message: `Failed: ${error.message}`, itemId, source });
          } else {
              console.log(`[${itemId}] Processing stopped due to cancellation for ${videoUrl}.`);
              sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Processing stopped due to cancellation.', itemId, source });
          }
      } finally {
          // Clean up any remaining temp files
          itemProcInfo.tempFiles.forEach(tempPathPattern => {
              const glob = require('glob');
              let files = glob.sync(path.basename(tempPathPattern), { cwd: DOWNLOAD_DIR });
              files.forEach(file => {
                  const fullPath = path.join(DOWNLOAD_DIR, file);
                  if (fs.existsSync(fullPath)) {
                      try { fs.unlinkSync(fullPath); } catch (e) { console.error(`[${itemId}] Error cleaning up temp file ${fullPath}:`, e); }
                  }
              });
          });
          activeProcesses.delete(itemId);
      }
  }


  async function processInstagramVideo(clientId, itemId, itemData) {
      const { videoUrl, quality, source, settings } = itemData;
      let currentVideoTitle = itemData.title || 'instagram_video';
      const tempFilesCreated = []; // Instagram usually doesn't create explicit temp files we manage

      const itemProcInfo = { ytdlpProc: null, ffmpegProc: null, tempFiles: tempFilesCreated, cancelled: false };
      activeProcesses.set(itemId, itemProcInfo);
      downloadQueue.delete(itemId);

      try {
          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Pre-cancelled processInstagramVideo.`); return; }

          sendMessageToClient(clientId, { type: 'status', message: 'Fetching Instagram video info...', itemId, source });
          const videoInfo = await getVideoInfo(clientId, videoUrl, itemId);
          currentVideoTitle = videoInfo.title || currentVideoTitle;
          const formattedEstimatedSize = videoInfo.fileSize ? formatBytes(videoInfo.fileSize) : null;
          sendMessageToClient(clientId, { type: 'item_info', itemId, title: currentVideoTitle, estimatedSize: formattedEstimatedSize, source, thumbnail: videoInfo.thumbnail });

          // Always use 'Instagram' folder inside DOWNLOAD_DIR
          let targetDir = path.join(DOWNLOAD_DIR, 'Instagram');
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

          const finalBaseFilename = sanitizeFilename(currentVideoTitle);
          const outputTemplate = path.join(targetDir, `${source}_${finalBaseFilename}_${itemId}.%(ext)s`);

          sendMessageToClient(clientId, { type: 'status', message: 'Starting Instagram download...', itemId, source });

          let ytDlpArgs = ['--no-playlist', '-o', outputTemplate, videoUrl];
          if (settings.skipDuplicates) ytDlpArgs.unshift('--no-overwrites');
          if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) ytDlpArgs.unshift('--limit-rate', `${settings.maxSpeed}K`);
          ytDlpArgs.push('--merge-output-format', 'mp4');

          let formatString = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
          if (quality && quality !== 'highest' && !isNaN(parseInt(quality))) {
              const h = parseInt(quality);
              formatString = `bestvideo[height<=?${h}][ext=mp4]+bestaudio[ext=m4a]/best[height<=?${h}][ext=mp4]/best`;
          }
          ytDlpArgs.unshift('-f', formatString);

          const { stdout: downloadOutput, actualPath } = await runYtDlpCommand(clientId, ytDlpArgs, itemId, false, itemProcInfo);

          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled after Instagram download attempt.`); return; }

          let finalFilePathValue = actualPath;

          if (!finalFilePathValue || !fs.existsSync(finalFilePathValue)) {
              // Fallback if actualPath isn't reliable from yt-dlp output for some reason
              const expectedFinalName = `${finalBaseFilename}_${itemId}.mp4`;
              const potentialPath = path.join(DOWNLOAD_DIR, expectedFinalName);
              if (fs.existsSync(potentialPath)) {
                  finalFilePathValue = potentialPath;
              } else {
                  throw new Error(`Instagram download processing failed, final file not found. Output: ${downloadOutput.substring(0,300)}`);
              }
          }
          
          const actualFinalFilenameDisplay = path.basename(finalFilePathValue);
          const relativePath = path.relative(DOWNLOAD_DIR, finalFilePathValue);
          const downloadLink = `/downloads/${encodeURIComponent(relativePath.replace(/\\/g, '/'))}`;
          let actualSize = null;
          try {
              const stats = fs.statSync(finalFilePathValue);
              actualSize = formatBytes(stats.size);
          } catch (statError) { console.error(`[${itemId}] Error getting file stats for ${finalFilePathValue}:`, statError); }

          sendMessageToClient(clientId, { 
              type: 'complete', 
              message: `Instagram download complete.`, 
              filename: actualFinalFilenameDisplay, 
              downloadUrl: downloadLink, 
              actualSize: actualSize, 
              itemId, 
              source,
              downloadFolder: targetDir,
              fullPath: finalFilePathValue
          });

      } catch (error) {
          if (!itemProcInfo.cancelled) {
              console.error(`[${itemId}] Error processing Instagram item for ${videoUrl}:`, error);
              sendMessageToClient(clientId, { type: 'error', message: `Instagram download failed: ${error.message}`, itemId, source });
          }  else {
              sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Instagram download cancelled.', itemId, source });
          }
      } finally {
          // Clean up temp files after download/conversion is complete (Instagram)
          tempFilesCreated.forEach(tempPathPattern => {
              const glob = require('glob');
              let files = glob.sync(path.basename(tempPathPattern), { cwd: DOWNLOAD_DIR });
              files.forEach(file => {
                  const fullPath = path.join(DOWNLOAD_DIR, file);
                  if (fs.existsSync(fullPath)) {
                      try { fs.unlinkSync(fullPath); } catch (e) { console.error(`[${itemId}] Error cleaning up temp file ${fullPath}:`, e); }
                  }
              });
          });
          activeProcesses.delete(itemId);
          // console.log(`[${itemId}] Cleaned Insta from activeProcesses in finally.`);
      }
  }


  async function getPlaylistItems(clientId, playlistUrl, playlistMetaId) {
      // console.log(`[${playlistMetaId}] Fetching playlist items for: ${playlistUrl}`);
      const args = ['--flat-playlist', '--print', '%(id)s\t%(title)s', playlistUrl];
      try {
          const { stdout } = await runYtDlpCommand(clientId, args, `playlist_info_${playlistMetaId}`, true);
          const lines = stdout.trim().split('\n').filter(line => line.trim() !== '' && line.includes('\t'));
          const items = lines.map(line => {
              const parts = line.split('\t');
              return { id: parts[0], title: parts[1] || 'Untitled Video' };
          });
          // console.log(`[${playlistMetaId}] Found ${items.length} items in playlist.`);
          if (items.length === 0 && stdout.trim() !== "" && !stdout.toLowerCase().includes("error")) {
              sendMessageToClient(clientId, {type: 'status', itemId: playlistMetaId, message: "Playlist seems empty or contains no downloadable video items."});
          }
          return items;
      } catch (error) {
          console.error(`[${playlistMetaId}] Error fetching playlist items: ${error.message}`);
          sendMessageToClient(clientId, { type: 'error', message: `Failed to get playlist items: ${error.message.substring(0,100)}`, itemId: playlistMetaId });
          throw error;
      }
  }


  // --- Command Execution Wrappers ---
  async function getCookiesPath() {
      const isDev = process.env.NODE_ENV !== 'production';
      const userDataPath = getUserDataPath();

      const possiblePaths = [
          // Electron userData (primary for both dev/prod)
          path.join(userDataPath, 'cookies.txt'),
          // Project root (dev convenience)
          path.join(__dirname, 'cookies.txt'),
          // Fallback in home directory
          path.join(os.homedir(), '.video-downloader-gemini', 'cookies.txt')
      ];

      console.log('[getCookiesPath] Environment:', isDev ? 'Development' : 'Production');
      console.log('[getCookiesPath] Checking paths:', possiblePaths);

      for (const testPath of possiblePaths) {
          try {
              if (fs.existsSync(testPath)) {
                  const stats = fs.statSync(testPath);
                  if (stats.isFile() && stats.size > 0) {
                      console.log(`[getCookiesPath] Found valid cookies.txt at: ${testPath}`);
                      return testPath;
                  }
              }
          } catch (e) {
              console.log(`[getCookiesPath] Error checking ${testPath}:`, e.message);
          }
      }

      console.log(`[getCookiesPath] No cookies.txt found. Downloads will proceed without authentication cookies.`);
      return null;
  }
    
    // Helper function to get userData path
    function getUserDataPath() {
        if (process.env.USER_DATA_PATH) {
            console.log('[getUserDataPath] Using USER_DATA_PATH from env:', process.env.USER_DATA_PATH);
            return process.env.USER_DATA_PATH;
        }
        const platform = os.platform();
        const homedir = os.homedir();
        switch (platform) {
            case 'win32':
                return path.join(homedir, 'AppData', 'Roaming', 'Video Downloader Gemini');
            case 'darwin':
                return path.join(homedir, 'Library', 'Application Support', 'Video Downloader Gemini');
            case 'linux':
                return path.join(homedir, '.config', 'Video Downloader Gemini');
            default:
                return path.join(homedir, '.video-downloader-gemini');
        }
  }

  async function runYtDlpCommand(clientId, baseArgs, itemId, suppressProgress = false, itemProcInfoRef = null) {
    const cookieFilePath = await getCookiesPath();
    
    let cookieArgs = [];
    if (cookieFilePath) {
        cookieArgs = ['--cookies', cookieFilePath];
        console.log(`[${itemId}] Using cookies file: ${cookieFilePath}`);
    } else {
        console.log(`[${itemId}] No cookies.txt found, proceeding without authentication cookies`);
    }

    // Optimized base arguments for better performance
    const finalArgs = [
        ...(ffmpegExecutable ? ['--ffmpeg-location', ffmpegExecutable] : []),
        ...cookieArgs, 
        ...baseArgs, 
        '--verbose',
        '--encoding', 'utf-8', 
        '--no-colors', 
        '--retries', '3',
        '--fragment-retries', '3',
        '--concurrent-fragments', '4', // lower for reliability
        '--buffer-size', '16384',
        '--no-part' // Don't create .part files for better performance
    ];
    
    if(!suppressProgress) finalArgs.push('--progress', '--newline');

    return new Promise((resolve, reject) => {
        const currentProcInfo = itemProcInfoRef || activeProcesses.get(itemId);
        if (currentProcInfo?.cancelled) {
            return reject(new Error(`[${itemId}] Download cancelled before yt-dlp process start.`));
        }

        console.log(`[${itemId}] Spawning yt-dlp with optimized args: ${finalArgs.join(' ')}`);
        const ytdlpProc = spawn(ytdlpExecutable, finalArgs, { 
            detached: os.platform() !== 'win32', 
            stdio: ['ignore', 'pipe', 'pipe'], 
            windowsHide: true 
        });

        // ... rest of the function remains the same
        if (currentProcInfo) currentProcInfo.ytdlpProc = ytdlpProc;
        else if (itemProcInfoRef && typeof itemProcInfoRef === 'object') itemProcInfoRef.ytdlpProc = ytdlpProc;

        let stdoutData = '';
        let stderrData = '';
        let destinationPath = null;

        ytdlpProc.stdout.setEncoding('utf8');
        ytdlpProc.stderr.setEncoding('utf8');

        // Smooth speed: compute over a moving window of 0.5s+ and cap outliers
        let lastSpeedEmit = 0;
        let lastBytes = 0;
         ytdlpProc.stdout.on('data', (data) => {
            stdoutData += data;
            if (!suppressProgress) {
                const progressMatch = data.match(/\[download\]\s*(\d+\.?\d*)%.*?of\s*([\d.]+(?:[KMG]?i?B)).*?at\s*([\d.]+(?:[KMG]?i?B)\/s)/);
                const destMatch = data.match(/\[download\] Destination:\s*(.*)/) || data.match(/\[Merger\] Merging formats into "([^"]+)"/) || data.match(/\[ExtractAudio\] Destination:\s*(.*)/) ;
                const alreadyDownloadedMatch = data.match(/\[download\] (.*?) has already been downloaded/);

                if (destMatch && destMatch[1]) {
                    destinationPath = destMatch[1].trim();
                }
                if (alreadyDownloadedMatch && alreadyDownloadedMatch[1]) {
                    sendMessageToClient(clientId, { type: 'progress', percent: 100, message: `Already downloaded: ${path.basename(destinationPath)}`, itemId, speedBytesPerSec: 0 });
                }

                 if (progressMatch) {
                    const percent = parseFloat(progressMatch[1]);
                    const speedStr = progressMatch[3];
                     let speedBps = parseSizeToBytesPerSec(speedStr) || 0;
                    const now = Date.now();
                    if (now - lastSpeedEmit >= 450) {
                        lastSpeedEmit = now;
                        sendMessageToClient(clientId, { type:'progress', percent, rawSpeed: speedStr, speedBytesPerSec: speedBps, itemId });
                    }
                }
            }
        });

        ytdlpProc.stderr.on('data', (data) => {
            stderrData += data;
        });

        ytdlpProc.on('error', (error) => {
            console.error(`[${itemId}] yt-dlp spawn error using ${ytdlpExecutable}: ${error.message}`);
            if (currentProcInfo) currentProcInfo.ytdlpProc = null;
            if (!itemProcInfoRef) activeProcesses.delete(itemId);
            reject(new Error(`yt-dlp process failed to start (${ytdlpExecutable}): ${error.message}`));
        });

        ytdlpProc.on('close', async (code, signal) => {
            if (currentProcInfo) currentProcInfo.ytdlpProc = null;

            if (currentProcInfo?.cancelled) {
                return reject(new Error(`Download cancelled for item ${itemId}`));
            }
            if (code === 0) {
                if (!destinationPath && stdoutData) {
                    const mergedPathMatch = stdoutData.match(/Merging formats into "([^"]+)"/);
                    const downloadedPathMatch = stdoutData.match(/\[download\] (.*?) has already been downloaded/);
                    const extractAudioMatch = stdoutData.match(/\[ExtractAudio\] Destination: (.*)/);
                    if (mergedPathMatch && mergedPathMatch[1]) destinationPath = mergedPathMatch[1];
                    else if (extractAudioMatch && extractAudioMatch[1]) destinationPath = extractAudioMatch[1];
                    else if (downloadedPathMatch && downloadedPathMatch[1]) destinationPath = downloadedPathMatch[1];
                }
                if (!destinationPath && baseArgs.includes('-o')) {
                    const outputTemplateIndex = baseArgs.indexOf('-o') + 1;
                    if (outputTemplateIndex < baseArgs.length) {
                        const template = baseArgs[outputTemplateIndex];
                      if (template.includes('%(ext)s')) {
                          const globPattern = template.replace(/%\([^)]+\)s/g, '*');
                             try {
                                const glob = require('glob');
                                const files = glob.sync(path.basename(globPattern), { cwd: path.dirname(template), absolute: true });
                              if (files.length === 1) {
                                    destinationPath = files[0];
                                } else if (files.length > 1) {
                                  console.warn(`[${itemId}] Glob matched multiple files for ${globPattern}, cannot determine unique output.`);
                                }
                            } catch (e) { /* console.error(`[${itemId}] Glob error:`, e); */ }
                      } else if (fs.existsSync(template)) {
                            destinationPath = template;
                        }
                    }
                }
                resolve({ stdout: stdoutData, stderr: stderrData, actualPath: destinationPath });
            } else {
                const merged = `${stdoutData}\n${stderrData}`;
                const lower = merged.toLowerCase();
                const isFragmentErr = lower.includes('fragment') && (lower.includes('not found') || lower.includes('http error 403'));
                const isPostprocessErr = lower.includes('postprocessing') || lower.includes('conversion failed');
                if (isFragmentErr || isPostprocessErr) {
                    console.warn(`[${itemId}] Fragment error detected. Retrying once with safer network settings...`);
                    try {
                        // Remove token-value pairs safely
                        const tokensToStrip = new Set(['--concurrent-fragments','--buffer-size','--retries','--fragment-retries']);
                        const saferArgs = [];
                        for (let i = 0; i < finalArgs.length; i++) {
                            const arg = finalArgs[i];
                            if (tokensToStrip.has(arg)) { i++; continue; }
                            saferArgs.push(arg);
                        }
                        saferArgs.push('--concurrent-fragments', '2');
                        saferArgs.push('--buffer-size', '8192');
                        saferArgs.push('--retries', '4', '--fragment-retries', '4');
                        // If post-processing/merge failed, force recode to mp4 as a robust fallback
                        if (isPostprocessErr && !saferArgs.includes('--recode-video')) {
                            saferArgs.push('--recode-video', 'mp4');
                        }
                        // Re-run once
                        const retry = await new Promise((res, rej) => {
                            const retryProc = spawn(ytdlpExecutable, saferArgs, { detached: os.platform() !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
                            if (currentProcInfo) currentProcInfo.ytdlpProc = retryProc;
                            let rStdout = '', rStderr = '';
                            let retryDest = null;
                            retryProc.stdout.setEncoding('utf8');
                            retryProc.stderr.setEncoding('utf8');
                            retryProc.stdout.on('data', (d) => {
                                rStdout += d;
                                const destMatchR = d.match(/\[download\] Destination:\s*(.*)/) || d.match(/\[Merger\] Merging formats into "([^"]+)"/) || d.match(/\[ExtractAudio\] Destination:\s*(.*)/);
                                if (destMatchR && destMatchR[1]) retryDest = destMatchR[1].trim();
                            });
                            retryProc.stderr.on('data', (d) => { rStderr += d; });
                            retryProc.on('error', (err) => rej(err));
                            retryProc.on('close', (c) => {
                                if (currentProcInfo) currentProcInfo.ytdlpProc = null;
                                if (c === 0) res({ stdout: rStdout, stderr: rStderr, actualPath: retryDest });
                                else rej(new Error(rStderr || `yt-dlp retry failed (code ${c})`));
                            });
                        });
                        return resolve(retry);
                    } catch (retryErr) {
                        console.error(`[${itemId}] Retry also failed: ${retryErr.message}`);
                    }
                }
                const errorMsg = stderrData.split('\n').filter(line => line.toLowerCase().includes('error:')).join('; ') || stderrData.trim() || `yt-dlp exited with code ${code}`;
                console.error(`[${itemId}] yt-dlp failed (code ${code}). Error: ${errorMsg}.`);
                reject(new Error(errorMsg.substring(0, 250)));
            }
        });
    });
}

async function runFFmpegCommand(clientId, ffmpegArgs, itemId, itemProcInfoRef) {
     return new Promise((resolve, reject) => {
        const currentProcInfo = itemProcInfoRef || activeProcesses.get(itemId);
        if (currentProcInfo?.cancelled) {
            return reject(new Error(`[${itemId}] Conversion cancelled before ffmpeg process start.`));
        }

        sendMessageToClient(clientId, { type: 'status', message: 'Starting conversion...', itemId });
        // console.log(`[${itemId}] Spawning ffmpeg (${ffmpegExecutable}) with args: ${ffmpegArgs.join(' ')}`);
        const ffmpegProc = spawn(ffmpegExecutable, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });


        if (currentProcInfo) currentProcInfo.ffmpegProc = ffmpegProc;
        else if (itemProcInfoRef && typeof itemProcInfoRef === 'object') itemProcInfoRef.ffmpegProc = ffmpegProc;
        // else activeProcesses.set(itemId, { ytdlpProc: null, ffmpegProc, tempFiles: currentProcInfo?.tempFiles || [], cancelled: false });


        let ffmpegStderr = '';
        ffmpegProc.stderr.setEncoding('utf8');
        ffmpegProc.stderr.on('data', (data) => {
            ffmpegStderr += data;
            // console.log(`[${itemId}] FFMPEG STDERR CHUNK: ${data.substring(0,100)}`);
        });

        ffmpegProc.on('error', (error) => {
            console.error(`[${itemId}] ffmpeg spawn error using ${ffmpegExecutable}: ${error.message}`);
            if (currentProcInfo) currentProcInfo.ffmpegProc = null;
            if(!itemProcInfoRef) activeProcesses.delete(itemId);
            reject(new Error(`ffmpeg process failed to start (${ffmpegExecutable}): ${error.message}`));
        });

        ffmpegProc.on('close', (code) => {
            // console.log(`[${itemId}] ffmpeg process closed with code ${code}`);
            if (currentProcInfo) currentProcInfo.ffmpegProc = null;

            if (currentProcInfo?.cancelled) {
                // console.log(`[${itemId}] ffmpeg process was cancelled (detected on close).`);
                return reject(new Error(`Conversion cancelled for item ${itemId}`));
            }
            if (code === 0) {
                sendMessageToClient(clientId, { type: 'status', message: 'Conversion complete.', itemId });
                resolve();
            } else {
                console.error(`[${itemId}] ffmpeg exited with code ${code}. Full stderr:\n${ffmpegStderr}`);
                reject(new Error(`ffmpeg conversion failed (code ${code}). Details: ${ffmpegStderr.substring(0, 200)}`));
            }
        });
    });
}


// --- HTTP Routes ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Enhanced /video-info route to accept quality and return availableQualities
app.post('/video-info', async (req, res) => {
    const { url: videoUrl, clientId, source, quality = 'highest' } = req.body;
    if (!videoUrl || !clientId || !source) {
        return res.status(400).json({ error: 'URL, Client ID, and Source are required.' });
    }
    const tempItemId = `info_${source}_${Date.now()}`;
    try {
        const info = await getVideoInfo(clientId, videoUrl, tempItemId, quality);
        res.json({
            title: info.title,
            fileSize: info.fileSize ? formatBytes(info.fileSize) : 'N/A',
            thumbnail: info.thumbnail,
            source,
            availableQualities: info.availableQualities
        });
    } catch (error) {
        console.error(`Error in /video-info for ${videoUrl} (${source}):`, error);
        res.status(500).json({ error: error.message || 'Failed to fetch video info.' });
    }
});

app.post('/shutdown', (req, res) => {
    res.json({ message: 'Server shutting down...' });
    setTimeout(() => gracefulShutdown(), 100); // Give response time to send
});


// --- Server Start & Graceful Shutdown ---
server.listen(PORT, async () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`Downloads will be saved to: ${DOWNLOAD_DIR}`);
    
    // Send server ready message to parent process (Electron)
    if (process.send) {
        console.log('Sending server_ready message to parent process...');
        process.send({ type: 'server_ready', port: PORT });
    }
    
    // Only open browser if not running under Electron
    if (!process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
      await open(`http://localhost:${PORT}`);
    }
    
    // Wait a bit for WebSocket server to be fully ready
    setTimeout(() => {
        console.log('WebSocket server should be ready now');
        if (!pLimit) console.warn("p-limit module not loaded yet. Concurrency limiters will be initialized once it loads.");
        else {
            console.log(`Using yt-dlp executable: ${ytdlpExecutable}`);
            console.log(`Using ffmpeg executable: ${ffmpegExecutable}`);
        }
        
        // Send 'ready' message to all connected clients
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                console.log('Sending ready message to client');
                client.send(JSON.stringify({ type: 'ready', message: 'Backend server is ready.' }));
            }
        });
    }, 500); // 500ms delay to ensure everything is set up
});

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

function gracefulShutdown() {
    console.log('Received shutdown signal. Closing server and cleaning up...');
    wss.clients.forEach(clientWs => {
        const clientEntry = Array.from(clients.entries()).find(([id, cws]) => cws === clientWs);
        if (clientEntry) {
            sendMessageToClient(clientEntry[0], { type: 'status', message: 'Server is shutting down...' });
        }
        clientWs.terminate();
    });

    server.close(() => {
        console.log('HTTP server closed.');
        activeProcesses.forEach((procInfo, itemId) => {
            console.log(`Terminating active processes for item: ${itemId} during shutdown.`);
            procInfo.cancelled = true;
            if (procInfo.ytdlpProc && procInfo.ytdlpProc.pid && !procInfo.ytdlpProc.killed) {
                terminateProcessTree(procInfo.ytdlpProc.pid);
            }
            if (procInfo.ffmpegProc && procInfo.ffmpegProc.pid && !procInfo.ffmpegProc.killed) {
                terminateProcessTree(procInfo.ffmpegProc.pid);
            }
        });
        console.log("Cleanup complete. Exiting.");
        process.exit(0);
    });

    setTimeout(() => {
        console.error("Graceful shutdown timed out. Forcing exit.");
        process.exit(1);
    }, 10000);
}

// Helper to get playlist title using yt-dlp
async function getPlaylistTitle(clientId, playlistUrl, playlistMetaId) {
    const args = ['--flat-playlist', '--print', '%(playlist_title)s', playlistUrl];
    try {
        const { stdout } = await runYtDlpCommand(clientId, args, `playlist_title_${playlistMetaId}`, true);
        const title = stdout.trim().split('\n')[0];
        return title || null;
    } catch (error) {
        console.error(`[${playlistMetaId}] Error fetching playlist title: ${error.message}`);
        return null;
    }
}
})();
