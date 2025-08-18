# Cookie Authentication Debugging Guide

This document outlines the comprehensive debugging system we created to troubleshoot and fix cookie authentication issues in the Simple YT Downloader application.

## Table of Contents
- [Problem Overview](#problem-overview)
- [Debugging System](#debugging-system)
- [Debug Functions Created](#debug-functions-created)
- [Backend Debug Endpoints](#backend-debug-endpoints)
- [Troubleshooting Process](#troubleshooting-process)
- [Final Solution](#final-solution)
- [Cleanup Instructions](#cleanup-instructions)

## Problem Overview

### Initial Issue
- Cookie files were being detected by the frontend but not by the backend
- Cookie testing was failing with timeout errors
- yt-dlp was not using authentication cookies properly

### Root Causes Identified
1. **Path Mismatch**: Backend expected `Video Downloader Gemini` while frontend used `video-downloader-gemini`
2. **Unsupported Arguments**: yt-dlp version didn't support `--timeout` argument
3. **Complex Path Detection**: 26+ paths being checked unnecessarily

## Debugging System

### Frontend Debug Functions

#### 1. Complete Cookie Flow Test
```javascript
window.testCookieFlow = async function() {
    console.log('=== Testing Complete Cookie Flow ===');
    
    if (!window.electronAPI) {
        console.error('❌ electronAPI not available');
        return;
    }
    
    try {
        // 1. Check userData path
        const userDataPath = await window.electronAPI.getUserDataPath();
        console.log('📁 User data path:', userDataPath);
        
        // 2. Debug cookies path
        const cookiesDebug = await window.electronAPI.debugCookiesPath();
        console.log('🍪 Cookies debug info:', cookiesDebug);
        
        // 3. Try to get cookies content
        const cookiesResult = await window.electronAPI.getCookiesTxt();
        console.log('📄 Cookies file result:', cookiesResult.success ? 'SUCCESS' : 'FAILED');
        
        if (cookiesResult.success) {
            console.log('📝 Cookies content preview:', cookiesResult.content?.substring(0, 200) + '...');
        } else {
            console.log('❌ Cookies error:', cookiesResult.error);
        }
        
        // 4. Check WebSocket connection
        console.log('🔌 WebSocket status:', window.ws ? window.ws.readyState : 'not found');
        
        if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
            console.log('⚠️ WebSocket not connected. Attempting to connect...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
                console.error('❌ WebSocket still not connected. Cookie testing requires active connection.');
                return;
            }
        }
        
        // 5. Test download to trigger cookie testing
        console.log('🧪 Testing download to trigger cookie validation...');
        const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        
        const testPayload = {
            url: testUrl,
            format: 'mp4',
            quality: 'highest',
            clientId: localStorage.getItem('ytdClientId'),
            source: 'youtube',
            playlistAction: 'single',
            concurrency: 1,
            singleConcurrency: 1,
            downloadFolder: document.getElementById('downloadFolder')?.value || ''
        };
        
        console.log('📤 Sending test download request...');
        console.log('⚠️ Watch the terminal/console for cookie testing messages!');
        console.log('🔍 Look for: "🧪 Testing cookie validity..." in the terminal');
        
        window.ws.send(JSON.stringify({ type: 'download_request', ...testPayload }));
        console.log('✅ Test request sent! Check terminal for cookie testing logs.');
        
    } catch (error) {
        console.error('💥 Error during cookie test:', error);
    }
};
```

#### 2. Direct Cookie Test (No WebSocket Required)
```javascript
window.testCookiesDirectly = async function() {
    console.log('=== Direct Cookie Test (No Download) ===');
    
    try {
        const response = await fetch('/test-cookies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                clientId: localStorage.getItem('ytdClientId'),
                testUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            })
        });
        
        const result = await response.json();
        console.log('🧪 Direct cookie test result:', result);
        
    } catch (error) {
        console.error('❌ Direct cookie test failed:', error);
    }
};
```

#### 3. Cookie Location Debug
```javascript
window.debugCookieLocations = async function() {
    console.log('=== Debug Cookie Locations ===');
    
    try {
        const response = await fetch('/debug-cookie-paths');
        const result = await response.json();
        
        console.log('🖥️ Backend cookie path analysis:', result);
        
        if (window.electronAPI) {
            const cookiesDebug = await window.electronAPI.debugCookiesPath();
            console.log('🖼️ Frontend cookie debug:', cookiesDebug);
            
            const cookiesResult = await window.electronAPI.getCookiesTxt();
            console.log('📄 Frontend cookies result:', cookiesResult);
        }
        
        console.log('🔍 Path Comparison:');
        console.log('  Backend expected:', result.expectedCookiesPath);
        console.log('  Backend found:', result.actualFoundPath);
        console.log('  Frontend path:', window.electronAPI ? await window.electronAPI.getUserDataPath() : 'N/A');
        
    } catch (error) {
        console.error('❌ Debug failed:', error);
    }
};
```

### Backend Debug Endpoints

#### 1. Cookie Path Analysis
```javascript
app.get('/debug-cookie-paths', async (req, res) => {
    try {
        console.log('[debug-cookie-paths] 🔍 Running comprehensive cookie path analysis...');
        
        const platform = os.platform();
        const homedir = os.homedir();
        
        const appName = 'Video Downloader Gemini';
        let electronUserDataPath;
        
        switch (platform) {
            case 'win32':
                electronUserDataPath = path.join(homedir, 'AppData', 'Roaming', appName);
                break;
            case 'darwin':
                electronUserDataPath = path.join(homedir, 'Library', 'Application Support', appName);
                break;
            case 'linux':
                electronUserDataPath = path.join(homedir, '.config', appName);
                break;
            default:
                electronUserDataPath = path.join(homedir, '.video-downloader-gemini');
        }
        
        const result = {
            platform: platform,
            homedir: homedir,
            __dirname: __dirname,
            processCwd: process.cwd(),
            expectedElectronPath: electronUserDataPath,
            expectedCookiesPath: path.join(electronUserDataPath, 'cookies.txt'),
            searchResults: []
        };
        
        const expectedPath = path.join(electronUserDataPath, 'cookies.txt');
        try {
            const exists = fs.existsSync(expectedPath);
            const stats = exists ? fs.statSync(expectedPath) : null;
            result.expectedPathTest = {
                path: expectedPath,
                exists: exists,
                size: stats ? stats.size : null,
                isFile: stats ? stats.isFile() : null
            };
        } catch (e) {
            result.expectedPathTest = {
                path: expectedPath,
                error: e.message
            };
        }
        
        const foundPath = await getCookiesPath();
        result.actualFoundPath = foundPath;
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

#### 2. Direct Cookie Test Endpoint
```javascript
app.post('/test-cookies', async (req, res) => {
    const { clientId, testUrl } = req.body;
    const itemId = `cookie_test_${Date.now()}`;
    
    try {
        console.log(`[${itemId}] 🧪 Direct cookie test requested`);
        
        const cookieFilePath = await getCookiesPath();
        
        if (!cookieFilePath) {
            return res.json({ 
                success: false, 
                error: 'No cookies file found',
                cookieFilePath: null
            });
        }
        
        const testResult = await testCookieValidity(cookieFilePath, clientId, itemId);
        
        res.json({
            success: testResult.valid,
            cookieFilePath: cookieFilePath,
            testResult: testResult,
            message: testResult.valid ? 'Cookies are working!' : `Cookies failed: ${testResult.reason}`
        });
        
    } catch (error) {
        console.error(`[${itemId}] Cookie test error:`, error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});
```

### Enhanced Cookie Testing Function

```javascript
async function testCookieValidity(cookieFilePath, clientId, itemId) {
    if (!cookieFilePath || !fs.existsSync(cookieFilePath)) {
        console.log(`[${itemId}] ❌ No cookies file found at: ${cookieFilePath}`);
        return { valid: false, reason: 'No cookies file' };
    }
    
    try {
        console.log(`[${itemId}] 🧪 Testing cookie validity with file: ${cookieFilePath}`);
        
        const testArgs = [
            '--cookies', cookieFilePath,
            '--no-download',
            '--print', '%(title)s',
            '--no-warnings',
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        ];
        
        console.log(`[${itemId}] 🔧 Running simplified test...`);
        
        const testResult = await new Promise((resolve) => {
            const testProc = spawn(ytdlpExecutable, testArgs, { 
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            let resolved = false;
            
            testProc.stdout.on('data', (data) => {
                stdout += data;
            });
            
            testProc.stderr.on('data', (data) => {
                stderr += data;
            });
            
            testProc.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });
            
            testProc.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    resolve({ code: -1, stdout: '', stderr: error.message });
                }
            });
            
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    testProc.kill('SIGTERM');
                    resolve({ code: -1, stdout: stdout.trim(), stderr: 'Process timeout', timeout: true });
                }
            }, 15000);
        });
        
        console.log(`[${itemId}] 📊 Simplified test result - Code: ${testResult.code}, Has output: ${!!testResult.stdout}`);
        
        if (testResult.code === 0 && testResult.stdout) {
            console.log(`[${itemId}] ✅ Cookies are valid! Video title: "${testResult.stdout}"`);
            return { valid: true, title: testResult.stdout };
        } else {
            console.log(`[${itemId}] ❌ Cookie test failed - proceeding without cookies`);
            return { valid: false, reason: testResult.stderr || 'Test failed' };
        }
        
    } catch (error) {
        console.error(`[${itemId}] 💀 Cookie test error:`, error.message);
        return { valid: false, reason: error.message };
    }
}
```

### Enhanced Cookie Path Detection

```javascript
async function getCookiesPath() {
    const isDev = process.env.NODE_ENV !== 'production';
    
    console.log('[getCookiesPath] 🔍 Starting enhanced cookie search...');
    console.log('[getCookiesPath] Environment:', isDev ? 'Development' : 'Production');
    console.log('[getCookiesPath] Platform:', os.platform());
    console.log('[getCookiesPath] Home directory:', os.homedir());
    
    const possiblePaths = [];
    
    const platform = os.platform();
    const homedir = os.homedir();
    
    const appName = 'Video Downloader Gemini';
    let electronUserDataPath;
    
    switch (platform) {
        case 'win32':
            electronUserDataPath = path.join(homedir, 'AppData', 'Roaming', appName);
            break;
        case 'darwin':
            electronUserDataPath = path.join(homedir, 'Library', 'Application Support', appName);
            break;
        case 'linux':
            electronUserDataPath = path.join(homedir, '.config', appName);
            break;
        default:
            electronUserDataPath = path.join(homedir, '.video-downloader-gemini');
    }
    
    const alternativeNames = [
        'video-downloader-gemini',
        'Video Downloader Gemini',
        'simple-ytd',
        'Simple YTD'
    ];
    
    possiblePaths.push(path.join(electronUserDataPath, 'cookies.txt'));
    
    alternativeNames.forEach(name => {
        if (platform === 'win32') {
            possiblePaths.push(path.join(homedir, 'AppData', 'Roaming', name, 'cookies.txt'));
        } else if (platform === 'darwin') {
            possiblePaths.push(path.join(homedir, 'Library', 'Application Support', name, 'cookies.txt'));
        } else if (platform === 'linux') {
            possiblePaths.push(path.join(homedir, '.config', name, 'cookies.txt'));
        }
        possiblePaths.push(path.join(homedir, `.${name.toLowerCase().replace(/\s+/g, '-')}`, 'cookies.txt'));
    });
    
    possiblePaths.push(path.join(__dirname, 'cookies.txt'));
    possiblePaths.push(path.join(process.cwd(), 'cookies.txt'));
    possiblePaths.push(path.join(homedir, 'cookies.txt'));
    possiblePaths.push(path.join(homedir, 'Desktop', 'cookies.txt'));
    possiblePaths.push(path.join(homedir, 'Downloads', 'cookies.txt'));
    
    const uniquePaths = [...new Set(possiblePaths)];
    
    console.log(`[getCookiesPath] 🔍 Checking ${uniquePaths.length} possible paths:`);
    uniquePaths.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    
    for (const [index, testPath] of uniquePaths.entries()) {
        try {
            console.log(`[getCookiesPath] 📂 Checking path ${index + 1}/${uniquePaths.length}: ${testPath}`);
            
            if (fs.existsSync(testPath)) {
                const stats = fs.statSync(testPath);
                console.log(`[getCookiesPath] ✅ File exists: ${testPath} (${stats.size} bytes)`);
                
                if (stats.isFile() && stats.size > 50) {
                    console.log(`[getCookiesPath] 📋 File size check passed: ${stats.size} bytes`);
                    
                    try {
                        const content = fs.readFileSync(testPath, 'utf8');
                        const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
                        
                        if (lines.length > 0) {
                            console.log(`[getCookiesPath] ✅ FOUND VALID COOKIES FILE: ${testPath}`);
                            console.log(`[getCookiesPath] 📊 File stats: ${stats.size} bytes, ${lines.length} cookie lines`);
                            return testPath;
                        } else {
                            console.log(`[getCookiesPath] ⚠️ File has no cookie data: ${testPath}`);
                        }
                    } catch (readError) {
                        console.log(`[getCookiesPath] ❌ Error reading file content: ${readError.message}`);
                    }
                } else {
                    console.log(`[getCookiesPath] ⚠️ File too small: ${testPath} (${stats.size} bytes)`);
                }
            } else {
                console.log(`[getCookiesPath] ❌ File does not exist: ${testPath}`);
            }
        } catch (e) {
            console.log(`[getCookiesPath] 💥 Error checking ${testPath}: ${e.message}`);
        }
    }
    
    console.log(`[getCookiesPath] 🚫 No valid cookies.txt found in any of the ${uniquePaths.length} locations.`);
    console.log(`[getCookiesPath] 💡 To use cookies, place cookies.txt in: ${electronUserDataPath}`);
    return null;
}
```

## Troubleshooting Process

### Step 1: Identify the Issue
- Frontend could detect cookies, backend could not
- Used `window.debugCookieLocations()` to compare paths

### Step 2: Path Analysis
- Found mismatch between expected paths
- Backend: `Video Downloader Gemini`
- Frontend: `video-downloader-gemini`

### Step 3: Cookie Testing
- Created direct test endpoint to bypass WebSocket issues
- Found `--timeout` argument not supported by yt-dlp version

### Step 4: Enhanced Debugging
- Added comprehensive logging to cookie detection
- Created multiple fallback paths
- Implemented proper error handling

### Step 5: Working Solution Verification
- Confirmed cookies were being found and tested
- Verified yt-dlp was using authentication properly

## Final Solution

### Simplified Cookie Management
Instead of complex path detection, we implemented a simple approach:

```javascript
// Simple, fixed location: project_folder/cookies/cookies.txt
async function getCookiesPath() {
    const cookiesDir = path.join(__dirname, 'cookies');
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
    }
    
    return null;
}
```

## Cleanup Instructions

Now that the system is working, here's the cleaned-up code without debug functions:

---

## Cleaned-Up Code (Ready for Production)

### 1. Clean server.js - Remove Debug Functions

```javascript
// Remove these debug endpoints from server.js:
// - app.get('/debug-cookie-paths', ...)
// - app.post('/test-cookies', ...)

// Keep only the simplified getCookiesPath function:
async function getCookiesPath() {
    const cookiesDir = path.join(__dirname, 'cookies');
    const cookiesPath = path.join(cookiesDir, 'cookies.txt');
    
    if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
    }
    
    if (fs.existsSync(cookiesPath)) {
        const stats = fs.statSync(cookiesPath);
        if (stats.size > 50) {
            return cookiesPath;
        }
    }
    
    return null;
}

// Keep the simplified testCookieValidity function:
async function testCookieValidity(cookieFilePath, clientId, itemId) {
    if (!cookieFilePath || !fs.existsSync(cookieFilePath)) {
        return { valid: false, reason: 'No cookies file' };
    }
    
    try {
        const testArgs = [
            '--cookies', cookieFilePath,
            '--no-download',
            '--print', '%(title)s',
            '--no-warnings',
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        ];
        
        const testResult = await new Promise((resolve) => {
            const testProc = spawn(ytdlpExecutable, testArgs, { 
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            let resolved = false;
            
            testProc.stdout.on('data', (data) => {
                stdout += data;
            });
            
            testProc.stderr.on('data', (data) => {
                stderr += data;
            });
            
            testProc.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });
            
            testProc.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    resolve({ code: -1, stdout: '', stderr: error.message });
                }
            });
            
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    testProc.kill('SIGTERM');
                    resolve({ code: -1, stdout: stdout.trim(), stderr: 'Process timeout', timeout: true });
                }
            }, 15000);
        });
        
        if (testResult.code === 0 && testResult.stdout) {
            return { valid: true, title: testResult.stdout };
        } else {
            return { valid: false, reason: testResult.stderr || 'Test failed' };
        }
        
    } catch (error) {
        return { valid: false, reason: error.message };
    }
}
```

### 2. Clean script.js - Remove Debug Functions

```javascript
// Remove these debug functions from script.js:
// - window.testCookieFlow
// - window.testCookiesDirectly  
// - window.debugCookieLocations
// - window.testCookiesSimple

// Keep only the essential cookie-related functions if any
```

### 3. Clean electron-main.js - Keep Simplified Handlers

```javascript
// Keep the simplified cookie handlers:
ipcMain.handle('save-cookies-txt', async (event, content) => {
    try {
        const cookiesDir = path.join(__dirname, 'cookies');
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

ipcMain.handle('get-cookies-txt', async () => {
    try {
        const cookiesDir = path.join(__dirname, 'cookies');
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

// Remove the debug handlers:
// - ipcMain.handle('debug-cookies-path', ...)
```

### 4. Update .gitignore

```gitignore
# Add this to your .gitignore
cookies/
```

### 5. Project Structure

```
your-project/
├── cookies/           (create this folder)
│   └── cookies.txt    (your actual cookies file)
├── server.js          (cleaned up)
├── script.js          (cleaned up)
├── electron-main.js   (cleaned up)
└── .gitignore         (updated)
```

This documentation preserves all the debugging knowledge while providing clean, production-ready code.