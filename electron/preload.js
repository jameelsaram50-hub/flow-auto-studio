const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  openPath: (folderPath) => ipcRenderer.invoke('open-path', folderPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  relaunchChrome: () => ipcRenderer.invoke('relaunch-chrome'),
  getDesktopInfo: () => ipcRenderer.invoke('get-desktop-info'),
});
