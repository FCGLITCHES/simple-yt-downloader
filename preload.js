const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openFolderDialog: async () => {
    return await ipcRenderer.invoke("dialog:openFolder");
  },
  getDefaultDownloadFolder: async () => {
    return await ipcRenderer.invoke("getDefaultDownloadFolder");
  },
  openPathInExplorer: async (folderPath) => {
    return await ipcRenderer.invoke("openPathInExplorer", folderPath);
  },
  readClipboardText: async () => {
    return await ipcRenderer.invoke("readClipboardText");
  },
  writeClipboardText: async (text) => {
    return await ipcRenderer.invoke("writeClipboardText", text);
  },
  getPath: (name) => ipcRenderer.invoke("getPath", name),
  getUserDataPath: async () => {
    return await ipcRenderer.invoke("get-userdata-path");
  },
  saveCookiesTxt: async (content) => {
    return await ipcRenderer.invoke("save-cookies-txt", content);
  },
  getCookiesTxt: async () => {
    return await ipcRenderer.invoke("get-cookies-txt");
  },
  openCookiesHelper: async () => {
    return await ipcRenderer.invoke("open-cookies-helper");
  },
  listDownloadFolder: async (folderPath) => {
    return await ipcRenderer.invoke("list-download-folder", folderPath);
  },
  getDirname: async (filePath) => {
    return await ipcRenderer.invoke("get-dirname", filePath);
  },
  normalizePath: async (filePath) => {
    return await ipcRenderer.invoke("normalize-path", filePath);
  },
  deleteFile: async (filePath) => {
    return await ipcRenderer.invoke("delete-file", filePath);
  },
  deleteFolder: async (folderPath) => {
    return await ipcRenderer.invoke("delete-folder", folderPath);
  },
  resolvePath: async (downloadFolder, relativePath) => {
    return await ipcRenderer.invoke(
      "resolve-path",
      downloadFolder,
      relativePath,
    );
  },
  pathExists: async (filePath) => {
    return await ipcRenderer.invoke("path-exists", filePath);
  },
  testFolderAccess: async (folderPath) => {
    return await ipcRenderer.invoke("test-folder-access", folderPath);
  },
  startPowerSaveBlocker: async () => {
    return await ipcRenderer.invoke("start-power-save-blocker");
  },
  stopPowerSaveBlocker: async () => {
    return await ipcRenderer.invoke("stop-power-save-blocker");
  },
  closeWindow: async () => {
    return await ipcRenderer.invoke("close-cookie-window");
  },
  // Auto-launch (Windows Startup) APIs
  getAutoLaunchStatus: async () => {
    return await ipcRenderer.invoke("get-auto-launch-status");
  },
  enableAutoLaunch: async () => {
    return await ipcRenderer.invoke("enable-auto-launch");
  },
  disableAutoLaunch: async () => {
    return await ipcRenderer.invoke("disable-auto-launch");
  },
  toggleAutoLaunch: async (enable) => {
    return await ipcRenderer.invoke("toggle-auto-launch", enable);
  },
  // Download count tracking for tray/close confirmation
  updateDownloadCount: async (count) => {
    return await ipcRenderer.invoke("update-download-count", count);
  },
  getDownloadCount: async () => {
    return await ipcRenderer.invoke("get-download-count");
  },
  // Close confirmation UI
  onShowCloseConfirmation: (callback) =>
    ipcRenderer.on("show-close-confirmation", (_, count) => callback(count)),
  sendCloseAction: (action) =>
    ipcRenderer.send("close-action-response", action),
  // Server authentication token for local API access
  getServerToken: async () => {
    return await ipcRenderer.invoke("get-server-token");
  },
});
