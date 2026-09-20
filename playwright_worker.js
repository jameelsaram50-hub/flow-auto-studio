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

function getDownloadsDir() {
  const dir = path.join(os.homedir(), 'Downloads', 'turboflow');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getProfileDir(workerId = 1) {
  const dirName = (Number(workerId) === 1 || !workerId)
    ? '.turboflow-chrome-profile'
    : `.turboflow-chrome-profile-${workerId}`;
  const dir = path.join(os.homedir(), dirName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function openWorkerForLogin(workerId = 1) {
  const chromeExe = findChromePath();
  const profileDir = getProfileDir(workerId);
  const flowUrl = 'https://flow.google.com/';

  console.log(`[Playwright Engine] Opening Chrome for Worker #${workerId} Google login...`);
  console.log(`[Playwright Engine] Profile directory: ${profileDir}`);

  const child = spawn(chromeExe, [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    flowUrl
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { success: true, workerId, profileDir };
}

function getProfilesStatus() {
  const status = [];
  for (let i = 1; i <= 7; i++) {
    const dir = getProfileDir(i);
    const hasDir = fs.existsSync(dir);
    const cookieFile1 = path.join(dir, 'Default', 'Network', 'Cookies');
    const cookieFile2 = path.join(dir, 'Default', 'Cookies');
    const hasCookies = fs.existsSync(cookieFile1) || fs.existsSync(cookieFile2);
    status.push({
      workerId: i,
      profileDir: dir,
      exists: hasDir,
      hasLogin: hasCookies,
      status: hasCookies ? 'Ready (Login Detected)' : (hasDir ? 'Created (Login Needed)' : 'Not Created')
    });
  }
  return status;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

const { execSync, spawn } = require('child_process');

function cleanupProfileLocks(profileDir) {
  if (process.platform === 'win32' && profileDir) {
    try {
      const baseDirName = path.basename(profileDir);
      const out = execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${baseDirName}*' } | ForEach-Object { $_.ProcessId }"`, { encoding: 'utf8' });
      const pids = out.trim().split(/\s+/).filter(Boolean);
      if (pids.length > 0) {
        console.log(`[Playwright Engine] Freeing profile lock for ${baseDirName} (PIDs: ${pids.join(', ')})...`);
        execSync(`taskkill /F ${pids.map(p => `/PID ${p}`).join(' ')}`, { stdio: 'ignore' });
      }
    } catch (e) {}
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

function isContextUsable(ctx) {
  if (!ctx) return false;
  try {
    const pages = ctx.pages();
    return pages && pages.length > 0 && !pages[0].isClosed();
  } catch (e) {
    return false;
  }
}

function bringChromeToFront() {
  try {
    if (activeBrowserContext && isContextUsable(activeBrowserContext)) {
      const pages = activeBrowserContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        pages[0].bringToFront().catch(() => {});
      }
    }
  } catch (e) {}

  if (process.platform === 'win32') {
    try {
      execSync('powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.AppActivate(\'Flow\'); $ws.AppActivate(\'Google Chrome\')"', { stdio: 'ignore' });
    } catch (e) {}
  }
}

async function configureSingleOutputMode(page) {
  try {
    console.log('[Playwright Engine] Checking output image count setting (ensuring 1x output)...');

    // 1. Locate the Settings trigger button at the bottom prompt bar (handles "x2", "Nano Banana", etc.)
    const settingsBtn = page.locator('button:has-text("x2"), button:has-text("Nano Banana"), button:has-text("x1"), button[aria-label*="Settings trigger"], button:has-text("Settings trigger")').first();
    const isSettingsVisible = await settingsBtn.isVisible({ timeout: 5000 }).catch(() => false);
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
    await page.waitForTimeout(700);

    // 3. Click the "x1" radio button
    const x1Option = page.locator('button[role="radio"]:has-text("x1"), mat-button-toggle:has-text("x1") button, button:has-text("x1")').first();
    await x1Option.waitFor({ state: 'visible', timeout: 5000 });
    await x1Option.click();
    console.log('[Playwright Engine] ✅ Successfully switched to 1x image output mode!');
    await page.waitForTimeout(500);

    // 4. Close the settings popover with Escape
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);

    // Verify
    const updatedText = await settingsBtn.innerText().catch(() => '');
    console.log('[Playwright Engine] Confirmed setting:', updatedText.replace(/\n/g, ' '));
  } catch (err) {
    console.warn('[Playwright Engine] Note: Could not set 1x output automatically:', err.message);
    try { await page.keyboard.press('Escape'); } catch (e) {}
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

async function getLiveFrameBuffer() {
  if (activeBrowserContext && isContextUsable(activeBrowserContext)) {
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
    await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    bringChromeToFront();
    await page.waitForTimeout(3000);

    const newBtn = page.locator('button:has-text("New project"), [role="button"]:has-text("New project"), .mat-focus-indicator:has-text("New project")').first();
    if (await newBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
      const box = await newBtn.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
        await page.waitForTimeout(150);
      }
      await newBtn.click();
      await page.waitForURL('**/project/**', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      console.log('[Playwright Engine] ✅ Fresh canvas project opened:', page.url());
      bringChromeToFront();
      await captureDebugView(page, 'Fresh Project Canvas Opened');
    }

    await page.waitForTimeout(3000);
    const editor = page.locator('div.ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 25000 });
    await configureSingleOutputMode(page);
    return editor;
  } catch (err) {
    console.warn('[Playwright Engine] Warning creating new project:', err.message);
    const editor = page.locator('div.ProseMirror').first();
    return editor;
  }
}

async function clearFlowSiteData(page) {
  try {
    console.log('[Playwright Engine] 🧹 Clearing Google Flow site data & caches via CDP...');
    const client = await page.context().newCDPSession(page);
    await client.send('Storage.clearDataForOrigin', {
      origin: 'https://flow.google.com',
      storageTypes: 'indexeddb,cache_storage,service_workers,local_storage'
    });
    console.log('[Playwright Engine] ✅ Google Flow site data cleared successfully.');
    return true;
  } catch (err) {
    console.warn('[Playwright Engine] CDP clearDataForOrigin warning:', err.message);
    return false;
  }
}

async function resetFlowSiteDataAndSession() {
  const context = await ensureBrowserOpen();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  await clearFlowSiteData(page);
  await createNewProject(page);
  return { success: true, url: page.url() };
}

async function checkUnusualActivity(page) {
  try {
    return await page.evaluate(() => {
      const fullText = document.body ? (document.body.innerText || '') : '';
      const hasErrorPhrase = /unusual activity/i.test(fullText) ||
                             /suspicious activity/i.test(fullText) ||
                             /too many requests/i.test(fullText);
      if (!hasErrorPhrase) return false;

      const modals = document.querySelectorAll('[role="dialog"], [role="alert"], .error, .banner, .modal, .toast');
      for (let m of modals) {
        if (/unusual activity/i.test(m.innerText || '')) return true;
      }

      const cards = document.querySelectorAll('div, section');
      for (let c of cards) {
        if (c.innerText && /unusual activity/i.test(c.innerText)) {
          return true;
        }
      }
      return true;
    });
  } catch (e) {
    return false;
  }
}

async function ensureBrowserOpen() {
  if (isContextUsable(activeBrowserContext)) {
    bringChromeToFront();
    return activeBrowserContext;
  }

  const chromeExe = findChromePath();
  const profileDir = getProfileDir();
  cleanupProfileLocks(profileDir);

  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromeExe,
      headless: false,
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized',
        '--disable-infobars',
        '--lang=en-US,en'
      ]
    });

    activeBrowserContext = context;
    latestDebugState.browserConnected = true;

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      try { delete navigator.__proto__.webdriver; } catch (e) {}
      if (!window.chrome) { window.chrome = {}; }
      window.chrome.runtime = window.chrome.runtime || { id: 'bdmfcdallkljfeejmglojaanbonjhbkb' };
    });

    const page = context.pages()[0] || await context.newPage();
    const flowUrl = 'https://flow.google.com/';
    if (!page.url() || page.url() === 'about:blank') {
      page.goto(flowUrl).catch(() => {});
    }
    bringChromeToFront();
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

  const xOffset = ((workerId - 1) % 4) * 70;
  const yOffset = Math.floor((workerId - 1) / 4) * 70;

  console.log(`[Playwright Engine] 🚀 Launching Chrome Worker #${workerId} (Profile: ${profileDir})...`);

  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromeExe,
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-position=${xOffset},${yOffset}`,
      '--disable-infobars',
      '--lang=en-US,en'
    ]
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    try { delete navigator.__proto__.webdriver; } catch (e) {}
    if (!window.chrome) { window.chrome = {}; }
    window.chrome.runtime = window.chrome.runtime || { id: 'bdmfcdallkljfeejmglojaanbonjhbkb' };
  });

  const page = context.pages()[0] || await context.newPage();
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
  const workerObj = await launchWorkerContext(workerId);
  const page = workerObj.page;
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
      (url.includes('googleusercontent.com') || url.includes('media.getMediaUrlRedirect') || url.includes('/asb/')) &&
      (res.headers()['content-type']?.includes('image') || url.includes('image') || url.includes('/asb/'))
    ) {
      if (!generatedImageUrls.includes(url)) {
        generatedImageUrls.push(url);
      }
    }
  });

  const flowUrl = targetUrl || 'https://flow.google.com/';
  if (!page.url().includes('/project/')) {
    await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    const newBtn = page.locator('button:has-text("New project"), [role="button"]:has-text("New project"), .mat-focus-indicator:has-text("New project")').first();
    if (await newBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await newBtn.click();
      await page.waitForURL('**/project/**', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  }

  await page.waitForTimeout(2500);
  let editor = page.locator('div.ProseMirror').first();
  await editor.waitFor({ state: 'visible', timeout: 25000 });
  await configureSingleOutputMode(page);

  let workerCompleted = 0;
  let currentSceneRetries = 0;

  for (let idx = 0; idx < items.length; idx++) {
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

    // 1-Shot prompt paste into ProseMirror
    await editor.click();
    await page.waitForTimeout(120);
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(60);
    await page.keyboard.insertText(prompt);
    await page.waitForTimeout(200);

    await page.evaluate((txt) => {
      const el = document.querySelector('div.ProseMirror');
      if (!el) return;
      const cur = (el.innerText || el.textContent || '').trim();
      if (!cur || cur.length < 5) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, txt);
      }
    }, prompt);

    await page.waitForTimeout(300);

    const baselineImages = await page.$$eval('img', els => els
      .filter(e => (e.alt && e.alt.includes("user's image")) || (e.src && e.src.includes('/asb/')))
      .map(e => e.src)
    ).catch(() => []);
    const networkStartIndex = generatedImageUrls.length;

    // Click Generate
    const genBtn = page.locator('button[aria-label="Start generation"], button.generate-icon-button').first();
    await genBtn.waitFor({ state: 'visible', timeout: 10000 });
    await genBtn.click();

    // Wait for image with unusual activity detection
    const genStartTime = Date.now();
    let generatedUrl = null;
    let unusualDetected = false;

    await page.waitForTimeout(3000);

    while (Date.now() - genStartTime < 75000) {
      await page.waitForTimeout(2000);

      const isUnusual = await checkUnusualActivity(page);
      if (isUnusual) {
        console.warn(`[Worker #${workerId}] ⚠️ Google Flow 'Unusual Activity' detected during scene ${globalSceneIndex}!`);
        unusualDetected = true;
        break;
      }

      // Check network images
      const newlyArrivedUrls = generatedImageUrls.slice(networkStartIndex);
      const trulyNewNetworkUrls = newlyArrivedUrls.filter(u => !baselineImages.includes(u));
      if (trulyNewNetworkUrls.length > 0) {
        generatedUrl = trulyNewNetworkUrls[trulyNewNetworkUrls.length - 1];
        break;
      }

      // Check canvas img DOM
      const currentTileImages = await page.$$eval('img', els => els
        .filter(e => (e.alt && e.alt.includes("user's image")) || (e.src && e.src.includes('/asb/')))
        .map(e => e.src)
      ).catch(() => []);
      const newImages = currentTileImages.filter(src => !baselineImages.includes(src));
      if (newImages.length > 0) {
        generatedUrl = newImages[newImages.length - 1];
        break;
      }
    }

    if (!generatedUrl && !unusualDetected) {
      unusualDetected = await checkUnusualActivity(page);
    }

    // Auto-Recovery pipeline
    if (unusualDetected) {
      currentSceneRetries++;
      console.warn(`[Worker #${workerId}] 🔄 Auto-Recovery attempt ${currentSceneRetries} for scene ${globalSceneIndex}...`);
      await page.keyboard.press('Escape').catch(() => {});

      if (currentSceneRetries === 1) {
        if (onProgress) {
          onProgress({
            workerId,
            status: 'unusual_recovery',
            sceneIndex: globalSceneIndex,
            message: `Chrome #${workerId}: Unusual activity detected. Switching to fresh canvas project...`
          });
        }
        await page.waitForTimeout(5000);
        editor = await createNewProject(page);
        idx--; // Retry same scene
        continue;
      } else if (currentSceneRetries === 2) {
        if (onProgress) {
          onProgress({
            workerId,
            status: 'clearing_cache',
            sceneIndex: globalSceneIndex,
            message: `Chrome #${workerId}: Clearing Flow cache and reloading...`
          });
        }
        await clearFlowSiteData(page);
        await page.waitForTimeout(4000);
        editor = await createNewProject(page);
        idx--; // Retry same scene
        continue;
      } else {
        console.error(`[Worker #${workerId}] ❌ Scene ${globalSceneIndex} failed after 2 retries.`);
        currentSceneRetries = 0;
        continue;
      }
    }

    currentSceneRetries = 0;

    // Save image to Downloads/turboflow
    const safeProjectName = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeProjectName}_w${workerId}_scene_${globalSceneIndex}_${Date.now().toString().slice(-4)}.png`;
    const savePath = path.join(outDir, filename);

    let savedOk = false;
    if (generatedUrl) {
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

    if (!savedOk) {
      const imageElement = page.locator('div.container:has(img[alt*="user\'s image"]), img[alt*="user\'s image"], img[src*="/asb/"]').last();
      if (await imageElement.isVisible({ timeout: 3000 }).catch(() => false)) {
        await imageElement.screenshot({ path: savePath });
        savedOk = true;
      }
    }

    workerCompleted++;
    if (workerId === 1) {
      await captureSceneScreenshot(page, globalSceneIndex, 'Generated & Saved');
      await captureDebugView(page, `Chrome #1: Scene ${globalSceneIndex} saved`);
    }

    if (onImageGenerated) {
      onImageGenerated({
        workerId,
        sceneIndex: globalSceneIndex,
        localIndex: localSceneIndex,
        totalScenes: totalGlobal,
        filename,
        localPath: savePath,
        url: `/api/images/${encodeURIComponent(filename)}`
      });
    }

    // Proactive canvas rotation every 10 scenes completed by this worker
    if (workerCompleted > 0 && workerCompleted % 10 === 0 && localSceneIndex < items.length) {
      console.log(`[Worker #${workerId}] 🔄 Proactive Canvas Rotation: 10 scenes completed on current canvas...`);
      editor = await createNewProject(page);
      await page.waitForTimeout(2000);
    }

    // Cooldown pause between scenes
    if (localSceneIndex < items.length) {
      const pauseMs = 12000 + Math.floor(Math.random() * 5000);
      console.log(`[Worker #${workerId}] Cooldown pause (${(pauseMs / 1000).toFixed(1)}s)...`);
      await page.waitForTimeout(pauseMs);
    }
  }

  console.log(`[Worker #${workerId}] 🎉 Completed all assigned ${items.length} scenes!`);
  return { workerId, completedCount: workerCompleted };
}

async function runPlaywrightBatch({
  projectId,
  prompts,
  workerCount = 7,
  onProgress,
  onImageGenerated,
  onComplete,
  onError,
  targetUrl
}) {
  if (isJobRunning) {
    throw new Error('A generation job is already running in Flow Auto Studio.');
  }

  isJobRunning = true;
  const totalPrompts = prompts.length;
  const numWorkers = Math.min(Math.max(Number(workerCount) || 7, 1), 7, totalPrompts);

  console.log(`[Playwright Orchestrator] 🚀 Launching ${numWorkers} parallel Chrome worker(s) for ${totalPrompts} prompts...`);

  // Distribute prompts across workers
  const workerBuckets = [];
  for (let w = 0; w < numWorkers; w++) workerBuckets.push([]);
  for (let i = 0; i < totalPrompts; i++) {
    workerBuckets[i % numWorkers].push({ prompt: prompts[i], globalIndex: i + 1 });
  }

  let completedGlobal = 0;
  const promises = [];

  for (let w = 0; w < numWorkers; w++) {
    const workerId = w + 1;
    const bucket = workerBuckets[w];
    if (bucket.length === 0) continue;

    const staggerMs = w * 3500; // 3.5s stagger between worker launches
    const promise = (async () => {
      if (staggerMs > 0) {
        console.log(`[Playwright Orchestrator] Staggering Worker #${workerId} by ${staggerMs / 1000}s...`);
        await new Promise(r => setTimeout(r, staggerMs));
      }
      return runSingleWorker({
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
    })();
    promises.push(promise);
  }

  try {
    await Promise.allSettled(promises);
    console.log(`[Playwright Orchestrator] 🎉 Batch completed! Total: ${completedGlobal}/${totalPrompts} generated.`);
    if (onComplete) onComplete({ projectId, totalGenerated: completedGlobal });
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
  ensureBrowserOpen,
  resetFlowSiteDataAndSession,
  createNewProject
};
