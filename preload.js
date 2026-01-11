const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getGames: () => ipcRenderer.invoke("get-games"),
  install: (gameId) => ipcRenderer.invoke("install", gameId),
  uninstall: (gameId) => ipcRenderer.invoke("uninstall", gameId),
  launch: (gameId, exeName) => ipcRenderer.invoke("launch", gameId, exeName),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  onInstallProgress: (cb) => ipcRenderer.on("install-progress", (_, d) => cb(d)),
  onInstallDone: (cb) => ipcRenderer.on("install-done", (_, d) => cb(d)),
  onInstallError: (cb) => ipcRenderer.on("install-error", (_, d) => cb(d)),
  onUninstallDone: (cb) => ipcRenderer.on("uninstall-done", (_, d) => cb(d))
});
