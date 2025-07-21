// main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const { execFile } = require('child_process');
const bodyParser = require('body-parser');
const fs = require('fs');

function createServer() {
  const appServer = express();
  const server = http.createServer(appServer);

  appServer.use(express.static(__dirname));
  appServer.use(bodyParser.json());

  appServer.post('/api/download', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'No URL provided' });

    const output = path.join(__dirname, 'downloads', '%(title)s.%(ext)s');
    const process = execFile('yt-dlp', ['-o', output, url], (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp error:', error);
        return res.status(500).json({ success: false, error: stderr });
      }
      res.json({ success: true, message: 'Download started', output });
    });
  });

  server.listen(3000, () => {
    console.log('Server running at http://localhost:3000');
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  win.loadFile(path.join(__dirname, 'index.html'));

}

app.whenReady().then(() => {
  createServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
