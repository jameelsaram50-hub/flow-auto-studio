const { app, BrowserWindow, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const logFile = path.join(os.homedir(), 'easyaihub-image-studio.log');

function log(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.stack || err}`);
});

process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason?.stack || reason}`);
});

log('Electron main starting...');

// Guarantee single running instance of Easy AI Hub Image Studio
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('Another instance of Easy AI Hub Image Studio is already running. Focusing existing window.');
  app.quit();
  // Do NOT call process.exit() here — let Electron clean up naturally
}

app.on('second-instance', () => {
  log('Second instance triggered — restoring/focusing main window.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

let startServer, launchChrome, getEasyAiHubDir;
try {
  const server = require('../server');
  startServer = server.startServer;
  launchChrome = server.launchChrome;
  getEasyAiHubDir = server.getEasyAiHubDir;
} catch (e) {
  log(`FATAL: Failed to load server module: ${e.stack || e}`);
  // Define stubs so the window still opens with a friendly error message
  startServer = (port) => {
    const http = require('http');
    http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2 style="font-family:sans-serif;color:red;padding:40px">⚠️ Server failed to start. Please restart the app.</h2>');
    }).listen(port, '127.0.0.1');
  };
  launchChrome = () => {};
  getEasyAiHubDir = () => require('path').join(require('os').homedir(), 'Downloads', 'easyaihub');
}

let mainWindow = null;
const PORT = 3001;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#07090e',
    title: 'Easy AI Hub — Image Studio',
    autoHideMenuBar: true,
    // Use show:false + ready-to-show to guarantee the window appears in front
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  // Show and raise to front once content is ready (avoids blank flash)
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    // Briefly always-on-top to break through any other window
    mainWindow.setAlwaysOnTop(true);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(false);
      }
    }, 1500);
    log('Window shown and raised to front.');
  });

  // Fallback: if ready-to-show never fires in 5s, show anyway
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log('Fallback show triggered — ready-to-show did not fire.');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 5000);
  mainWindow.once('ready-to-show', () => clearTimeout(showFallback));
  mainWindow.once('closed', () => clearTimeout(showFallback));

  mainWindow.webContents.on('console-message', (event, ...args) => {
    const level = event?.level ?? args[0];
    const message = event?.message ?? args[1];
    const line = event?.lineNumber ?? args[2];
    const sourceId = event?.sourceId ?? args[3];
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
  const finalPath = targetPath || getEasyAiHubDir();
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
      title: title || 'Easy AI Hub',
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
    downloadsDir: getEasyAiHubDir(),
    appVersion: '1.0.0',
  };
});

// App lifecycle: always launch window cleanly
app.whenReady().then(() => {
  log('app.whenReady triggered');
  // Start embedded local bridge server on port 3001
  try {
    startServer(PORT);
    log('Server started on port ' + PORT);
  } catch (e) {
    log('Server start error: ' + (e.stack || e));
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log('All windows closed, quitting app');
  try {
    app.quit();
  } catch (e) {}
  setTimeout(() => {
    process.exit(0);
  }, 300);
});

