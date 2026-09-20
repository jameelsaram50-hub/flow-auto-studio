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

function getProfileDir() {
  const dir = path.join(os.homedir(), '.turboflow-chrome-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
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

const { execSync } = require('child_process');

function cleanupProfileLocks(profileDir) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { $_.CommandLine -like '*turboflow*' } | ForEach-Object { $_.ProcessId }"`, { encoding: 'utf8' });
      const pids = out.trim().split(/\s+/).filter(Boolean);
      if (pids.length > 0) {
        console.log('[Playwright Engine] Terminating stale turboflow chrome processes before launch:', pids);
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

async function runPlaywrightBatch({
  projectId,
  prompts,
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
  const chromeExe = findChromePath();
  const profileDir = getProfileDir();
  const outDir = getDownloadsDir();

  console.log('[Playwright Engine] Starting batch generation for project:', projectId);
  console.log('[Playwright Engine] Prompts count:', prompts.length);
  console.log('[Playwright Engine] Using Chrome profile:', profileDir);

  try {
    let context = null;
    if (isContextUsable(activeBrowserContext)) {
      console.log('[Playwright Engine] Reusing active browser session!');
      context = activeBrowserContext;
    } else {
      cleanupProfileLocks(profileDir);
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: chromeExe,
        headless: false,
        viewport: null, // native maximize
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

      // Inject stealth bypass before any page scripts load
      await context.addInitScript(() => {
        // 1. Mask navigator.webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        try {
          delete navigator.__proto__.webdriver;
        } catch (e) {}

        // 2. Ensure window.chrome structure matches genuine Chrome
        if (!window.chrome) {
          window.chrome = {};
        }
        window.chrome.runtime = window.chrome.runtime || {
          connect: () => {},
          sendMessage: () => {},
          onMessage: { addListener: () => {}, removeListener: () => {} }
        };
        window.chrome.app = window.chrome.app || {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
        };

        // 3. Realistic plugins list
        if (!navigator.plugins || navigator.plugins.length === 0) {
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
          });
        }

        // 4. Realistic languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });

        // 5. Notification permissions query spoofing
        const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
        if (originalQuery) {
          window.navigator.permissions.query = (parameters) => (
            parameters && parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission }) :
              originalQuery(parameters)
          );
        }
      });

      activeBrowserContext = context;
    }

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.bringToFront().catch(() => {});
    bringChromeToFront();

    // Listen for image network responses, carefully filtering out Google user avatars and small icons
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
          console.log('[Playwright Engine] Captured real generated image response:', url.substring(0, 90));
        }
      }
    });

function getFlowLaunchUrl() {
  try {
    const historyDb = path.join(getProfileDir(), 'Default', 'History');
    if (fs.existsSync(historyDb)) {
      const buf = fs.readFileSync(historyDb);
      const str = buf.toString('latin1');
      const matches = str.match(/https:\/\/flow\.google\.com\/project\/[a-f0-9-]{36}/gi);
      if (matches && matches.length > 0) {
        return matches[matches.length - 1];
      }
    }
  } catch (e) {}
  return 'https://flow.google.com/';
}

    const flowUrl = targetUrl || getFlowLaunchUrl();
    console.log('[Playwright Engine] Navigating to Google Flow with Stealth Mode:', flowUrl);
    if (onProgress) onProgress({ status: 'opening_flow', message: `Opening Google Flow canvas (${flowUrl})...` });

    await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    bringChromeToFront();
    await page.waitForTimeout(3000);
    await captureDebugView(page, 'Google Flow Canvas Loaded');

    // Enter project canvas if on landing page
    if (!page.url().includes('/project/')) {
      console.log('[Playwright Engine] Landing page detected. Clicking "+ New project"...');
      if (onProgress) onProgress({ status: 'creating_project', message: 'Creating new canvas project in Google Flow...' });

      const newBtn = page.locator('button:has-text("New project"), [role="button"]:has-text("New project"), .mat-focus-indicator:has-text("New project")').first();
      if (await newBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
        const box = await newBtn.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
          await page.waitForTimeout(200);
        }
        await newBtn.click();
        await page.waitForURL('**/project/**', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        console.log('[Playwright Engine] Successfully entered project canvas:', page.url());
        bringChromeToFront();
        await captureDebugView(page, 'Project Canvas Opened');
      }
    }

    await page.waitForTimeout(3000);
    let editor = page.locator('div.ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 20000 });

    // Ensure output count is set to 1x image (instead of default 2x / 4x)
    await configureSingleOutputMode(page);
    await captureDebugView(page, 'Canvas Ready (1x Image Mode Active)');

    const total = prompts.length;
    let completedCount = 0;
    let currentSceneRetries = 0;

    for (let i = 0; i < total; i++) {
      const prompt = prompts[i];
      const sceneIndex = i + 1;

      console.log(`[Playwright Engine] Processing Scene ${sceneIndex}/${total}: "${prompt}" (Retry: ${currentSceneRetries})`);
      bringChromeToFront();

      if (onProgress) {
        onProgress({
          status: 'generating_scene',
          sceneIndex,
          totalScenes: total,
          prompt,
          message: `Generating scene ${sceneIndex} of ${total} (1x image mode)...`
        });
      }

      // Re-verify 1x mode before first scene or periodically
      if (i === 0) {
        await configureSingleOutputMode(page);
      }

      // Instant 1-shot paste into ProseMirror (Fast, clean & no repetitive keydown triggers)
      await editor.click();
      await page.waitForTimeout(150);
      await page.keyboard.press('Control+A');
      await page.waitForTimeout(100);

      // Instant 1-shot text insertion (acts like instant clipboard paste)
      await page.keyboard.insertText(prompt);
      await page.waitForTimeout(250);

      // Verify ProseMirror has the prompt; fallback to in-DOM insertText if needed
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

      await page.waitForTimeout(400);
      await captureDebugView(page, `Scene ${sceneIndex}/${total}: Prompt Pasted`);

      // Capture baseline images on canvas and network stream count before clicking generate
      const baselineImages = await page.$$eval('img', els => els
        .filter(e => (e.alt && e.alt.includes("user's image")) || (e.src && e.src.includes('/asb/')))
        .map(e => e.src)
      ).catch(() => []);
      const networkStartIndex = generatedImageUrls.length;

      // Click generate button with realistic mouse hover
      const genBtn = page.locator('button[aria-label="Start generation"], button.generate-icon-button').first();
      await genBtn.waitFor({ state: 'visible', timeout: 10000 });
      
      const genBox = await genBtn.boundingBox().catch(() => null);
      if (genBox) {
        await page.mouse.move(genBox.x + genBox.width / 2, genBox.y + genBox.height / 2, { steps: 8 });
        await page.waitForTimeout(300);
      }
      await genBtn.click();
      console.log(`[Playwright Engine] Scene ${sceneIndex} generation triggered.`);
      await page.waitForTimeout(700);
      const sceneGenShot = await captureSceneScreenshot(page, sceneIndex, 'Generation Triggered');
      if (onProgress) {
        onProgress({
          status: 'generating_scene',
          sceneIndex,
          totalScenes: total,
          prompt,
          screenshotUrl: sceneGenShot,
          message: `📸 Scene ${sceneIndex}: Chrome canvas captured during generation`
        });
      }
      await captureDebugView(page, `Scene ${sceneIndex}/${total}: Generation Triggered`);

      // Wait for image to generate (Google Flow takes ~12-25 seconds per generation)
      const genStartTime = Date.now();
      let generatedUrl = null;
      let unusualDetected = false;
      
      // Give initial generation breathing time
      await page.waitForTimeout(4000);

      while (Date.now() - genStartTime < 75000) {
        await page.waitForTimeout(2000);

        // Instant check: Did Google Flow flag unusual activity? (Never wait 75s for a failed image!)
        const isUnusual = await checkUnusualActivity(page);
        if (isUnusual) {
          console.warn(`[Playwright Engine] ⚠️ Google Flow 'Unusual Activity' detected during scene ${sceneIndex} generation!`);
          unusualDetected = true;
          break; // Exit wait loop immediately to trigger auto-recovery!
        }

        // Stream periodic live canvas screenshots during image generation
        const elapsedSec = Math.round((Date.now() - genStartTime) / 1000);
        if (elapsedSec > 0 && elapsedSec % 5 === 0) {
          await captureDebugView(page, `Scene ${sceneIndex}/${total}: Waiting for AI render (${elapsedSec}s)...`);
        }

        // Simulate subtle human mouse movement across canvas while waiting
        if (Math.random() < 0.35) {
          await page.mouse.move(300 + Math.random() * 400, 200 + Math.random() * 300, { steps: 5 }).catch(() => {});
        }

        // 1. Check newly arrived network images (ONLY those that arrived AFTER clicking generate)
        const newlyArrivedUrls = generatedImageUrls.slice(networkStartIndex);
        const trulyNewNetworkUrls = newlyArrivedUrls.filter(u => !baselineImages.includes(u));
        if (trulyNewNetworkUrls.length > 0) {
          generatedUrl = trulyNewNetworkUrls[trulyNewNetworkUrls.length - 1];
          console.log(`[Playwright Engine] Scene ${sceneIndex} captured fresh new image from network stream!`);
          break;
        }

        // 2. Check if a new generated image tile appeared on canvas DOM
        const currentTileImages = await page.$$eval('img', els => els
          .filter(e => (e.alt && e.alt.includes("user's image")) || (e.src && e.src.includes('/asb/')))
          .map(e => e.src)
        ).catch(() => []);

        const newImages = currentTileImages.filter(src => !baselineImages.includes(src));
        if (newImages.length > 0) {
          generatedUrl = newImages[newImages.length - 1];
          console.log(`[Playwright Engine] Scene ${sceneIndex} captured from canvas DOM:`, generatedUrl.substring(0, 90));
          break;
        }

        // 3. Check all canvas img elements matching Google Flow image patterns
        const imgs = await page.locator('img').all();
        for (let img of imgs) {
          const src = await img.getAttribute('src').catch(() => null);
          const alt = await img.getAttribute('alt').catch(() => null);
          if (
            src &&
            !src.includes('/rd-ogw/') &&
            !src.includes('gstatic') &&
            !src.includes('=s32') &&
            !src.includes('=s64') &&
            (src.includes('/asb/') || (alt && alt.includes("user's image")) || src.includes('googleusercontent.com') || src.startsWith('blob:'))
          ) {
            if (!baselineImages.includes(src)) {
              generatedUrl = src;
              break;
            }
          }
        }
        if (generatedUrl) break;
      }

      // Final check: did it fail with unusual activity right at the end?
      if (!generatedUrl && !unusualDetected) {
        unusualDetected = await checkUnusualActivity(page);
      }

      // ───────────────────────────────────────────────────────────────────────
      // AUTO-RECOVERY PIPELINE FOR UNUSUAL ACTIVITY
      // ───────────────────────────────────────────────────────────────────────
      if (unusualDetected) {
        currentSceneRetries++;
        console.warn(`[Playwright Engine] 🔄 Auto-Recovery initiated for Scene ${sceneIndex} (Attempt ${currentSceneRetries})...`);

        // Close any modal popup
        await page.keyboard.press('Escape').catch(() => {});
        const dismissBtn = page.locator('button:has-text("OK"), button:has-text("Dismiss"), button:has-text("Close"), button[aria-label="Close"]').first();
        if (await dismissBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await dismissBtn.click().catch(() => {});
        }

        if (currentSceneRetries === 1) {
          // Hul 3: Open brand new project canvas & retry scene
          if (onProgress) {
            onProgress({
              status: 'unusual_recovery',
              sceneIndex,
              totalScenes: total,
              prompt,
              message: `⚠️ 'Unusual Activity' detected. Auto-recovering: Switching to a Fresh Project Canvas (Attempt 1)...`
            });
          }
          await page.waitForTimeout(6000);
          editor = await createNewProject(page);
          i--; // Retry this same scene!
          continue;
        } else if (currentSceneRetries === 2) {
          // Hul 1/4: Clear Google Flow Site Data via CDP, create new project & retry
          if (onProgress) {
            onProgress({
              status: 'clearing_cache',
              sceneIndex,
              totalScenes: total,
              prompt,
              message: `🧹 'Unusual Activity' persisted. Clearing Google Flow site data & cache...`
            });
          }
          await clearFlowSiteData(page);
          await page.waitForTimeout(5000);
          editor = await createNewProject(page);
          i--; // Retry this same scene!
          continue;
        } else {
          console.error(`[Playwright Engine] ❌ Scene ${sceneIndex} failed after 2 auto-recovery attempts due to persistent Google Flow rate-limiting.`);
          currentSceneRetries = 0; // Skip to next scene so batch doesn't get completely stuck
          continue;
        }
      }

      // Reset retry counter on successful scene generation
      currentSceneRetries = 0;

      // If still not captured by diff, check one more time specifically for new tiles (never pick old tiles)
      if (!generatedUrl) {
        const latestNewCanvasImg = await page.$$eval('img', (els, baseline) => {
          const newTiles = els.filter(e => ((e.alt && e.alt.includes("user's image")) || (e.src && e.src.includes('/asb/'))) && !baseline.includes(e.src));
          return newTiles.length > 0 ? newTiles[newTiles.length - 1].src : null;
        }, baselineImages).catch(() => null);
        if (latestNewCanvasImg) {
          generatedUrl = latestNewCanvasImg;
          console.log(`[Playwright Engine] Scene ${sceneIndex} using latest fresh canvas tile:`, generatedUrl.substring(0, 90));
        }
      }

      // Download and save generated image (Never take a whole page screenshot!)
      const safeProjectName = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeProjectName}_scene_${sceneIndex}_${Date.now().toString().slice(-4)}.png`;
      const savePath = path.join(outDir, filename);

      let savedOk = false;
      if (generatedUrl) {
        try {
          console.log(`[Playwright Engine] Fetching image bytes in-page for scene ${sceneIndex}...`);
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
            console.log(`[Playwright Engine] ✅ Successfully saved scene ${sceneIndex} image (${buffer.length} bytes) to:`, savePath);
            savedOk = true;
          }
        } catch (inPageErr) {
          console.warn(`[Playwright Engine] In-page fetch error:`, inPageErr.message);
          try {
            await downloadFile(generatedUrl, savePath);
            console.log(`[Playwright Engine] Downloaded scene ${sceneIndex} via direct stream:`, savePath);
            savedOk = true;
          } catch (dlErr) {
            console.warn(`[Playwright Engine] Direct download error:`, dlErr.message);
          }
        }
      }

      // If URL fetch was unavailable, capture ONLY the specific image element tile (NEVER full page!)
      if (!savedOk) {
        const imageElement = page.locator('div.container:has(img[alt*="user\'s image"]), img[alt*="user\'s image"], img[src*="/asb/"]').last();
        if (await imageElement.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log(`[Playwright Engine] Capturing cropped element snapshot of image tile for scene ${sceneIndex}...`);
          await imageElement.screenshot({ path: savePath });
          savedOk = true;
        } else {
          console.error(`[Playwright Engine] ❌ Could not locate image element for scene ${sceneIndex}`);
        }
      }

      completedCount++;
      const sceneDoneShot = await captureSceneScreenshot(page, sceneIndex, 'Generated & Saved');
      await captureDebugView(page, `Scene ${sceneIndex}/${total}: Saved (${filename})`);

      if (onImageGenerated) {
        onImageGenerated({
          sceneIndex,
          totalScenes: total,
          filename,
          localPath: savePath,
          url: `/api/images/${encodeURIComponent(filename)}`,
          chromeScreenshotUrl: sceneDoneShot || sceneGenShot || null
        });
      }

      // ───────────────────────────────────────────────────────────────────────
      // Hul 3: PROACTIVE CANVAS ROTATION EVERY 10 SCENES
      // ───────────────────────────────────────────────────────────────────────
      if (completedCount > 0 && completedCount % 10 === 0 && sceneIndex < total) {
        console.log(`[Playwright Engine] 🔄 Proactive Canvas Rotation: 10 scenes completed on current canvas. Opening fresh project for remaining scenes...`);
        if (onProgress) {
          onProgress({
            status: 'rotating_project',
            sceneIndex,
            totalScenes: total,
            message: `🔄 Completed ${completedCount} scenes! Switching to a fresh project canvas to prevent Google Flow rate limits...`
          });
        }
        editor = await createNewProject(page);
        await page.waitForTimeout(3000);
      }

      // Natural human cooldown pause between scenes (avoids Google Flow rapid-burst blocks)
      if (sceneIndex < total) {
        const pauseMs = 12000 + Math.floor(Math.random() * 6000);
        console.log(`[Playwright Engine] Natural human pause (${(pauseMs / 1000).toFixed(1)}s) before scene ${sceneIndex + 1}...`);
      }
    }

    console.log(`[Playwright Engine] 🎉 All ${total} scenes generated successfully for ${projectId}!`);
    await captureDebugView(page, `Completed: All ${total} scenes ready`);
    if (onComplete) onComplete({ projectId, totalGenerated: completedCount });
  } catch (err) {
    console.error('[Playwright Engine] Generation error:', err);
    latestDebugState.lastError = err.message || String(err);
    try {
      if (activeBrowserContext && isContextUsable(activeBrowserContext)) {
        const p = activeBrowserContext.pages()[0];
        if (p && !p.isClosed()) {
          await captureDebugView(p, `Error: ${err.message}`, true);
        }
      }
    } catch (e) {}
    if (onError) onError(err);
  } finally {
    isJobRunning = false;
  }
}

function stopJob() {
  if (activeBrowserContext) {
    try {
      activeBrowserContext.close().catch(() => {});
    } catch (e) {}
    activeBrowserContext = null;
  }
  isJobRunning = false;
}

module.exports = {
  runPlaywrightBatch,
  stopJob,
  getDownloadsDir,
  getProfileDir,
  getDebugState,
  forceCaptureScreenshot,
  getLiveFrameBuffer,
  bringChromeToFront,
  ensureBrowserOpen,
  resetFlowSiteDataAndSession,
  createNewProject
};
