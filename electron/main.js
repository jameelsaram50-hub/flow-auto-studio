const { app, BrowserWindow, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const logFile = path.join(os.homedir(), 'flow-auto-studio.log');

function log(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.stack || err}`);
});

log('Electron main starting...');

const { startServer, launchChrome, getTurboFlowDir } = require('../server');

let mainWindow = null;
const PORT = 3001;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#07090e',
    title: 'Flow Auto Studio — AI Image Automation Desktop',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
  }, 1000);

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log(`[Renderer Console ${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log(`[Renderer Load Failure] Code: ${errorCode}, Desc: ${errorDescription}, URL: ${validatedURL}`);
  });

  // Load the web app running on local port 3001
  const targetUrl = `http://localhost:${PORT}`;

  function loadURLWithRetry() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(targetUrl).catch(() => {
      setTimeout(loadURLWithRetry, 500);
    });
  }

  loadURLWithRetry();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('open-path', async (event, targetPath) => {
  const finalPath = targetPath || getTurboFlowDir();
  shell.openPath(finalPath);
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('show-notification', async (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: title || 'Flow Auto Studio',
      body: body || 'Operation finished',
    }).show();
  }
  return true;
});

ipcMain.handle('relaunch-chrome', async () => {
  launchChrome();
  return true;
});

ipcMain.handle('get-desktop-info', async () => {
  return {
    platform: process.platform,
    downloadsDir: getTurboFlowDir(),
    appVersion: '1.0.0',
  };
});

// App lifecycle: always launch window cleanly
app.whenReady().then(() => {
  log('app.whenReady triggered');
  // Start embedded local bridge server on port 3001
  startServer(PORT);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log('All windows closed, quitting app');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
