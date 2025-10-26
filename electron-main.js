// electron-main.js - Main process for Electron application
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, powerSaveBlocker } = require('electron');

// Set application name
app.setName('SimplyYTD');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os'); // Required for os.platform()
const net = require('net'); // Required for server readiness check

let mainWindow;
let serverProcess;
let serverPort = process.env.PORT || 9875; // Will be updated when server starts

// --- Determine Paths for Packaged App ---
const isDev = process.env.NODE_ENV !== 'production';

let resourcesBinPath;
if (isDev) {
  // Development: expect 'bin' folder in project root
  resourcesBinPath = path.join(__dirname, 'bin');
} else {
  // Production:
  if (app.isPackaged) {
    // Packaged app: 'bin' folder is inside 'resources' (never inside app.asar)
    resourcesBinPath = path.join(process.resourcesPath, 'bin');
  } else {
    // Unpackaged production-like run (e.g., `electron .` with NODE_ENV=production):
    // Still expect 'bin' folder in project root relative to __dirname
    resourcesBinPath = path.join(__dirname, 'bin');
  }
}
// Safety: Never allow app.asar/bin in the path
if (resourcesBinPath.includes('app.asar')) {
  resourcesBinPath = path.join(process.resourcesPath, 'bin');
}
console.log('[electron-main.js] FINAL resourcesBinPath:', resourcesBinPath);

const ytdlpPath = path.join(resourcesBinPath, os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ffmpegPath = path.join(resourcesBinPath, os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (fs.existsSync(windowStatePath)) {
      return JSON.parse(fs.readFileSync(windowStatePath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }
  return { width: 1280, height: 800, isMaximized: false, isFullScreen: false };
}

function saveWindowState(win) {
  if (!win) return;
  const bounds = win.getBounds();
  const state = {
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen()
  };
  try {
    fs.writeFileSync(windowStatePath, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

// Add server readiness check
function waitForServer(port, maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      console.log(`Checking server readiness (attempt ${attempts + 1}/${maxAttempts})...`);
      const socket = net.createConnection({ port, host: 'localhost' })
        .on('connect', () => {
          console.log('Server is ready!');
          socket.destroy();
          resolve();
        })
        .on('error', () => {
          attempts++;
          if (attempts >= maxAttempts) {
            console.error('Server readiness check failed after maximum attempts');
            reject(new Error('Server readiness check failed'));
          } else {
            setTimeout(check, 200);
          }
        });
    };
    check();
  });
}

async function createWindow() {
  const lastState = loadWindowState();
  
  try {
    console.log('Starting server...');
    const port = await startServer();
    console.log(`Server started on port ${port}`);
    
    mainWindow = new BrowserWindow({
      width: lastState.width,
      height: lastState.height,
      title: 'SimplyYTD - Video Downloader',
      show: false, // Don't show until ready
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: !app.isPackaged,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, 'assets', 'Logo 1.png')
    });

    // Wait for server to be truly ready before loading
    console.log('Waiting for server to be ready...');
    await waitForServer(port);
    console.log('Server is ready, loading URL...');
    
    await mainWindow.loadURL(`http://localhost:${port}`);
    console.log('URL loaded, showing window...');
    mainWindow.show();
    
    // Apply saved window state
    if (lastState.isMaximized) mainWindow.maximize();
    if (lastState.isFullScreen) mainWindow.setFullScreen(true);
    
  } catch (error) {
    console.error('Failed to create window:', error);
    dialog.showErrorBox("Startup Error", `Failed to start application: ${error.message}`);
    app.quit();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on('resize', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on('maximize', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on('unmaximize', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on('enter-full-screen', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on('leave-full-screen', () => {
    saveWindowState(mainWindow);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverScriptPath = path.join(__dirname, 'server.js');

    if (!fs.existsSync(serverScriptPath)) {
      console.error(`Server script not found at ${serverScriptPath}`);
      dialog.showErrorBox("Server Error", `The server script (server.js) could not be found.`);
      reject(new Error('Server script not found'));
      return;
    }

    // Log paths for verification
    console.log(`[electron-main.js] Running in ${isDev ? 'development' : 'production'}${!isDev && app.isPackaged ? ' (packaged)' : !isDev ? ' (unpackaged)' : ''} mode.`);
    console.log(`[electron-main.js] __dirname: ${__dirname}`);
    if (!isDev && app.isPackaged) {
        console.log(`[electron-main.js] process.resourcesPath (packaged): ${process.resourcesPath}`);
    }
    console.log(`[electron-main.js] Calculated resourcesBinPath for executables: ${resourcesBinPath}`);
    console.log(`[electron-main.js] Calculated ytdlpPath: ${ytdlpPath}`);
    console.log(`[electron-main.js] Calculated ffmpegPath: ${ffmpegPath}`);
    
    const ytdlpExists = fs.existsSync(ytdlpPath);
    const ffmpegExists = fs.existsSync(ffmpegPath);
    console.log(`[electron-main.js] Does ytdlp exist at path? ${ytdlpExists}`);
    console.log(`[electron-main.js] Does ffmpeg exist at path? ${ffmpegExists}`);

    if (!ytdlpExists) {
      dialog.showErrorBox("Dependency Error", `yt-dlp executable not found at the expected path: ${ytdlpPath}. Please ensure it's correctly placed.`);
      // app.quit(); // Decide if you want to quit
      // return;
    }
    if (!ffmpegExists) {
      dialog.showErrorBox("Dependency Error", `ffmpeg executable not found at the expected path: ${ffmpegPath}. Please ensure it's correctly placed.`);
      // app.quit();
      // return;
    }

    console.log(`Forking server process: ${serverScriptPath}`);
    serverProcess = fork(
      serverScriptPath,
      [],
      {
        silent: false,
        env: {
          ...process.env,
          YTDLP_PATH: ytdlpPath,
          FFMPEG_PATH: ffmpegPath,
          ELECTRON_RUN_AS_NODE: '1'
        }
      }
    );

    // Wait for server to be ready
    serverProcess.on('message', (msg) => {
      console.log('Message from server process:', msg);
      if (msg.type === 'server_ready') {
        serverPort = msg.port;
        resolve(msg.port);
      }
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server process:', err);
      reject(err);
    });

    // Timeout fallback
    setTimeout(() => {
      if (!serverPort) {
        reject(new Error('Server startup timeout'));
      }
    }, 10000);
  });
}

// Add server exit handler
serverProcess?.on('exit', (code, signal) => {
  console.log(`Server process exited with code ${code} and signal ${signal}`);
  if (code !== 0 && !serverProcess?.killed) {
    dialog.showMessageBox(mainWindow || null, {
      type: 'warning',
      title: 'Server Stopped',
      message: `The backend server process stopped unexpectedly (code: ${code}, signal: ${signal}). Some features might not work. You may need to restart the application.`
    });
  }
  serverProcess = null;
});

app.on('ready', async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error('Failed to start application:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  console.log('App before-quit event triggered.');
  if (serverProcess && !serverProcess.killed) {
    console.log('Attempting to kill server process...');
    const killed = serverProcess.kill('SIGTERM');
    if (killed) {
      console.log('Sent SIGTERM to server process. Waiting for exit...');
    } else {
      console.log('Failed to send SIGTERM or process already exited.');
    }
    serverProcess = null;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    if (!serverProcess || serverProcess.killed) {
      console.log("Server process not running on activate, restarting server...");
      startServer();
    }
    createWindow();
  }
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return '';
  return result.filePaths[0];
});

ipcMain.handle('getDefaultDownloadFolder', async () => {
  return app.getPath('downloads');
});

ipcMain.handle('openPathInExplorer', async (event, folderPath) => {
  if (folderPath && typeof folderPath === 'string') {
    await shell.openPath(folderPath);
    return true;
  }
  return false;
});

ipcMain.handle('readClipboardText', async () => {
  return clipboard.readText();
});

// Add new IPC handler for getting userData path
ipcMain.handle('get-userdata-path', async () => {
    return app.getPath('userData');
});

// Update the save-cookies-txt handler (Using userData directory)
ipcMain.handle('save-cookies-txt', async (event, content) => {
    try {
        // Save to userData directory for runtime modification
        const userDataPath = app.getPath('userData');
        const cookiesDir = path.join(userDataPath, 'cookies');
        const cookiesPath = path.join(cookiesDir, 'cookies.txt');
        
        // Ensure cookies directory exists
        if (!fs.existsSync(cookiesDir)) {
            fs.mkdirSync(cookiesDir, { recursive: true });
            console.log(`[save-cookies-txt] Created cookies directory: ${cookiesDir}`);
        }
        
        console.log(`[save-cookies-txt] Saving cookies to: ${cookiesPath}`);
        fs.writeFileSync(cookiesPath, content, 'utf8');
        
        return { success: true, path: cookiesPath };
    } catch (err) {
        console.error('Failed to save cookies.txt:', err);
        return { success: false, error: err.message };
    }
});

// Add handler to get cookies content (for the cookies helper) (Using userData directory)
ipcMain.handle('get-cookies-txt', async () => {
    try {
        const userDataPath = app.getPath('userData');
        const cookiesDir = path.join(userDataPath, 'cookies');
        const cookiesPath = path.join(cookiesDir, 'cookies.txt');
        
        // Ensure cookies directory exists
        if (!fs.existsSync(cookiesDir)) {
            fs.mkdirSync(cookiesDir, { recursive: true });
        }
        
        if (fs.existsSync(cookiesPath)) {
            const content = fs.readFileSync(cookiesPath, 'utf8');
            return { success: true, content, path: cookiesPath };
        } else {
            // Check for migration from old project directory
            const oldCookiesPath = path.join(__dirname, 'cookies', 'cookies.txt');
            if (fs.existsSync(oldCookiesPath)) {
                console.log(`[get-cookies-txt] 🔄 Migrating cookies from old location: ${oldCookiesPath}`);
                try {
                    const content = fs.readFileSync(oldCookiesPath, 'utf8');
                    if (content.length > 50) {
                        fs.writeFileSync(cookiesPath, content, 'utf8');
                        console.log(`[get-cookies-txt] ✅ Successfully migrated cookies to: ${cookiesPath}`);
                        return { success: true, content, path: cookiesPath };
                    }
                } catch (err) {
                    console.error(`[get-cookies-txt] ❌ Failed to migrate cookies:`, err);
                }
            }
            return { success: false, error: 'Cookies file not found' };
        }
    } catch (err) {
        console.error('Failed to read cookies.txt:', err);
        return { success: false, error: err.message };
    }
});

// --- Cookie Helper Window State Persistence and Upload Handler ---

// Helper to load cookie window state
function loadCookieWindowState() {
    const cookieStatePath = path.join(app.getPath('userData'), 'cookie-window-state.json');
    try {
        if (fs.existsSync(cookieStatePath)) {
            return JSON.parse(fs.readFileSync(cookieStatePath, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load cookie window state:', e);
    }
    return { width: 900, height: 750, x: undefined, y: undefined };
}

// Helper to save cookie window state
function saveCookieWindowState(win) {
    if (!win) return;
    const bounds = win.getBounds();
    const cookieStatePath = path.join(app.getPath('userData'), 'cookie-window-state.json');
    try {
        fs.writeFileSync(cookieStatePath, JSON.stringify({
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y
        }));
    } catch (e) {
        console.error('Failed to save cookie window state:', e);
    }
}

// Enhanced cookie helper with window state persistence
ipcMain.handle('open-cookies-helper', async () => {
    const savedState = loadCookieWindowState();
  const win = new BrowserWindow({
        width: savedState.width,
        height: savedState.height,
        x: savedState.x,
        y: savedState.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    parent: mainWindow,
    modal: false,
    show: true,
        title: 'Import YouTube Cookies',
        minWidth: 320,
        minHeight: 200,
        resizable: true
  });
  win.setMenuBarVisibility(false);
    win.on('resize', () => saveCookieWindowState(win));
    win.on('move', () => saveCookieWindowState(win));
  win.loadFile(path.join(__dirname, 'public', 'cookies.html'));
  return true;
});

// Add file upload handler for cookies
ipcMain.handle('upload-cookies-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    try {
        const content = fs.readFileSync(result.filePaths[0], 'utf8');
        return { success: true, content };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('getPath', (_, name) => app.getPath(name));

// ------------------------------------------------------------------
//  NEW handler: scans the entire download folder and returns
//  every video file with the correct type for each history sub-tab
// ------------------------------------------------------------------
ipcMain.handle('list-download-folder', async (_, folderPath) => {
  const glob = require('glob');
  const fs   = require('fs');
  const path = require('path');

  // 1.  Absolute path to the root download folder
  const root = folderPath || path.join(process.resourcesPath || __dirname, 'downloads');  // Matches server.js DOWNLOAD_DIR

  // 2.  Find every video file (mp4, mkv, webm, avi, mov, flv, 3gp)
  const pattern = path.join(root, '**/*.{mp4,mkv,webm,avi,mov,flv,3gp}');
  const files   = glob.sync(pattern, { nodir: true });

  // 3.  Build the list the frontend expects
  const list = files.map(file => {
    const stat = fs.statSync(file);
    const name = path.basename(file);

    // Decide which sub-tab this file belongs to
    let type = 'youtubeSingles';          // default
    if (name.includes('_playlist_')) type = 'youtubePlaylists';
    if (name.includes('_instagram_')) type = 'instagram';

    return {
      name,
      path: file,
      type,
      size: (stat.size / 1024 / 1024).toFixed(1) + ' MB',
      mtime: stat.mtime.toISOString(),
      thumbnail: null   // thumbnails can be added later
    };
  });

  return list;
});

// NEW: IPC to get containing folder (dirname) from a file path
ipcMain.handle('get-dirname', async (_, filePath) => {
  return path.dirname(filePath);
});

// Delete file handler
ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        console.log(`[delete-file] Attempting to delete: ${filePath}`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[delete-file] Successfully deleted: ${filePath}`);
            return { success: true };
        } else {
            console.log(`[delete-file] File not found: ${filePath}`);
            return { success: false, error: 'File not found' };
        }
    } catch (error) {
        console.error(`[delete-file] Error deleting file ${filePath}:`, error);
        return { success: false, error: error.message };
    }
});

// Path resolver handler
ipcMain.handle('resolve-path', async (event, downloadFolder, relativePath) => {
    try {
        const fullPath = path.join(downloadFolder, relativePath);
        const resolvedPath = path.resolve(fullPath);
        console.log(`[resolve-path] Resolved: ${downloadFolder} + ${relativePath} = ${resolvedPath}`);
        return resolvedPath;
    } catch (error) {
        console.error(`[resolve-path] Error resolving path:`, error);
        return null;
    }
});

// Check if path exists handler
ipcMain.handle('path-exists', async (event, filePath) => {
    try {
        const exists = fs.existsSync(filePath);
        console.log(`[path-exists] ${filePath} exists: ${exists}`);
        return exists;
    } catch (error) {
        console.error(`[path-exists] Error checking path ${filePath}:`, error);
        return false;
    }
});

// Update the existing normalize-path handler to be more robust
ipcMain.handle('normalize-path', async (event, filePath) => {
    try {
        const normalized = path.normalize(filePath);
        console.log(`[normalize-path] ${filePath} -> ${normalized}`);
        return normalized;
    } catch (error) {
        console.error(`[normalize-path] Error normalizing path ${filePath}:`, error);
        return filePath; // Return original if normalization fails
    }
});

// Power Save Blocker handlers
let powerSaveBlockerId = null;

ipcMain.handle('start-power-save-blocker', async () => {
    try {
        // If we have no ID or the blocker with current ID isn't running
        if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
            // Stop any existing blocker just in case
            if (powerSaveBlockerId !== null) {
                try {
                    powerSaveBlocker.stop(powerSaveBlockerId);
                } catch (e) {
                    // Ignore errors when stopping
                }
            }
            
            // Start fresh
            powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
            console.log('Power save blocker started:', powerSaveBlockerId);
            return { success: true, id: powerSaveBlockerId };
        } else {
            // Already running
            console.log('Power save blocker already active:', powerSaveBlockerId);
            return { success: true, id: powerSaveBlockerId }; // Return success, not failure!
        }
    } catch (error) {
        console.error('Error starting power save blocker:', error);
        powerSaveBlockerId = null;
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-power-save-blocker', async () => {
    try {
        if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
            powerSaveBlocker.stop(powerSaveBlockerId);
            console.log('Power save blocker stopped:', powerSaveBlockerId);
            powerSaveBlockerId = null;
            return { success: true };
        } else {
            console.log('No active power save blocker to stop');
            powerSaveBlockerId = null; // Reset state
            return { success: true }; // Return success, not failure!
        }
    } catch (error) {
        console.error('Error stopping power save blocker:', error);
        powerSaveBlockerId = null;
        return { success: false, error: error.message };
    }
});


