const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const {
  runPlaywrightBatch,
  stopJob,
  getDebugState,
  forceCaptureScreenshot,
  getLiveFrameBuffer,
  bringChromeToFront,
  ensureBrowserOpen,
  resetFlowSiteDataAndSession,
  openWorkerForLogin,
  getProfilesStatus
} = require('./playwright_worker.js');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend assets from public directory
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// Path configuration
const EXT_DIR = path.resolve(__dirname, 'turboflow-2.3.2.1-betaa', 'dist');
const EXT_ID = 'bdmfcdallkljfeejmglojaanbonjhbkb';
const EXT_URL = `chrome-extension://${EXT_ID}/sidepanel.html`;
const FLOW_URL = 'https://flow.google.com/';
const PROJECTS_DIR = path.join(__dirname, 'data', 'projects');

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// Turboflow default download directory
function getTurboFlowDir() {
  const dir = path.join(os.homedir(), 'Downloads', 'turboflow');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Dedicated profile directory so user Google login and extension data persist
function getDedicatedProfileDir() {
  const profileDir = path.join(os.homedir(), '.turboflow-chrome-profile');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  return profileDir;
}

// Locate Chrome executable on Windows
function findChromeExecutable() {
  const candidatePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'chrome.exe';
}

// In-memory logs store for frontend live monitoring
const recentLogs = [];
function addLog(source, msg, type = 'info', screenshotUrl = null) {
  const time = new Date().toLocaleTimeString();
  const text = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
  recentLogs.push({ id: Date.now() + Math.random(), time, source, text, type, screenshotUrl });
  if (recentLogs.length > 100) recentLogs.shift();
}

// In-memory active prompts store — always starts clean on server launch
function freshRun() {
  return {
    runId: null,
    projectId: null,
    prompts: [],
    plainText: '',
    count: 0,
    speedMode: 'fast',
    imageQuality: 'standard',
    workerCount: 7,
    startTime: 0,
    status: 'idle',
    chromeLaunched: false,
    lastLaunchTime: null,
    error: null,
    progressText: '',
    sceneScreenshots: {},
    workerStatus: {},
  };
}
let activeRun = freshRun();

// High-speed in-memory image cache to avoid blocking event loop with frequent fs.statSync
let imagesCache = {
  timestamp: 0,
  images: [],
  dir: null,
};

function getCachedImages() {
  const now = Date.now();
  const dir = getTurboFlowDir();
  // 1000ms cache TTL for fast responses
  if (imagesCache.dir === dir && (now - imagesCache.timestamp) < 1000) {
    return imagesCache.images;
  }

  const images = [];
  if (fs.existsSync(dir)) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (/\.(png|jpe?g|webp)$/i.test(f)) {
          const filePath = path.join(dir, f);
          const stat = fs.statSync(filePath);
          images.push({
            filename: f,
            url: `/api/images/${encodeURIComponent(f)}`,
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        }
      }
    } catch (e) {
      console.warn('[Server] Error reading images:', e.message);
    }
  }

  images.sort((a, b) => b.mtime - a.mtime);
  imagesCache = { timestamp: now, images, dir };
  return images;
}

// Ensure extension is synced to a path with NO SPACES (Chromium requires space-free path on Windows)
function getCleanExtensionDir() {
  const targetDir = path.join(os.homedir(), '.turboflow-extension');
  const sourceDir = path.resolve(__dirname, 'turboflow-2.3.2.1-betaa', 'dist');

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const copyRecursive = (src, dest) => {
      for (const item of fs.readdirSync(src)) {
        const s = path.join(src, item);
        const d = path.join(dest, item);
        const stat = fs.statSync(s);
        if (stat.isDirectory()) {
          if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
          copyRecursive(s, d);
        } else {
          // Sync if missing or newer
          if (!fs.existsSync(d) || fs.statSync(d).mtimeMs < stat.mtimeMs) {
            fs.copyFileSync(s, d);
          }
        }
      }
    };
    if (fs.existsSync(sourceDir)) {
      copyRecursive(sourceDir, targetDir);
    }
  } catch (e) {
    console.warn('[Launcher] Error syncing clean extension dir:', e.message);
  }
  return targetDir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chrome Profile Manager — clears junk data before each launch but KEEPS login
// ─────────────────────────────────────────────────────────────────────────────

// These dirs under Default/ are wiped before each Chrome launch.
// Clearing them removes stale state that causes Google detection / stuck issues.
// NOTE: Do NOT clear 'Local Extension Settings' or 'Extension State' —
//       these contain TurboFlow auth tokens and extension storage data.
// These dirs under Default/ are wiped before each Chrome launch to prevent memory leaks and cache bloat.
// NOTE: We do NOT clear Local Storage, IndexedDB, Network, or Extension directories,
// so Google Flow login and TurboFlow settings are 100% preserved.
const CHROME_DIRS_TO_CLEAR = [
  'Cache', 'Code Cache', 'GPUCache', 'ShaderCache',
  'Service Worker', 'CacheStorage',
];

// These files / dirs are PRECIOUS — never delete them (Google login lives here).
const CHROME_KEEP_FILES = new Set([
  'Cookies', 'Cookies-journal',
  'Login Data', 'Login Data For Account',
  'Web Data', 'Bookmarks', 'Preferences',
  'Secure Preferences', 'TransportSecurity',
  'Origin Bound Certs', 'LOCK',
]);

// Backup dir for precious files (survives profile wipes)
function getCookieBackupDir() {
  const d = path.join(os.homedir(), '.turboflow-session-backup');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

// Remove a directory tree, ignoring errors
function rmDirSafe(p) {
  try {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const item of fs.readdirSync(p)) {
        rmDirSafe(path.join(p, item));
      }
      try { fs.rmdirSync(p); } catch (e) {}
    } else {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  } catch (e) {}
}

// Back up precious Chrome session files (including modern Chrome Network/Cookies)
function backupSessionFiles(defaultDir) {
  const backupDir = getCookieBackupDir();
  let saved = 0;
  for (const name of CHROME_KEEP_FILES) {
    const src = path.join(defaultDir, name);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, path.join(backupDir, name));
        saved++;
      } catch (e) {}
    }
  }

  // Modern Chrome (v96+) stores cookies under Default/Network/Cookies
  const netSrc = path.join(defaultDir, 'Network');
  const netBackup = path.join(backupDir, 'Network');
  if (fs.existsSync(netSrc)) {
    if (!fs.existsSync(netBackup)) fs.mkdirSync(netBackup, { recursive: true });
    for (const f of ['Cookies', 'Cookies-journal', 'TransportSecurity', 'Network Persistent State']) {
      const srcFile = path.join(netSrc, f);
      if (fs.existsSync(srcFile)) {
        try {
          fs.copyFileSync(srcFile, path.join(netBackup, f));
          saved++;
        } catch (e) {}
      }
    }
  }

  // Backup Local Extension Settings for TurboFlow
  const extSettingsSrc = path.join(defaultDir, 'Local Extension Settings', 'bdmfcdallkljfeejmglojaanbonjhbkb');
  const extSettingsBackup = path.join(backupDir, 'Local Extension Settings', 'bdmfcdallkljfeejmglojaanbonjhbkb');
  if (fs.existsSync(extSettingsSrc)) {
    if (!fs.existsSync(extSettingsBackup)) fs.mkdirSync(extSettingsBackup, { recursive: true });
    for (const f of fs.readdirSync(extSettingsSrc)) {
      try {
        fs.copyFileSync(path.join(extSettingsSrc, f), path.join(extSettingsBackup, f));
        saved++;
      } catch (e) {}
    }
  }

  if (saved > 0) console.log(`[Session] Backed up ${saved} session file(s) to ${backupDir}`);
  return backupDir;
}

// Restore session files (cookies / login) into profile
function restoreSessionFiles(defaultDir) {
  const backupDir = getCookieBackupDir();
  let restored = 0;
  for (const name of CHROME_KEEP_FILES) {
    const src = path.join(backupDir, name);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, path.join(defaultDir, name));
        restored++;
      } catch (e) {}
    }
  }

  // Restore Modern Chrome Network/Cookies
  const netBackup = path.join(backupDir, 'Network');
  const netDest = path.join(defaultDir, 'Network');
  if (fs.existsSync(netBackup)) {
    if (!fs.existsSync(netDest)) fs.mkdirSync(netDest, { recursive: true });
    for (const f of ['Cookies', 'Cookies-journal', 'TransportSecurity', 'Network Persistent State']) {
      const srcFile = path.join(netBackup, f);
      if (fs.existsSync(srcFile)) {
        try {
          fs.copyFileSync(srcFile, path.join(netDest, f));
          restored++;
        } catch (e) {}
      }
    }
  }

  // Restore Local Extension Settings for TurboFlow
  const extSettingsBackup = path.join(backupDir, 'Local Extension Settings', 'bdmfcdallkljfeejmglojaanbonjhbkb');
  const extSettingsDest = path.join(defaultDir, 'Local Extension Settings', 'bdmfcdallkljfeejmglojaanbonjhbkb');
  if (fs.existsSync(extSettingsBackup)) {
    if (!fs.existsSync(extSettingsDest)) fs.mkdirSync(extSettingsDest, { recursive: true });
    for (const f of fs.readdirSync(extSettingsBackup)) {
      try {
        fs.copyFileSync(path.join(extSettingsBackup, f), path.join(extSettingsDest, f));
        restored++;
      } catch (e) {}
    }
  }

  if (restored > 0) console.log(`[Session] Restored ${restored} session file(s) — Google login preserved`);
}

// Clear all Chrome junk but keep precious session files intact
function clearChromeJunk(profileDir) {
  const defaultDir = path.join(profileDir, 'Default');
  if (!fs.existsSync(defaultDir)) return;

  addLog('Launcher', '🧹 Clearing Chrome junk data (cache, storage, stale state)...', 'info');
  console.log('[Launcher] Clearing Chrome profile junk before launch...');

  // 1. Backup precious files first
  backupSessionFiles(defaultDir);

  // 2. Wipe known problem directories
  for (const dir of CHROME_DIRS_TO_CLEAR) {
    rmDirSafe(path.join(defaultDir, dir));
  }

  // 3. Remove lock files at top level
  for (const f of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch (e) {}
  }

  // 4. Restore precious session files (Google login cookies etc.)
  restoreSessionFiles(defaultDir);

  addLog('Launcher', '✅ Chrome junk cleared. Google login session preserved.', 'success');
  console.log('[Launcher] Chrome junk cleared. Session restored.');
}

// Detect active Google Flow project URL from Chrome profile history
function getFlowLaunchUrl() {
  try {
    const historyDb = path.join(getDedicatedProfileDir(), 'Default', 'History');
    if (fs.existsSync(historyDb)) {
      const buf = fs.readFileSync(historyDb);
      const str = buf.toString('latin1');
      const matches = str.match(/https:\/\/flow\.google\.com\/project\/[a-f0-9-]{36}/gi);
      if (matches && matches.length > 0) {
        const latest = matches[matches.length - 1];
        console.log(`[Launcher] Detected active Flow project URL from Chrome profile: ${latest}`);
        return latest;
      }
    }
  } catch (e) {}
  return 'https://flow.google.com/';
}

// Kill any running Chrome processes that use our profile dir (Windows)
function killChromeProcesses(callback) {
  if (process.platform !== 'win32') {
    if (callback) callback();
    return;
  }
  const checkCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { $_.CommandLine -like '*turboflow-chrome-profile*' } | ForEach-Object { $_.ProcessId }"`;
  exec(checkCmd, (err, stdout) => {
    const pids = (stdout || '').trim().split(/\s+/).filter(Boolean);
    if (pids.length > 0) {
      console.log('[Launcher] Terminating stale turboflow chrome processes:', pids);
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /F ${pids.map((p) => `/PID ${p}`).join(' ')}`);
      } catch (e) {}
    }
    setTimeout(() => {
      if (callback) callback();
    }, 400);
  });
}

// Auto launch Chrome with Google Flow + TurboFlow extension
function launchChrome() {
  const chromeExe = findChromeExecutable();
  const profileDir = getDedicatedProfileDir();
  const extDir = getCleanExtensionDir();
  const flowUrl = getFlowLaunchUrl();

  console.log(`[Launcher] Launching Chrome executable: ${chromeExe}`);
  console.log(`[Launcher] Clean Extension path: ${extDir}`);
  console.log(`[Launcher] Target Flow URL: ${flowUrl}`);

  function doSpawn() {
    // Clear Chrome junk FIRST (keeps cookies/login intact)
    clearChromeJunk(profileDir);

    try {
      const mainArgs = [
        `--user-data-dir=${profileDir}`,
        '--profile-directory=Default',
        `--load-extension=${extDir}`,
        `--disable-extensions-except=${extDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        flowUrl,
      ];
      const mainChild = spawn(chromeExe, mainArgs, { detached: true, stdio: 'ignore' });
      mainChild.unref();
      console.log(`[Launcher] Chrome spawned (PID: ${mainChild.pid}) opening: ${flowUrl}`);
      addLog('Launcher', `🚀 Chrome launched with project canvas: ${flowUrl}`, 'success');
    } catch (err) {
      console.error('[Launcher] Could not spawn Chrome:', err);
      addLog('Launcher', `❌ Could not spawn Chrome: ${err.message}`, 'error');
    }
  }

  // Kill any existing Chrome first, then spawn fresh
  killChromeProcesses(doSpawn);
}

// Helper to save project state to disk
function saveProject(projectId, projectData) {
  const projectFolder = path.join(PROJECTS_DIR, projectId);
  if (!fs.existsSync(projectFolder)) {
    fs.mkdirSync(projectFolder, { recursive: true });
  }
  const filePath = path.join(projectFolder, 'project.json');
  fs.writeFileSync(filePath, JSON.stringify(projectData, null, 2), 'utf8');
}

// API: Start generation session & auto-launch Chrome
app.post('/api/generate', (req, res) => {
  try {
    const rawPrompts = req.body.prompts;
    const projectName = (req.body.projectName || 'Project_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Date.now().toString().slice(-4)).trim();
    let promptList = [];

    if (Array.isArray(rawPrompts)) {
      promptList = rawPrompts.map((p) => String(p).trim()).filter(Boolean);
    } else if (typeof rawPrompts === 'string') {
      promptList = rawPrompts
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean);
    }

    if (promptList.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one prompt.' });
    }

    const speedMode = req.body.speedMode || 'fast';
    const imageQuality = req.body.imageQuality || 'standard';
    const workerCount = Math.min(Math.max(parseInt(req.body.workerCount, 10) || 7, 1), 7);
    const runId = `run_${Date.now()}`;
    const plainText = promptList.join('\n');

    // ── Full state reset — start completely fresh every time ──────────────
    activeRun = freshRun();
    activeRun.runId = runId;
    activeRun.projectId = projectName;
    activeRun.prompts = promptList;
    activeRun.plainText = plainText;
    activeRun.count = promptList.length;
    activeRun.speedMode = speedMode;
    activeRun.imageQuality = imageQuality;
    activeRun.workerCount = workerCount;
    activeRun.workerStatus = {};
    activeRun.startTime = Date.now();
    activeRun.status = 'launched';
    activeRun.chromeLaunched = true;
    activeRun.lastLaunchTime = new Date().toLocaleTimeString();

    // Clear logs for fresh session
    recentLogs.length = 0;

    // Invalidate image cache for fresh run
    imagesCache.timestamp = 0;

    // Save Shared Project State to disk
    const projectRecord = {
      projectId: projectName,
      runId,
      status: 'generating',
      totalScenes: promptList.length,
      workerCount,
      speedMode,
      imageQuality,
      createdAt: new Date().toISOString(),
      scenes: promptList.map((p, idx) => ({
        id: idx + 1,
        prompt: p,
        status: 'pending',
        image: null,
      })),
    };
    saveProject(projectName, projectRecord);

    addLog('Studio', `🚀 Project "${projectName}" started — ${promptList.length} prompts | ${workerCount} Chrome Workers | Speed: ${speedMode} | Quality: ${imageQuality}`, 'success');
    console.log(`[Server] Project "${projectName}" started with ${promptList.length} prompts across ${workerCount} Chrome workers [Speed: ${speedMode}, Quality: ${imageQuality}].`);

    activeRun.status = 'generating';
    activeRun.progressText = 'Starting Google Flow Chrome workers...';

    // Start batch generation via Google Flow direct multi-worker engine
    runPlaywrightBatch({
      projectId: projectName,
      prompts: promptList,
      workerCount,
      onProgress: (p) => {
        if (p.screenshotUrl && p.sceneIndex) {
          activeRun.sceneScreenshots[p.sceneIndex] = p.screenshotUrl;
        }
        if (p.workerId) {
          activeRun.workerStatus = activeRun.workerStatus || {};
          activeRun.workerStatus[p.workerId] = {
            workerId: p.workerId,
            sceneIndex: p.sceneIndex,
            localIndex: p.localIndex,
            workerScenes: p.workerScenes,
            totalScenes: p.totalScenes,
            status: p.status,
            prompt: p.prompt,
            message: p.message,
            updatedAt: new Date().toLocaleTimeString()
          };
        }
        if (p.message) addLog('FlowEngine', p.message, 'info', p.screenshotUrl || null);
        if (p.sceneIndex) {
          activeRun.progressText = `Scene ${p.sceneIndex}/${p.totalScenes} [W#${p.workerId || 1}]`;
        }
      },
      onImageGenerated: (img) => {
        if (img.chromeScreenshotUrl && img.sceneIndex) {
          activeRun.sceneScreenshots[img.sceneIndex] = img.chromeScreenshotUrl;
        }
        if (img.workerId && activeRun.workerStatus?.[img.workerId]) {
          activeRun.workerStatus[img.workerId].lastImage = img.filename;
        }
        addLog('FlowEngine', `✅ Generated Scene ${img.sceneIndex} [Worker #${img.workerId || 1}]: ${img.filename}`, 'success', img.chromeScreenshotUrl || null);
        imagesCache.timestamp = 0; // Invalidate cache immediately so UI updates
      },
      onComplete: (res) => {
        if (res && res.totalGenerated >= promptList.length) {
          addLog('Studio', `🎉 All ${res.totalGenerated} scenes generated successfully across workers!`, 'success');
          activeRun.status = 'completed';
          activeRun.progressText = 'Done!';
        } else {
          const genCount = res?.totalGenerated || 0;
          addLog('Studio', `⚠️ Batch ended with ${genCount}/${promptList.length} scenes generated.`, 'warn');
          activeRun.status = genCount >= promptList.length ? 'completed' : 'generating';
          activeRun.progressText = `${genCount}/${promptList.length} scenes finished`;
        }
        imagesCache.timestamp = 0;
      },
      onError: (err) => {
        addLog('Studio', `❌ Generation error: ${err.message}`, 'error');
        activeRun.status = 'error';
        activeRun.error = err.message;
      }
    }).catch((err) => {
      console.error('[Server] runPlaywrightBatch error:', err);
    });

    return res.json({
      success: true,
      message: `Project "${projectName}" started with ${promptList.length} prompts across ${workerCount} Chrome workers...`,
      runId,
      projectId: projectName,
      count: promptList.length,
      workerCount,
      speedMode,
      imageQuality,
    });
  } catch (err) {
    addLog('Studio', `Error starting project: ${err.message}`, 'error');
    console.error('[Server] /api/generate error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// API: Get status of all 7 Chrome worker profiles
app.get('/api/profiles/status', (req, res) => {
  try {
    const profiles = typeof getProfilesStatus === 'function' ? getProfilesStatus() : [];
    return res.json({ success: true, profiles });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// API: Open specific Chrome worker for Google Account login
app.post('/api/profiles/open', async (req, res) => {
  try {
    const workerId = Math.min(Math.max(parseInt(req.body.workerId, 10) || 1, 1), 7);
    addLog('Launcher', `Opening Chrome Worker #${workerId} for Google Account login...`, 'info');
    const result = await openWorkerForLogin(workerId);
    addLog('Launcher', `✅ Chrome Worker #${workerId} is open. Sign in to your Google Account!`, 'success');
    return res.json(result);
  } catch (err) {
    addLog('Launcher', `❌ Error launching Chrome Worker #${req.body.workerId}: ${err.message}`, 'error');
    return res.status(500).json({ error: err.message });
  }
});

// API: Full Studio Reset (Restores initial state like first launch, preserves Chrome login)
app.post('/api/reset-app', async (req, res) => {
  try {
    console.log('[Server] 🔄 Full Studio Reset requested...');
    // 1. Stop any active running batch generation
    stopJob();

    // 2. Reset active run and logs in memory
    activeRun = freshRun();
    recentLogs.length = 0;
    imagesCache.timestamp = 0;

    addLog('Studio', '🔄 Studio reset to initial clean state (Chrome login preserved).', 'success');

    // 3. Reset Google Flow cache & canvas in Chrome (non-blocking)
    resetFlowSiteDataAndSession().catch((err) => {
      console.log('[Server] Flow session reset note:', err.message);
    });

    return res.json({
      success: true,
      message: 'Flow Auto Studio reset successfully to clean initial state. Chrome login preserved.',
    });
  } catch (err) {
    console.error('[Server] /api/reset-app error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// API: 1-Click Fix for Google Flow "Unusual Activity" (Clear Site Data + Fresh Project)
app.post('/api/fix-unusual-activity', async (req, res) => {
  try {
    addLog('FlowEngine', '🧹 User requested Flow Site Data & Session Reset...', 'info');
    const result = await resetFlowSiteDataAndSession();
    addLog('FlowEngine', '✅ Google Flow site data cleared & fresh project canvas ready!', 'success');
    return res.json({ success: true, message: 'Google Flow site data reset & fresh project ready.' });
  } catch (err) {
    addLog('FlowEngine', `❌ Failed to reset Flow data: ${err.message}`, 'error');
    return res.status(500).json({ error: err.message });
  }
});

// API: Endpoint queried by turboflow_bridge.js in the extension
app.get('/api/extension/turboflow-prompts', (req, res) => {
  if (!activeRun.runId || activeRun.count === 0) {
    return res.status(404).json({
      error: 'No active generation run found. Please queue prompts from the desktop app first.',
      count: 0,
      plainText: '',
    });
  }

  // Only set syncing status once (not on every background.js 1s poll)
  if (activeRun.status === 'launched') {
    activeRun.status = 'syncing';
    addLog('Extension', `Prompts transferred to Google Flow (${activeRun.count} scenes, Speed: ${activeRun.speedMode || 'fast'}, Quality: ${activeRun.imageQuality || 'standard'})`, 'success');
  }

  res.json({
    runId: activeRun.runId,
    projectId: activeRun.projectId,
    count: activeRun.count,
    prompts: activeRun.prompts || [],
    plainText: activeRun.plainText,
    speedMode: activeRun.speedMode || 'fast',
    imageQuality: activeRun.imageQuality || 'standard',
    topic: activeRun.projectId,
    isRetry: false,
  });
});

// API: Endpoint queried by turboflow_bridge.js for completion check
app.get('/api/extension/turboflow-status', (req, res) => {
  const dir = getTurboFlowDir();
  let freshCount = 0;

  if (fs.existsSync(dir)) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (/\.(png|jpe?g|webp)$/i.test(f)) {
          const stat = fs.statSync(path.join(dir, f));
          if (stat.mtimeMs >= activeRun.startTime) {
            freshCount++;
          }
        }
      }
    } catch (e) {}
  }

  const isComplete = activeRun.count > 0 && freshCount >= activeRun.count;
  if (isComplete) {
    activeRun.status = 'completed';
  }

  res.json({
    isComplete,
    importedCount: freshCount,
    totalNeeded: activeRun.count || 0,
  });
});

// API: Save image directly from in-page image URL to Downloads/turboflow
app.post('/api/save-image-url', async (req, res) => {
  const { url, filename, projectName } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  const dir = getTurboFlowDir();
  const safeProjectName = (projectName || activeRun.projectId || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
  const baseName = filename ? path.basename(filename) : `${safeProjectName}_scene_${Date.now().toString().slice(-4)}.png`;
  const destPath = path.join(dir, baseName);

  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuf = await response.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuf));
    console.log(`[Server] Successfully saved image to disk via URL: ${baseName} (${arrayBuf.byteLength} bytes)`);
    addLog('Storage', `✅ Saved image: ${baseName}`, 'success');
    imagesCache.timestamp = 0;
    syncProjectImages(safeProjectName, activeRun.startTime, false);
    res.json({ ok: true, filename: baseName });
  } catch (err) {
    console.error('[Server] save-image-url error:', err.message);
    addLog('Storage', `Image download error: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

// API: Save image directly from raw base64 data to Downloads/turboflow
app.post('/api/save-image-base64', (req, res) => {
  const { base64, filename, projectName } = req.body;
  if (!base64) return res.status(400).json({ error: 'No base64 data provided' });

  const dir = getTurboFlowDir();
  const safeFilename = filename ? path.basename(filename) : `img_${Date.now()}.png`;
  const destPath = path.join(dir, safeFilename);

  try {
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(destPath, buffer);
    console.log(`[Server] Saved image directly from base64: ${safeFilename} (${buffer.length} bytes)`);
    addLog('Storage', `✅ Saved image: ${safeFilename}`, 'success');
    imagesCache.timestamp = 0; // Invalidate cache immediately
    const safeProjectName = projectName || activeRun.projectId || 'Project';
    syncProjectImages(safeProjectName, activeRun.startTime, false);
    res.json({ ok: true, filename: safeFilename });
  } catch (err) {
    console.error('[Server] save-image-base64 error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Extension telemetry and page logs (handles both background.js and bridge.js formats)
app.post('/api/extension/flow-log', (req, res) => {
  const body = req.body || {};
  // background.js sends: { source, msg, data, time }
  // bridge.js sends: { type:'FROM_BACKGROUND', subType, message, logType, runId, ... }
  const source = body.source || (body.subType ? `mx[${body.subType}]` : 'Extension');
  const rawMsg = body.msg || body.message || body.subType || '';
  const data = body.data || (body.stats ? body.stats : null);
  const text = `${rawMsg}${data ? ' ' + (typeof data === 'object' ? JSON.stringify(data) : data) : ''}`.trim();
  if (text) {
    const isErr = text.includes('\u274c') || text.toLowerCase().includes('failed') || text.includes('FATAL') || body.logType === 'error';
    const isOk  = text.includes('\u2705') || text.includes('ready') || body.logType === 'success';
    addLog(source, text, isErr ? 'error' : (isOk ? 'success' : 'info'));
    console.log(`[Extension Log] [${source}] ${text}`);
  }
  res.json({ ok: true });
});

// API: Extension reports real-time batch progress (e.g. "3 / 5")
app.post('/api/extension/turboflow-progress', (req, res) => {
  const { runId, progressText } = req.body;
  if (progressText) {
    activeRun.progressText = progressText;
    activeRun.status = 'generating';
    addLog('Google Flow', progressText, 'info');
    console.log(`[Bridge Progress] Run ${runId || activeRun.runId}: ${progressText}`);
  }
  res.json({ success: true });
});

// API: Extension reports 100% batch completion signal
app.post('/api/extension/turboflow-complete', (req, res) => {
  const { runId, status, reason } = req.body;
  activeRun.status = 'completed';
  addLog('TurboFlow', `🎉 Batch completed for run ${runId || activeRun.runId}! (${reason || 'All scenes finished'})`, 'success');
  console.log(`[Bridge Signal] 🎉 TURBOFLOW EXTENSION SIGNAL: Batch completed for run ${runId || activeRun.runId}! (Reason: ${reason || 'Done'})`);

  // Scan and map images to project scenes
  syncProjectImages(activeRun.projectId, activeRun.startTime, true);

  res.json({ success: true, message: 'Completion signal recorded in Electron engine' });
});

// Helper to map downloaded images into project.json scenes
function syncProjectImages(projectId, startTime, markComplete = false) {
  if (!projectId) return;
  const projectFile = path.join(PROJECTS_DIR, projectId, 'project.json');
  if (!fs.existsSync(projectFile)) return;

  try {
    const pData = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    if (markComplete) {
      pData.status = 'completed';
      pData.completedAt = new Date().toISOString();
    }

    const dir = getTurboFlowDir();
    const freshImages = [];
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const threshold = (startTime || 0) > 0 ? (startTime - 5000) : 0;
      for (const f of files) {
        if (/\.(png|jpe?g|webp)$/i.test(f)) {
          const filePath = path.join(dir, f);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs >= threshold) {
            freshImages.push({
              filename: f,
              mtime: stat.mtimeMs,
              size: stat.size,
              url: `/api/images/${encodeURIComponent(f)}`,
            });
          }
        }
      }
    }

    freshImages.sort((a, b) => a.mtime - b.mtime);

    if (Array.isArray(pData.scenes)) {
      pData.scenes.forEach((sc, idx) => {
        if (freshImages[idx]) {
          sc.status = 'completed';
          sc.image = freshImages[idx].filename;
          sc.imageUrl = freshImages[idx].url;
        }
      });
    }
    pData.generatedImagesCount = freshImages.length;

    fs.writeFileSync(projectFile, JSON.stringify(pData, null, 2), 'utf8');
    if (markComplete) {
      console.log(`[Server] Project "${projectId}" project.json saved with ${freshImages.length} images mapped.`);
    }
  } catch (e) {
    console.warn('[Server] Error syncing project.json:', e.message);
  }
}

// API: Overall status for frontend live dashboard (Ultra-fast cached lookup)
app.get('/api/status', (req, res) => {
  const dir = getTurboFlowDir();
  const threshold = (activeRun.startTime || 0) > 0 ? (activeRun.startTime - 5000) : 0;

  // Blazing fast in-memory cached image retrieval (< 1ms)
  const allImages = getCachedImages();
  const images = allImages.map((img) => ({
    ...img,
    isCurrentRun: activeRun.startTime > 0 && img.mtime >= threshold,
  }));

  const currentRunImages = images.filter((img) => img.isCurrentRun);

  // Auto-sync project scenes with fresh images
  if (activeRun.projectId && currentRunImages.length > 0) {
    const isDone = activeRun.count > 0 && currentRunImages.length >= activeRun.count;
    if (isDone && activeRun.status !== 'completed') {
      activeRun.status = 'completed';
      syncProjectImages(activeRun.projectId, activeRun.startTime, true);
    } else {
      syncProjectImages(activeRun.projectId, activeRun.startTime, false);
    }
  }

  // Read current project scenes for scene-by-scene frontend tracker
  let projectScenes = [];
  if (activeRun.projectId) {
    const projectFile = path.join(PROJECTS_DIR, activeRun.projectId, 'project.json');
    if (fs.existsSync(projectFile)) {
      try {
        const p = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
        projectScenes = p.scenes || [];
      } catch (e) {}
    }
  }

  // Fallback scenes if project.json not loaded yet
  if (projectScenes.length === 0 && Array.isArray(activeRun.prompts) && activeRun.prompts.length > 0) {
    projectScenes = activeRun.prompts.map((p, idx) => ({
      id: idx + 1,
      prompt: p,
      status: idx < currentRunImages.length ? 'completed' : (activeRun.status === 'generating' ? 'generating' : 'pending'),
      image: currentRunImages[idx]?.filename || null,
      imageUrl: currentRunImages[idx]?.url || null,
      chromeScreenshotUrl: activeRun.sceneScreenshots?.[idx + 1] || null,
    }));
  }

  // Attach real-time chrome screenshots to all scenes
  if (projectScenes.length > 0 && activeRun.sceneScreenshots) {
    projectScenes = projectScenes.map((sc, idx) => ({
      ...sc,
      chromeScreenshotUrl: sc.chromeScreenshotUrl || activeRun.sceneScreenshots[sc.id || (idx + 1)] || null,
    }));
  }

  res.json({
    activeRun,
    downloadsDir: dir,
    totalGeneratedInFolder: images.length,
    currentRunCount: currentRunImages.length,
    totalNeeded: activeRun.count || 0,
    images: images.slice(0, 36),
    scenes: projectScenes,
    logs: recentLogs.slice(-80),
    debug: {
      ...(typeof getDebugState === 'function' ? getDebugState() : {}),
      error: activeRun.error || null,
    },
  });
});

// API: Live debug telemetry and canvas screenshot details
app.get('/api/debug/state', (req, res) => {
  const debugState = typeof getDebugState === 'function' ? getDebugState() : {};
  res.json({
    ...debugState,
    error: activeRun.error || debugState.lastError || null,
    activeRunStatus: activeRun.status,
  });
});

// API: Force capture fresh browser canvas screenshot
app.post('/api/debug/force-capture', async (req, res) => {
  try {
    if (typeof forceCaptureScreenshot === 'function') {
      const state = await forceCaptureScreenshot();
      return res.json({ success: true, debug: state });
    }
    res.json({ success: false, message: 'forceCaptureScreenshot unavailable' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Bring active Chrome window to front & focus
app.post('/api/focus-chrome', async (req, res) => {
  try {
    if (typeof ensureBrowserOpen === 'function') {
      await ensureBrowserOpen();
    } else if (typeof bringChromeToFront === 'function') {
      bringChromeToFront();
    }
    res.json({ success: true, message: 'Chrome window focused or launched' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Continuous Real-Time Live Frame (in-memory buffer, zero disk I/O, ultra-low latency)
app.get('/api/debug/live-frame.jpg', async (req, res) => {
  res.set({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  try {
    if (typeof getLiveFrameBuffer === 'function') {
      const buf = await getLiveFrameBuffer();
      if (buf && buf.length > 0) {
        return res.send(buf);
      }
    }
  } catch (err) {}

  const fallback = path.join(__dirname, 'public', 'debug', 'latest_canvas.jpg');
  if (fs.existsSync(fallback)) {
    return res.sendFile(fallback);
  }
  const placeholder = path.join(__dirname, 'public', 'debug', 'placeholder.svg');
  if (fs.existsSync(placeholder)) {
    res.set('Content-Type', 'image/svg+xml');
    return res.sendFile(placeholder);
  }
  res.status(204).end();
});

// API: Continuous Native MJPEG Video Stream (Motion JPEG for direct live video playback)
app.get('/api/debug/stream.mjpg', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=liveframe',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'close',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  let isStreaming = true;
  req.on('close', () => { isStreaming = false; });

  const streamNext = async () => {
    if (!isStreaming) return;
    try {
      if (typeof getLiveFrameBuffer === 'function') {
        const buf = await getLiveFrameBuffer();
        if (buf && isStreaming) {
          res.write(`--liveframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
          res.write(buf);
          res.write('\r\n');
        }
      }
    } catch (e) {}
    if (isStreaming) {
      setTimeout(streamNext, 450);
    }
  };

  streamNext();
});

// API: Dismiss / clear active error
app.post('/api/debug/clear-error', (req, res) => {
  activeRun.error = null;
  if (typeof getDebugState === 'function') {
    const state = getDebugState();
    if (state) state.lastError = null;
  }
  addLog('Debug', 'Error dismissed by user', 'info');
  res.json({ success: true });
});

// API: Serve generated image file
app.get('/api/images/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(getTurboFlowDir(), filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Image not found');
  }

  res.sendFile(filePath);
});

// API: Open Windows Explorer in downloads folder
app.post('/api/open-downloads', (req, res) => {
  const dir = getTurboFlowDir();
  if (process.platform === 'win32') {
    exec(`start "" explorer "${dir}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, path: dir });
    });
  } else {
    exec(`open "${dir}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, path: dir });
    });
  }
});

// API: Manual trigger to re-launch Chrome
app.post('/api/relaunch-chrome', async (req, res) => {
  try {
    if (typeof ensureBrowserOpen === 'function') {
      await ensureBrowserOpen();
    } else if (typeof launchChrome === 'function') {
      launchChrome();
    }
    res.json({ success: true, message: 'Chrome launched' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Sync extension files and instruct the user to reload in Chrome
app.post('/api/reload-extension', (req, res) => {
  try {
    const cleanExtDir = getCleanExtensionDir();
    addLog('Extension', '🔄 Extension files re-synced to ' + cleanExtDir, 'info');
    res.json({
      success: true,
      message: 'Extension files synced. Open chrome://extensions and click the reload (↺) icon next to TurboFlow.',
      extDir: cleanExtDir,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Kill Chrome processes (used when closing the app)
app.post('/api/kill-chrome', (req, res) => {
  addLog('Launcher', '🛑 Closing Chrome window...', 'info');
  stopJob();
  killChromeProcesses(() => {
    addLog('Launcher', '✅ Chrome closed successfully.', 'success');
    res.json({ success: true, message: 'Chrome processes killed' });
  });
});

// API: Manually save current Chrome session (cookies) to backup
app.post('/api/save-session', (req, res) => {
  const profileDir = getDedicatedProfileDir();
  const defaultDir = path.join(profileDir, 'Default');
  if (!fs.existsSync(defaultDir)) {
    return res.status(400).json({ error: 'No Chrome profile found. Launch Chrome and log in first.' });
  }
  const backupDir = backupSessionFiles(defaultDir);
  const saved = [...CHROME_KEEP_FILES].filter(f => fs.existsSync(path.join(backupDir, f)));
  addLog('Session', `💾 Session saved (${saved.length} files). Login preserved for next launch.`, 'success');
  res.json({ success: true, savedFiles: saved, backupDir });
});

// API: Check session status (are cookies saved?)
app.get('/api/session-status', (req, res) => {
  const backupDir = getCookieBackupDir();
  const profileDir = getDedicatedProfileDir();
  const defaultDir = path.join(profileDir, 'Default');

  const hasCookies = fs.existsSync(path.join(backupDir, 'Cookies')) ||
                     fs.existsSync(path.join(backupDir, 'Network', 'Cookies')) ||
                     fs.existsSync(path.join(defaultDir, 'Network', 'Cookies')) ||
                     fs.existsSync(path.join(defaultDir, 'Cookies'));
  const hasLoginData = fs.existsSync(path.join(backupDir, 'Login Data')) ||
                       fs.existsSync(path.join(defaultDir, 'Login Data'));

  res.json({
    sessionSaved: hasCookies,
    hasCookies,
    hasLoginData,
    backupDir,
    message: hasCookies
      ? '✅ Google login session saved. Chrome will auto-login next launch.'
      : '⚠️ No session saved yet. Log in to Google Flow once, then click "Save Session".',
  });
});


// API: Clear current queue & reset session state completely
app.post('/api/clear-queue', (req, res) => {
  stopJob();
  activeRun = freshRun();
  recentLogs.length = 0;
  imagesCache.timestamp = 0;
  addLog('Studio', '🧹 Session reset from zero. All state, logs, and queue cleared.', 'info');
  console.log('[Server] Session cleared and reset to fresh idle state.');
  res.json({ success: true, message: 'Queue cleared and session reset' });
});

function startServer(port = PORT) {
  // Synchronize clean extension files to ~/.turboflow-extension
  const cleanExtDir = getCleanExtensionDir();
  console.log(`[Server] Clean Extension synchronized to: ${cleanExtDir}`);

  const server = app.listen(port, () => {
    console.log(`====================================================`);
    console.log(`🚀 Electron Automation Engine active on port ${port}`);
    console.log(`👉 Web Interface:  http://localhost:${port}`);
    console.log(`👉 Extension Sync: http://localhost:${port}/api/extension/turboflow-prompts`);
    console.log(`👉 Output Images:  ${getTurboFlowDir()}`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${port} is already active. Connected to existing engine instance.`);
    } else {
      console.error('[Server] Server error:', err);
    }
  });

  return server;
}

// If run directly via "node server.js"
if (require.main === module) {
  startServer(PORT);
}

module.exports = {
  app,
  startServer,
  launchChrome,
  getTurboFlowDir,
};
