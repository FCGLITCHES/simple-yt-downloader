// Electron main process setup
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, powerSaveBlocker, Tray, Menu, nativeImage } = require('electron');

// Set application name
app.setName('GetVideosLocally');
const path = require('path');

function isBrokenPipeError(error) {
  return error && (error.code === 'EPIPE' || String(error.message || '').includes('EPIPE'));
}

function hardenProcessLogging() {
  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
  };

  ['log', 'warn', 'error', 'info'].forEach(method => {
    console[method] = (...args) => {
      try {
        originalConsole[method](...args);
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error;
        }
      }
    };
  });

  [process.stdout, process.stderr].forEach(stream => {
    if (!stream || typeof stream.on !== 'function') return;
    stream.on('error', error => {
      if (!isBrokenPipeError(error)) {
        try {
          originalConsole.error('[electron-main.js] Logging stream error:', error);
        } catch (_) {
          // Avoid recursive logging failures.
        }
      }
    });
  });
}

hardenProcessLogging();

// Auto-launch configuration for Windows startup
// IMPORTANT: Defer initialization until app is ready to avoid path issues with spaces
let autoLauncher = null;
function getAutoLauncher() {
  if (autoLauncher) return autoLauncher;

  try {
    const AutoLaunch = require('auto-launch');
    autoLauncher = new AutoLaunch({
      name: 'GetVideosLocally',
      path: app.getPath('exe'),
      isHidden: false
    });
  } catch (err) {
    console.error('Failed to load auto-launch module:', err);
    // Return dummy object to prevent crashes
    autoLauncher = {
      enable: async () => console.warn('Auto-launch not available'),
      disable: async () => console.warn('Auto-launch not available'),
      isEnabled: async () => false
    };
  }
  return autoLauncher;
}
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os'); // Required for os.platform()
const net = require('net'); // Required for server readiness check

let mainWindow;
let cookieWindow = null; // Track the cookie helper window
let serverProcess;
let serverPort = process.env.PORT || 9875; // Will be updated when server starts
let serverToken = null;
let isQuitting = false; // Prevent multiple cleanup attempts
let tray = null; // System tray
let activeDownloadCount = 0; // Track active downloads
let powerSaveBlockerId = null; // Track power save blocker ID

// --- Determine Paths for Packaged App ---
const isDev = process.env.NODE_ENV !== 'production';

let resourcesBinPath;
let resourcesCookiesPath;

if (isDev) {
  resourcesBinPath = path.join(__dirname, 'bin');
} else {
  if (app.isPackaged) {
    resourcesBinPath = path.join(process.resourcesPath, 'bin');
  } else {
    resourcesBinPath = path.join(__dirname, 'bin');
  }
}

// Per-user cookies always live under app data. We do not ship shared cookies in the app bundle.
resourcesCookiesPath = path.join(app.getPath('userData'), 'cookies');

// Safety: Never allow app.asar in the paths for external tools/files
if (resourcesBinPath.includes('app.asar')) {
  resourcesBinPath = path.join(process.resourcesPath, 'bin');
}
if (resourcesCookiesPath.includes('app.asar')) {
  resourcesCookiesPath = path.join(app.getPath('userData'), 'cookies');
}

console.log('[electron-main.js] FINAL resourcesBinPath:', resourcesBinPath);
console.log('[electron-main.js] FINAL resourcesCookiesPath:', resourcesCookiesPath);

const ytdlpPath = path.join(resourcesBinPath, os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ffmpegPath = path.join(resourcesBinPath, os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const nodeBinaryPath = path.join(resourcesBinPath, os.platform() === 'win32' ? 'node.exe' : 'node');

// On non-Windows, ensure bundled binaries have executable permissions
if (os.platform() !== 'win32') {
  [ytdlpPath, ffmpegPath, nodeBinaryPath].forEach(binPath => {
    try {
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
      }
    } catch (e) {
      console.warn(`[electron-main.js] Failed to chmod ${binPath}:`, e.message);
    }
  });
}

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (fs.existsSync(windowStatePath)) {
      return JSON.parse(fs.readFileSync(windowStatePath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }
  return { width: 1229, height: 870, x: undefined, y: undefined, isMaximized: false, isFullScreen: false };
}

function saveWindowState(win) {
  if (!win || win.isMaximized() || win.isFullScreen()) return; // Don't save position when maximized/fullscreen
  const bounds = win.getBounds();
  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
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
function waitForServer(port, maxAttempts = 100) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      console.log(`Checking server readiness (attempt ${attempts + 1}/${maxAttempts})...`);
      const socket = net.createConnection({ port, host: '127.0.0.1', family: 4 })
        .on('connect', () => {
          console.log('Server is ready!');
          socket.destroy();
          resolve();
        })
        .on('error', (err) => {
          attempts++;
          const errorCode = err.code || 'UNKNOWN';
          if (attempts >= maxAttempts) {
            console.error(`Server readiness check failed after ${maxAttempts} attempts. Last error: ${errorCode} - ${err.message}`);
            reject(new Error(`Server readiness check failed: ${errorCode}`));
          } else {
            console.log(`Server not ready yet (${errorCode}), retrying in 200ms...`);
            setTimeout(check, 200);
          }
        });
    };
    check();
  });
}

/**
 * Automatically sets up a Windows Firewall rule for GetVideosLocally.
 * This runs seamlessly to ensure the backend server can communicate.
 */
function setupFirewallRule() {
  if (os.platform() !== 'win32') return;

  const appPath = isDev ? process.execPath : app.getPath('exe');
  const ruleName = 'GetVideosLocally-Server-Access';

  console.log(`[Firewall] Application path for rule: ${appPath}`);

  const { exec } = require('child_process');

  // Check if rule exists, and add it if not. We use the netsh command.
  // This might require admin privileges for some setups, but we try as best-effort.
  const checkRuleCmd = `netsh advfirewall firewall show rule name="${ruleName}"`;
  const addRuleCmd = `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow program="${appPath}" enable=yes profile=any`;

  exec(checkRuleCmd, (error) => {
    if (error) {
      // Rule doesn't exist, try to add it
      console.log(`[Firewall] Rule "${ruleName}" not found. Attempting to add...`);
      exec(addRuleCmd, (addError, stdout, stderr) => {
        if (addError) {
          console.warn(`[Firewall] Could not add firewall rule automatically: ${addError.message}. This is usually due to lack of admin permissions.`);
        } else {
          console.log(`[Firewall] Successfully added firewall rule for: ${appPath}`);
        }
      });
    } else {
      console.log(`[Firewall] Rule "${ruleName}" already exists.`);
    }
  });
}

/**
 * Creates a system tray icon for background downloads.
 */
function createTrayIcon() {
  if (tray) return; // Already created

  const iconPath = path.join(__dirname, 'public', 'Logo_1.ico');

  try {
    // Create tray icon
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show GetVideosLocally',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: `Downloads: ${activeDownloadCount} active`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip(`GetVideosLocally - ${activeDownloadCount} download${activeDownloadCount !== 1 ? 's' : ''} in progress`);
    tray.setContextMenu(contextMenu);

    // Single click to show window
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    // Double-click to show window (keep for compatibility)
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    console.log('[Tray] System tray icon created');
  } catch (error) {
    console.error('[Tray] Failed to create tray icon:', error);
  }
}

/**
 * Updates the tray icon tooltip and menu
 */
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show GetVideosLocally',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: `Downloads: ${activeDownloadCount} active`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(`GetVideosLocally - ${activeDownloadCount} download${activeDownloadCount !== 1 ? 's' : ''} in progress`);
  tray.setContextMenu(contextMenu);
}

/**
 * Destroys the tray icon when no longer needed
 */
function destroyTrayIcon() {
  if (tray) {
    tray.destroy();
    tray = null;
    console.log('[Tray] System tray icon destroyed');
  }
}

async function createWindow() {
  const lastState = loadWindowState();

  // Try to setup firewall rule on launch
  setupFirewallRule();

  try {
    console.log('Starting server...');
    const port = await startServer();
    console.log(`Server started on port ${port}`);

    const winOptions = {
      width: lastState.width,
      height: lastState.height,
      minWidth: 580,
      minHeight: 830,
      title: 'GetVideosLocally - Multi-Site Video Downloader',
      show: false, // Don't show until ready
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: !app.isPackaged,
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false // CRITICAL: Prevent freezing when minimized/hidden
      },
      icon: path.join(__dirname, 'public', 'Logo_1.ico')
    };

    // Restore position if available and valid
    if (lastState.x !== undefined && lastState.y !== undefined) {
      winOptions.x = lastState.x;
      winOptions.y = lastState.y;
    }

    mainWindow = new BrowserWindow(winOptions);

    // Wait for server to be truly ready before loading
    console.log('Waiting for server to be ready...');
    await waitForServer(port);
    console.log('Server is ready, loading URL...');

    await mainWindow.loadURL(`http://127.0.0.1:${port}`);
    console.log('URL loaded, showing window...');
    mainWindow.show();

    // Apply saved window state
    if (lastState.isMaximized) mainWindow.maximize();
    if (lastState.isFullScreen) mainWindow.setFullScreen(true);

    // Safety: Prevent navigation to untrusted external URLs
    mainWindow.webContents.on('will-navigate', (event, url) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
        event.preventDefault();
        shell.openExternal(url); // Open external links in default browser
      }
    });

    // Prevent new windows from being opened except for sanctioned ones
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
        return { action: 'allow' };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

  } catch (error) {
    console.error('Failed to create window:', error);
    dialog.showErrorBox("Startup Error", `Failed to start application: ${error.message}`);
    app.quit();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', async (event) => {
    saveWindowState(mainWindow);

    // If already quitting, allow close
    if (isQuitting) return;

    let currentActiveDownloadCount = activeDownloadCount;
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      try {
        const rendererCount = await mainWindow.webContents.executeJavaScript(
          'window.__GVL_ACTIVE_DOWNLOAD_COUNT ?? 0',
          true,
        );
        if (Number.isFinite(Number(rendererCount))) {
          currentActiveDownloadCount = Number(rendererCount);
          activeDownloadCount = currentActiveDownloadCount;
        }
      } catch (error) {
        console.warn('[electron-main.js] Failed to query renderer download count:', error);
      }
    }

    if (currentActiveDownloadCount > 0) {
      event.preventDefault();
      mainWindow.webContents.send('show-close-confirmation', currentActiveDownloadCount);
      return;
    }

    isQuitting = true;
  });

  mainWindow.on('move', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      saveWindowState(mainWindow);
    }
  });

  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      saveWindowState(mainWindow);
    }
  });

  mainWindow.on('maximize', () => {
    const state = {
      width: lastState.width || 1280,
      height: lastState.height || 800,
      x: lastState.x,
      y: lastState.y,
      isMaximized: true,
      isFullScreen: mainWindow.isFullScreen()
    };
    try {
      fs.writeFileSync(windowStatePath, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save window state:', e);
    }
  });

  mainWindow.on('unmaximize', () => {
    // Save state after a brief delay to ensure bounds are correct
    setTimeout(() => {
      saveWindowState(mainWindow);
    }, 100);
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
    console.log(`[electron-main.js] Calculated nodeBinaryPath: ${nodeBinaryPath}`);

    const ytdlpExists = fs.existsSync(ytdlpPath);
    const ffmpegExists = fs.existsSync(ffmpegPath);
    const nodeExists = fs.existsSync(nodeBinaryPath);
    console.log(`[electron-main.js] Does ytdlp exist at path? ${ytdlpExists}`);
    console.log(`[electron-main.js] Does ffmpeg exist at path? ${ffmpegExists}`);
    console.log(`[electron-main.js] Does node binary exist at path? ${nodeExists}`);

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
    if (!nodeExists) {
      console.warn(`[electron-main.js] Node binary not found at ${nodeBinaryPath}. 4K downloads may fail.`);
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
          NODE_BINARY: nodeBinaryPath,
          COOKIES_DIR: resourcesCookiesPath,
          ELECTRON_RUN_AS_NODE: '1'
        }
      }
    );

    // Attach exit handler immediately after fork
    serverProcess.on('exit', (code, signal) => {
      console.log(`Server process exited with code ${code} and signal ${signal}`);
      // Don't show dialog if:
      // 1. Process was intentionally killed (serverProcess.killed is true)
      // 2. Signal is SIGTERM (graceful shutdown) or SIGKILL (forced shutdown)
      // 3. App is quitting (isQuitting flag is set)
      if (code !== 0 && !serverProcess?.killed && signal !== 'SIGTERM' && signal !== 'SIGKILL' && !isQuitting) {
        dialog.showMessageBox(mainWindow || null, {
          type: 'warning',
          title: 'Server Stopped',
          message: `The backend server process stopped unexpectedly (code: ${code}, signal: ${signal}). Some features might not work. You may need to restart the application.`
        });
      }
      serverProcess = null;
    });

    // Wait for server to be ready
    serverProcess.on('message', (msg) => {
      console.log('Message from server process:', msg);
      if (msg.type === 'server_ready') {
        serverPort = msg.port;
        serverToken = msg.serverToken || null;
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
  // Prevent multiple cleanup attempts
  if (isQuitting) {
    console.log('Cleanup already in progress, ignoring duplicate before-quit event');
    return;
  }

  // Prevent default quit behavior so we can clean up properly
  event.preventDefault();
  isQuitting = true;
  console.log('App before-quit event triggered. Cleaning up...');

  // Stop power save blocker
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    try {
      powerSaveBlocker.stop(powerSaveBlockerId);
      console.log('Power save blocker stopped');
      powerSaveBlockerId = null;
    } catch (e) {
      console.error('Error stopping power save blocker:', e);
    }
  }

  const cleanupAndQuit = async () => {
    try {
      if (!serverProcess) {
        console.log('No server process to clean up');
        app.quit();
        return;
      }

      // Check if process is already dead
      if (serverProcess.killed) {
        console.log('Server process already killed');
        serverProcess = null;
        app.quit();
        return;
      }

      console.log('Terminating server process and waiting for cleanup...');

      // Send SIGTERM to allow graceful shutdown
      let processExited = false;
      try {
        const killed = serverProcess.kill('SIGTERM');
        if (!killed) {
          console.log('Failed to send SIGTERM, server may already be exiting');
          serverProcess = null;
          app.quit();
          return;
        }
      } catch (e) {
        console.log('Error sending SIGTERM (process may already be dead):', e.message);
        serverProcess = null;
        app.quit();
        return;
      }

      // Wait for server process to exit (up to 12 seconds - server has 10s graceful shutdown timeout)
      const waitForExit = new Promise((resolve) => {
        // Check if process already exited before attaching listener
        if (serverProcess.killed) {
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          if (!processExited) {
            console.warn('Server process did not exit gracefully within timeout, forcing termination...');
            if (serverProcess && !serverProcess.killed) {
              // Force kill - SIGKILL works on both Windows and Unix
              try {
                serverProcess.kill('SIGKILL');
                console.log('Force killed server process');
              } catch (e) {
                console.error('Error force killing server process:', e);
              }
            }
            processExited = true;
            resolve();
          }
        }, 12000);

        serverProcess.once('exit', (code, signal) => {
          if (!processExited) {
            clearTimeout(timeout);
            console.log(`Server process exited with code ${code} and signal ${signal}`);
            processExited = true;
            resolve();
          }
        });
      });

      await waitForExit;
      serverProcess = null;

      // Small delay to ensure all child processes are cleaned up
      setTimeout(() => {
        console.log('Cleanup complete, quitting application');
        app.quit();
      }, 500);
    } catch (error) {
      console.error('Error during cleanup:', error);
      // Ensure we quit even if cleanup fails
      serverProcess = null;
      app.quit();
    }
  };

  cleanupAndQuit();
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



// Save cookies.txt to per-user app data.
ipcMain.handle('save-cookies-txt', async (event, content) => {
  try {
    const cookiesDir = resourcesCookiesPath;
    const cookiesPath = path.join(cookiesDir, 'cookies.txt');

    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }

    fs.writeFileSync(cookiesPath, content, 'utf8');
    return { success: true, path: cookiesPath };
  } catch (err) {
    console.error('Failed to save cookies.txt:', err);
    return { success: false, error: err.message };
  }
});

// Read cookies.txt from per-user app data.
ipcMain.handle('get-cookies-txt', async () => {
  try {
    const cookiesDir = resourcesCookiesPath;
    const cookiesPath = path.join(cookiesDir, 'cookies.txt');

    if (fs.existsSync(cookiesPath)) {
      const content = fs.readFileSync(cookiesPath, 'utf8');
      return { success: true, content, path: cookiesPath };
    } else {
      return { success: false, error: 'Cookies file not found' };
    }
  } catch (err) {
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
  // Close existing cookie window if open
  if (cookieWindow && !cookieWindow.isDestroyed()) {
    cookieWindow.close();
  }

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
    title: 'Import Your Browser Cookies',
    minWidth: 320,
    minHeight: 200,
    resizable: true
  });

  cookieWindow = win; // Store reference

  win.setMenuBarVisibility(false);

  // Handle external links - open in default browser (same as main window)
  win.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
      return { action: 'allow' };
    }
    shell.openExternal(url); // Open external URLs in default browser
    return { action: 'deny' }; // Prevent opening in Electron window
  });

  // Also handle navigation to external URLs
  win.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1' && !parsedUrl.protocol.startsWith('file:')) {
      event.preventDefault();
      shell.openExternal(url); // Open external URLs in default browser
    }
  });

  win.on('resize', () => saveCookieWindowState(win));
  win.on('move', () => saveCookieWindowState(win));
  win.on('closed', () => {
    cookieWindow = null; // Clear reference when closed
    // Show and focus the main window when cookie window closes
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  win.loadFile(path.join(__dirname, 'public', 'cookies.html'));
  return true;
});

// Handler to close the cookie window
ipcMain.handle('close-cookie-window', async () => {
  if (cookieWindow && !cookieWindow.isDestroyed()) {
    cookieWindow.close();
    // Note: The 'closed' event handler will handle showing the main window and clearing the reference
    return { success: true };
  }
  return { success: false, error: 'Cookie window not found' };
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
ipcMain.handle('get-userdata-path', async () => app.getPath('userData'));

// ------------------------------------------------------------------
//  NEW handler: scans the entire download folder and returns
//  every video file with the correct type for each history sub-tab
// ------------------------------------------------------------------
ipcMain.handle('list-download-folder', async (_, folderPath) => {
  const glob = require('glob');
  const fs = require('fs');
  const path = require('path');

  // 1.  Absolute path to the root download folder
  const root = folderPath || path.join(process.resourcesPath || __dirname, 'downloads');  // Matches server.js DOWNLOAD_DIR

  // 2.  Find every video file (mp4, mkv, webm, avi, mov, flv, 3gp)
  const pattern = path.join(root, '**/*.{mp4,mkv,webm,avi,mov,flv,3gp}');
  const files = glob.sync(pattern, { nodir: true });

  // 3.  Group playlist videos by folder
  const playlistFolders = new Map(); // folderPath -> { folderName, videos: [] }
  const singleVideos = [];

  files.forEach(file => {
    const stat = fs.statSync(file);
    const name = path.basename(file);
    const dir = path.dirname(file);
    const relativeDir = path.relative(root, dir);

    // Decide which sub-tab this file belongs to
    let type = 'youtubeSingles';
    if (name.includes('_playlist_')) type = 'youtubePlaylists';

    const fileInfo = {
      name,
      path: file,
      type,
      size: (stat.size / 1024 / 1024).toFixed(1) + ' MB',
      mtime: stat.mtime.toISOString(),
      thumbnail: null,
      folder: dir,
      relativeFolder: relativeDir
    };

    // If it's a playlist video and not in root, group by folder
    if (type === 'youtubePlaylists' && relativeDir && relativeDir !== '.' && relativeDir !== '') {
      if (!playlistFolders.has(dir)) {
        playlistFolders.set(dir, {
          folderName: path.basename(dir),
          folderPath: dir,
          relativeFolder: relativeDir,
          videos: [],
          type: 'youtubePlaylists',
          mtime: stat.mtime.toISOString() // Use latest video's mtime
        });
      }
      playlistFolders.get(dir).videos.push(fileInfo);
      // Update folder mtime to latest video
      if (new Date(stat.mtime) > new Date(playlistFolders.get(dir).mtime)) {
        playlistFolders.get(dir).mtime = stat.mtime.toISOString();
      }
    } else {
      singleVideos.push(fileInfo);
    }
  });

  // 4.  Build the list: folders first, then single videos
  const list = [];

  // Add playlist folders as folder items
  for (const [folderPath, folderData] of playlistFolders.entries()) {
    // Calculate total size
    const totalSize = folderData.videos.reduce((sum, v) => {
      const sizeMB = parseFloat(v.size);
      return sum + (isNaN(sizeMB) ? 0 : sizeMB);
    }, 0);

    list.push({
      name: folderData.folderName,
      path: folderPath,
      type: folderData.type,
      size: totalSize.toFixed(1) + ' MB',
      mtime: folderData.mtime,
      thumbnail: null,
      isFolder: true,
      videoCount: folderData.videos.length,
      videos: folderData.videos, // Include videos for expandable UI
      folder: folderPath,
      relativeFolder: folderData.relativeFolder
    });
  }

  // Add single videos
  list.push(...singleVideos);

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

// Delete folder handler (for playlist folders)
ipcMain.handle('delete-folder', async (event, folderPath) => {
  try {
    console.log(`[delete-folder] Attempting to delete folder: ${folderPath}`);
    if (fs.existsSync(folderPath)) {
      const stats = fs.statSync(folderPath);
      if (stats.isDirectory()) {
        // Recursively delete folder and all contents
        fs.rmSync(folderPath, { recursive: true, force: true });
        console.log(`[delete-folder] Successfully deleted folder: ${folderPath}`);
        return { success: true };
      } else {
        return { success: false, error: 'Path is not a directory' };
      }
    } else {
      console.log(`[delete-folder] Folder not found: ${folderPath}`);
      return { success: false, error: 'Folder not found' };
    }
  } catch (error) {
    console.error(`[delete-folder] Error deleting folder ${folderPath}:`, error);
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

ipcMain.handle('test-folder-access', async (_, folderPath) => {
  try {
    if (!folderPath || typeof folderPath !== 'string') {
      return { success: false, error: 'No folder path provided.' };
    }

    const folderStats = await fs.promises.stat(folderPath);
    if (!folderStats.isDirectory()) {
      return { success: false, error: 'Configured path is not a folder.' };
    }

    await fs.promises.access(folderPath, fs.constants.R_OK | fs.constants.W_OK);
    return { success: true };
  } catch (error) {
    console.error(`[test-folder-access] Error checking folder ${folderPath}:`, error);
    return { success: false, error: error.message || 'Unable to verify folder access.' };
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

// --- Auto-Launch (Windows Startup) Handlers ---

// Get current auto-launch status
ipcMain.handle('get-auto-launch-status', async () => {
  try {
    const isEnabled = await getAutoLauncher().isEnabled();
    console.log('[auto-launch] Current status:', isEnabled);
    return { success: true, enabled: isEnabled };
  } catch (error) {
    console.error('[auto-launch] Error getting status:', error);
    return { success: false, error: error.message, enabled: false };
  }
});

// Enable auto-launch (add to Windows startup)
ipcMain.handle('enable-auto-launch', async () => {
  try {
    const isEnabled = await getAutoLauncher().isEnabled();
    if (!isEnabled) {
      await getAutoLauncher().enable();
      console.log('[auto-launch] Enabled - app will start with Windows');
    }
    return { success: true };
  } catch (error) {
    console.error('[auto-launch] Error enabling:', error);
    return { success: false, error: error.message };
  }
});

// Disable auto-launch (remove from Windows startup)
ipcMain.handle('disable-auto-launch', async () => {
  try {
    const isEnabled = await getAutoLauncher().isEnabled();
    if (isEnabled) {
      await getAutoLauncher().disable();
      console.log('[auto-launch] Disabled - app will not start with Windows');
    }
    return { success: true };
  } catch (error) {
    console.error('[auto-launch] Error disabling:', error);
    return { success: false, error: error.message };
  }
});

// Toggle auto-launch
ipcMain.handle('toggle-auto-launch', async (_, enable) => {
  try {
    if (enable) {
      await getAutoLauncher().enable();
      console.log('[auto-launch] Enabled via toggle');
    } else {
      await getAutoLauncher().disable();
      console.log('[auto-launch] Disabled via toggle');
    }
    return { success: true, enabled: enable };
  } catch (error) {
    console.error('[auto-launch] Error toggling:', error);
    return { success: false, error: error.message };
  }
});

// ==================== DOWNLOAD COUNT TRACKING ====================
// Update active download count (called from renderer)
ipcMain.handle('update-download-count', async (_, count) => {
  activeDownloadCount = count;
  console.log(`[Downloads] Active download count: ${activeDownloadCount}`);

  // Update tray menu if tray exists
  updateTrayMenu();

  // If downloads finished and window is hidden, show notification
  // If downloads finished and window is hidden
  if (count === 0 && tray && mainWindow && !mainWindow.isVisible()) {
    // 1. Stop Power Save Blocker (downloads done)
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      console.log(`[PowerSave] Downloads complete. Blocker stopped (ID: ${powerSaveBlockerId})`);
      // Don't nullify ID yet, allows restart reuse logic or just keeping track
    }

    // 2. Show Notification (Tray Balloon)
    tray.displayBalloon({
      iconType: 'info',
      title: 'GetVideosLocally',
      content: 'All downloads have finished successfully!'
    });

    // CRITICAL: Do NOT show or focus window. 
    // Do NOT destroy tray.
    // User stays in tray until they choose to open.
  }

  return { success: true };
});

// Get current download count
ipcMain.handle('get-download-count', async () => {
  return activeDownloadCount;
});

ipcMain.handle('get-server-token', async () => {
  return serverToken;
});

// Handle Custom Close Confirmation Action
ipcMain.on('close-action-response', (_, action) => {
  if (action === 'exit') {
    isQuitting = true;
    app.quit();
  } else if (action === 'minimize-to-tray') {
    createTrayIcon();
    if (mainWindow) mainWindow.hide();

    // Explicitly enforce power save blocker when hidden to prevent OS suspension
    if (!powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(`[PowerSave] Enforced blocker for background mode (ID: ${powerSaveBlockerId})`);
    }
  }
  // If 'cancel', just do nothing (window stays open)
});
