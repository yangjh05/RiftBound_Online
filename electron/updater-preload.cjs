const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("riftboundUpdater", {
  onStatus(callback) {
    ipcRenderer.on("update-status", (_event, status) => callback(status));
  }
});
