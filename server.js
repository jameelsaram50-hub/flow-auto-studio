const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn, spawnSync, execSync } = require('child_process');
const express = require('express');
const cors = require('cors');
const {
  runPlaywrightBatch,
  stopJob,
  getDebugState,
  forceCaptureScreenshot,
  getLiveFrameBuffer,
  bringChromeToFront,
  hideChromeWindow,
  ensureBrowserOpen,
  resetFlowSiteDataAndSession,
  openWorkerForLogin,
  getProfilesStatus,
  getProfileDir
} = require('./playwright_worker.js');

const {
  runChatGPTPipelineBatch,
  executeChatGPTTask,
  stopChatGPTJob,
  getWorker: getChatGPTWorker,
  getChatGPTLiveFrameBuffer,
  bringChatGPTWorkerToFront,
  hideChatGPTWorker,
  openChatGPTWorker,
  getChatGPTWorkersTelemetry
} = require('./chatgpt_worker.js');

const app = express();
const PORT = Number(process.env.FREE_IMAGE_PORT) || 3001;

function getDedicatedProfileDir() {
  return getProfileDir(1);
}

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

app.get('/minimal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'minimal.html'));
});

const PROJECTS_DIR = path.join(__dirname, 'data', 'projects');

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// Easy AI Hub default download directory
function getEasyAiHubDir() {
  const dir = path.join(os.homedir(), 'Downloads', 'easyaihub');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return dir;
}

// All valid image directories (primary: Downloads/easyaihub)
function getImageDirs() {
  const primary = getEasyAiHubDir();
  const dirs = [primary];
  const legacyDirs = [
    path.join(os.homedir(), 'Downloads', 'easyaiflow')
  ];
  for (const leg of legacyDirs) {
    if (fs.existsSync(leg) && leg.toLowerCase() !== primary.toLowerCase()) {
      dirs.push(leg);
    }
  }
  return dirs;
}

// Locate an image across all valid image directories
function findImageFile(filename) {
  if (!filename) return null;
  const base = path.basename(filename);
  for (const dir of getImageDirs()) {
    const candidate = path.join(dir, base);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: handle URL-encoded filenames
  try {
    const decoded = path.basename(decodeURIComponent(filename));
    if (decoded !== base) {
      for (const dir of getImageDirs()) {
        const candidate = path.join(dir, decoded);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch (e) {}

  // Fallback: check Downloads root directly if file landed outside subfolder
  const downloadsRoot = path.join(os.homedir(), 'Downloads', base);
  if (fs.existsSync(downloadsRoot)) {
    try {
      if (fs.statSync(downloadsRoot).isFile()) return downloadsRoot;
    } catch (e) {}
  }

  return null;
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
    generationMode: 'playwright',
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

// "Reset App" starts a fresh session: the gallery only lists images created
// after this moment (older images stay on disk in Downloads/easyaihub).
let gallerySince = 0;

function getCachedImages() {
  const now = Date.now();
  const dirs = getImageDirs();
  const cacheKey = `${dirs.join('|')}|${gallerySince}`;
  // 1000ms cache TTL for fast responses
  if (imagesCache.dir === cacheKey && (now - imagesCache.timestamp) < 1000) {
    return imagesCache.images;
  }

  const imagesMap = new Map();
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (/\.(png|jpe?g|webp)$/i.test(f) && !imagesMap.has(f)) {
            const filePath = path.join(dir, f);
            const stat = fs.statSync(filePath);
            imagesMap.set(f, {
              filename: f,
              url: `/api/images/${encodeURIComponent(f)}`,
              size: stat.size,
              mtime: stat.mtimeMs,
            });
          }
        }
      } catch (e) {
        console.warn('[Server] Error reading images from', dir, e.message);
      }
    }
  }

  const images = Array.from(imagesMap.values()).filter((img) => img.mtime >= gallerySince);
  images.sort((a, b) => b.mtime - a.mtime);
  imagesCache = { timestamp: now, images, dir: cacheKey };
  return images;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chrome Profile Manager — clears junk data before each launch but KEEPS login
// ─────────────────────────────────────────────────────────────────────────────

// These dirs under Default/ are wiped before each Chrome launch.
// Clearing them removes stale state that causes Google detection / stuck issues.
// NOTE: Do NOT clear 'Local Extension Settings' or 'Extension State' —
//       these contain Easy AI Hub auth tokens and extension storage data.
// These dirs under Default/ are wiped before each Chrome launch to prevent memory leaks and cache bloat.
// NOTE: We do NOT clear Local Storage, IndexedDB, Network, or Extension directories,
// so Google Flow login and Easy AI Hub settings are 100% preserved.
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
  const d = path.join(os.homedir(), '.easyaihub-session-backup');
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

  // Backup Local Extension Settings for Easy AI Hub
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

  // Restore Local Extension Settings for Easy AI Hub
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
  const baseDirName = path.basename(getDedicatedProfileDir());
  const checkCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*${baseDirName}\\"*' -or $_.CommandLine -like '*${baseDirName} *' -or $_.CommandLine -like '*${baseDirName}/' -or $_.CommandLine -like '*${baseDirName}\\\\*' -or $_.CommandLine.Trim().EndsWith('${baseDirName}')) } | ForEach-Object { $_.ProcessId }"`;
  exec(checkCmd, (err, stdout) => {
    const pids = (stdout || '').trim().split(/\s+/).filter(Boolean);
    if (pids.length > 0) {
      console.log('[Launcher] Terminating stale Easy AI Hub chrome processes:', pids);
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

// Auto launch Chrome depending on selected mode
function launchChrome(mode = 'playwright') {
  if (typeof ensureBrowserOpen === 'function') {
    ensureBrowserOpen().catch((err) => {
      console.error('[Launcher] ensureBrowserOpen error:', err);
    });
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline integration: the Easy AI Hub pipeline sends its scene
// prompts here and gets each image written straight into its job folder.
// ─────────────────────────────────────────────────────────────────────────────

function getPipelineJobsDir() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const easyAiHubJobs = path.join(roaming, 'easy-ai-hub', 'jobs');
  const svcJobs = path.join(roaming, 'script-video-creator', 'jobs');
  if (fs.existsSync(easyAiHubJobs)) return easyAiHubJobs;
  if (fs.existsSync(svcJobs)) return svcJobs;
  return easyAiHubJobs;
}
const PIPELINE_JOBS_DIR = getPipelineJobsDir();

// Only files inside the pipeline jobs folder may be written by /api/pipeline/*
function isInsidePipelineJobs(filePath) {
  const resolved = path.resolve(filePath);
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const allowedRoots = [
    path.join(roaming, 'easy-ai-hub', 'jobs'),
    path.join(roaming, 'script-video-creator', 'jobs')
  ];
  return allowedRoots.some(root => {
    const rel = path.relative(root, resolved);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

// Copies a finished scene image to the pipeline job path it was requested for
function deliverPipelineImage(img) {
  const target = activeRun.targets?.[img.sceneIndex - 1];
  if (!target || !img.localPath) return;
  try {
    fs.mkdirSync(path.dirname(target.output_path), { recursive: true });
    fs.copyFileSync(img.localPath, target.output_path);
    activeRun.deliveredNos.push(target.no);
  } catch (e) {
    addLog('Pipeline', `⚠️ Could not copy scene ${img.sceneIndex} into the job folder: ${e.message}`, 'warn');
  }
}

/**
 * Starts a batch run. `targets` (optional) maps prompt i → { no, output_path }
 * so each image is also copied into a pipeline job folder.
 */
function startGenerationRun({ projectName, promptList, speedMode, imageQuality, workerCount, generationMode = 'playwright', launchBrowser = true, targets = null }) {
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
    activeRun.generationMode = generationMode;
    activeRun.workerStatus = {};
    activeRun.startTime = Date.now();
    activeRun.status = 'launched';
    activeRun.chromeLaunched = true;
    activeRun.lastLaunchTime = new Date().toLocaleTimeString();
    activeRun.targets = targets;
    activeRun.deliveredNos = [];
    activeRun.sceneFiles = {}; // sceneIndex -> saved filename
    activeRun.finished = false;

    // Clear logs for fresh session
    recentLogs.length = 0;

    // Invalidate image cache for fresh run
    imagesCache.timestamp = 0;

    // Save Shared Project State to disk
    const projectRecord = {
      projectId: projectName,
      runId,
      status: 'generating',
      generationMode,
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

    // Direct Engine (Playwright Multi-Worker Automation)
    addLog('Studio', `🚀 Project "${projectName}" started — ${promptList.length} prompts | ${workerCount} Channels | Speed: ${speedMode} | Quality: ${imageQuality}`, 'success');
    console.log(`[Server] Project "${projectName}" started with ${promptList.length} prompts across ${workerCount} Chrome workers [Speed: ${speedMode}, Quality: ${imageQuality}].`);

    activeRun.status = 'generating';
    activeRun.progressText = 'Starting image generator channels...';

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
        if (img.sceneIndex) activeRun.sceneFiles[img.sceneIndex] = img.filename;
        deliverPipelineImage(img);
        imagesCache.timestamp = 0; // Invalidate cache immediately so UI updates
      },
      onComplete: (res) => {
        if (res && res.totalGenerated >= promptList.length) {
          addLog('Studio', `🎉 All ${res.totalGenerated} scenes generated successfully across workers!`, 'success');
          activeRun.status = 'completed';
          activeRun.progressText = 'Done!';
        } else {
          const genCount = res?.totalGenerated || 0;
          activeRun.status = genCount >= promptList.length ? 'completed' : (genCount > 0 ? 'completed' : 'error');
          activeRun.progressText = `${genCount}/${promptList.length} scenes finished`;
        }
        activeRun.finished = true;
        imagesCache.timestamp = 0;
      },
      onError: (err) => {
        addLog('Studio', `❌ Generation error: ${err.message}`, 'error');
        activeRun.status = 'error';
        activeRun.error = err.message;
        activeRun.finished = true;
      }
    }).catch((err) => {
      console.error('[Server] runPlaywrightBatch error:', err);
      activeRun.status = 'error';
      activeRun.error = err.message;
      activeRun.finished = true;
    });

    return {
      success: true,
      message: `Project "${projectName}" started with ${promptList.length} prompts across ${workerCount} channels...`,
      runId,
      projectId: projectName,
      count: promptList.length,
      workerCount,
      generationMode: 'playwright',
      speedMode,
      imageQuality,
    };
}

const isRunBusy = () =>
  !activeRun.finished && ['launched', 'syncing', 'generating'].includes(activeRun.status) && activeRun.runId !== null;

// API: Start generation session & auto-launch Chrome
app.post('/api/generate', (req, res) => {
  try {
    const rawPrompts = req.body.prompts;
    const projectName = (req.body.projectName || 'Project_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Date.now().toString().slice(-4)).trim();
    const generationMode = 'playwright';
    const launchBrowser = req.body.launchBrowser !== false;
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

    return res.json(
      startGenerationRun({
        projectName,
        promptList,
        generationMode,
        launchBrowser,
        speedMode: req.body.speedMode || 'fast',
        imageQuality: req.body.imageQuality || 'standard',
        workerCount: Math.min(Math.max(parseInt(req.body.workerCount, 10) || 1, 1), 7),
      })
    );
  } catch (err) {
    addLog('Studio', `Error starting project: ${err.message}`, 'error');
    console.error('[Server] /api/generate error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// API: Generate images for a pipeline job.
// Body: { projectName, items: [{ no, prompt, output_path }], workerCount?, speedMode?, imageQuality?, generationMode? }
app.post('/api/pipeline/generate', (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const generationMode = 'playwright';
    const clean = [];
    for (const item of items) {
      const prompt = String(item?.prompt || '').trim();
      const outputPath = String(item?.output_path || '');
      if (!prompt || !outputPath) continue;
      if (!isInsidePipelineJobs(outputPath)) {
        return res.status(400).json({ error: `Output path is outside the pipeline jobs folder: ${outputPath}` });
      }
      clean.push({ no: Number(item.no) || clean.length + 1, prompt, output_path: path.resolve(outputPath) });
    }
    if (clean.length === 0) {
      return res.status(400).json({ error: 'No prompts to generate.' });
    }
    if (isRunBusy()) {
      return res.status(409).json({ error: 'Another image batch is still running in the Image Tool. Wait for it to finish.' });
    }

    const safeName = String(req.body.projectName || 'Pipeline').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const result = startGenerationRun({
      projectName: `${safeName}_${Date.now().toString().slice(-5)}`,
      promptList: clean.map((c) => c.prompt),
      generationMode,
      speedMode: req.body.speedMode || 'fast',
      imageQuality: req.body.imageQuality || 'standard',
      workerCount: Math.min(Math.max(parseInt(req.body.workerCount, 10) || 7, 1), 7),
      targets: clean.map((c) => ({ no: c.no, output_path: c.output_path })),
    });
    addLog('Pipeline', `📥 Pipeline job "${safeName}" requested ${clean.length} images via ${generationMode} mode.`, 'info');
    return res.json(result);
  } catch (err) {
    console.error('[Server] /api/pipeline/generate error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// API: Progress of a pipeline run (which scene numbers already reached the job folder)
app.get('/api/pipeline/status', (req, res) => {
  const runId = String(req.query.runId || '');
  if (!runId || runId !== activeRun.runId) {
    return res.status(404).json({ error: 'Run not found (the Image Tool may have been restarted).' });
  }
  res.json({
    runId,
    status: activeRun.status,
    finished: !!activeRun.finished,
    total: activeRun.targets ? activeRun.targets.length : activeRun.count,
    delivered: activeRun.deliveredNos || [],
    progressText: activeRun.progressText,
    error: activeRun.error || null,
  });
});

// API: Get status of all 7 Chrome worker profiles
app.get(['/api/profiles/status', '/api/profiles-status'], (req, res) => {
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
    addLog('Launcher', `Opening Channel #${workerId} for account sign-in...`, 'info');
    const result = await openWorkerForLogin(workerId);
    addLog('Launcher', `✅ Channel #${workerId} is open. Complete sign-in in the opened window.`, 'success');
    return res.json(result);
  } catch (err) {
    addLog('Launcher', `❌ Error launching Channel #${req.body.workerId}: ${err.message}`, 'error');
    return res.status(500).json({ error: err.message });
  }
});

// API: Full Studio Reset (Restores initial state like first launch, preserves Chrome login)
app.post('/api/reset-app', async (req, res) => {
  try {
    console.log('[Server] 🔄 Full Studio Reset requested...');
    // 1. Stop Playwright workers 1–7 (closes their Chrome windows; logins stay in the profiles)
    stopJob();

    // 2. Fresh run state and logs.
    activeRun = freshRun();
    recentLogs.length = 0;

    // 3. Gallery starts empty (images already made stay on disk)
    gallerySince = Date.now();
    imagesCache.timestamp = 0;

    // 4. Remove per-scene debug screenshots from the previous session
    for (const dir of [path.join(__dirname, 'public', 'debug', 'scenes'), path.join(__dirname, 'public', 'debug')]) {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (/\.(jpe?g|png)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
        }
      } catch (e) {}
    }

    addLog('Studio', '🔄 Fresh start: queue, logs, gallery and workers reset. Google logins kept.', 'success');

    return res.json({
      success: true,
      message: 'Studio reset to a fresh start. Google logins and saved image files are kept.',
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
    addLog('FlowEngine', '✅ Engine site data cleared & fresh canvas ready!', 'success');
    return res.json({ success: true, message: 'Engine site data reset & fresh canvas ready.' });
  } catch (err) {
    addLog('FlowEngine', `❌ Failed to reset Flow data: ${err.message}`, 'error');
    return res.status(500).json({ error: err.message });
  }
});


// API: Save image directly from in-page image URL to Downloads/easyaihub
app.post('/api/save-image-url', async (req, res) => {
  const { url, filename, projectName } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  const dir = getEasyAiHubDir();
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

// API: Save image directly from raw base64 data to Downloads/easyaihub
app.post('/api/save-image-base64', (req, res) => {
  const { base64, filename, projectName } = req.body;
  if (!base64) return res.status(400).json({ error: 'No base64 data provided' });

  const dir = getEasyAiHubDir();
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

    const freshImages = [];
    const dirs = getImageDirs();
    const threshold = (startTime || 0) > 0 ? (startTime - 5000) : 0;
    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
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
    }

    freshImages.sort((a, b) => a.mtime - b.mtime);

    // Workers run in parallel, so finish order is not scene order. Prefer the
    // scene index reported by the worker; fall back to time order only if unknown.
    const byScene = projectId === activeRun.projectId ? activeRun.sceneFiles || {} : {};
    const hasSceneMap = Object.keys(byScene).length > 0;

    if (Array.isArray(pData.scenes) && hasSceneMap) {
      pData.scenes.forEach((sc, idx) => {
        const filename = byScene[sc.id || idx + 1];
        if (filename) {
          sc.status = 'completed';
          sc.image = filename;
          sc.imageUrl = `/api/images/${encodeURIComponent(filename)}`;
        }
      });
    } else if (Array.isArray(pData.scenes)) {
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
  const dir = getEasyAiHubDir();
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
    // Deliver pipeline targets if targets exist
    if (activeRun.targets && Array.isArray(activeRun.targets)) {
      currentRunImages.forEach((img, idx) => {
        const sceneIndex = idx + 1;
        const target = activeRun.targets[idx];
        if (target && !activeRun.deliveredNos.includes(target.no)) {
          const realPath = findImageFile(img.filename) || path.join(dir, img.filename);
          deliverPipelineImage({
            sceneIndex,
            localPath: realPath,
            filename: img.filename,
          });
        }
      });
    }

    const isDone = activeRun.count > 0 && currentRunImages.length >= activeRun.count;
    if (isDone && activeRun.status !== 'completed') {
      activeRun.status = 'completed';
      activeRun.progressText = 'Done!';
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

// API: Bring active Chrome window to front & focus (works across both Flow & ChatGPT engines)
app.post(['/api/focus-chrome', '/api/chatgpt/worker/focus'], async (req, res) => {
  try {
    const workerId = parseInt(req.query.workerId || req.body?.workerId, 10) || 1;
    let handled = false;

    // 1. Try ChatGPT worker pool
    if (typeof bringChatGPTWorkerToFront === 'function') {
      const chatgptWorkers = typeof getChatGPTWorkersTelemetry === 'function' ? getChatGPTWorkersTelemetry() : [];
      const isOpen = chatgptWorkers.some(w => w.workerId === workerId && w.isOpen);
      if (isOpen) {
        await bringChatGPTWorkerToFront(workerId);
        handled = true;
      }
    }

    // 2. Try Playwright worker pool
    if (!handled && typeof bringChromeToFront === 'function') {
      const resP = await bringChromeToFront(workerId);
      if (resP && resP.success) {
        handled = true;
      }
    }

    // 3. If worker was not open in either pool, launch it through the app so it stays connected in backend!
    if (!handled) {
      if (typeof openChatGPTWorker === 'function') {
        await openChatGPTWorker(workerId);
        await bringChatGPTWorkerToFront(workerId);
        handled = true;
      } else if (typeof openWorkerForLogin === 'function') {
        await openWorkerForLogin(workerId);
        handled = true;
      }
    }

    res.json({ success: true, message: `Worker #${workerId} Chrome window brought to front and active in backend` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Hide Chrome window back to offscreen (Canvas only)
app.post(['/api/hide-chrome', '/api/chatgpt/worker/hide'], async (req, res) => {
  try {
    const workerId = parseInt(req.query.workerId || req.body?.workerId, 10) || 1;
    if (typeof hideChatGPTWorker === 'function') {
      await hideChatGPTWorker(workerId);
    }
    if (typeof hideChromeWindow === 'function') {
      await hideChromeWindow(workerId);
    }
    res.json({ success: true, message: `Chrome #${workerId} window hidden to canvas` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Continuous Real-Time Live Frame (in-memory buffer, zero disk I/O, ultra-low latency)
app.get(['/api/debug/live-frame.jpg', '/api/chatgpt/live-frame.jpg'], async (req, res) => {
  const workerId = parseInt(req.query.workerId || req.query.worker, 10) || 1;
  const source = req.query.source || (req.path.includes('/chatgpt/') ? 'chatgpt' : '');
  res.set({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  // 1. If explicit ChatGPT source or ChatGPT pipeline running, prioritize ChatGPT worker live frame
  if (source === 'chatgpt' || chatgptActivePipeline.status === 'running') {
    try {
      if (typeof getChatGPTLiveFrameBuffer === 'function') {
        const gptBuf = await getChatGPTLiveFrameBuffer(workerId);
        if (gptBuf && gptBuf.length > 0) {
          return res.send(gptBuf);
        }
      }
    } catch (e) {}
  }

  // 2. Playwright worker live frame (Flow/Google)
  try {
    if (typeof getLiveFrameBuffer === 'function') {
      const buf = await getLiveFrameBuffer(workerId);
      if (buf && buf.length > 0) {
        return res.send(buf);
      }
    }
  } catch (err) {}

  // 3. Fallback: check ChatGPT live frame buffer if Flow worker wasn't active
  try {
    if (typeof getChatGPTLiveFrameBuffer === 'function') {
      const gptBuf = await getChatGPTLiveFrameBuffer(workerId);
      if (gptBuf && gptBuf.length > 0) {
        return res.send(gptBuf);
      }
    }
  } catch (e) {}

  // Fallback to latest captured canvas (only if recently captured within 15s) or placeholder
  const fallback = path.join(__dirname, 'public', 'debug', 'latest_canvas.jpg');
  if (fs.existsSync(fallback)) {
    try {
      const stat = fs.statSync(fallback);
      if (Date.now() - stat.mtimeMs < 15000) {
        return res.sendFile(fallback);
      }
    } catch (e) {}
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
      let buf = null;
      const streamWorker = parseInt(req.query.workerId, 10) || 1;
      if (typeof getLiveFrameBuffer === 'function') {
        buf = await getLiveFrameBuffer(streamWorker);
      }
      if (buf && isStreaming) {
        res.write(`--liveframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
        res.write(buf);
        res.write('\r\n');
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

// API: List all generated images
app.get('/api/images', (req, res) => {
  res.json({ success: true, images: getCachedImages() });
});

// API: Serve generated image file (supports Downloads/easyaihub)
app.get('/api/images/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = findImageFile(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Image not found');
  }

  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).end();
    }
  });
});

// API: Open Windows Explorer in downloads folder
app.post('/api/open-downloads', (req, res) => {
  const dir = getEasyAiHubDir();
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
      launchChrome('playwright');
    }
    res.json({ success: true, message: `Chrome launched` });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      : '⚠️ No session saved yet. Log in once, then click "Save Session".',
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

// ─────────────────────────────────────────────────────────────────────────────
// ChatGPT Pipeline Endpoints
// ─────────────────────────────────────────────────────────────────────────────

let chatgptActivePipeline = {
    jobId: null,
    status: 'idle', // idle, running, completed, error
    results: {},
    error: null,
    progress: [] // stores progress events
};

app.post('/api/chatgpt/pipeline/start', (req, res) => {
    if (chatgptActivePipeline.status === 'running') {
        return res.status(409).json({ error: 'A ChatGPT pipeline is already running.' });
    }

    const { pipelineTasks } = req.body;
    if (!pipelineTasks || !Array.isArray(pipelineTasks) || pipelineTasks.length === 0) {
        return res.status(400).json({ error: 'pipelineTasks array is required.' });
    }

    chatgptActivePipeline = {
        jobId: `gpt_${Date.now()}`,
        status: 'running',
        results: {},
        error: null,
        progress: []
    };

    addLog('ChatGPT', `Started ChatGPT Pipeline with ${pipelineTasks.length} tasks`, 'info');

    runChatGPTPipelineBatch({
        pipelineTasks,
        onProgress: (p) => {
            chatgptActivePipeline.progress.push(p);
            // Keep progress array from growing indefinitely
            if (chatgptActivePipeline.progress.length > 500) {
                chatgptActivePipeline.progress.shift();
            }
        },
        onComplete: (result) => {
            chatgptActivePipeline.status = 'completed';
            chatgptActivePipeline.results = result.results;
            addLog('ChatGPT', `ChatGPT Pipeline Completed`, 'success');
        },
        onError: (err) => {
            chatgptActivePipeline.status = 'error';
            chatgptActivePipeline.error = err.message;
            addLog('ChatGPT', `ChatGPT Pipeline Error: ${err.message}`, 'error');
        }
    });

    res.json({ success: true, jobId: chatgptActivePipeline.jobId });
});

app.get('/api/chatgpt/pipeline/status', (req, res) => {
    const workers = typeof getChatGPTWorkersTelemetry === 'function' ? getChatGPTWorkersTelemetry() : [];
    res.json({
        success: true,
        ...chatgptActivePipeline,
        workers
    });
});

app.get('/api/chatgpt/workers/status', (req, res) => {
    const workers = typeof getChatGPTWorkersTelemetry === 'function' ? getChatGPTWorkersTelemetry() : [];
    res.json({ success: true, workers });
});

app.post(['/api/chatgpt/worker/open', '/api/open-worker'], async (req, res) => {
    try {
        const workerId = parseInt(req.query.workerId || req.body?.workerId, 10) || 1;
        if (typeof openChatGPTWorker === 'function') {
            await openChatGPTWorker(workerId);
        }
        if (typeof bringChatGPTWorkerToFront === 'function') {
            await bringChatGPTWorkerToFront(workerId);
        }
        addLog('ChatGPT', `Opened Chrome Worker #${workerId} (Visible & connected)`, 'info');
        res.json({ success: true, message: `ChatGPT Worker #${workerId} opened and focused` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Demo Pipeline generator and launcher
app.post('/api/chatgpt/pipeline/demo', (req, res) => {
    const preset = req.body.preset || 'standard';
    const isSimulated = req.body.simulate === true;

    let demoTasks = [];
    if (preset === 'parallel') {
        // 7 workers parallel batch
        demoTasks = [
            { id: 'topic', dependsOn: [], prompt: 'Suggest an epic documentary topic about forgotten ancient mega-cities with high viral intrigue.', workerId: 1 },
            { id: 'script', dependsOn: ['topic'], prompt: 'Write a gripping 60-second voiceover script for: {{topic}}', workerId: 1 },
            { id: 'scene_1', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 1 of: {{script}}', workerId: 2 },
            { id: 'scene_2', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 2 of: {{script}}', workerId: 3 },
            { id: 'scene_3', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 3 of: {{script}}', workerId: 4 },
            { id: 'scene_4', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 4 of: {{script}}', workerId: 5 },
            { id: 'scene_5', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 5 of: {{script}}', workerId: 6 },
            { id: 'video_dir', dependsOn: ['script'], prompt: 'Generate camera motion directives for all 5 scenes of: {{script}}', workerId: 7 }
        ];
    } else {
        // Standard 4-step pipeline
        demoTasks = [
            { id: 'topic', dependsOn: [], prompt: 'Generate a captivating historical video title and 3 core narrative angles about The Great Library of Alexandria.', workerId: 1 },
            { id: 'script', dependsOn: ['topic'], prompt: 'Write an immersive 90-second voiceover narration script based on:\n{{topic}}\nStructure with Intro Hook, Rising Mystery, Dramatic Turning Point, and Thought-Provoking Climax.', workerId: 1 },
            { id: 'image_prompts', dependsOn: ['script'], prompt: 'Based on this script:\n{{script}}\nCreate 5 ultra-detailed cinematic 16:9 Midjourney/Google Flow image prompts with atmospheric lighting, historical architecture, and 35mm lens specs.', workerId: 2 },
            { id: 'video_prompts', dependsOn: ['script'], prompt: 'Based on this script:\n{{script}}\nGenerate 5 dynamic cinematic camera movement prompts (e.g. slow crane push, orbital tracking, shallow depth of field rack focus) for each scene.', workerId: 3 }
        ];
    }

    if (isSimulated) {
        chatgptActivePipeline = {
            jobId: `demo_sim_${Date.now()}`,
            status: 'running',
            results: {},
            error: null,
            progress: [{ taskId: 'topic', workerId: 1, status: 'Starting Simulation', progress: 10, time: Date.now() }]
        };
        addLog('ChatGPT', `🧪 Demo Pipeline Simulation started (${preset} preset)`, 'info');

        setTimeout(() => {
            chatgptActivePipeline.results.topic = { success: true, text: 'The Lost Citadel of the Sahara: The Enigma of the Eye of Africa' };
            chatgptActivePipeline.progress.push({ taskId: 'topic', workerId: 1, status: 'Done', progress: 100, text: chatgptActivePipeline.results.topic.text, time: Date.now() });
            chatgptActivePipeline.progress.push({ taskId: 'script', workerId: 1, status: 'Writing Voiceover Script...', progress: 30, time: Date.now() });
        }, 1200);

        setTimeout(() => {
            chatgptActivePipeline.results.script = { success: true, text: '[INTRO]\nFor centuries, caravans spoke of a circular titan sleeping beneath the Mauritanian sands.\n\n[MYSTERY]\nSpanning 40 kilometers across, the Richat Structure is so vast that only astronauts in low Earth orbit first grasped its uncanny symmetry.\n\n[CLIMAX]\nWas it a natural geological dome... or the salt-encrusted remnants of a civilization erased by sudden cataclysm? The desert keeps its secret.' };
            chatgptActivePipeline.progress.push({ taskId: 'script', workerId: 1, status: 'Done', progress: 100, text: chatgptActivePipeline.results.script.text, time: Date.now() });
            chatgptActivePipeline.progress.push({ taskId: 'image_prompts', workerId: 2, status: 'Generating Visual Scenes...', progress: 40, time: Date.now() });
            chatgptActivePipeline.progress.push({ taskId: 'video_prompts', workerId: 3, status: 'Directing Camera Motions...', progress: 40, time: Date.now() });
        }, 2600);

        setTimeout(() => {
            chatgptActivePipeline.results.image_prompts = {
                success: true,
                text: '1. Aerial wide-angle view of the colossal Richat Structure rings rising from golden Sahara sand dunes at sunset, 8k, photorealistic, Hasselblad.\n2. Ancient robed nomad standing before colossal weathered stone concentric ramparts, dramatic wind-swept dust, cinematic chiaroscuro.\n3. Close up ancient engraved quartzite artifacts half-buried in salt crust, warm dramatic morning light, 35mm film grain.\n4. Overhead satellite perspective of concentric geological rings with turquoise water reflection mirage, photorealistic hyper-detail.\n5. Dramatic starry night sky with Milky Way arching over the desert rings, campfire embers rising into darkness.'
            };
            chatgptActivePipeline.results.video_prompts = {
                success: true,
                text: '1. Slow high-altitude drone pull-back revealing concentric circles of the Richat Structure.\n2. Low-angle steady-cam tracking past sand dunes toward monolithic stone pillars.\n3. Slow macro push-in focusing on intricate crystalline mineral textures.\n4. Orbital 360-degree rotation above central circular plateau at sunset.\n5. Dramatic tilt-up from desert sands to celestial starry night expanse.'
            };
            chatgptActivePipeline.status = 'completed';
            chatgptActivePipeline.progress.push({ taskId: 'image_prompts', workerId: 2, status: 'Done', progress: 100, time: Date.now() });
            chatgptActivePipeline.progress.push({ taskId: 'video_prompts', workerId: 3, status: 'Done', progress: 100, time: Date.now() });
            addLog('ChatGPT', `✅ Demo Pipeline Simulation Completed Successfully!`, 'success');
        }, 4200);

        return res.json({ success: true, jobId: chatgptActivePipeline.jobId, tasks: demoTasks, simulated: true });
    }

    return res.json({ success: true, tasks: demoTasks });
});

app.post('/api/chatgpt/pipeline/clear', (req, res) => {
    stopChatGPTJob();
    chatgptActivePipeline = {
        jobId: null,
        status: 'idle',
        results: {},
        error: null,
        progress: []
    };
    addLog('ChatGPT', 'Cleared ChatGPT Pipeline monitor and state', 'info');
    res.json({ success: true });
});

app.post('/api/chatgpt/pipeline/stop', (req, res) => {
    stopChatGPTJob();
    chatgptActivePipeline.status = 'stopped';
    addLog('ChatGPT', `ChatGPT Pipeline Stopped by user`, 'warn');
    res.json({ success: true, message: 'ChatGPT job stopped' });
});

app.post('/api/chatgpt/single', async (req, res) => {
    const { prompt, workerId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required.' });
    const targetWorkerId = Number(workerId) || 1;
    const taskId = `single_${Date.now()}`;
    
    chatgptActivePipeline.status = 'running';
    chatgptActivePipeline.progress.push({
        taskId,
        workerId: targetWorkerId,
        status: 'Easy AI Hub Task In Progress',
        promptSnippet: prompt.slice(0, 80),
        time: Date.now()
    });
    addLog('ChatGPT', `[Worker #${targetWorkerId}] Easy AI Hub Job: ${prompt.slice(0, 60)}...`, 'info');

    try {
        const result = await executeChatGPTTask(targetWorkerId, prompt, (p) => {
            chatgptActivePipeline.progress.push({
                taskId,
                workerId: targetWorkerId,
                status: p.status,
                progress: p.progress,
                time: Date.now()
            });
        });
        chatgptActivePipeline.status = 'idle';
        chatgptActivePipeline.progress.push({
            taskId,
            workerId: targetWorkerId,
            status: 'Task Completed',
            text: result.text,
            time: Date.now()
        });
        addLog('ChatGPT', `[Worker #${targetWorkerId}] Easy AI Hub Task Completed`, 'success');
        res.json({ success: true, result });
    } catch (err) {
        chatgptActivePipeline.status = 'error';
        chatgptActivePipeline.progress.push({
            taskId,
            workerId: targetWorkerId,
            status: 'Error: ' + err.message,
            time: Date.now()
        });
        addLog('ChatGPT', `[Worker #${targetWorkerId}] Error: ${err.message}`, 'error');
        res.status(500).json({ error: err.message });
    }
});

function startServer(port = PORT) {
  // Loopback only: other devices on the network must not be able to drive
  // this machine's Chrome or write into the pipeline job folders
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`====================================================`);
    console.log(`🚀 Easy AI Hub Image Engine active on port ${port}`);
    console.log(`👉 Web Interface:  http://localhost:${port}`);
    console.log(`👉 Output Images:  ${getEasyAiHubDir()}`);
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
  getEasyAiHubDir,
  getImageDirs,
};
