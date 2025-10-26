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
  const PORT = process.env.PORT || await getAvailablePort(9875);
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

  // Auto-update system for yt-dlp and FFmpeg
  async function checkAndUpdateTools() {
    console.log('🔄 Starting automatic tool updates...');
    
    try {
      // Check and update yt-dlp
      const ytdlpResult = await updateYtDlp();
      
      // Check and update FFmpeg
      const ffmpegResult = await updateFFmpeg();
      
      console.log('✅ Tool update check completed');
      return { ytdlp: ytdlpResult, ffmpeg: ffmpegResult };
    } catch (error) {
      console.error('❌ Error during tool updates:', error);
      return { error: error.message };
    }
  }

  async function updateYtDlp() {
    try {
      console.log('🔄 Checking yt-dlp for updates...');
      
      // Get current version
      const currentVersion = await getToolVersion(ytdlpExecutable);
      console.log(`📋 Current yt-dlp version: ${currentVersion}`);
      
      // Check if update is needed (run every 3 days for more frequent updates)
      const lastUpdateCheck = getLastUpdateCheck('ytdlp');
      const daysSinceLastCheck = (Date.now() - lastUpdateCheck) / (1000 * 60 * 60 * 24);
      
      if (daysSinceLastCheck < 3) {
        console.log(`⏰ yt-dlp update check skipped (last checked ${Math.round(daysSinceLastCheck)} days ago)`);
        return { updated: false, currentVersion, reason: 'Update check skipped (checked recently)' };
      }
      
      // Attempt update with enhanced options
      console.log('📥 Updating yt-dlp...');
      const updateResult = await runToolUpdate(ytdlpExecutable, ['-U', '--verbose']);
      
      if (updateResult.success) {
        const newVersion = await getToolVersion(ytdlpExecutable);
        console.log(`✅ yt-dlp updated successfully! ${currentVersion} → ${newVersion}`);
        setLastUpdateCheck('ytdlp');
        
        // Update the global executable path if needed
        global.ytdlpExecutable = ytdlpExecutable;
        
        return { updated: true, oldVersion: currentVersion, newVersion: newVersion };
      } else {
        console.log(`⚠️ yt-dlp update failed: ${updateResult.error}`);
        return { updated: false, currentVersion, error: updateResult.error };
      }
      
    } catch (error) {
      console.error('❌ Error updating yt-dlp:', error.message);
      return { updated: false, error: error.message };
    }
  }

  async function updateFFmpeg() {
    try {
      console.log('🔄 Checking FFmpeg for updates...');
      
      // Get current version
      let currentVersion = await getToolVersion(ffmpegExecutable);
      console.log(`📋 Current FFmpeg version: ${currentVersion}`);
      
      // If version is still unknown, try to test if FFmpeg is working
      if (currentVersion === 'unknown' || currentVersion === 'error') {
        console.log('🔄 FFmpeg version unknown, testing if executable works...');
        const isWorking = await testFFmpegWorking();
        if (isWorking) {
          currentVersion = 'Working (version unknown)';
          console.log('✅ FFmpeg is working but version detection failed');
        } else {
          currentVersion = 'Not working';
          console.log('❌ FFmpeg executable is not working');
        }
      }
      
      // Check if update is needed (run every 7 days for FFmpeg)
      const lastUpdateCheck = getLastUpdateCheck('ffmpeg');
      const daysSinceLastCheck = (Date.now() - lastUpdateCheck) / (1000 * 60 * 60 * 24);
      
      if (daysSinceLastCheck < 7) {
        console.log(`⏰ FFmpeg update check skipped (last checked ${Math.round(daysSinceLastCheck)} days ago)`);
        return { updated: false, currentVersion, reason: 'Update check skipped (checked recently)' };
      }
      
      // For Windows, try to auto-download FFmpeg (disabled for now due to stability issues)
      if (os.platform() === 'win32' && false) { // Disabled auto-update
        console.log('📥 Attempting to auto-update FFmpeg for Windows...');
        const downloadResult = await downloadLatestFFmpeg();
        
        if (downloadResult.success) {
          console.log(`✅ FFmpeg updated successfully! ${currentVersion} → ${downloadResult.newVersion}`);
          setLastUpdateCheck('ffmpeg');
          
          // Update the global executable path
          global.ffmpegExecutable = downloadResult.newPath;
          
          return { updated: true, oldVersion: currentVersion, newVersion: downloadResult.newVersion };
        } else {
          console.log(`⚠️ FFmpeg auto-update failed: ${downloadResult.error}`);
        }
      }
      
      // Fallback to manual update check
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
          console.log(`📤 stdout data: ${data.toString().trim()}`);
        });
        
        versionProc.stderr.on('data', (data) => {
          stderr += data;
          console.log(`⚠️ stderr data: ${data.toString().trim()}`);
        });
        
        versionProc.on('close', (code) => {
          console.log(`🔍 Process closed with code: ${code}`);
          console.log(`📤 Final stdout: "${stdout.trim()}"`);
          console.log(`⚠️ Final stderr: "${stderr.trim()}"`);
          
          // FFmpeg can return various exit codes but still output version info
          // Accept any code as long as we got output
          const output = stdout.trim() || stderr.trim();
          if (output) {
            // Handle different output formats
            if (executable.includes('ffmpeg') || executable.includes('ffmpeg.exe')) {
              console.log(`🔍 Processing FFmpeg output: "${output}"`);
              // FFmpeg format: "ffmpeg version 2025-05-26-git-43a69886b2-essentials_build-www.gyan.dev"
              const match = output.match(/ffmpeg version ([0-9]{4}-[0-9]{2}-[0-9]{2}-git-[a-f0-9]+)/);
              if (match) {
                console.log(`✅ FFmpeg version match found: ${match[1]}`);
                resolve(`ffmpeg version ${match[1]}`);
              } else {
                // Fallback: try to extract just the date part
                const dateMatch = output.match(/ffmpeg version ([0-9]{4}-[0-9]{2}-[0-9]{2})/);
                if (dateMatch) {
                  console.log(`✅ FFmpeg date version found: ${dateMatch[1]}`);
                  resolve(`ffmpeg version ${dateMatch[1]}`);
                } else {
                  console.log(`⚠️ No FFmpeg version match, using first line: "${output.split('\n')[0]}"`);
                  resolve(output.split('\n')[0]); // Fallback to first line
                }
              }
            } else if (executable.includes('yt-dlp') || executable.includes('yt-dlp.exe')) {
              console.log(`🔍 Processing yt-dlp output: "${output}"`);
              // yt-dlp format: "yt-dlp 2025.08.11"
              const match = output.match(/yt-dlp ([0-9]+\.[0-9]+\.[0-9]+)/);
              if (match) {
                console.log(`✅ yt-dlp version match found: ${match[1]}`);
                resolve(`yt-dlp ${match[1]}`);
              } else {
                console.log(`⚠️ No yt-dlp version match, using first line: "${output.split('\n')[0]}"`);
                resolve(output.split('\n')[0]); // Fallback to first line
              }
            } else {
              console.log(`🔍 Generic tool, using first line: "${output.split('\n')[0]}"`);
              resolve(output.split('\n')[0]); // Generic fallback
            }
          } else {
            console.log(`❌ No output from ${executable}`);
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
        timeout: 120000 // 2 minute timeout
      });
      
      let updateOutput = '';
      let updateError = '';
      
      updateProc.stdout.on('data', (data) => {
        updateOutput += data;
        console.log(`📥 Update output: ${data.toString().trim()}`);
      });
      
      updateProc.stderr.on('data', (data) => {
        updateError += data;
        console.log(`⚠️ Update warning: ${data.toString().trim()}`);
      });
      
      updateProc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: updateOutput });
        } else {
          resolve({ success: false, error: updateError, code });
        }
      });
      
      updateProc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  async function checkFFmpegUpdates() {
    try {
      // Check FFmpeg website for latest version
      const response = await fetch('https://ffmpeg.org/download.html');
      const html = await response.text();
      
      // Extract version from HTML (this is a simple approach)
      const versionMatch = html.match(/FFmpeg ([0-9]+\.[0-9]+\.[0-9]+)/);
      if (versionMatch) {
        const latestVersion = versionMatch[1];
        const currentVersion = await getToolVersion(ffmpegExecutable);
        
        // Simple version comparison
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
        // Test with a simple command that should work
        const testProc = spawn(ffmpegExecutable, ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=1', '-f', 'null', '-'], { 
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 10000
        });
        
        let stderr = '';
        testProc.stderr.on('data', (data) => stderr += data);
        
        testProc.on('close', (code) => {
          // FFmpeg often returns non-zero codes for test commands, but stderr output indicates it's working
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

  // Auto-download latest FFmpeg for Windows
  async function downloadLatestFFmpeg() {
    try {
      console.log('📥 Downloading latest FFmpeg for Windows...');
      
      // Get the latest FFmpeg release from GitHub
      const response = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest');
      if (!response.ok) {
        throw new Error(`Failed to fetch FFmpeg releases: ${response.status}`);
      }
      
      const release = await response.json();
      const assets = release.assets;
      
      // Find the Windows build asset
      const windowsAsset = assets.find(asset => 
        asset.name.includes('win64') && 
        asset.name.includes('gpl') && 
        asset.name.endsWith('.zip')
      );
      
      if (!windowsAsset) {
        throw new Error('No Windows FFmpeg build found');
      }
      
      console.log(`📥 Found FFmpeg release: ${release.tag_name}`);
      console.log(`📥 Downloading: ${windowsAsset.name}`);
      
      // Download the asset
      const downloadResponse = await fetch(windowsAsset.browser_download_url);
      if (!downloadResponse.ok) {
        throw new Error(`Failed to download FFmpeg: ${downloadResponse.status}`);
      }
      
      const buffer = await downloadResponse.arrayBuffer();
      const zipPath = path.join(__dirname, 'temp_ffmpeg.zip');
      fs.writeFileSync(zipPath, Buffer.from(buffer));
      
      // Extract the zip file
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(zipPath);
      const extractPath = path.join(__dirname, 'temp_ffmpeg');
      zip.extractAllTo(extractPath, true);
      
      // Find the ffmpeg.exe in the extracted files
      function findFFmpegExe(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const found = findFFmpegExe(fullPath);
            if (found) return found;
          } else if (file === 'ffmpeg.exe') {
            return fullPath;
          }
        }
        return null;
      }
      
      const ffmpegExePath = findFFmpegExe(extractPath);
      
      if (!ffmpegExePath) {
        throw new Error('ffmpeg.exe not found in downloaded archive');
      }
      
      const sourcePath = path.join(extractPath, ffmpegExePath);
      const targetPath = path.join(__dirname, 'bin', 'ffmpeg.exe');
      
      // Backup old ffmpeg if it exists
      if (fs.existsSync(targetPath)) {
        const backupPath = path.join(__dirname, 'bin', `ffmpeg_backup_${Date.now()}.exe`);
        fs.copyFileSync(targetPath, backupPath);
        console.log(`📁 Backed up old FFmpeg to: ${backupPath}`);
      }
      
      // Copy new ffmpeg to bin directory
      fs.copyFileSync(sourcePath, targetPath);
      
      // Verify the new ffmpeg works before cleaning up
      console.log('🔍 Verifying new FFmpeg installation...');
      const testResult = await testFFmpegWorking();
      if (!testResult) {
        // Restore backup if verification fails
        const backupFiles = fs.readdirSync(path.join(__dirname, 'bin')).filter(f => f.startsWith('ffmpeg_backup_'));
        if (backupFiles.length > 0) {
          const latestBackup = backupFiles.sort().pop();
          const backupPath = path.join(__dirname, 'bin', latestBackup);
          fs.copyFileSync(backupPath, targetPath);
          console.log('🔄 Restored FFmpeg from backup due to verification failure');
        }
        throw new Error('New FFmpeg installation failed verification test');
      }
      
      // Clean up temporary files
      fs.unlinkSync(zipPath);
      fs.rmSync(extractPath, { recursive: true, force: true });
      
      // Get version of new ffmpeg
      const newVersion = await getToolVersion(targetPath);
      
      console.log(`✅ FFmpeg downloaded and installed: ${newVersion}`);
      
      return { 
        success: true, 
        newVersion: newVersion,
        newPath: targetPath,
        releaseTag: release.tag_name
      };
      
    } catch (error) {
      console.error('❌ Error downloading FFmpeg:', error.message);
      
      // Try to restore backup if it exists
      const backupFiles = fs.readdirSync(path.join(__dirname, 'bin')).filter(f => f.startsWith('ffmpeg_backup_'));
      if (backupFiles.length > 0) {
        const latestBackup = backupFiles.sort().pop();
        const backupPath = path.join(__dirname, 'bin', latestBackup);
        const ffmpegPath = path.join(__dirname, 'bin', 'ffmpeg.exe');
        try {
          fs.copyFileSync(backupPath, ffmpegPath);
          console.log('🔄 Restored FFmpeg from backup:', latestBackup);
        } catch (restoreError) {
          console.error('❌ Failed to restore FFmpeg backup:', restoreError.message);
        }
      }
      
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
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
          sendMessageToClient(clientId, { type: 'queued', itemId: itemId, title: itemData.title, source });


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

  // Enhanced getVideoInfo without size estimation
  async function getVideoInfo(clientId, videoUrl, itemId, requestedQuality = 'highest', format = 'mp4') {
      const baseArgs = ['--no-playlist', '--skip-download', '--print-json', videoUrl];
      try {
          const { stdout } = await runYtDlpCommand(clientId, baseArgs, `info_${itemId}`, true);
          const info = JSON.parse(stdout.trim());
          const title = info.title || 'video';
          let thumbnail = info.thumbnail || null;
          
          return {
              title,
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
          return { title: 'video', thumbnail: null, availableQualities: [] };
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
          sendMessageToClient(clientId, { 
              type: 'item_info', 
              itemId, 
              title: currentVideoTitle, 
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

          if (format === 'mp3') {
              // OPTIMIZED MP3: Use yt-dlp's built-in extraction (much faster)
              const finalOutputFilename = outputTemplate.replace('%(ext)s', 'mp3');
              
              let mp3Args = [
                  '--extract-audio',
                  '--audio-format', 'mp3',
                  '--no-playlist',
                  '-o', outputTemplate,
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

          } else if (format === 'mp4') {
              // ENHANCED MP4: Precise quality selection with fallbacks
              const finalOutputFilename = outputTemplate.replace('%(ext)s', 'mp4');
              
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

              let mp4Args = [
                  '-f', formatString,
                  '--merge-output-format', 'mp4',
                  '--no-playlist',
                  '-o', outputTemplate,
                  videoUrl
              ];
              
              // Add rate limiting only if specified and > 0
              if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) {
                  mp4Args.unshift('--limit-rate', `${settings.maxSpeed}K`);
              }
              
              if (settings.skipDuplicates && isPlaylistItem) {
                  mp4Args.unshift('--no-overwrites');
              }

              const qualityText = quality === 'highest' ? 'highest available quality' : `${quality}p quality`;
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
          sendMessageToClient(clientId, { type: 'item_info', itemId, title: currentVideoTitle, source, thumbnail: videoInfo.thumbnail });

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


  // --- Simplified Cookie Path Management ---
  async function getCookiesPath() {
      // Use userData directory for runtime-modifiable cookies
      const userDataPath = getUserDataPathFallback();
      const cookiesDir = path.join(userDataPath, 'cookies');
      const cookiesPath = path.join(cookiesDir, 'cookies.txt');
      
      console.log('[getCookiesPath] 📁 Checking cookies at:', cookiesPath);
      
      // Ensure cookies directory exists
      if (!fs.existsSync(cookiesDir)) {
          fs.mkdirSync(cookiesDir, { recursive: true });
          console.log('[getCookiesPath] 📁 Created cookies directory:', cookiesDir);
      }
      
      // Check if cookies file exists in userData
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
          
          // Check for migration from old project directory
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

  // Function that matches Electron's userData path logic exactly
  function getElectronUserDataPath() {
      const platform = os.platform();
      const homedir = os.homedir();
      
      // This should match exactly what app.getPath('userData') returns in Electron
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

  // Fallback function (renamed from original getUserDataPath)
  function getUserDataPathFallback() {
      const platform = os.platform();
      const homedir = os.homedir();
      
      switch (platform) {
          case 'win32':
              return path.join(homedir, 'AppData', 'Roaming', 'SimplyYTD');
          case 'darwin':
              return path.join(homedir, 'Library', 'Application Support', 'SimplyYTD');
          case 'linux':
              return path.join(homedir, '.config', 'SimplyYTD');
          default:
              return path.join(homedir, '.video-downloader-gemini');
      }
  }



  // Simple cookie validation without test video
  async function validateCookiesFile(filePath) {
      try {
          const content = fs.readFileSync(filePath, 'utf8').trim();
          
          // Check if it's empty
          if (!content || content.length < 10) {
              console.log(`[validateCookiesFile] File too small or empty: ${filePath} (${content.length} bytes)`);
              return false;
          }
          
          // Basic validation - check if it has cookie-like content
          const lines = content.split('\n');
          const nonCommentLines = lines.filter(line => {
              const trimmed = line.trim();
              return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//');
          });
          
          if (nonCommentLines.length === 0) {
              console.log(`[validateCookiesFile] No non-comment lines found: ${filePath}`);
              return false;
          }
          
          // Basic check - if ANY line contains common cookie indicators, consider it valid
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

  async function runYtDlpCommand(clientId, baseArgs, itemId, suppressProgress = false, itemProcInfoRef = null) {
    console.log(`[${itemId}] 🚀 Starting yt-dlp command...`);
    
    const cookieFilePath = await getCookiesPath();
    
    let cookieArgs = [];
    if (cookieFilePath) {
        try {
            const stats = fs.statSync(cookieFilePath);
            console.log(`[${itemId}] 📁 Found cookies file: ${cookieFilePath} (${stats.size} bytes)`);
            
            // Simple validation without test video
            const isValid = await validateCookiesFile(cookieFilePath);
            
            if (isValid) {
                console.log(`[${itemId}] ✅ Using cookies for enhanced access`);
                cookieArgs = [
                    '--cookies', cookieFilePath,
                    '--extractor-retries', '2', // Reduced retries to avoid rate limiting
                    '--sleep-requests', '3', // Increased delay between requests
                    '--sleep-interval', '2' // Additional sleep interval
                ];
                
                // Send success message to client
                sendMessageToClient(clientId, {
                    type: 'status',
                    message: '🍪 Using cookies (conservative mode)',
                    itemId
                });
            } else {
                console.log(`[${itemId}] ⚠️ Cookies file found but appears invalid format`);
                sendMessageToClient(clientId, {
                    type: 'status',
                    message: '⚠️ Cookies found but invalid format. Using standard access...',
                    itemId
                });
            }
        } catch (e) {
            console.error(`[${itemId}] ❌ Cookie file error: ${e.message}`);
            sendMessageToClient(clientId, {
                type: 'status',
                message: `❌ Cookie error: ${e.message}`,
                itemId
            });
        }
    } else {
        console.log(`[${itemId}] ℹ️ No cookies file found - using standard requests`);
        // Add warning for no cookies
        sendMessageToClient(clientId, {
            type: 'status',
            message: 'ℹ️ No cookies found - add cookies for enhanced access',
            itemId
        });
    }

    // Conservative arguments to avoid rate limiting
    const finalArgs = [
        ...cookieArgs, 
        ...baseArgs, 
        '--encoding', 'utf-8', 
        '--no-colors',
        '--retries', '3', // Reduced retries to avoid triggering rate limits
        '--fragment-retries', '3', // Reduced fragment retries
        '--concurrent-fragments', '1', // Single fragment to be very conservative
        '--buffer-size', '8192', // Smaller buffer to be less aggressive
        '--no-part',
        '--sleep-requests', '2', // Add delay between requests
        '--sleep-interval', '5', // Sleep interval for rate limiting
        '--max-sleep-interval', '10', // Maximum sleep interval
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' // Modern user agent
    ];
    
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
            
            // Log 403 errors specifically
            if (data.includes('403') || data.includes('Forbidden')) {
                console.log(`[${itemId}] 🚨 Auth error detected: ${data.trim()}`);
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
                            } catch (e) { /* console.error(`[${itemId}] Glob error:`, e); */ }
                      } else if (fs.existsSync(template)) {
                            destinationPath = template;
                        }
                    }
                }
                resolve({ stdout: stdoutData, stderr: stderrData, actualPath: destinationPath });
            } else {
                // Enhanced error handling for auth issues
                let errorMsg = stderrData.split('\n').filter(line => line.toLowerCase().includes('error:')).join('; ') || stderrData.trim() || `yt-dlp exited with code ${code}`;
                
                if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
                    if (cookieFilePath) {
                        errorMsg = `Authentication failed despite cookies. Your cookies may be expired or invalid. Try getting fresh cookies. Original error: ${errorMsg}`;
                    } else {
                        errorMsg = `Authentication required (403 Forbidden). This video may require login. Try importing fresh cookies from your browser. Original error: ${errorMsg}`;
                    }
                }
                
                console.error(`[${itemId}] yt-dlp failed (code ${code}). Error: ${errorMsg}`);
                reject(new Error(errorMsg.substring(0, 400))); // Longer error message for better error handling
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

// Tool update endpoints
app.post('/update-tools', async (req, res) => {
    try {
        console.log('🔄 Manual tool update request received');
        const result = await checkAndUpdateTools();
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
        
        // Clear last update check timestamps to force update
        setLastUpdateCheck('ytdlp'); // Set to current time to reset
        setLastUpdateCheck('ffmpeg'); // Set to current time to reset
        
        // Force update both tools
        const result = await checkAndUpdateTools();
        res.json(result);
    } catch (error) {
        console.error('❌ Error in force update endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});








// --- Server Start & Graceful Shutdown ---
server.listen(PORT, async () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`Downloads will be saved to: ${DOWNLOAD_DIR}`);
    
    // Auto-check for tool updates on server start (non-blocking)
    setTimeout(async () => {
        try {
            console.log('🚀 Server started, checking for tool updates...');
            await checkAndUpdateTools();
        } catch (error) {
            console.error('❌ Error during startup tool check:', error);
        }
    }, 5000); // Wait 5 seconds after server start
    
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
