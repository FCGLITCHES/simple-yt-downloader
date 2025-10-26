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

  // Use fixed port 9875 as requested
  const PORT = 9875;
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

const pLimit = require('p-limit');

// Initialize limiters
let singleVideoProcessingLimit = pLimit(1); // Default to 1 for single videos initially
let playlistItemProcessingLimit = pLimit(3); // Default for items within a playlist
console.log('p-limit loaded and limiters initialized.');
console.log(`Using yt-dlp: ${ytdlpExecutable}`);
console.log(`Using ffmpeg: ${ffmpegExecutable}`);


  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // --- Global State ---
  const clients = new Map(); // Stores connected WebSocket clients (clientId -> ws)
  const activeProcesses = new Map(); // Stores active yt-dlp/ffmpeg processes (itemId -> { ytdlpProc, ffmpegProc, tempFiles: [], cancelled: false })
  const downloadQueue = new Map(); // Stores item details before processing (itemId -> { clientId, videoUrl, format, quality, source, settings, isPlaylistItem, playlistIndex, status: 'queued' })

  // Limiters are now initialized above with p-limit


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
      if (!singleVideoProcessingLimit || !playlistItemProcessingLimit) { // Check if limiters are initialized
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

  // Enhanced getVideoInfo with quality-specific size estimation
  async function getVideoInfo(clientId, videoUrl, itemId, requestedQuality = 'highest', format = 'mp4') {
      const baseArgs = ['--no-playlist', '--skip-download', '--print-json', videoUrl];
      try {
          const { stdout } = await runYtDlpCommand(clientId, baseArgs, `info_${itemId}`, true);
          const info = JSON.parse(stdout.trim());
          const title = info.title || 'video';
          let estimatedSize = null;
          let thumbnail = info.thumbnail || null;
          // Calculate size based on requested quality and format
          if (info.formats && Array.isArray(info.formats)) {
              let selectedFormat = null;
              if (format === 'mp3') {
                  // For MP3, find best audio format
                  const audioFormats = info.formats.filter(f => f.acodec && f.acodec !== 'none' && f.filesize);
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
              } else {
                  // For MP4, find best video format matching quality
                  const targetHeight = requestedQuality === 'highest' ? 9999 : parseInt(requestedQuality) || 720;
                  const videoFormats = info.formats.filter(f => 
                      f.height && f.height <= targetHeight && f.vcodec && f.vcodec !== 'none' && f.filesize
                  );
                  if (videoFormats.length > 0) {
                      // Get the best quality that matches the target
                      selectedFormat = videoFormats.reduce((best, current) => 
                          (current.height || 0) > (best.height || 0) ? current : best
                      );
                      // Add estimated audio size (typically 10-15% of video size for same duration)
                      if (selectedFormat.filesize) {
                          const audioSizeEstimate = Math.round(selectedFormat.filesize * 0.12);
                          estimatedSize = selectedFormat.filesize + audioSizeEstimate;
                      }
                  }
              }
              if (selectedFormat && selectedFormat.filesize) {
                  estimatedSize = selectedFormat.filesize;
                  logDetailed('info', itemId, `Size estimated for ${format} at ${requestedQuality}: ${formatBytes(estimatedSize)}`);
              }
          }
          // Fallback to general filesize
          if (!estimatedSize) {
              estimatedSize = info.filesize || info.filesize_approx || null;
          }
          return {
              title,
              fileSize: estimatedSize,
              thumbnail,
              availableQualities: extractAvailableQualities(info.formats)
          };
      } catch (error) {
          logDetailed('error', itemId, `getVideoInfo Error for ${videoUrl}: ${error.message}`);
          sendMessageToClient(clientId, {
              type: 'status',
              message: 'Could not fetch detailed video info, proceeding with defaults.',
              itemId
          });
          return { title: 'video', fileSize: null, thumbnail: null, availableQualities: [] };
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

          let downloadedPrimaryPath, tempAudioPath;
          let finalExtension = format;
          let needsConversion = false;

          sendMessageToClient(clientId, { type: 'status', message: 'Preparing download...', itemId, source });

          if (format === 'mp3') {
              const tempDownloadFilenamePattern = `tmp_${itemId}_audio.*`;
              downloadedPrimaryPath = path.join(targetDir, `tmp_${itemId}_audio.%(ext)s`); // For yt-dlp output
              tempFilesCreated.push(path.join(targetDir, tempDownloadFilenamePattern)); // Use wildcard for cleanup

              let audioDownloadArgs = ['-f', 'bestaudio/best', '--no-playlist', '-o', downloadedPrimaryPath, videoUrl];
              if (settings.skipDuplicates && isPlaylistItem) audioDownloadArgs.unshift('--no-overwrites');
              if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) audioDownloadArgs.unshift('--limit-rate', `${settings.maxSpeed}K`);
              
              const { actualPath } = await runYtDlpCommand(clientId, audioDownloadArgs, itemId, false, itemProcInfo);
              if (!actualPath) throw new Error("yt-dlp did not return an output path for audio.");
              downloadedPrimaryPath = actualPath; // Update with actual path

              if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled after audio dl for mp3.`); return; }
              sendMessageToClient(clientId, { type: 'status', message: 'Audio download finished. Converting...', itemId, source });
              needsConversion = true; finalExtension = 'mp3';
          } else if (format === 'mp4') {
              const tempVideoFilenamePattern = `tmp_${itemId}_video.*`;
              downloadedPrimaryPath = path.join(targetDir, `tmp_${itemId}_video.%(ext)s`);
              tempFilesCreated.push(path.join(targetDir, tempVideoFilenamePattern));

              const tempAudioFilenamePattern = `tmp_${itemId}_audio_for_mp4.*`;
              tempAudioPath = path.join(targetDir, `tmp_${itemId}_audio_for_mp4.%(ext)s`);
              tempFilesCreated.push(path.join(targetDir, tempAudioFilenamePattern));

              const height = parseInt(quality);
              let formatString = height === 2160
                ? 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]/best'
                : height && !isNaN(height)
                  ? `bestvideo[height<=?${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=?${height}][ext=mp4]/best`
                  : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

              let videoArgs = ['-f', formatString, '--no-playlist', '-o', downloadedPrimaryPath, videoUrl];
              if (settings.skipDuplicates && isPlaylistItem) videoArgs.unshift('--no-overwrites');
              if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) videoArgs.unshift('--limit-rate', `${settings.maxSpeed}K`);
              sendMessageToClient(clientId, { type: 'status', message: 'Downloading video stream...', itemId, source });
              const { actualPath: actualVideoPath } = await runYtDlpCommand(clientId, videoArgs, itemId, false, itemProcInfo);
              if (!actualVideoPath) throw new Error("yt-dlp did not return an output path for video.");
              downloadedPrimaryPath = actualVideoPath;

              if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled after video dl for mp4.`); return; }
              sendMessageToClient(clientId, { type: 'status', message: 'Video stream finished. Downloading audio...', itemId, source });

              let audioArgs = ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '--no-playlist', '-o', tempAudioPath, videoUrl];
              if (settings.skipDuplicates && isPlaylistItem) audioArgs.unshift('--no-overwrites');
              if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) audioArgs.unshift('--limit-rate', `${settings.maxSpeed}K`);
              const { actualPath: actualAudioPath } = await runYtDlpCommand(clientId, audioArgs, itemId, false, itemProcInfo);
              if (!actualAudioPath) throw new Error("yt-dlp did not return an output path for audio merge.");
              tempAudioPath = actualAudioPath;

              if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled after audio for MP4 dl.`); return; }
              sendMessageToClient(clientId, { type: 'status', message: 'Audio stream finished. Merging...', itemId, source });
              needsConversion = true; finalExtension = 'mp4';
          } else {
              throw new Error(`Unsupported format: ${format}`);
          }

          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled before conversion.`); return; }

          let finalFilePathValue;
          const finalOutputFilenameWithExt = outputTemplate.replace('%(ext)s', finalExtension);

          if (needsConversion) {
              let ffmpegArgs = [];
              if (format === 'mp3') {
                  if (!fs.existsSync(downloadedPrimaryPath)) throw new Error(`Missing temp audio file for MP3 conversion: ${downloadedPrimaryPath}`);
                  ffmpegArgs = ['-i', downloadedPrimaryPath, '-vn'];
                  if (quality && quality !== 'highest' && !isNaN(parseInt(quality))) {
                      ffmpegArgs.push('-b:a', `${quality}k`);
                  } else {
                      ffmpegArgs.push('-q:a', '0');
                  }
                  if (settings.searchTags) ffmpegArgs.push('-map_metadata', '0', '-id3v2_version', '3', '-write_id3v1', '1');
                  ffmpegArgs.push('-y', finalOutputFilenameWithExt);
              } else if (format === 'mp4') {
                  if (!fs.existsSync(downloadedPrimaryPath)) throw new Error(`Missing temp video file for MP4 muxing: ${downloadedPrimaryPath}`);
                  if (!fs.existsSync(tempAudioPath)) throw new Error(`Missing temp audio file for MP4 muxing: ${tempAudioPath}`);
                  ffmpegArgs = ['-i', downloadedPrimaryPath, '-i', tempAudioPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-y', finalOutputFilenameWithExt];
              }
              await runFFmpegCommand(clientId, ffmpegArgs, itemId, itemProcInfo); // ffmpeg writes directly to finalOutputFilenameWithExt
              finalFilePathValue = finalOutputFilenameWithExt;
          } else { // Should not happen with current logic as both mp3 and mp4 need conversion/merge
              if (fs.existsSync(downloadedPrimaryPath)) {
                  fs.renameSync(downloadedPrimaryPath, finalOutputFilenameWithExt);
                  finalFilePathValue = finalOutputFilenameWithExt;
                  // Remove downloadedPrimaryPath from tempFilesCreated as it's now the final file
                  itemProcInfo.tempFiles = itemProcInfo.tempFiles.filter(f => f !== downloadedPrimaryPath);
              } else {
                   throw new Error("Downloaded file not found for renaming (no conversion).");
              }
          }

          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled after conversion/merge step.`); return; }

          if (!finalFilePathValue || !fs.existsSync(finalFilePathValue)) {
              throw new Error("Processing failed, final file not found at: " + finalFilePathValue);
          }

          // Set file modification time to now (always)
          try {
              const now = new Date();
              fs.utimesSync(finalFilePathValue, now, now);
          } catch (e) {
              console.error(`[${itemId}] Failed to set file modification time:`, e);
          }

          const actualFinalFilenameDisplay = path.basename(finalFilePathValue);
          // For download link, always make it relative to DOWNLOAD_DIR (main one)
          const relativePathForLink = path.relative(DOWNLOAD_DIR, finalFilePathValue);
          const downloadLink = `/downloads/${encodeURIComponent(relativePathForLink.replace(/\\/g, '/'))}`;
          let actualSize = null;
          try {
              const stats = fs.statSync(finalFilePathValue);
              actualSize = formatBytes(stats.size);
          } catch (e) { console.error(`[${itemId}] Stat error for ${finalFilePathValue}:`, e); }

          sendMessageToClient(clientId, { type: 'complete', message: 'Download complete!', downloadUrl: downloadLink, filename: actualFinalFilenameDisplay, actualSize: actualSize, itemId, source });

      } catch (error) {
          if (!itemProcInfo.cancelled) {
              console.error(`[${itemId}] Error in processSingleVideo for ${videoUrl}:`, error);
              sendMessageToClient(clientId, { type: 'error', message: `Failed: ${error.message}`, itemId, source });
          } else {
              console.log(`[${itemId}] Processing stopped due to cancellation for ${videoUrl}.`);
              sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Processing stopped due to cancellation.', itemId, source });
          }
      } finally {
          // Clean up temp files after download/conversion is complete (YouTube)
          itemProcInfo.tempFiles.forEach(tempPathPattern => {
              const glob = require('glob');
              // Clean from DOWNLOAD_DIR
              let files = glob.sync(path.basename(tempPathPattern), { cwd: DOWNLOAD_DIR });
              files.forEach(file => {
                  const fullPath = path.join(DOWNLOAD_DIR, file);
                  if (fs.existsSync(fullPath)) {
                      try { fs.unlinkSync(fullPath); } catch (e) { console.error(`[${itemId}] Error cleaning up temp file ${fullPath}:`, e); }
                  }
              });
              // Also clean from playlistFolderPath if different
              if (itemData.playlistFolderPath && itemData.playlistFolderPath !== DOWNLOAD_DIR) {
                  files = glob.sync(path.basename(tempPathPattern), { cwd: itemData.playlistFolderPath });
                  files.forEach(file => {
                      const fullPath = path.join(itemData.playlistFolderPath, file);
                      if (fs.existsSync(fullPath)) {
                          try { fs.unlinkSync(fullPath); } catch (e) { console.error(`[${itemId}] Error cleaning up temp file ${fullPath}:`, e); }
                      }
                  });
              }
              // Also clean up absolute tempPathPattern if it exists (in case temp files are written elsewhere)
              if (fs.existsSync(tempPathPattern)) {
                  try { fs.unlinkSync(tempPathPattern); } catch (e) { console.error(`[${itemId}] Error cleaning up temp file ${tempPathPattern}:`, e); }
              }
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

          sendMessageToClient(clientId, { type: 'complete', message: `Instagram download complete.`, filename: actualFinalFilenameDisplay, downloadUrl: downloadLink, actualSize: actualSize, itemId, source });

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
      
      let cookieFilePath = null;
      const possiblePaths = [];
      
      if (isDev) {
            // Development: check project directory
          possiblePaths.push(path.join(__dirname, 'cookies.txt'));
      } else {
            // Production: check resources folder (outside app.asar)
          const resourcesPath = process.env.ELECTRON_RESOURCES_PATH || process.resourcesPath;
          if (resourcesPath) {
              possiblePaths.push(path.join(resourcesPath, 'cookies.txt'));
          }
          // Fallback to __dirname (might be app.asar)
          possiblePaths.push(path.join(__dirname, 'cookies.txt'));
      }
        
        console.log('[getCookiesPath] Environment:', isDev ? 'Development' : 'Production');
        console.log('[getCookiesPath] Checking paths:', possiblePaths);
      
      // Check existing files
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
        const os = require('os');
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
    // Get correct cookies path - may return null if no cookies exist
      const cookieFilePath = await getCookiesPath();
      
      let cookieArgs = [];
    if (cookieFilePath) {
          cookieArgs = ['--cookies', cookieFilePath];
          console.log(`[${itemId}] Using cookies file: ${cookieFilePath}`);
      } else {
        console.log(`[${itemId}] No cookies.txt found, proceeding without authentication cookies`);
      }

      const finalArgs = [...cookieArgs, ...baseArgs, '--encoding', 'utf-8', '--no-colors', '--retries', '3', '--fragment-retries', '3'];
      if(!suppressProgress) finalArgs.push('--progress', '--newline');

      return new Promise((resolve, reject) => {
          const currentProcInfo = itemProcInfoRef || activeProcesses.get(itemId);
          if (currentProcInfo?.cancelled) {
              return reject(new Error(`[${itemId}] Download cancelled before yt-dlp process start.`));
          }

        console.log(`[${itemId}] Spawning yt-dlp with args: ${finalArgs.join(' ')}`);
          const ytdlpProc = spawn(ytdlpExecutable, finalArgs, { detached: os.platform() !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

        // ... rest of the function remains the same
          if (currentProcInfo) currentProcInfo.ytdlpProc = ytdlpProc;
          else if (itemProcInfoRef && typeof itemProcInfoRef === 'object') itemProcInfoRef.ytdlpProc = ytdlpProc;

          let stdoutData = '';
          let stderrData = '';
          let destinationPath = null;

          ytdlpProc.stdout.setEncoding('utf8');
          ytdlpProc.stderr.setEncoding('utf8');

          ytdlpProc.stdout.on('data', (data) => {
              stdoutData += data;
              if (!suppressProgress) {
                  const progressMatch = data.match(/\[download\]\s*(\d+\.?\d*)%.*?at\s*([\d.]+(?:[KMG]?i?B)\/s)/);
                  const destMatch = data.match(/\[download\] Destination:\s*(.*)/) || data.match(/\[Merger\] Merging formats into "([^"]+)"/) || data.match(/\[ExtractAudio\] Destination:\s*(.*)/) ;
                  const alreadyDownloadedMatch = data.match(/\[download\] (.*?) has already been downloaded/);

                  if (destMatch && destMatch[1]) {
                      destinationPath = destMatch[1].trim();
                  }
                  if (alreadyDownloadedMatch && alreadyDownloadedMatch[1]) {
                      sendMessageToClient(clientId, { type: 'progress', percent: 100, message: `Already downloaded: ${path.basename(destinationPath)}`, itemId });
                  }

                  if (progressMatch) {
                      const percent = parseFloat(progressMatch[1]);
                      const speed = progressMatch[2];
                      sendMessageToClient(clientId, { type:'progress', percent, rawSpeed: speed, itemId });
                  } else if (data.includes('[download]') && data.includes('%')) {
                       sendMessageToClient(clientId, { type: 'progress', message: data.trim(), itemId });
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

          ytdlpProc.on('close', (code, signal) => {
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


  // --- Update Tools Functions ---
  async function updateYtDlp(ytdlpPath) {
      return new Promise((resolve, reject) => {
          console.log('[updateYtDlp] Starting yt-dlp update...');
          
          // Check if yt-dlp exists
          if (!fs.existsSync(ytdlpPath)) {
              console.error('[updateYtDlp] yt-dlp not found at:', ytdlpPath);
              reject(new Error('yt-dlp not found'));
              return;
          }
          
          // yt-dlp can update itself - quote the path to handle spaces
          const quotedPath = `"${ytdlpPath}"`;
          const updateProcess = spawn(quotedPath, ['-U'], {
              cwd: path.dirname(ytdlpPath),
              stdio: 'pipe',
              shell: true
          });
          
          let output = '';
          let errorOutput = '';
          
          updateProcess.stdout.on('data', (data) => {
              const dataStr = data.toString();
              output += dataStr;
              console.log('[updateYtDlp]', dataStr.trim());
          });
          
          updateProcess.stderr.on('data', (data) => {
              const dataStr = data.toString();
              errorOutput += dataStr;
              console.log('[updateYtDlp]', dataStr.trim()); // yt-dlp may output to stderr
          });
          
          updateProcess.on('close', (code) => {
              // yt-dlp -U can return non-zero codes even on success
              if (code === 0 || code === 1) {
                  console.log('[updateYtDlp] Update process completed');
                  resolve({ output, error: errorOutput });
              } else {
                  console.error(`[updateYtDlp] Process exited with code ${code}`);
                  console.error('[updateYtDlp] Output:', output);
                  console.error('[updateYtDlp] Error:', errorOutput);
                  reject(new Error(`yt-dlp update failed with code ${code}`));
              }
          });
          
          updateProcess.on('error', (error) => {
              console.error('[updateYtDlp] Failed to start update process:', error);
              reject(error);
          });
      });
  }
  
  async function updateFfmpeg(ffmpegPath, platform) {
      return new Promise((resolve, reject) => {
          console.log('[updateFfmpeg] Starting ffmpeg update...');
          
          // For now, skip ffmpeg update as it requires manual handling
          // Users should update ffmpeg manually
          console.log('[updateFfmpeg] Skipping ffmpeg update - please update manually from https://ffmpeg.org');
          resolve({ message: 'FFmpeg update skipped - please update manually' });
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

  // Check tools version endpoint
  app.get('/check-tools-version', async (req, res) => {
      try {
          const binDir = path.join(__dirname, 'bin');
          const platform = os.platform();
          const ytdlpPath = path.join(binDir, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
          const ffmpegPath = path.join(binDir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
          
          const versions = {
              ytdlp: await getYtDlpVersion(ytdlpPath),
              ffmpeg: await getFfmpegVersion(ffmpegPath),
              platform
          };
          
          res.json(versions);
      } catch (error) {
          console.error('[check-tools-version] Error:', error);
          res.status(500).json({ error: error.message });
      }
  });

  async function getYtDlpVersion(ytdlpPath) {
      return new Promise((resolve) => {
          if (!fs.existsSync(ytdlpPath)) {
              resolve({ installed: false, version: null, latest: null, needsUpdate: false });
              return;
          }
          
          const process = spawn(ytdlpPath, ['--version'], { stdio: 'pipe' });
          let version = '';
          
          process.stdout.on('data', (data) => {
              version += data.toString().trim();
          });
          
          process.on('close', (code) => {
              if (code === 0) {
                  resolve({ 
                      installed: true, 
                      version: version,
                      latest: null,
                      needsUpdate: false // We'd need to check GitHub API for latest
                  });
              } else {
                  resolve({ installed: false, version: null, latest: null, needsUpdate: false });
              }
          });
          
          process.on('error', () => {
              resolve({ installed: false, version: null, latest: null, needsUpdate: false });
          });
      });
  }

  async function getFfmpegVersion(ffmpegPath) {
      return new Promise((resolve) => {
          if (!fs.existsSync(ffmpegPath)) {
              resolve({ installed: false, version: null, latest: null, needsUpdate: false });
              return;
          }
          
          const process = spawn(ffmpegPath, ['-version'], { stdio: 'pipe' });
          let version = '';
          
          process.stdout.on('data', (data) => {
              const dataStr = data.toString();
              // Extract version from first line
              const match = dataStr.match(/ffmpeg version ([\d.]+)/i);
              if (match) {
                  version = match[1];
              }
          });
          
          process.on('close', (code) => {
              if (code === 0 && version) {
                  resolve({ 
                      installed: true, 
                      version: version,
                      latest: null,
                      needsUpdate: false
                  });
              } else {
                  resolve({ installed: false, version: null, latest: null, needsUpdate: false });
              }
          });
          
          process.on('error', () => {
              resolve({ installed: false, version: null, latest: null, needsUpdate: false });
          });
      });
  }

  // Update tools endpoint
  app.post('/update-tools', async (req, res) => {
      const { platform = os.platform() } = req.body;
      
      try {
          const binDir = path.join(__dirname, 'bin');
          const ytdlpPath = path.join(binDir, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
          const ffmpegPath = path.join(binDir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
          
          console.log('[update-tools] Starting tool updates...');
          console.log('[update-tools] binDir:', binDir);
          console.log('[update-tools] ytdlpPath:', ytdlpPath);
          console.log('[update-tools] ffmpegPath:', ffmpegPath);
          
          // Send initial response
          res.json({ 
              success: true, 
              message: 'Update process started',
              platform 
          });
          
          // Update yt-dlp
          try {
              const result = await updateYtDlp(ytdlpPath);
              console.log('[update-tools] yt-dlp update result:', result);
          } catch (error) {
              console.error('[update-tools] yt-dlp update error:', error.message);
          }
          
          // Update ffmpeg
          try {
              const result = await updateFfmpeg(ffmpegPath, platform);
              console.log('[update-tools] ffmpeg update result:', result);
          } catch (error) {
              console.error('[update-tools] ffmpeg update error:', error.message);
          }
          
      } catch (error) {
          console.error('[update-tools] Error:', error);
      }
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
          console.log(`Using yt-dlp executable: ${ytdlpExecutable}`);
          console.log(`Using ffmpeg executable: ${ffmpegExecutable}`);
          
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
      
      // Notify all clients about shutdown
      wss.clients.forEach(clientWs => {
          const clientEntry = Array.from(clients.entries()).find(([id, cws]) => cws === clientWs);
          if (clientEntry) {
              sendMessageToClient(clientEntry[0], { type: 'status', message: 'Server is shutting down...' });
          }
          clientWs.terminate();
      });

      // Close WebSocket server
      wss.close(() => {
          console.log('WebSocket server closed.');
      });

      // Terminate all active processes more aggressively
      activeProcesses.forEach((procInfo, itemId) => {
          console.log(`Terminating active processes for item: ${itemId} during shutdown.`);
          procInfo.cancelled = true;
          
          // Kill yt-dlp processes
          if (procInfo.ytdlpProc && procInfo.ytdlpProc.pid && !procInfo.ytdlpProc.killed) {
              console.log(`Force killing yt-dlp process (PID: ${procInfo.ytdlpProc.pid})`);
              terminateProcessTree(procInfo.ytdlpProc.pid);
              procInfo.ytdlpProc.killed = true;
          }
          
          // Kill ffmpeg processes
          if (procInfo.ffmpegProc && procInfo.ffmpegProc.pid && !procInfo.ffmpegProc.killed) {
              console.log(`Force killing ffmpeg process (PID: ${procInfo.ffmpegProc.pid})`);
              terminateProcessTree(procInfo.ffmpegProc.pid);
              procInfo.ffmpegProc.killed = true;
          }
      });

      // Clear all maps
      activeProcesses.clear();
      downloadQueue.clear();
      clients.clear();

      server.close(() => {
          console.log('HTTP server closed.');
          console.log("Cleanup complete. Exiting.");
          process.exit(0);
      });

      // More aggressive timeout for shutdown
      setTimeout(() => {
          console.error("Graceful shutdown timed out. Force killing all processes and exiting.");
          // Force kill any remaining processes
          activeProcesses.forEach((procInfo) => {
              if (procInfo.ytdlpProc && procInfo.ytdlpProc.pid) {
                  try {
                      process.kill(procInfo.ytdlpProc.pid, 'SIGKILL');
                  } catch (e) {}
              }
              if (procInfo.ffmpegProc && procInfo.ffmpegProc.pid) {
                  try {
                      process.kill(procInfo.ffmpegProc.pid, 'SIGKILL');
                  } catch (e) {}
              }
          });
          process.exit(1);
      }, 5000); // Reduced timeout to 5 seconds
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
