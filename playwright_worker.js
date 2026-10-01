const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const http = require('http');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

function findChromePath() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return 'chrome.exe';
}

// Workers 1–7 are plain Playwright Chrome profiles.

function getDownloadsDir() {
  const dir = path.join(os.homedir(), 'Downloads', 'easyaihub');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getProfileDir(workerId = 1) {
  const dirName = (Number(workerId) === 1 || !workerId)
    ? '.easyaihub-chrome-profile'
    : `.easyaihub-chrome-profile-${workerId}`;
  const dir = path.join(os.homedir(), dirName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const { spawnSync, spawn, exec, execSync } = require('child_process');

const safeWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resetCrashFlags(profileDir) {
  if (!profileDir) return;
  try {
    // 1. Purge session restore files so Chrome never prompts "Restore pages?"
    const sessionsDir = path.join(profileDir, 'Default', 'Sessions');
    if (fs.existsSync(sessionsDir)) {
      try {
        fs.rmSync(sessionsDir, { recursive: true, force: true });
      } catch (e) {}
    }
    const oldSessionFiles = ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
    for (const f of oldSessionFiles) {
      const fp = path.join(profileDir, 'Default', f);
      if (fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch (e) {}
      }
    }

    // 2. Normalize Preferences: clean exit, offscreen placement, no session restore
    const prefPath = path.join(profileDir, 'Default', 'Preferences');
    if (fs.existsSync(prefPath)) {
      const d = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
      if (!d.profile) d.profile = {};
      d.profile.exit_type = 'Normal';
      d.profile.exited_cleanly = true;

      if (!d.browser) d.browser = {};
      d.browser.window_placement = {
        left: -32000,
        top: -32000,
        right: -30720,
        bottom: -31100,
        maximized: false,
        work_area_bottom: 672,
        work_area_left: 0,
        work_area_right: 1280,
        work_area_top: 0
      };

      if (!d.session) d.session = {};
      d.session.restore_on_startup = 1;

      fs.writeFileSync(prefPath, JSON.stringify(d), 'utf8');
    }
  } catch (e) {}
}

async function applyBackgroundWindowPlacement(context, page, workerId = 1) {
  try {
    if (page && !page.isClosed()) {
      const session = await page.context().newCDPSession(page);
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: -3200, top: -3200, width: 1280, height: 900, windowState: 'normal' }
      });
      await session.detach().catch(() => {});
    }
  } catch (e) {}
}

function hideProcessWindows(profileDir) {
  // Headless mode: no desktop window exists to hide
  return;
}

function cleanupProfileLocks(profileDir) {
  if (!profileDir) return;

  // Do not kill Chrome if it is actively running in the current worker pool
  for (const [wId, wObj] of activeWorkerPool.entries()) {
    if (wObj && wObj.profileDir === profileDir && isContextUsable(wObj.context)) {
      return;
    }
  }

  const baseDirName = path.basename(profileDir);

  if (process.platform === 'win32') {
    try {
      // Use strict boundary match so .easyaihub-chrome-profile does NOT match .easyaihub-chrome-profile-2..7
      const psCommand = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*${baseDirName}"*' -or $_.CommandLine -like '*${baseDirName} *' -or $_.CommandLine -like '*${baseDirName}/' -or $_.CommandLine -like '*${baseDirName}\\*' -or $_.CommandLine.Trim().EndsWith('${baseDirName}')) } | Select-Object -ExpandProperty ProcessId`;
      const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { encoding: 'utf8', timeout: 5000 });
      const pids = (res.stdout || '').trim().split(/\s+/).filter(Boolean);
      if (pids.length > 0) {
        console.log(`[Playwright Engine] Freeing profile lock for ${baseDirName} (PIDs: ${pids.join(', ')})...`);
        for (const pid of pids) {
          try {
            spawnSync('taskkill.exe', ['/F', '/T', '/PID', pid], { stdio: 'ignore' });
          } catch (e) {}
        }
        try {
          const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(sleepBuf, 0, 0, 500);
        } catch (e) {}
      }
    } catch (e) {
      console.warn('[Playwright Engine] cleanupProfileLocks error:', e.message);
    }
  }

  try {
    const lockFiles = ['SingletonLock', 'lockfile', 'SingletonSocket', 'SingletonCookie'];
    for (const f of lockFiles) {
      const p = path.join(profileDir, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    }
  } catch (e) {}
}

function openWorkerForLogin(workerId = 1) {
  const chromeExe = findChromePath();
  const profileDir = getProfileDir(workerId);
  const baseDirName = path.basename(profileDir);
  const flowUrl = 'https://flow.google.com/';

  console.log(`[Playwright Engine] Opening Chrome for Worker #${workerId} Google login...`);
  console.log(`[Playwright Engine] Profile directory: ${profileDir}`);

  // 1. If Chrome for this worker is ALREADY open and running, don't kill it! Just bring it to front.
  if (process.platform === 'win32') {
    try {
      const psCheck = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*${baseDirName}"*' -or $_.CommandLine -like '*${baseDirName} *' -or $_.CommandLine -like '*${baseDirName}/' -or $_.CommandLine -like '*${baseDirName}\\*' -or $_.CommandLine.Trim().EndsWith('${baseDirName}')) } | Select-Object -ExpandProperty ProcessId`;
      const checkRes = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCheck], { encoding: 'utf8', timeout: 3000 });
      const activePids = (checkRes.stdout || '').trim().split(/\s+/).filter(Boolean);
      if (activePids.length > 0) {
        console.log(`[Playwright Engine] Worker #${workerId} Chrome is already open (PIDs: ${activePids.join(', ')}). Bringing to front...`);
        bringChromeToFront(workerId);
        return { success: true, workerId, profileDir, alreadyOpen: true };
      }
    } catch (e) {}
  }

  // 2. Free profile locks and kill any stale zombies for this profile
  cleanupProfileLocks(profileDir);

  // 3. Launch using Windows Shell "start" command for guaranteed interactive GUI
  const cmd = `start "" "${chromeExe}" --user-data-dir="${profileDir}" --profile-directory=Default --new-window --start-maximized --no-first-run --no-default-browser-check "${flowUrl}"`;
  exec(cmd, { shell: 'cmd.exe' }, (err) => {
    if (err) {
      console.warn(`[Playwright Engine] start command fallback to spawn: ${err.message}`);
      const spawnArgs = [
        `--user-data-dir=${profileDir}`,
        '--profile-directory=Default',
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized',
      ];
      spawnArgs.push(flowUrl);
      const child = spawn(chromeExe, spawnArgs, {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    }
  });

  // 4. Bring Chrome to front on Windows
  setTimeout(() => {
    bringChromeToFront(workerId);
  }, 1000);

  return { success: true, workerId, profileDir };
}

function getProfilesStatus() {
  const status = [];
  for (let i = 1; i <= 7; i++) {
    const dir = getProfileDir(i);
    const hasDir = fs.existsSync(dir);
    const prefPath = path.join(dir, 'Default', 'Preferences');
    let email = null;
    let hasLogin = false;

    if (fs.existsSync(prefPath)) {
      try {
        const obj = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
        if (Array.isArray(obj.account_info) && obj.account_info.length > 0 && obj.account_info[0].email) {
          email = obj.account_info[0].email;
          hasLogin = true;
        }
      } catch (e) {}
    }

    // Fallback for ALL workers: check if Network/Cookies has real data (>8KB = real session cookies present)
    if (!hasLogin) {
      const cookieFile = path.join(dir, 'Default', 'Network', 'Cookies');
      if (fs.existsSync(cookieFile)) {
        try {
          const size = fs.statSync(cookieFile).size;
          if (size > 25600) hasLogin = true; // 25KB+ means real auth cookies, not just tracking
        } catch (e) {}
      }
    }

    // Also check for manually saved email file (written by cookie injector)
    if (!email) {
      const emailFile = path.join(dir, 'injected-email.txt');
      if (fs.existsSync(emailFile)) {
        try {
          const savedEmail = fs.readFileSync(emailFile, 'utf8').trim();
          if (savedEmail && savedEmail.includes('@')) {
            email = savedEmail;
            hasLogin = true;
          }
        } catch (e) {}
      }
    }

    status.push({
      workerId: i,
      profileDir: dir,
      exists: hasDir,
      hasLogin,
      email: email || null,
      status: hasLogin ? (email ? `Logged in (${email})` : 'Ready (Login Detected)') : (hasDir ? 'Created (Login Needed)' : 'Not Created')
    });
  }
  return status;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          try {
            const parsed = new URL(url);
            redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
          } catch (e) {}
        }
        res.resume();
        return downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Failed to download image: HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function isContextUsable(ctx) {
  if (!ctx) return false;
  try {
    const pages = ctx.pages();
    return pages && pages.length > 0 && !pages[0].isClosed();
  } catch (e) {
    return false;
  }
}

async function bringChromeToFront(workerId = 1) {
  let targetPage = null;
  const targetId = Number(workerId) || 1;
  try {
    const workerObj = activeWorkerPool.get(targetId);
    if (workerObj && isContextUsable(workerObj.context) && workerObj.page && !workerObj.page.isClosed()) {
      targetPage = workerObj.page;
    } else if (activeBrowserContext && isContextUsable(activeBrowserContext)) {
      const pages = activeBrowserContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        targetPage = pages[0];
      }
    }

    if (targetPage) {
      try {
        const session = await targetPage.context().newCDPSession(targetPage);
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: { left: 80, top: 80, width: 1280, height: 850, windowState: 'normal' }
        });
        await session.detach().catch(() => {});
      } catch (e) {}

      await targetPage.bringToFront().catch(() => {});
    }
  } catch (e) {}

  if (targetPage && process.platform === 'win32') {
    try {
      const profileDir = getProfileDir(workerId);
      const baseDirName = path.basename(profileDir);
      const psCmd = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${baseDirName}*' } | Select-Object -ExpandProperty ProcessId | ForEach-Object { (New-Object -ComObject WScript.Shell).AppActivate($_) }`;
      exec(psCmd);
      execSync('powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.AppActivate(\'Flow\'); $ws.AppActivate(\'Google Chrome\')"', { stdio: 'ignore' });
    } catch (e) {}
  }
  return { success: Boolean(targetPage), workerId: Number(workerId) || 1 };
}

async function hideChromeWindow(workerId = 1) {
  try {
    const targetId = Number(workerId) || 1;
    let targetPage = null;
    let targetContext = null;
    const workerObj = activeWorkerPool.get(targetId);
    if (workerObj && isContextUsable(workerObj.context) && workerObj.page && !workerObj.page.isClosed()) {
      targetPage = workerObj.page;
      targetContext = workerObj.context;
    } else if (activeBrowserContext && isContextUsable(activeBrowserContext)) {
      targetContext = activeBrowserContext;
      const pages = activeBrowserContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        targetPage = pages[0];
      }
    }

    if (targetContext && targetPage) {
      await applyBackgroundWindowPlacement(targetContext, targetPage, targetId);
    }
  } catch (e) {}
}

async function configureSingleOutputMode(page) {
  try {
    console.log('[Playwright Engine] Checking output image count setting (ensuring 1x output)...');

    // 1. Locate the Settings trigger button at the bottom prompt bar (handles "x2", "Nano Banana", etc.)
    const settingsBtn = page.locator('button.settings-trigger-button, button:has-text("x2"), button:has-text("Nano Banana"), button:has-text("x1"), button[aria-label*="Settings trigger"], button:has-text("Settings trigger")').first();
    const isSettingsVisible = await settingsBtn.isVisible({ timeout: 4000 }).catch(() => false);
    if (!isSettingsVisible) {
      console.warn('[Playwright Engine] Settings trigger button not found on canvas.');
      return;
    }

    const currentSettingsText = await settingsBtn.innerText().catch(() => '');
    if (currentSettingsText.includes('x1') && !currentSettingsText.includes('x2') && !currentSettingsText.includes('x4')) {
      console.log('[Playwright Engine] Output count is already set to 1x image per prompt.');
      return;
    }

    // 2. Open the settings overlay
    console.log('[Playwright Engine] Opening model & output count settings popover (currently: ' + currentSettingsText.replace(/\n/g, ' ') + ')...');
    await settingsBtn.click();
    await safeWait(700);

    // 3. Click the "x1" radio button
    const x1Option = page.locator('button[role="radio"]:has-text("x1"), mat-button-toggle:has-text("x1") button, button:has-text("x1")').first();
    await x1Option.waitFor({ state: 'visible', timeout: 5000 });
    await x1Option.click();
    console.log('[Playwright Engine] ✅ Successfully switched to 1x image output mode!');
    await safeWait(500);

    // 4. Close the settings popover with Escape
    await page.keyboard.press('Escape').catch(() => {});
    await safeWait(300);

    // Verify
    const updatedText = await settingsBtn.innerText().catch(() => '');
    console.log('[Playwright Engine] Confirmed setting:', updatedText.replace(/\n/g, ' '));
  } catch (err) {
    console.warn('[Playwright Engine] Note: Could not set 1x output automatically:', err.message);
    try { await page.keyboard.press('Escape'); } catch (e) {}
  }
}

async function ensureDirectCanvasMode(page) {
  try {
    // 1. Dismiss any onboarding/feature tooltips (e.g. "Got it", "Dismiss", "You're generating with Gemini Omni Flash...")
    const gotItBtn = page.locator('button:has-text("Got it"), button:has-text("Dismiss")').first();
    if (await gotItBtn.isVisible({ timeout: 600 }).catch(() => false)) {
      console.log('[Playwright Engine] Dismissing onboarding tooltip banner...');
      await gotItBtn.click().catch(() => {});
      await safeWait(300);
    }

    // 2. Close Agent Session side panel ("Untitled session" panel) if open
    const sessionCloseBtn = page.locator('button[aria-label="Close"], [role="button"][aria-label="Close"], button:has-text("close"), button[aria-label="Close panel"], button[aria-label="Close session"]').first();
    if (await sessionCloseBtn.isVisible({ timeout: 600 }).catch(() => false)) {
      console.log('[Playwright Engine] 🛑 Closing Agent Session side panel to return to direct canvas mode...');
      await sessionCloseBtn.click().catch(() => {});
      await safeWait(600);
    }

    // Dismiss tooltip again if it reappeared after closing panel
    if (await gotItBtn.isVisible({ timeout: 400 }).catch(() => false)) {
      await gotItBtn.click().catch(() => {});
      await safeWait(300);
    }

    // 3. Check Agent Mode chip: if active (aria-pressed="true", aria-checked="true", or selected/active class), click it to turn OFF agent mode
    const agentChip = page.locator('button.agent-mode-chip, button:has-text("Agent"), [role="button"]:has-text("Agent")').first();
    if (await agentChip.isVisible({ timeout: 600 }).catch(() => false)) {
      const isPressed = await agentChip.getAttribute('aria-pressed');
      const isChecked = await agentChip.getAttribute('aria-checked');
      const classAttr = (await agentChip.getAttribute('class')) || '';
      const isAgentActive = isPressed === 'true' || isChecked === 'true' || classAttr.includes('selected') || classAttr.includes('active');
      if (isAgentActive) {
        console.log('[Playwright Engine] 🛑 Agent mode is ACTIVE. Switching to Direct Canvas Mode...');
        await agentChip.click().catch(() => {});
        await safeWait(600);
      }
    }

    // 4. Ensure output mode is 1x with Nano Banana 2 Lite
    await configureSingleOutputMode(page);
  } catch (err) {
    console.warn('[Playwright Engine] ensureDirectCanvasMode warning:', err.message);
  }
}

const DEBUG_DIR = path.join(__dirname, 'public', 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  try { fs.mkdirSync(DEBUG_DIR, { recursive: true }); } catch (e) {}
}

const SCENES_DEBUG_DIR = path.join(DEBUG_DIR, 'scenes');
if (!fs.existsSync(SCENES_DEBUG_DIR)) {
  try { fs.mkdirSync(SCENES_DEBUG_DIR, { recursive: true }); } catch (e) {}
}

async function captureSceneScreenshot(page, sceneIndex, label = 'generation') {
  if (!page || page.isClosed()) return null;
  try {
    const filename = `scene_${sceneIndex}_chrome_${Date.now().toString().slice(-4)}.jpg`;
    const filePath = path.join(SCENES_DEBUG_DIR, filename);
    await page.screenshot({ path: filePath, type: 'jpeg', quality: 70, timeout: 3500 });

    const latestPath = path.join(DEBUG_DIR, 'latest_canvas.jpg');
    try { fs.copyFileSync(filePath, latestPath); } catch (e) {}

    const webUrl = `/debug/scenes/${filename}`;
    latestDebugState.lastScreenshotUrl = `/debug/latest_canvas.jpg?t=${Date.now()}`;
    latestDebugState.lastScreenshotTime = Date.now();
    latestDebugState.lastAction = `Scene ${sceneIndex}: ${label}`;
    return webUrl;
  } catch (e) {
    return null;
  }
}

const latestDebugState = {
  lastScreenshotUrl: null,
  lastScreenshotTime: 0,
  lastAction: 'Idle',
  lastError: null,
  lastErrorScreenshotUrl: null,
  lastErrorTime: 0,
  canvasStatus: 'Ready',
  browserConnected: false,
  currentUrl: '',
};

function getDebugState() {
  return { ...latestDebugState };
}

async function captureDebugView(page, actionLabel, isError = false) {
  if (!page || page.isClosed()) return;
  try {
    latestDebugState.browserConnected = true;
    latestDebugState.currentUrl = page.url() || '';
    latestDebugState.lastAction = actionLabel;
    latestDebugState.canvasStatus = isError ? 'Error encountered' : 'Active';

    const filename = isError ? 'latest_error.jpg' : 'latest_canvas.jpg';
    const destPath = path.join(DEBUG_DIR, filename);
    await page.screenshot({ path: destPath, type: 'jpeg', quality: 65, timeout: 4000 });

    const now = Date.now();
    const webUrl = `/debug/${filename}?t=${now}`;
    if (isError) {
      latestDebugState.lastErrorScreenshotUrl = webUrl;
      latestDebugState.lastErrorTime = now;
      latestDebugState.lastError = actionLabel;
    } else {
      latestDebugState.lastScreenshotUrl = webUrl;
      latestDebugState.lastScreenshotTime = now;
    }
  } catch (err) {
    // Non-blocking debug capture error
  }
}

async function forceCaptureScreenshot() {
  if (activeBrowserContext && isContextUsable(activeBrowserContext)) {
    try {
      const pages = activeBrowserContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        await captureDebugView(pages[0], 'Manual refresh');
        return latestDebugState;
      }
    } catch (e) {}
  }
  return latestDebugState;
}

async function getLiveFrameBuffer(workerId = 1) {
  const targetId = Number(workerId) || 1;
  const workerObj = activeWorkerPool.get(targetId);
  if (workerObj && isContextUsable(workerObj.context) && workerObj.page && !workerObj.page.isClosed()) {
    try {
      const buffer = await workerObj.page.screenshot({ type: 'jpeg', quality: 60, timeout: 2000 });
      return buffer;
    } catch (e) {}
  }
  if (targetId === 1 && activeBrowserContext && isContextUsable(activeBrowserContext)) {
    try {
      const pages = activeBrowserContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        const page = pages[0];
        const buffer = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 2000 });
        latestDebugState.browserConnected = true;
        latestDebugState.currentUrl = page.url() || '';
        latestDebugState.lastScreenshotTime = Date.now();
        return buffer;
      }
    } catch (e) {}
  }
  const latestPath = path.join(DEBUG_DIR, 'latest_canvas.jpg');
  if (fs.existsSync(latestPath)) {
    try { return fs.readFileSync(latestPath); } catch (e) {}
  }
  return null;
}

let activeBrowserContext = null;
let isJobRunning = false;

// ─────────────────────────────────────────────────────────────────────────────
// Google Flow Helpers: Project Management, Unusual Activity & Cache Reset
// ─────────────────────────────────────────────────────────────────────────────

async function createNewProject(page) {
  console.log('[Playwright Engine] 🆕 Opening brand new project canvas in Google Flow...');
  try {
    // 1. Dismiss any open menus, dialogs, or dropdowns
    await page.keyboard.press('Escape').catch(() => {});
    await safeWait(300);
    await page.keyboard.press('Escape').catch(() => {});
    await safeWait(300);

    const oldUrl = page.url() || '';

    // 2. Navigate to Google Flow root to ensure a completely fresh, untainted project
    console.log('[Playwright Engine] Navigating to https://flow.google.com/ to create fresh project...');
    await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await safeWait(2000);

    // If page is stuck on Loading..., reload once to break the hang
    const isStuck = await page.evaluate(() => {
      const t = (document.body.innerText || '').trim();
      return t === 'Loading...' || t.startsWith('Loading...\nGoogle Flow can make mistakes');
    }).catch(() => false);
    if (isStuck) {
      console.log('[Playwright Engine] 🔄 Page stuck on Loading... Reloading...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await safeWait(2500);
    }

    // 3. Click 'New project' button on Google Flow home page
    const newBtn = page.locator('button.new-project-button, button:has-text("New project"), [role="button"]:has-text("New project"), .mat-focus-indicator:has-text("New project")').first();
    await newBtn.waitFor({ state: 'visible', timeout: 20000 });
    console.log('[Playwright Engine] Clicking New project button...');
    await newBtn.click({ force: true });

    // 4. Wait for the new project URL to load
    await page.waitForURL(url => url.toString().includes('/project/') && (!oldUrl.includes('/project/') || url.toString() !== oldUrl), { timeout: 35000 }).catch(async () => {
      await page.waitForURL('**/project/**', { timeout: 15000 }).catch(() => {});
    });

    console.log('[Playwright Engine] ✅ Fresh canvas project opened:', page.url());
    await captureDebugView(page, 'Fresh Project Canvas Opened');

    await safeWait(2000);
    await page.keyboard.press('Escape').catch(() => {});
    await safeWait(400);

    // 5. Ensure Direct Canvas Mode & 1x output
    await ensureDirectCanvasMode(page);
    const editor = page.locator('div.ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    return editor;
  } catch (err) {
    console.warn('[Playwright Engine] Warning creating new project:', err.message);
    const editor = page.locator('div.ProseMirror').first();
    return editor;
  }
}

async function clearFlowSiteData(page) {
  try {
    console.log('[Playwright Engine] 🧹 Safe-clearing Google Flow cache & storage...');
    const client = await page.context().newCDPSession(page);
    await client.send('Network.clearBrowserCache');
    await page.evaluate(() => {
      try { localStorage.clear(); } catch (e) {}
      try { sessionStorage.clear(); } catch (e) {}
    }).catch(() => {});
    console.log('[Playwright Engine] ✅ Cache & storage cleared safely.');
    return true;
  } catch (err) {
    console.warn('[Playwright Engine] clearBrowserCache warning:', err.message);
    return false;
  }
}

async function resetFlowSiteDataAndSession() {
  const context = await ensureBrowserOpen();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  await clearFlowSiteData(page);
  await createNewProject(page);
  const targetUrl = page.url();
  try {
    await context.close();
  } catch (e) {}
  activeBrowserContext = null;
  return { success: true, url: targetUrl };
}

async function retryFailedCard(page) {
  try {
    return await page.evaluate(() => {
      const candidates = document.querySelectorAll('h1, h2, h3, h4, [role="alert"], div.tile-header, span, p, div');
      for (const el of candidates) {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (txt.includes('unusual activity') || txt.includes('not been charged')) {
          const card = el.closest('div.tile-container, div.card, div[class*="tile"], div[class*="card"], [role="region"], section') || el.parentElement;
          if (card) {
            const actionBtns = card.querySelectorAll('button, [role="button"]');
            for (const btn of actionBtns) {
              const bTxt = (btn.innerText || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
              const icon = (btn.querySelector('mat-icon, span')?.innerText || '').toLowerCase();
              if (icon.includes('refresh') || icon.includes('replay') || icon.includes('redo') || icon.includes('retry') || bTxt.includes('retry') || bTxt.includes('try again') || bTxt.includes('regenerate')) {
                btn.click();
                return true;
              }
            }
          }
        }
      }
      return false;
    });
  } catch (e) {
    return false;
  }
}

async function dismissFailedErrorCards(page) {
  try {
    return await page.evaluate(() => {
      let dismissed = 0;
      const elements = document.querySelectorAll('h1, h2, h3, h4, [role="alert"], div.tile-header, span, p, div');
      for (const el of elements) {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (txt.includes('unusual activity') || (txt.includes('failed') && txt.includes('not been charged'))) {
          const card = el.closest('div.tile-container, div.card, div[class*="tile"], div[class*="card"], [role="region"], section') || el;
          if (card) {
            const actionBtns = card.querySelectorAll('button, [role="button"]');
            for (const btn of actionBtns) {
              const bTxt = (btn.innerText || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
              const icon = (btn.querySelector('mat-icon, span')?.innerText || '').toLowerCase();
              if (bTxt.includes('delete') || icon.includes('delete') || icon.includes('delete_forever') || icon.includes('close') || bTxt.includes('dismiss')) {
                try {
                  btn.click();
                  dismissed++;
                  break;
                } catch (e) {}
              }
            }
          }
        }
      }
      return dismissed;
    });
  } catch (e) {
    return 0;
  }
}

async function countFailedCards(page) {
  try {
    return await page.evaluate(() => {
      const cards = new Set();
      const elements = document.querySelectorAll('h1, h2, h3, h4, [role="alert"], div.tile-header, span, p, div');
      for (const el of elements) {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (txt.includes('unusual activity') || (txt.includes('failed') && txt.includes('not been charged'))) {
          const card = el.closest('div.tile-container, div.card, div[class*="tile"], div[class*="card"], [role="region"], section') || el;
          if (card) cards.add(card);
        }
      }
      return cards.size;
    });
  } catch (e) {
    return 0;
  }
}

async function checkUnusualActivity(page, baselineErrorCount = 0) {
  try {
    const current = await countFailedCards(page);
    return current > baselineErrorCount;
  } catch (e) {
    return false;
  }
}

async function ensureBrowserOpen() {
  if (isContextUsable(activeBrowserContext)) {
    return activeBrowserContext;
  }

  const chromeExe = findChromePath();
  const profileDir = getProfileDir();
  cleanupProfileLocks(profileDir);
  resetCrashFlags(profileDir);

  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromeExe,
      headless: false,
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--disable-extensions'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,900',
        '--disable-infobars',
        '--hide-crash-restore-bubble',
        '--disable-session-crashed-bubble',
        '--noerrdialogs',
        '--disable-component-update',
        '--disable-notifications',
        '--lang=en-US,en'
      ]
    });

    activeBrowserContext = context;
    latestDebugState.browserConnected = true;

    const page = context.pages()[0] || await context.newPage();
    await applyBackgroundWindowPlacement(context, page, 1);

    const flowUrl = 'https://flow.google.com/';
    if (!page.url() || page.url() === 'about:blank') {
      page.goto(flowUrl).catch(() => {});
    }
    return activeBrowserContext;
  } catch (err) {
    console.error('[Playwright Engine] ensureBrowserOpen error:', err);
    throw err;
  }
}

const activeWorkerPool = new Map();

async function launchWorkerContext(workerId = 1) {
  const existing = activeWorkerPool.get(workerId);
  if (existing && isContextUsable(existing.context)) {
    return existing;
  }

  const chromeExe = findChromePath();
  const profileDir = getProfileDir(workerId);
  cleanupProfileLocks(profileDir);
  resetCrashFlags(profileDir);

  console.log(`[Playwright Engine] 🚀 Launching Chrome Worker #${workerId} (Profile: ${profileDir})...`);

  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=-3200,-3200',
    '--window-size=1280,900',
    '--disable-infobars',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--noerrdialogs',
    '--disable-component-update',
    '--disable-notifications',
    '--lang=en-US,en'
  ];

  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromeExe,
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--disable-extensions'],
    args: launchArgs
  });

  const page = context.pages()[0] || await context.newPage();
  await applyBackgroundWindowPlacement(context, page, workerId);

  const workerObj = {
    workerId,
    context,
    page,
    profileDir,
    status: 'idle',
    lastAction: 'Launched'
  };

  activeWorkerPool.set(workerId, workerObj);
  if (workerId === 1) {
    activeBrowserContext = context;
  }
  return workerObj;
}

async function runSingleWorker({
  workerId,
  projectId,
  items,
  totalGlobal,
  onProgress,
  onImageGenerated,
  targetUrl
}) {
  console.log(`[Worker #${workerId}] 🚀 Starting ${items.length} assigned scenes (total global: ${totalGlobal})`);
  let workerObj = await launchWorkerContext(workerId);
  let page = workerObj.page;
  const outDir = getDownloadsDir();

  const generatedImageUrls = [];
  page.on('response', async (res) => {
    const url = res.url();
    const isAvatarOrIcon = url.includes('/rd-ogw/') ||
                           url.includes('=s32') ||
                           url.includes('=s64') ||
                           url.includes('=s96') ||
                           url.includes('googleusercontent.com/a/') ||
                           url.includes('favicon') ||
                           url.includes('gstatic.com');

    if (
      !isAvatarOrIcon &&
      (url.includes('flow-content.google') || url.includes('googleusercontent.com') || url.includes('media.getMediaUrlRedirect') || url.includes('/asb/')) &&
      (res.headers()['content-type']?.includes('image') || url.includes('image') || url.includes('/asb/'))
    ) {
      if (!generatedImageUrls.includes(url)) {
        generatedImageUrls.push(url);
      }
    }
  });

  console.log(`[Worker #${workerId}] Initializing fresh Google Flow canvas project...`);
  let editor = await createNewProject(page);
  const editorFound = await editor.waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);
  if (!editorFound) {
    const curUrl = page.url();
    const isLoginPage = curUrl.includes('accounts.google.com') ||
                        curUrl.includes('/signin') ||
                        curUrl.includes('/ServiceLogin');
    if (isLoginPage) {
      console.warn(`[Worker #${workerId}] ⚠️ Not logged in to Google! (URL: ${curUrl})`);
      if (onProgress) {
        onProgress({
          workerId,
          status: 'not_logged_in',
          message: `⚠️ Chrome #${workerId} is not signed into Google. Scenes reassigned to active worker.`
        });
      }
    } else {
      console.warn(`[Worker #${workerId}] ⚠️ Google Flow canvas editor not accessible (URL: ${curUrl})`);
      if (onProgress) {
        onProgress({
          workerId,
          status: 'editor_missing',
          message: `⚠️ Chrome #${workerId}: Canvas not accessible. Reassigning scenes...`
        });
      }
    }
    try { await workerObj.context.close(); } catch (e) {}
    activeWorkerPool.delete(workerId);
    return { workerId, notLoggedIn: true, unhandledItems: items, completedCount: 0 };
  }

  let workerCompleted = 0;
  let currentSceneRetries = 0;
  const unhandledItems = [];

  for (let idx = 0; idx < items.length; idx++) {
    if (!isJobRunning) {
      console.log(`[Worker #${workerId}] Generation stopped. Exiting scene loop.`);
      break;
    }

    const item = items[idx];
    const prompt = item.prompt;
    const globalSceneIndex = item.globalIndex;
    const localSceneIndex = idx + 1;

    console.log(`[Worker #${workerId}] 🎨 Scene ${globalSceneIndex} (Local ${localSceneIndex}/${items.length}): "${prompt}"`);

    if (onProgress) {
      onProgress({
        workerId,
        status: 'generating_scene',
        sceneIndex: globalSceneIndex,
        localIndex: localSceneIndex,
        workerScenes: items.length,
        totalScenes: totalGlobal,
        prompt,
        message: `Chrome #${workerId}: Scene ${globalSceneIndex}/${totalGlobal} ("${prompt.slice(0, 35)}...")`
      });
    }

    try {
      // If page or context disconnected, attempt transparent recovery
      if (!page || page.isClosed() || !workerObj.context || !isContextUsable(workerObj.context)) {
        console.warn(`[Worker #${workerId}] ⚠️ Browser page closed. Relaunching worker context...`);
        try {
          const revived = await launchWorkerContext(workerId);
          workerObj = revived;
          page = revived.page;
          await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          await safeWait(2500);
          await ensureDirectCanvasMode(page);
        } catch (revErr) {
          console.warn(`[Worker #${workerId}] ⚠️ Could not relaunch worker:`, revErr.message);
          unhandledItems.push(item);
          continue;
        }
      }

      // Dismiss any open menus or overlays first
      await page.keyboard.press('Escape').catch(() => {});
      await safeWait(200);

      // Ensure direct canvas mode before each scene prompt
      await ensureDirectCanvasMode(page);
      editor = page.locator('div.ProseMirror').first();
      await editor.waitFor({ state: 'visible', timeout: 15000 });

      // Focus editor and clear previous text
      await editor.click();
      await safeWait(150);
      await page.keyboard.press('Control+A');
      await safeWait(80);
      await page.keyboard.press('Backspace');
      await safeWait(100);

      // Humanized typing: insert prompt + space with typing delay (fires real keyboard/input events)
      await page.keyboard.insertText(prompt);
      await safeWait(150);
      await page.keyboard.type(' ', { delay: 60 });
      await safeWait(250);

      // Fallback verification in ProseMirror DOM
      await page.evaluate((txt) => {
        const el = document.querySelector('div.ProseMirror');
        if (!el) return;
        const cur = (el.innerText || el.textContent || '').trim();
        if (!cur || cur.length < 5) {
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, txt + ' ');
        }
      }, prompt);

      // Human-like pause before clicking Generate (critical for reCAPTCHA Enterprise bot score)
      await safeWait(1200);

      const baselineImages = await page.$$eval('img', els => els
        .filter(e => (e.alt && (e.alt.includes("user's image") || e.alt.includes("image"))) || (e.src && (e.src.includes('flow-content.google') || e.src.includes('/asb/'))))
        .map(e => e.src)
      ).catch(() => []);
      const baselineFailedCards = await countFailedCards(page);
      const networkStartIndex = generatedImageUrls.length;

      // Click Generate with mouse hover
      const genBtn = page.locator('button[aria-label="Start generation"], button.generate-icon-button, button:has(mat-icon:has-text("arrow_forward")), button:has(span:has-text("arrow_forward"))').first();
      await genBtn.waitFor({ state: 'visible', timeout: 10000 });
      await genBtn.hover().catch(() => {});
      await safeWait(200);
      await genBtn.click();

      // Wait for image with unusual activity detection
      const genStartTime = Date.now();
      let generatedUrl = null;
      let unusualDetected = false;

      await safeWait(3000);

      while (Date.now() - genStartTime < 75000) {
        if (!isJobRunning) break;
        await safeWait(2000);

        if (!page || page.isClosed()) break;

        // 1. Check network images first
        const newlyArrivedUrls = generatedImageUrls.slice(networkStartIndex);
        const trulyNewNetworkUrls = newlyArrivedUrls.filter(u => !baselineImages.includes(u));
        if (trulyNewNetworkUrls.length > 0) {
          generatedUrl = trulyNewNetworkUrls[trulyNewNetworkUrls.length - 1];
          break;
        }

        // 2. Check canvas img DOM
        const currentTileImages = await page.$$eval('img', els => els
          .filter(e => (e.alt && (e.alt.includes("user's image") || e.alt.includes("image"))) || (e.src && (e.src.includes('flow-content.google') || e.src.includes('/asb/'))))
          .map(e => e.src)
        ).catch(() => []);
        const newImages = currentTileImages.filter(src => !baselineImages.includes(src));
        if (newImages.length > 0) {
          generatedUrl = newImages[newImages.length - 1];
          break;
        }

        // 3. Only check for unusual activity if at least 6 seconds have elapsed (gives Google Flow time to process)
        if (Date.now() - genStartTime > 6000) {
          const isUnusual = await checkUnusualActivity(page, baselineFailedCards);
          if (isUnusual) {
            console.warn(`[Worker #${workerId}] ⚠️ Google Flow 'Unusual Activity' detected during scene ${globalSceneIndex}!`);
            unusualDetected = true;
            break;
          }
        }
      }

      if (!generatedUrl && !unusualDetected && page && !page.isClosed()) {
        unusualDetected = await checkUnusualActivity(page, baselineFailedCards);
      }

      // Auto-Recovery pipeline
      if (unusualDetected) {
        currentSceneRetries++;
        console.warn(`[Worker #${workerId}] 🔄 Auto-Recovery attempt ${currentSceneRetries}/3 for scene ${globalSceneIndex}...`);
        await page.keyboard.press('Escape').catch(() => {});

        if (currentSceneRetries <= 2) {
          if (onProgress) {
            onProgress({
              workerId,
              status: 'unusual_recovery',
              sceneIndex: globalSceneIndex,
              message: `Chrome #${workerId}: Unusual activity detected. Auto-clearing tainted canvas & opening fresh project...`
            });
          }
          await dismissFailedErrorCards(page);
          await safeWait(1000);
          await clearFlowSiteData(page);
          await safeWait(1500);
          editor = await createNewProject(page);
          await safeWait(2000);
          idx--; // Retry same scene in fresh project
          continue;
        } else if (currentSceneRetries === 3) {
          if (onProgress) {
            onProgress({
              workerId,
              status: 'cooldown_retry',
              sceneIndex: globalSceneIndex,
              message: `Chrome #${workerId}: Rate limit cooldown (8s) before final retry...`
            });
          }
          await dismissFailedErrorCards(page);
          await safeWait(8000);
          await clearFlowSiteData(page);
          editor = await createNewProject(page);
          await safeWait(2500);
          idx--; // Final retry
          continue;
        } else {
          console.error(`[Worker #${workerId}] ❌ Scene ${globalSceneIndex} failed after 3 retries.`);
          currentSceneRetries = 0;
          unhandledItems.push(item);
          continue;
        }
      }

      currentSceneRetries = 0;

      // Save image to Downloads/easyaihub
      const safeProjectName = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const padIdx = String(globalSceneIndex).padStart(3, '0');
      const filename = `${safeProjectName}_scene_${padIdx}.png`;
      const savePath = path.join(outDir, filename);

      let savedOk = false;
      if (generatedUrl && page && !page.isClosed()) {
        try {
          const base64 = await page.evaluate(async (url) => {
            const resp = await fetch(url);
            const blob = await resp.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          }, generatedUrl);

          if (base64 && base64.includes(',')) {
            const buffer = Buffer.from(base64.split(',')[1], 'base64');
            fs.writeFileSync(savePath, buffer);
            savedOk = true;
            console.log(`[Worker #${workerId}] ✅ Saved scene ${globalSceneIndex} (${buffer.length} bytes) to: ${savePath}`);
          }
        } catch (inPageErr) {
          try {
            await downloadFile(generatedUrl, savePath);
            savedOk = true;
          } catch (e) {}
        }
      }

      if (!savedOk && page && !page.isClosed()) {
        const imageElement = page.locator('div.container:has(img[alt*="user\'s image"]), img[alt*="user\'s image"], img[src*="/asb/"]').last();
        if (await imageElement.isVisible({ timeout: 3000 }).catch(() => false)) {
          await imageElement.screenshot({ path: savePath });
          savedOk = true;
        }
      }

      if (!savedOk) {
        console.warn(`[Worker #${workerId}] ⚠️ Image for scene ${globalSceneIndex} could not be saved.`);
        unhandledItems.push(item);
      } else {
        workerCompleted++;
      }

      const chromeScreenshotUrl = await captureSceneScreenshot(page, globalSceneIndex, `Worker #${workerId}: Scene ${globalSceneIndex} saved`);
      if (workerId === 1) {
        await captureDebugView(page, `Chrome #1: Scene ${globalSceneIndex} saved`);
      }

      if (onImageGenerated && savedOk) {
        onImageGenerated({
          workerId,
          sceneIndex: globalSceneIndex,
          localIndex: localSceneIndex,
          totalScenes: totalGlobal,
          filename,
          localPath: savePath,
          url: `/api/images/${encodeURIComponent(filename)}`,
          chromeScreenshotUrl
        });
      }

      // Proactive canvas rotation every 10 scenes completed by this worker
      if (workerCompleted > 0 && workerCompleted % 10 === 0 && localSceneIndex < items.length) {
        console.log(`[Worker #${workerId}] 🔄 Proactive Canvas Rotation: 10 scenes completed on current canvas...`);
        editor = await createNewProject(page);
        await safeWait(2000);
      }

      // Cooldown pause between scenes
      if (localSceneIndex < items.length && isJobRunning) {
        const pauseMs = 12000 + Math.floor(Math.random() * 5000);
        console.log(`[Worker #${workerId}] Cooldown pause (${(pauseMs / 1000).toFixed(1)}s)...`);
        await safeWait(pauseMs);
      }
    } catch (sceneErr) {
      console.warn(`[Worker #${workerId}] ⚠️ Scene ${globalSceneIndex} error:`, sceneErr.message);
      if (onProgress) {
        onProgress({
          workerId,
          status: 'scene_error',
          sceneIndex: globalSceneIndex,
          message: `Chrome #${workerId}: Scene ${globalSceneIndex} issue (${sceneErr.message.slice(0, 45)}). Auto-recovering...`
        });
      }
      await page.keyboard.press('Escape').catch(() => {});
      await safeWait(1000);
      if (currentSceneRetries < 2) {
        currentSceneRetries++;
        try {
          editor = await createNewProject(page);
          await safeWait(2000);
          idx--; // Retry this scene
          continue;
        } catch (e) {}
      }
      currentSceneRetries = 0;
      if (sceneErr.message && (sceneErr.message.includes('closed') || sceneErr.message.includes('Target page'))) {
        activeWorkerPool.delete(workerId);
      }
      unhandledItems.push(item);
    }
  }

  console.log(`[Worker #${workerId}] 🎉 Finished assigned scenes (Completed: ${workerCompleted}/${items.length}, Unhandled: ${unhandledItems.length})`);
  return { workerId, completedCount: workerCompleted, unhandledItems };
}

async function runPlaywrightBatch({
  projectId,
  prompts,
  workerCount,
  onProgress,
  onImageGenerated,
  onComplete,
  onError,
  targetUrl
}) {
  if (isJobRunning) {
    throw new Error('A generation job is already running in Easy AI Hub.');
  }

  isJobRunning = true;
  const totalPrompts = prompts.length;

  // Parallel Worker Selection:
  // Respect user's selected worker count (1, 2, 3, 5, or 7 Chromes from UI).
  // Distribute across up to totalPrompts (cannot have more workers than prompts).
  let requestedWorkers = (workerCount && Number(workerCount) > 0) ? Number(workerCount) : 1;
  let numWorkers = Math.min(requestedWorkers, totalPrompts, 7);

  console.log(`[Playwright Orchestrator] 🚀 Planning ${numWorkers} parallel Chrome worker(s) for ${totalPrompts} prompts (Requested: ${requestedWorkers} workers)...`);

  const workerBuckets = [];
  const baseSize = Math.floor(totalPrompts / numWorkers);
  const remainder = totalPrompts % numWorkers;

  let currentStart = 0;
  for (let w = 0; w < numWorkers; w++) {
    const chunkSize = baseSize + (w < remainder ? 1 : 0);
    const bucket = [];
    for (let i = 0; i < chunkSize; i++) {
      const globalIdx = currentStart + i + 1;
      bucket.push({
        prompt: prompts[currentStart + i],
        globalIndex: globalIdx
      });
    }
    workerBuckets.push(bucket);
    currentStart += chunkSize;
  }

  // Check which profiles currently have saved logins
  const profileStatuses = getProfilesStatus();
  console.log('[Playwright Orchestrator] Profile check:', profileStatuses.map(p => `W#${p.workerId}: ${p.hasLogin ? 'Login OK' : 'No Login'}`).join(', '));

  const activeWorkerConfigs = [];
  const unloggedItems = [];

  for (let w = 0; w < numWorkers; w++) {
    const workerId = w + 1;
    const bucket = workerBuckets[w];
    if (!bucket || bucket.length === 0) continue;

    const prof = profileStatuses.find(p => p.workerId === workerId);
    const hasSavedLogin = workerId === 1 || (prof && prof.hasLogin);

    if (!hasSavedLogin) {
      console.log(`[Playwright Orchestrator] ℹ️ Worker #${workerId} has no saved Google login. Its ${bucket.length} scene(s) will be executed by Worker #1.`);
      if (onProgress) {
        onProgress({
          workerId,
          status: 'idle',
          message: `ℹ️ Chrome #${workerId} has no Google account saved yet. Its ${bucket.length} scene(s) will run on Worker #1.`
        });
      }
      unloggedItems.push(...bucket);
    } else {
      activeWorkerConfigs.push({ workerId, bucket });
    }
  }

  // If unlogged items exist, give them to Worker 1
  const w1Config = activeWorkerConfigs.find(c => c.workerId === 1);
  if (w1Config) {
    w1Config.bucket.push(...unloggedItems);
  } else if (unloggedItems.length > 0) {
    activeWorkerConfigs.unshift({ workerId: 1, bucket: unloggedItems });
  }

  let completedGlobal = 0;
  const promises = [];

  for (let idx = 0; idx < activeWorkerConfigs.length; idx++) {
    const { workerId, bucket } = activeWorkerConfigs[idx];
    const staggerMs = idx * 1800; // 1.8s stagger between worker launches

    const promise = (async () => {
      if (staggerMs > 0) {
        console.log(`[Playwright Orchestrator] Staggering Worker #${workerId} by ${staggerMs / 1000}s...`);
        await safeWait(staggerMs);
      }

      const result = await runSingleWorker({
        workerId,
        projectId,
        items: bucket,
        totalGlobal: totalPrompts,
        onProgress,
        onImageGenerated: (img) => {
          completedGlobal++;
          if (onImageGenerated) onImageGenerated(img);
        },
        targetUrl
      });

      return result;
    })();

    promises.push(promise);
  }

  try {
    const results = await Promise.allSettled(promises);

    // If any worker couldn't log in or failed, execute its unhandled items on Worker #1 SEQUENTIALLY
    const pendingFallback = [];
    for (let idx = 0; idx < results.length; idx++) {
      const res = results[idx];
      const cfg = activeWorkerConfigs[idx];
      if (res.status === 'fulfilled' && res.value && res.value.unhandledItems && res.value.unhandledItems.length > 0 && res.value.workerId !== 1) {
        pendingFallback.push(...res.value.unhandledItems);
      } else if (res.status === 'rejected' && cfg && cfg.workerId !== 1) {
        console.warn(`[Playwright Orchestrator] ⚠️ Worker #${cfg.workerId} encountered crash:`, res.reason?.message || res.reason);
        pendingFallback.push(...cfg.bucket);
      }
    }

    if (pendingFallback.length > 0 && isJobRunning) {
      console.warn(`[Playwright Orchestrator] 🔄 Re-routing ${pendingFallback.length} unhandled scenes to Worker #1 (executing sequentially)...`);
      if (onProgress) {
        onProgress({
          workerId: 1,
          status: 'running_fallback',
          message: `Worker #1 executing remaining ${pendingFallback.length} fallback scenes sequentially...`
        });
      }
      try {
        await runSingleWorker({
          workerId: 1,
          projectId,
          items: pendingFallback,
          totalGlobal: totalPrompts,
          onProgress,
          onImageGenerated: (img) => {
            completedGlobal++;
            if (onImageGenerated) onImageGenerated(img);
          },
          targetUrl
        });
      } catch (fallbackErr) {
        console.warn(`[Playwright Orchestrator] Fallback execution warning:`, fallbackErr.message);
      }
    }

    console.log(`[Playwright Orchestrator] 🎉 Batch completed! Total: ${completedGlobal}/${totalPrompts} generated.`);
    if (onComplete) {
      onComplete({
        projectId,
        totalGenerated: completedGlobal,
        totalNeeded: totalPrompts,
        isComplete: completedGlobal >= totalPrompts
      });
    }
  } catch (err) {
    console.error('[Playwright Orchestrator] Batch error:', err);
    if (onError) onError(err);
  } finally {
    isJobRunning = false;
  }
}

function stopJob() {
  for (const [workerId, workerObj] of activeWorkerPool.entries()) {
    try {
      if (workerObj.context) {
        workerObj.context.close().catch(() => {});
      }
    } catch (e) {}
  }
  activeWorkerPool.clear();
  if (activeBrowserContext) {
    try {
      activeBrowserContext.close().catch(() => {});
    } catch (e) {}
  }
  activeBrowserContext = null;
  isJobRunning = false;
}

module.exports = {
  runPlaywrightBatch,
  stopJob,
  getDownloadsDir,
  getProfileDir,
  openWorkerForLogin,
  getProfilesStatus,
  getDebugState,
  forceCaptureScreenshot,
  getLiveFrameBuffer,
  bringChromeToFront,
  hideChromeWindow,
  ensureBrowserOpen,
  resetFlowSiteDataAndSession,
  createNewProject,
  ensureDirectCanvasMode,
  configureSingleOutputMode
};
