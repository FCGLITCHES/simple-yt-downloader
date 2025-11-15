// server.js - Backend logic for Simple YTD - OPTIMIZED VERSION
const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const os = require('os');
const cluster = require('cluster');
const net = require('net');

// Port availability check
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

console.log("[server.js] Server process started.");
console.log("[server.js] Received YTDLP_PATH from env: ", process.env.YTDLP_PATH);
console.log("[server.js] Received FFMPEG_PATH from env: ", process.env.FFMPEG_PATH);

(async () => {
  // Dynamically import ESM modules
  const open = (await import('open')).default;
  const getPort = (await import('get-port')).default;

  const PORT = process.env.PORT || await getAvailablePort(9875);
  let DOWNLOAD_DIR = path.join(__dirname, 'downloads');
  
  // Safety: Never allow app.asar in the path
  if (DOWNLOAD_DIR.includes('app.asar') || DOWNLOAD_DIR.includes('app.asa')) {
    DOWNLOAD_DIR = path.join(process.resourcesPath || __dirname, 'downloads');
  }
  
  console.log('[server.js] FINAL DOWNLOAD_DIR:', DOWNLOAD_DIR);
  if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  // Set up executables
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

  global.ytdlpExecutable = ytdlpExecutable;
  global.ffmpegExecutable = ffmpegExecutable;

  console.log("[server.js] Effective ytdlpExecutable: ", ytdlpExecutable);
  console.log("[server.js] Effective ffmpegExecutable: ", ffmpegExecutable);

  // ==================== AUTO-UPDATE SYSTEM ====================
  async function checkAndUpdateTools(forceCheck = false) {
    console.log('🔄 Starting tool updates...');
    try {
      const ytdlpResult = await updateYtDlp(forceCheck);
      const ffmpegResult = await updateFFmpeg(forceCheck);
      console.log('✅ Tool update check completed');
      return { ytdlp: ytdlpResult, ffmpeg: ffmpegResult };
    } catch (error) {
      console.error('❌ Error during tool updates:', error);
      return { error: error.message };
    }
  }

  async function checkYtDlpUpdateAvailable() {
    try {
      const currentVersion = await getToolVersion(ytdlpExecutable);
      const checkResult = await runToolUpdate(ytdlpExecutable, ['-U', '--verbose']);
      
      const output = (checkResult.output || '').toLowerCase();
      const errorOutput = (checkResult.error || '').toLowerCase();
      const combinedOutput = output + ' ' + errorOutput;
      
      if (checkResult.success) {
        const newVersion = await getToolVersion(ytdlpExecutable);
        
        if (newVersion !== currentVersion) {
          return { hasUpdate: true, updated: true, currentVersion, newVersion };
        }
        
        if (combinedOutput.includes('already up to date') || 
            combinedOutput.includes('no update') ||
            combinedOutput.includes('is up to date')) {
          return { hasUpdate: false, currentVersion, reason: 'Already up to date' };
        }
        
        return { hasUpdate: false, currentVersion, reason: 'No update available' };
      }
      
      return { hasUpdate: false, error: checkResult.error || 'Failed to check for updates' };
    } catch (error) {
      return { hasUpdate: false, error: error.message };
    }
  }

  async function updateYtDlp(forceCheck = false) {
    try {
      console.log('🔄 Checking yt-dlp for updates...');
      const currentVersion = await getToolVersion(ytdlpExecutable);
      console.log(`📋 Current yt-dlp version: ${currentVersion}`);
      
      if (!forceCheck) {
        const lastUpdateCheck = getLastUpdateCheck('ytdlp');
        const daysSinceLastCheck = (Date.now() - lastUpdateCheck) / (1000 * 60 * 60 * 24);
        
        if (daysSinceLastCheck < 3) {
          console.log(`⏰ yt-dlp update check skipped (last checked ${Math.round(daysSinceLastCheck)} days ago)`);
          return { updated: false, currentVersion, reason: 'Update check skipped (checked recently)' };
        }
      }
      
      console.log('🔍 Checking for updates and updating if available...');
      const checkResult = await checkYtDlpUpdateAvailable();
      
      if (checkResult.error) {
        console.log(`❌ yt-dlp update check failed: ${checkResult.error}`);
        setLastUpdateCheck('ytdlp');
        return { updated: false, currentVersion, error: checkResult.error || 'Failed to check for updates' };
      }
      
      if (checkResult.updated && checkResult.newVersion) {
        console.log(`✅ yt-dlp updated successfully! ${currentVersion} → ${checkResult.newVersion}`);
        setLastUpdateCheck('ytdlp');
        global.ytdlpExecutable = ytdlpExecutable;
        return { updated: true, oldVersion: currentVersion, newVersion: checkResult.newVersion };
      }
      
      console.log(`ℹ️ yt-dlp: ${checkResult.reason || 'No update available'}`);
      setLastUpdateCheck('ytdlp');
      return { updated: false, currentVersion: checkResult.currentVersion || currentVersion, reason: checkResult.reason || 'No update available' };
      
    } catch (error) {
      console.error('❌ Error updating yt-dlp:', error.message);
      return { updated: false, error: error.message };
    }
  }

  async function updateFFmpeg(forceCheck = false) {
    try {
      console.log('🔄 Checking FFmpeg for updates...');
      let currentVersion = await getToolVersion(ffmpegExecutable);
      console.log(`📋 Current FFmpeg version: ${currentVersion}`);
      
      if (currentVersion === 'unknown' || currentVersion === 'error') {
        console.log('🔄 FFmpeg version unknown, testing if executable works...');
        const isWorking = await testFFmpegWorking();
        currentVersion = isWorking ? 'Working (version unknown)' : 'Not working';
        console.log(isWorking ? '✅ FFmpeg is working but version detection failed' : '❌ FFmpeg executable is not working');
      }
      
      if (!forceCheck) {
        const lastUpdateCheck = getLastUpdateCheck('ffmpeg');
        const daysSinceLastCheck = (Date.now() - lastUpdateCheck) / (1000 * 60 * 60 * 24);
        
        if (daysSinceLastCheck < 7) {
          console.log(`⏰ FFmpeg update check skipped (last checked ${Math.round(daysSinceLastCheck)} days ago)`);
          return { updated: false, currentVersion, reason: 'Update check skipped (checked recently)' };
        }
      }
      
      console.log('📥 Checking FFmpeg for new versions...');
      const ffmpegResult = await checkFFmpegUpdates();
      
      if (ffmpegResult.hasUpdate) {
        console.log(`🔄 FFmpeg update available: ${ffmpegResult.latestVersion}`);
        return { updated: false, currentVersion, hasUpdate: true, latestVersion: ffmpegResult.latestVersion, reason: 'Manual update required' };
      } else {
        console.log('✅ FFmpeg is up to date');
        setLastUpdateCheck('ffmpeg');
        return { updated: false, currentVersion, reason: 'Already up to date' };
      }
      
    } catch (error) {
      console.error('❌ Error checking FFmpeg updates:', error.message);
      return { updated: false, error: error.message };
    }
  }

  async function getToolVersion(executable) {
    try {
      return await new Promise((resolve) => {
        console.log(`🔍 Getting version for: ${executable}`);
        
        const versionProc = spawn(executable, ['--version'], { 
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000
        });
        
        let stdout = '';
        let stderr = '';
        
        versionProc.stdout.on('data', (data) => {
          stdout += data;
        });
        
        versionProc.stderr.on('data', (data) => {
          stderr += data;
        });
        
        versionProc.on('close', (code) => {
          const output = stdout.trim() || stderr.trim();
          if (output) {
            if (executable.includes('ffmpeg')) {
              const match = output.match(/ffmpeg version ([0-9]{4}-[0-9]{2}-[0-9]{2}-git-[a-f0-9]+)/);
              if (match) {
                resolve(`ffmpeg version ${match[1]}`);
              } else {
                const dateMatch = output.match(/ffmpeg version ([0-9]{4}-[0-9]{2}-[0-9]{2})/);
                resolve(dateMatch ? `ffmpeg version ${dateMatch[1]}` : output.split('\n')[0]);
              }
            } else if (executable.includes('yt-dlp')) {
              const match = output.match(/yt-dlp ([0-9]+\.[0-9]+\.[0-9]+)/);
              resolve(match ? `yt-dlp ${match[1]}` : output.split('\n')[0]);
            } else {
              resolve(output.split('\n')[0]);
            }
          } else {
            resolve('unknown');
          }
        });
        
        versionProc.on('error', (error) => {
          console.error(`❌ Error getting version for ${executable}:`, error.message);
          resolve('error');
        });
      });
    } catch (error) {
      console.error(`❌ Exception getting version for ${executable}:`, error.message);
      return 'error';
    }
  }

  async function runToolUpdate(executable, args) {
    return new Promise((resolve) => {
      const updateProc = spawn(executable, args, { 
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000
      });
      
      let updateOutput = '';
      let updateError = '';
      
      updateProc.stdout.on('data', (data) => {
        updateOutput += data;
      });
      
      updateProc.stderr.on('data', (data) => {
        updateError += data;
      });
      
      updateProc.on('close', (code) => {
        resolve(code === 0 ? { success: true, output: updateOutput } : { success: false, error: updateError, code });
      });
      
      updateProc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  async function checkFFmpegUpdates() {
    try {
      const response = await fetch('https://ffmpeg.org/download.html');
      const html = await response.text();
      const versionMatch = html.match(/FFmpeg ([0-9]+\.[0-9]+\.[0-9]+)/);
      
      if (versionMatch) {
        const latestVersion = versionMatch[1];
        const currentVersion = await getToolVersion(ffmpegExecutable);
        const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;
        return { hasUpdate, latestVersion, currentVersion };
      }
      
      return { hasUpdate: false, latestVersion: 'unknown' };
    } catch (error) {
      console.error('Error checking FFmpeg updates:', error);
      return { hasUpdate: false, latestVersion: 'unknown', error: error.message };
    }
  }

  function compareVersions(v1, v2) {
    if (v1 === 'unknown' || v1 === 'error') return 0;
    if (v2 === 'unknown') return 0;
    
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      
      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }
    
    return 0;
  }

  function getLastUpdateCheck(tool) {
    try {
      const checkFile = path.join(__dirname, `${tool}_last_check.json`);
      if (fs.existsSync(checkFile)) {
        const data = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
        return data.lastCheck || 0;
      }
    } catch (error) {
      console.error(`Error reading last update check for ${tool}:`, error);
    }
    return 0;
  }

  function setLastUpdateCheck(tool) {
    try {
      const checkFile = path.join(__dirname, `${tool}_last_check.json`);
      const data = { lastCheck: Date.now() };
      fs.writeFileSync(checkFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Error writing last update check for ${tool}:`, error);
    }
  }

  async function testFFmpegWorking() {
    try {
      return await new Promise((resolve) => {
        const testProc = spawn(ffmpegExecutable, ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=1', '-f', 'null', '-'], { 
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 10000
        });
        
        let stderr = '';
        testProc.stderr.on('data', (data) => stderr += data);
        
        testProc.on('close', (code) => {
          const isWorking = stderr.includes('ffmpeg') || stderr.includes('Input') || stderr.includes('Output');
          resolve(isWorking);
        });
        
        testProc.on('error', (error) => {
          console.error('FFmpeg test error:', error.message);
          resolve(false);
        });
      });
    } catch (error) {
      console.error('Exception testing FFmpeg:', error.message);
      return false;
    }
  }

  // Dynamically import p-limit
  let pLimit;
  import('p-limit').then(module => {
      pLimit = module.default;
      singleVideoProcessingLimit = pLimit(1);
      playlistItemProcessingLimit = pLimit(3);
      console.log('p-limit loaded and limiters initialized.');
  }).catch(err => console.error("Failed to load p-limit:", err));

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // ==================== GLOBAL STATE ====================
  const clients = new Map();
  const activeProcesses = new Map();
  const downloadQueue = new Map();

  let singleVideoProcessingLimit;
  let playlistItemProcessingLimit;

  // ==================== MIDDLEWARE ====================
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      allowedHeaders: 'Content-Type,Authorization',
  }));
  app.use(express.static(__dirname));
  app.use('/downloads', express.static(DOWNLOAD_DIR, {
      setHeaders: (res, filePath) => {
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(filePath))}"`);
      }
  }));

  // ==================== WEBSOCKET HANDLING ====================
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
          try {
              const messageData = JSON.parse(rawMessage.toString());
              const { type, itemId } = messageData;

              if (type === 'download_request') {
                  await handleDownloadRequest(clientId, messageData);
              } else if (type === 'cancel' && itemId) {
                  await handleCancelRequest(clientId, itemId);
              } else {
                  console.warn(`Unknown message type from ${clientId}: ${type}`);
              }
          } catch (parseError) {
              console.error(`Failed to parse message from ${clientId}:`, parseError);
              sendMessageToClient(clientId, { type: 'error', message: 'Invalid message format received.' });
          }
      });

      ws.on('close', () => {
          clients.delete(clientId);
          console.log(`Client disconnected: ${clientId}. Total clients: ${clients.size}`);
      });

      ws.on('error', (error) => {
          console.error(`WebSocket error for client ${clientId}:`, error);
      });
  });

  function sendMessageToClient(clientId, messageObject) {
      const client = clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
          try {
              client.send(JSON.stringify(messageObject));
          } catch (error) {
              console.error(`Error sending message to ${clientId}:`, error);
          }
      }
  }

  // ==================== DOWNLOAD REQUEST HANDLING ====================
  async function handleDownloadRequest(clientId, requestData) {
      const { url: videoUrl, format, quality, source, playlistAction, concurrency, singleConcurrency, ...settings } = requestData;

      if (!videoUrl) {
          return sendMessageToClient(clientId, { type: 'error', message: 'Missing video URL.' });
      }
      if (!pLimit || !singleVideoProcessingLimit || !playlistItemProcessingLimit) {
           return sendMessageToClient(clientId, { type: 'error', message: 'Server not ready. Please try again shortly.' });
      }

      const isPlaylist = source === 'youtube' && videoUrl.includes('list=');

      if (isPlaylist && playlistAction === 'full') {
          const playlistMetaId = `playlist_${source}_${Date.now()}`;
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

              const playlistTitle = await getPlaylistTitle(clientId, videoUrl, playlistMetaId) || items[0]?.title || `Playlist_${Date.now()}`;
              playlistFolderPath = getUniqueFolderPath(DOWNLOAD_DIR, sanitizeFilename(playlistTitle));
              if (!fs.existsSync(playlistFolderPath)) fs.mkdirSync(playlistFolderPath, { recursive: true });

              const newPlaylistConcurrency = parseInt(concurrency) || 3;
              if (playlistItemProcessingLimit.concurrency !== newPlaylistConcurrency) {
                  console.log(`Updating playlist item concurrency to: ${newPlaylistConcurrency}`);
                  playlistItemProcessingLimit = pLimit(newPlaylistConcurrency);
              }

              const downloadPromises = items.map((item, index) => {
                  const individualItemId = `${source}_${item.id}_${Date.now()}_${index}`;
                  const itemData = {
                      clientId, videoUrl: item.id,
                      format, quality, source, settings,
                      isPlaylistItem: true, playlistIndex: index,
                      status: 'queued', parentPlaylistId: playlistMetaId,
                      title: item.title || `Video ${index + 1}`,
                      playlistFolderPath
                  };
                  downloadQueue.set(individualItemId, itemData);
                  sendMessageToClient(clientId, { 
                      type: 'queued', 
                      itemId: individualItemId, 
                      title: itemData.title, 
                      source, 
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
      } else {
          const itemId = `${source}_${(videoUrl.split('v=')[1]?.split('&')[0] || videoUrl.split('/').pop()?.split('?')[0] || Date.now())}_${Math.random().toString(36).substring(2, 7)}`;
          const itemData = {
              clientId, videoUrl, format, quality, source, settings,
              isPlaylistItem: isPlaylist && playlistAction === 'single',
              status: 'queued',
              title: `Video: ${videoUrl}`
          };
          downloadQueue.set(itemId, itemData);
          sendMessageToClient(clientId, { type: 'queued', itemId: itemId, title: itemData.title, source });

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

  // ==================== CANCELLATION HANDLING ====================
  async function handleCancelRequest(clientId, itemId) {
      sendMessageToClient(clientId, { type: 'status', message: 'Cancellation request received...', itemId });

      const queuedItem = downloadQueue.get(itemId);
      if (queuedItem) {
          queuedItem.cancelled = true;
          if (queuedItem.isMeta) {
              downloadQueue.forEach(item => {
                  if (item.parentPlaylistId === itemId) item.cancelled = true;
              });
          }
          sendMessageToClient(clientId, { type: 'cancel_confirm', message: 'Download cancelled from queue.', itemId });
          return;
      }

      const processInfo = activeProcesses.get(itemId);
      if (processInfo) {
          processInfo.cancelled = true;
          try {
              if (processInfo.ytdlpProc && processInfo.ytdlpProc.pid && !processInfo.ytdlpProc.killed) {
                  console.log(`[${itemId}] Terminating yt-dlp process (PID: ${processInfo.ytdlpProc.pid})`);
                  terminateProcessTree(processInfo.ytdlpProc.pid);
                  processInfo.ytdlpProc.killed = true;
              }
              if (processInfo.ffmpegProc && processInfo.ffmpegProc.pid && !processInfo.ffmpegProc.killed) {
                  console.log(`[${itemId}] Terminating ffmpeg process (PID: ${processInfo.ffmpegProc.pid})`);
                  terminateProcessTree(processInfo.ffmpegProc.pid);
                  processInfo.ffmpegProc.killed = true;
              }
          } catch (killError) {
              console.error(`Error during process termination for ${itemId}:`, killError);
          }

          processInfo.tempFiles?.forEach(filePathPattern => {
              const glob = require('glob');
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
              if (stderr && !stderr.toLowerCase().includes("could not be terminated") && !stderr.toLowerCase().includes("not found")) {
                   console.error(`[terminateProcessTree] taskkill stderr for PID ${pid}: ${stderr}`);
              }
          });
      } else {
          try {
              process.kill(-pid, 'SIGTERM');
              console.log(`[terminateProcessTree] Sent SIGTERM to process group ${-pid}`);
          } catch (err) {
              console.warn(`[terminateProcessTree] Error sending SIGTERM to process group ${-pid}: ${err.message}. Trying direct PID.`);
              try {
                  process.kill(pid, 'SIGTERM');
                  console.log(`[terminateProcessTree] Sent SIGTERM to PID ${pid}`);
              } catch (e2) {
                  console.warn(`[terminateProcessTree] Error sending SIGTERM to PID ${pid}: ${e2.message}. Trying SIGKILL.`);
                  try {
                      process.kill(pid, 'SIGKILL');
                      console.log(`[terminateProcessTree] Sent SIGKILL to PID ${pid}.`);
                  } catch (e3) {
                      console.error(`[terminateProcessTree] Error SIGKILLing PID ${pid}: ${e3.message}`);
                  }
              }
          }
      }
  }

  // ==================== VIDEO PROCESSING LOGIC ====================
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

  const videoInfoCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  async function getVideoInfo(clientId, videoUrl, itemId, requestedQuality = 'highest', format = 'mp4') {
      const videoIdMatch = videoUrl.match(/(?:v=|youtu\.be\/|embed\/)([^&\n?#]+)/);
      const cacheKey = videoIdMatch ? videoIdMatch[1] : videoUrl;
      
      const cached = videoInfoCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
          console.log(`[${itemId}] 📦 Using cached video info for ${cacheKey}`);
          return cached.data;
      }
      
      const baseArgs = ['--no-playlist', '--skip-download', '--print-json', videoUrl];
      
      try {
          const { stdout } = await runYtDlpCommand(clientId, baseArgs, `info_${itemId}`, true);
          const info = JSON.parse(stdout.trim());
          const title = info.title || 'video';
          let thumbnail = info.thumbnail || null;
          
          const result = {
              title,
              thumbnail,
              availableQualities: extractAvailableQualities(info.formats)
          };
          
          videoInfoCache.set(cacheKey, { data: result, timestamp: Date.now() });
          
          if (videoInfoCache.size > 100) {
              const now = Date.now();
              for (const [key, value] of videoInfoCache.entries()) {
                  if (now - value.timestamp > CACHE_TTL) {
                      videoInfoCache.delete(key);
                  }
              }
          }
          
          return result;
      } catch (error) {
          logDetailed('error', itemId, `getVideoInfo Error for ${videoUrl}: ${error.message}`);
          sendMessageToClient(clientId, {
              type: 'status',
              message: 'Could not fetch detailed video info, proceeding with defaults.',
              itemId
          });
          return { title: 'video', thumbnail: null, availableQualities: [] };
      }
  }

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
      let sanitized = title.replace(/[<>:"/\\|?*~]/g, ' ').replace(/\s+/g, ' ');
      return sanitized.trim().substring(0, 180);
  }

  function getUniqueFolderPath(basePath, baseName) {
      let folderPath = path.join(basePath, sanitizeFilename(baseName));
      let counter = 1;
      if (!fs.existsSync(folderPath)) {
          return folderPath;
      }
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
          sendMessageToClient(clientId, { 
              type: 'item_info', 
              itemId, 
              title: currentVideoTitle, 
              source, 
              thumbnail: videoInfo.thumbnail,
              isPlaylistItem: itemData.isPlaylistItem || false,
              playlistIndex: itemData.playlistIndex || null
          });

          let targetDir;
          if (isPlaylistItem && itemData.playlistFolderPath && fs.existsSync(itemData.playlistFolderPath)) {
              targetDir = itemData.playlistFolderPath;
          } else if (settings && settings.downloadFolder && settings.downloadFolder.trim() !== '' && fs.existsSync(settings.downloadFolder)) {
              targetDir = settings.downloadFolder;
          } else if (settings && settings.downloadFolder && settings.downloadFolder.trim() !== '') {
              // User specified a folder but it doesn't exist yet - create it
              try {
                  fs.mkdirSync(settings.downloadFolder, { recursive: true });
                  targetDir = settings.downloadFolder;
              } catch (mkdirError) {
                  console.error(`[${itemId}] Failed to create download folder ${settings.downloadFolder}:`, mkdirError);
                  targetDir = itemData.playlistFolderPath || DOWNLOAD_DIR;
              }
          } else {
              targetDir = itemData.playlistFolderPath || DOWNLOAD_DIR;
          }

          const finalBaseFilename = sanitizeFilename(currentVideoTitle);
          let outputTemplate;
          if (isPlaylistItem && itemData.playlistFolderPath) {
              if (settings.numerateFiles && playlistIndex !== null) {
                  const displayIndex = (playlistIndex + 1).toString();
                  outputTemplate = path.join(targetDir, `${displayIndex}_${finalBaseFilename}.%(ext)s`);
              } else {
                  outputTemplate = path.join(targetDir, `${finalBaseFilename}.%(ext)s`);
              }
          } else {
              outputTemplate = path.join(targetDir, `${finalBaseFilename}.%(ext)s`);
          }

          let finalFilePathValue;
          
          sendMessageToClient(clientId, { type: 'status', message: 'Starting optimized download...', itemId, source });

          if (format === 'mp3') {
              const finalOutputFilename = outputTemplate.replace('%(ext)s', 'mp3');
              
              let mp3Args = [
                  '--extract-audio',
                  '--audio-format', 'mp3',
                  '--no-playlist',
                  '-o', outputTemplate,
                  videoUrl
              ];
              
              if (quality && quality !== 'highest' && !isNaN(parseInt(quality))) {
                  mp3Args.push('--audio-quality', quality + 'K');
              } else {
                  mp3Args.push('--audio-quality', '0');
              }
              
              if (settings.searchTags) {
                  mp3Args.push('--embed-metadata');
              }
              
              if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) {
                  mp3Args.unshift('--limit-rate', `${settings.maxSpeed}K`);
              }
              
              if (settings.skipDuplicates && isPlaylistItem) {
                  mp3Args.unshift('--no-overwrites');
              }

              const { actualPath } = await runYtDlpCommand(clientId, mp3Args, itemId, false, itemProcInfo);
              finalFilePathValue = actualPath || finalOutputFilename;

          } else if (format === 'mp4') {
              // OPTIMIZED FORMAT SELECTION - EXACT RESOLUTION + HIGHEST BITRATE
              const finalOutputFilename = outputTemplate.replace('%(ext)s', 'mp4');
              
              let formatString;
              if (quality === 'highest') {
                  // Get absolute best quality - bestvideo prioritizes bitrate automatically
                  formatString = 'bestvideo+bestaudio/best';
              } else {
                  const targetHeight = parseInt(quality);
                  if (!isNaN(targetHeight)) {
                      // CRITICAL: bestvideo[height=X] automatically selects highest bitrate at that resolution
                      formatString = `bestvideo[height=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight}]+bestaudio/best`;
                  } else {
                      formatString = 'bestvideo+bestaudio/best';
                  }
              }

              let mp4Args = [
                  '-f', formatString,
                  '--merge-output-format', 'mp4',
                  '--no-playlist',
                  '-o', outputTemplate,
                  videoUrl
              ];
              
              if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) {
                  mp4Args.unshift('--limit-rate', `${settings.maxSpeed}K`);
              }
              
              if (settings.skipDuplicates && isPlaylistItem) {
                  mp4Args.unshift('--no-overwrites');
              }

              const qualityText = quality === 'highest' ? 'highest available quality with best bitrate' : `${quality}p with highest available bitrate`;
              sendMessageToClient(clientId, { type: 'status', message: `Downloading in ${qualityText}...`, itemId, source });
              const { actualPath } = await runYtDlpCommand(clientId, mp4Args, itemId, false, itemProcInfo);
              finalFilePathValue = actualPath || finalOutputFilename;

          } else {
              throw new Error(`Unsupported format: ${format}`);
          }

          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Cancelled after download.`); return; }

          if (!finalFilePathValue || !fs.existsSync(finalFilePathValue)) {
              throw new Error("Processing failed, final file not found at: " + finalFilePathValue);
          }

          try {
              const now = new Date();
              fs.utimesSync(finalFilePathValue, now, now);
          } catch (e) {
              console.error(`[${itemId}] Failed to set file modification time:`, e);
          }

          const actualFinalFilenameDisplay = path.basename(finalFilePathValue);
          // Calculate relative path - if file is outside DOWNLOAD_DIR, use absolute path approach
          let relativePathForLink;
          try {
              relativePathForLink = path.relative(DOWNLOAD_DIR, finalFilePathValue);
              // If the relative path goes up directories (starts with ..), the file is outside DOWNLOAD_DIR
              // In this case, we need to handle it differently for the download link
              if (relativePathForLink.startsWith('..')) {
                  // File is outside DOWNLOAD_DIR, use the filename directly
                  relativePathForLink = path.basename(finalFilePathValue);
              }
          } catch (e) {
              // Fallback to just filename if path calculation fails
              relativePathForLink = path.basename(finalFilePathValue);
          }
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
              title: currentVideoTitle, // Send clean title for display
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
      const tempFilesCreated = [];

      const itemProcInfo = { ytdlpProc: null, ffmpegProc: null, tempFiles: tempFilesCreated, cancelled: false };
      activeProcesses.set(itemId, itemProcInfo);
      downloadQueue.delete(itemId);

      try {
          if (itemProcInfo.cancelled) { console.log(`[${itemId}] Pre-cancelled processInstagramVideo.`); return; }

          sendMessageToClient(clientId, { type: 'status', message: 'Fetching Instagram video info...', itemId, source });
          const videoInfo = await getVideoInfo(clientId, videoUrl, itemId);
          currentVideoTitle = videoInfo.title || currentVideoTitle;
          sendMessageToClient(clientId, { type: 'item_info', itemId, title: currentVideoTitle, source, thumbnail: videoInfo.thumbnail });

          let targetDir;
          if (settings && settings.downloadFolder && settings.downloadFolder.trim() !== '' && fs.existsSync(settings.downloadFolder)) {
              targetDir = path.join(settings.downloadFolder, 'Instagram');
          } else if (settings && settings.downloadFolder && settings.downloadFolder.trim() !== '') {
              // User specified a folder but it doesn't exist yet - create it
              try {
                  targetDir = path.join(settings.downloadFolder, 'Instagram');
                  fs.mkdirSync(targetDir, { recursive: true });
              } catch (mkdirError) {
                  console.error(`[${itemId}] Failed to create download folder ${targetDir}:`, mkdirError);
                  targetDir = path.join(DOWNLOAD_DIR, 'Instagram');
              }
          } else {
              targetDir = path.join(DOWNLOAD_DIR, 'Instagram');
          }
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

          const finalBaseFilename = sanitizeFilename(currentVideoTitle);
          const outputTemplate = path.join(targetDir, `${finalBaseFilename}.%(ext)s`);

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
              const expectedFinalName = `${finalBaseFilename}.mp4`;
              const potentialPath = path.join(DOWNLOAD_DIR, expectedFinalName);
              if (fs.existsSync(potentialPath)) {
                  finalFilePathValue = potentialPath;
              } else {
                  throw new Error(`Instagram download processing failed, final file not found. Output: ${downloadOutput.substring(0,300)}`);
              }
          }
          
          const actualFinalFilenameDisplay = path.basename(finalFilePathValue);
          // Calculate relative path - if file is outside DOWNLOAD_DIR, use absolute path approach
          let relativePath;
          try {
              relativePath = path.relative(DOWNLOAD_DIR, finalFilePathValue);
              // If the relative path goes up directories (starts with ..), the file is outside DOWNLOAD_DIR
              // In this case, we need to handle it differently for the download link
              if (relativePath.startsWith('..')) {
                  // File is outside DOWNLOAD_DIR, use the filename directly
                  relativePath = path.basename(finalFilePathValue);
              }
          } catch (e) {
              // Fallback to just filename if path calculation fails
              relativePath = path.basename(finalFilePathValue);
          }
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
              title: currentVideoTitle, // Send clean title for display
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
      }
  }

  async function getPlaylistItems(clientId, playlistUrl, playlistMetaId) {
      const args = ['--flat-playlist', '--print', '%(id)s\t%(title)s', playlistUrl];
      try {
          const { stdout } = await runYtDlpCommand(clientId, args, `playlist_info_${playlistMetaId}`, true);
          const lines = stdout.trim().split('\n').filter(line => line.trim() !== '' && line.includes('\t'));
          const items = lines.map(line => {
              const parts = line.split('\t');
              return { id: parts[0], title: parts[1] || 'Untitled Video' };
          });
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

  // ==================== COOKIE MANAGEMENT ====================
  async function getCookiesPath() {
      const userDataPath = getElectronUserDataPath();
      const cookiesDir = path.join(userDataPath, 'cookies');
      const cookiesPath = path.join(cookiesDir, 'cookies.txt');
      
      console.log('[getCookiesPath] 📁 Checking cookies at:', cookiesPath);
      
      if (!fs.existsSync(cookiesDir)) {
          fs.mkdirSync(cookiesDir, { recursive: true });
          console.log('[getCookiesPath] 📁 Created cookies directory:', cookiesDir);
      }
      
      if (fs.existsSync(cookiesPath)) {
          const stats = fs.statSync(cookiesPath);
          if (stats.size > 50) {
              console.log(`[getCookiesPath] ✅ Found cookies file: ${cookiesPath} (${stats.size} bytes)`);
              return cookiesPath;
          } else {
              console.log(`[getCookiesPath] ⚠️ Cookies file too small: ${cookiesPath} (${stats.size} bytes)`);
          }
      } else {
          console.log(`[getCookiesPath] ℹ️ No cookies file found at: ${cookiesPath}`);
          
          const oldCookiesPath = path.join(__dirname, 'cookies', 'cookies.txt');
          if (fs.existsSync(oldCookiesPath)) {
              console.log(`[getCookiesPath] 🔄 Migrating cookies from old location: ${oldCookiesPath}`);
              try {
                  const content = fs.readFileSync(oldCookiesPath, 'utf8');
                  if (content.length > 50) {
                      fs.writeFileSync(cookiesPath, content, 'utf8');
                      console.log(`[getCookiesPath] ✅ Successfully migrated cookies to: ${cookiesPath}`);
                      return cookiesPath;
                  }
              } catch (err) {
                  console.error(`[getCookiesPath] ❌ Failed to migrate cookies:`, err);
              }
          }
      }
      
      return null;
  }

  function getElectronUserDataPath() {
      const platform = os.platform();
      const homedir = os.homedir();
      const appName = 'SimplyYTD';
      
      switch (platform) {
          case 'win32':
              return path.join(homedir, 'AppData', 'Roaming', appName);
          case 'darwin':
              return path.join(homedir, 'Library', 'Application Support', appName);
          case 'linux':
              return path.join(homedir, '.config', appName);
          default:
              return path.join(homedir, '.video-downloader-gemini');
      }
  }

  async function validateCookiesFile(filePath) {
      try {
          const content = fs.readFileSync(filePath, 'utf8').trim();
          
          if (!content || content.length < 10) {
              console.log(`[validateCookiesFile] File too small or empty: ${filePath} (${content.length} bytes)`);
              return false;
          }
          
          const lines = content.split('\n');
          const nonCommentLines = lines.filter(line => {
              const trimmed = line.trim();
              return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//');
          });
          
          if (nonCommentLines.length === 0) {
              console.log(`[validateCookiesFile] No non-comment lines found: ${filePath}`);
              return false;
          }
          
          const hasValidIndicator = content.toLowerCase().includes('youtube') || 
                                   content.toLowerCase().includes('google') || 
                                   content.includes('\t') || 
                                   content.includes('.com') ||
                                   nonCommentLines.length >= 3;
          
          if (!hasValidIndicator) {
              console.log(`[validateCookiesFile] No recognizable cookie patterns: ${filePath}`);
              return false;
          }
          
          console.log(`[validateCookiesFile] ✅ Valid cookies file: ${filePath} (${content.length} chars, ${nonCommentLines.length} cookie lines)`);
          return true;
          
      } catch (e) {
          console.error(`[validateCookiesFile] Error validating ${filePath}:`, e.message);
          return false;
      }
  }

  // ==================== YT-DLP COMMAND RUNNER (OPTIMIZED) ====================
  async function runYtDlpCommand(clientId, baseArgs, itemId, suppressProgress = false, itemProcInfoRef = null) {
    console.log(`[${itemId}] 🚀 Starting yt-dlp command...`);
    
    const isInfoOnly = suppressProgress || baseArgs.includes('--print-json') || baseArgs.includes('--print');
    const cookieFilePath = await getCookiesPath();
    
    let cookieArgs = [];
    if (cookieFilePath) {
        try {
            const stats = fs.statSync(cookieFilePath);
            console.log(`[${itemId}] 📁 Found cookies file: ${cookieFilePath} (${stats.size} bytes)`);
            
            const isValid = await validateCookiesFile(cookieFilePath);
            
            if (isValid) {
                console.log(`[${itemId}] ✅ Using cookies for enhanced access`);
                cookieArgs = ['--cookies', cookieFilePath];
                
                if (!isInfoOnly) {
                    cookieArgs.push('--extractor-retries', '3');
                    sendMessageToClient(clientId, {
                        type: 'status',
                        message: '🍪 Using cookies (optimized mode)',
                        itemId
                    });
                }
            } else {
                console.log(`[${itemId}] ⚠️ Cookies file found but appears invalid format`);
                if (!isInfoOnly) {
                    sendMessageToClient(clientId, {
                        type: 'status',
                        message: '⚠️ Cookies found but invalid format. Using standard access...',
                        itemId
                    });
                }
            }
        } catch (e) {
            console.error(`[${itemId}] ❌ Cookie file error: ${e.message}`);
            if (!isInfoOnly) {
                sendMessageToClient(clientId, {
                    type: 'status',
                    message: `❌ Cookie error: ${e.message}`,
                    itemId
                });
            }
        }
    } else if (!isInfoOnly) {
        console.log(`[${itemId}] ℹ️ No cookies file found - using standard requests`);
        sendMessageToClient(clientId, {
            type: 'status',
            message: 'ℹ️ No cookies found - add cookies for enhanced access',
            itemId
        });
    }

    // Helper for randomized sleep (anti-bot)
    function getRandomSleepInterval() {
        return Math.floor(Math.random() * 3) + 1; // 1-3 seconds
    }

    // OPTIMIZED ARGS - Different settings for info vs downloads
    const finalArgs = [
        ...cookieArgs, 
        ...baseArgs, 
        '--encoding', 'utf-8', 
        '--no-colors',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ];
    
    if (isInfoOnly) {
        // Fast settings for info - no throttles
        finalArgs.push(
            '--retries', '3',
            '--no-warnings'
        );
    } else {
        // OPTIMIZED DOWNLOAD SETTINGS - Speed + Anti-bot Balance
        const sleepInterval = getRandomSleepInterval();
        const maxSleepInterval = sleepInterval + 1;
        
        finalArgs.push(
            '--retries', '5',
            '--fragment-retries', '4',
            '--retry-sleep', '2',
            '--concurrent-fragments', '6', // INCREASED from 3 to 6
            '--buffer-size', '256K', // INCREASED from 64K to 256K
            '--socket-timeout', '45', // Prevents hanging
            '--http-chunk-size', '10M', // Better chunk handling
            '--sleep-interval', sleepInterval.toString(), // Anti-bot randomization
            '--max-sleep-interval', maxSleepInterval.toString(), // Anti-bot jitter
            '--no-part',
            // Browser-like headers for anti-bot
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '--add-header', 'Accept-Encoding:gzip, deflate, br',
            '--add-header', 'DNT:1',
            '--add-header', 'Connection:keep-alive',
            '--add-header', 'Upgrade-Insecure-Requests:1'
        );
    }
    
    if(!suppressProgress) finalArgs.push('--progress', '--newline');

    console.log(`[${itemId}] 🎯 Final yt-dlp args:`, finalArgs.slice(0, 10), '... (truncated)');

    return new Promise((resolve, reject) => {
        const currentProcInfo = itemProcInfoRef || activeProcesses.get(itemId);
        if (currentProcInfo?.cancelled) {
            return reject(new Error(`[${itemId}] Download cancelled before yt-dlp process start.`));
        }

        console.log(`[${itemId}] 🚀 Starting yt-dlp...`);
        const ytdlpProc = spawn(ytdlpExecutable, finalArgs, { 
            detached: os.platform() !== 'win32', 
            stdio: ['ignore', 'pipe', 'pipe'], 
            windowsHide: true 
        });

        if (currentProcInfo) currentProcInfo.ytdlpProc = ytdlpProc;
        else if (itemProcInfoRef && typeof itemProcInfoRef === 'object') itemProcInfoRef.ytdlpProc = ytdlpProc;

        let stdoutData = '';
        let stderrData = '';
        let destinationPath = null;

        ytdlpProc.stdout.setEncoding('utf8');
        ytdlpProc.stderr.setEncoding('utf8');

        // Speed monitoring
        let lastSpeedCheck = Date.now();
        let speedSamples = [];
        let rateLimitDetected = false;

        ytdlpProc.stdout.on('data', (data) => {
            stdoutData += data;
            if (!suppressProgress) {
                const progressMatch = data.match(/\[download\]\s*(\d+\.?\d*)%.*?at\s*([\d.]+(?:[KMG]?i?B)\/s)/);
                const destMatch = data.match(/\[download\] Destination:\s*(.*)/) || data.match(/\[Merger\] Merging formats into "([^"]+)"/) || data.match(/\[ExtractAudio\] Destination:\s*(.*)/);
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
                    
                    // Speed monitoring for throttle detection
                    const now = Date.now();
                    if (now - lastSpeedCheck > 5000) {
                        try {
                            const speedValue = parseFloat(speed);
                            if (!isNaN(speedValue) && speedValue > 0) {
                                const speedLower = speed.toLowerCase();
                                let speedBytes = speedValue;
                                
                                if (speedLower.includes('gib') || speedLower.includes('gb')) {
                                    speedBytes *= 1024 * 1024 * 1024;
                                } else if (speedLower.includes('mib') || speedLower.includes('mb')) {
                                    speedBytes *= 1024 * 1024;
                                } else if (speedLower.includes('kib') || speedLower.includes('kb')) {
                                    speedBytes *= 1024;
                                }
                                
                                speedSamples.push(speedBytes);
                                if (speedSamples.length > 10) speedSamples.shift();
                                
                                if (speedSamples.length >= 3) {
                                    const recentAvg = speedSamples.slice(-3).reduce((a, b) => a + b, 0) / 3;
                                    const earlierAvg = speedSamples.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
                                    
                                    if (earlierAvg > 0 && recentAvg < earlierAvg * 0.3) {
                                        console.log(`[${itemId}] ⚠️ Speed drop detected: ${(earlierAvg / 1024 / 1024).toFixed(2)} MB/s → ${(recentAvg / 1024 / 1024).toFixed(2)} MB/s`);
                                    }
                                }
                            }
                        } catch (e) {
                            // Silently ignore speed parsing errors
                        }
                        
                        lastSpeedCheck = now;
                    }
                    
                    sendMessageToClient(clientId, { type:'progress', percent, rawSpeed: speed, itemId });
                } else if (data.includes('[download]') && data.includes('%')) {
                     sendMessageToClient(clientId, { type: 'progress', message: data.trim(), itemId });
                }
            }
        });

        ytdlpProc.stderr.on('data', (data) => {
            stderrData += data;
            
            // Enhanced error detection
            if (data.includes('403') || data.includes('Forbidden')) {
                console.log(`[${itemId}] 🚨 Auth error detected: ${data.trim()}`);
                if (!isInfoOnly) {
                    sendMessageToClient(clientId, {
                        type: 'status',
                        message: '⚠️ Authentication issue detected. Consider updating cookies.',
                        itemId
                    });
                }
            }
            
            if (data.includes('429') || data.includes('Too Many Requests') || data.includes('rate limit')) {
                rateLimitDetected = true;
                console.log(`[${itemId}] 🚨 Rate limiting detected: ${data.trim()}`);
                if (!isInfoOnly) {
                    sendMessageToClient(clientId, {
                        type: 'status',
                        message: '⚠️ Rate limiting detected. Adjusting download strategy...',
                        itemId
                    });
                }
            }
            
            if (data.includes('throttled') || data.includes('blocked') || data.includes('temporarily unavailable')) {
                console.log(`[${itemId}] ⚠️ Possible throttling detected: ${data.trim()}`);
            }
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
                            } catch (e) { /* Silent */ }
                      } else if (fs.existsSync(template)) {
                            destinationPath = template;
                        }
                    }
                }
                resolve({ stdout: stdoutData, stderr: stderrData, actualPath: destinationPath });
            } else {
                // Enhanced error handling
                let errorMsg = stderrData.split('\n').filter(line => line.toLowerCase().includes('error:')).join('; ') || stderrData.trim() || `yt-dlp exited with code ${code}`;
                
                if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
                    if (cookieFilePath) {
                        errorMsg = `Authentication failed despite cookies. Your cookies may be expired or invalid. Try getting fresh cookies. Original error: ${errorMsg}`;
                    } else {
                        errorMsg = `Authentication required (403 Forbidden). This video may require login. Try importing fresh cookies from your browser. Original error: ${errorMsg}`;
                    }
                } else if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests') || errorMsg.includes('rate limit') || rateLimitDetected) {
                    errorMsg = `Rate limiting detected (429 Too Many Requests). YouTube is temporarily restricting downloads. Please wait a few minutes before trying again. Consider using cookies for better access. Original error: ${errorMsg}`;
                    console.log(`[${itemId}] 💡 Rate limiting tip: Wait 5-10 minutes, ensure cookies are up to date, and try again.`);
                } else if (errorMsg.includes('throttled') || errorMsg.includes('blocked')) {
                    errorMsg = `Download throttled or blocked. This may be due to excessive requests. Wait a few minutes and try again. Original error: ${errorMsg}`;
                }
                
                console.error(`[${itemId}] yt-dlp failed (code ${code}). Error: ${errorMsg}`);
                reject(new Error(errorMsg.substring(0, 400)));
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
        const ffmpegProc = spawn(ffmpegExecutable, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

        if (currentProcInfo) currentProcInfo.ffmpegProc = ffmpegProc;
        else if (itemProcInfoRef && typeof itemProcInfoRef === 'object') itemProcInfoRef.ffmpegProc = ffmpegProc;

        let ffmpegStderr = '';
        ffmpegProc.stderr.setEncoding('utf8');
        ffmpegProc.stderr.on('data', (data) => {
            ffmpegStderr += data;
        });

        ffmpegProc.on('error', (error) => {
            console.error(`[${itemId}] ffmpeg spawn error using ${ffmpegExecutable}: ${error.message}`);
            if (currentProcInfo) currentProcInfo.ffmpegProc = null;
            if(!itemProcInfoRef) activeProcesses.delete(itemId);
            reject(new Error(`ffmpeg process failed to start (${ffmpegExecutable}): ${error.message}`));
        });

        ffmpegProc.on('close', (code) => {
            if (currentProcInfo) currentProcInfo.ffmpegProc = null;

            if (currentProcInfo?.cancelled) {
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

  // ==================== HTTP ROUTES ====================
  app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
  });

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
      setTimeout(() => gracefulShutdown(), 100);
  });

  app.post('/update-tools', async (req, res) => {
      try {
          console.log('🔄 Manual tool update request received');
          const result = await checkAndUpdateTools(true);
          res.json(result);
      } catch (error) {
          console.error('❌ Error in manual update endpoint:', error);
          res.status(500).json({ error: error.message });
      }
  });

  app.get('/tools-status', async (req, res) => {
      try {
          const ytdlpVersion = await getToolVersion(ytdlpExecutable);
          const ffmpegVersion = await getToolVersion(ffmpegExecutable);
          
          const ytdlpLastCheck = getLastUpdateCheck('ytdlp');
          const ffmpegLastCheck = getLastUpdateCheck('ffmpeg');
          
          res.json({
              ytdlp: {
                  version: ytdlpVersion,
                  lastUpdateCheck: ytdlpLastCheck,
                  daysSinceLastCheck: Math.round((Date.now() - ytdlpLastCheck) / (1000 * 60 * 60 * 24))
              },
              ffmpeg: {
                  version: ffmpegVersion,
                  lastUpdateCheck: ffmpegLastCheck,
                  daysSinceLastCheck: Math.round((Date.now() - ffmpegLastCheck) / (1000 * 60 * 60 * 24))
              }
          });
      } catch (error) {
          console.error('❌ Error getting tools status:', error);
          res.status(500).json({ error: error.message });
      }
  });

  app.post('/force-update-tools', async (req, res) => {
      try {
          console.log('🔄 Force update request received');
          setLastUpdateCheck('ytdlp');
          setLastUpdateCheck('ffmpeg');
          const result = await checkAndUpdateTools();
          res.json(result);
      } catch (error) {
          console.error('❌ Error in force update endpoint:', error);
          res.status(500).json({ error: error.message });
      }
  });

  // ==================== SERVER START & GRACEFUL SHUTDOWN ====================
  server.listen(PORT, async () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
      console.log(`Downloads will be saved to: ${DOWNLOAD_DIR}`);
      
      // Auto-check for tool updates on server start
      setTimeout(async () => {
          try {
              console.log('🚀 Server started, checking for tool updates...');
              await checkAndUpdateTools();
          } catch (error) {
              console.error('❌ Error during startup tool check:', error);
          }
      }, 5000);
      
      if (process.send) {
          console.log('Sending server_ready message to parent process...');
          process.send({ type: 'server_ready', port: PORT });
      }
      
      if (!process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
        await open(`http://localhost:${PORT}`);
      }
      
      setTimeout(() => {
          console.log('WebSocket server should be ready now');
          if (!pLimit) console.warn("p-limit module not loaded yet. Concurrency limiters will be initialized once it loads.");
          else {
              console.log(`Using yt-dlp executable: ${ytdlpExecutable}`);
              console.log(`Using ffmpeg executable: ${ffmpegExecutable}`);
          }
          
          wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                  console.log('Sending ready message to client');
                  client.send(JSON.stringify({ type: 'ready', message: 'Backend server is ready.' }));
              }
          });
      }, 500);
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

})();
