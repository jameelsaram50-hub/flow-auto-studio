const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync, spawn, exec } = require('child_process');

const { getProfileDir } = require('./playwright_worker.js');

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

const activeWorkerPool = new Map();
let isJobRunning = false;

function isContextUsable(ctx) {
  if (!ctx) return false;
  try {
    const pages = ctx.pages();
    return pages && pages.length > 0 && !pages[0].isClosed();
  } catch (e) {
    return false;
  }
}

async function cleanupProfileLocks(profileDir) {
  if (!profileDir) return;
  const baseDirName = path.basename(profileDir);
  if (process.platform === 'win32') {
    try {
      const psCommand = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*${baseDirName}"*' -or $_.CommandLine -like '*${baseDirName} *' -or $_.CommandLine -like '*${baseDirName}/' -or $_.CommandLine -like '*${baseDirName}\\*' -or $_.CommandLine.Trim().EndsWith('${baseDirName}')) } | Select-Object -ExpandProperty ProcessId`;
      const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { encoding: 'utf8', timeout: 5000 });
      const pids = (res.stdout || '').trim().split(/\s+/).filter(Boolean);
      if (pids.length > 0) {
        for (const pid of pids) {
          try { spawnSync('taskkill.exe', ['/F', '/T', '/PID', pid], { stdio: 'ignore' }); } catch (e) {}
        }
      }
    } catch (e) {}
  }
}

async function applyChatGPTBackgroundWindowPlacement(page) {
  try {
    if (page && !page.isClosed()) {
      const session = await page.context().newCDPSession(page);
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: -3200, top: -3200, width: 1280, height: 850, windowState: 'normal' }
      });
      await session.detach().catch(() => {});
    }
  } catch (e) {}
}

async function getWorker(workerId) {
  const existing = activeWorkerPool.get(workerId);
  if (existing && isContextUsable(existing.context)) {
    return existing;
  }

  console.log(`[ChatGPT Worker] Launching Chrome Worker #${workerId} (Background/Canvas Mode)...`);
  const profileDir = getProfileDir(workerId);
  await cleanupProfileLocks(profileDir);

  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: findChromePath(),
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
    args: [
      '--window-position=-3200,-3200',
      '--window-size=1280,850',
      '--disable-infobars',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--noerrdialogs'
    ]
  });

  const page = context.pages()[0] || await context.newPage();
  await applyChatGPTBackgroundWindowPlacement(page);
  
  if (!page.url().includes('chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }

  await applyChatGPTBackgroundWindowPlacement(page);

  const workerObj = { context, page, workerId, idle: true, status: 'Standby', currentTask: null, progress: 0 };
  activeWorkerPool.set(workerId, workerObj);
  return workerObj;
}

// Check live frame buffer for a specific worker
async function getChatGPTLiveFrameBuffer(workerId = 1) {
  const wid = Number(workerId) || 1;
  const workerObj = activeWorkerPool.get(wid);
  if (workerObj && isContextUsable(workerObj.context) && workerObj.page && !workerObj.page.isClosed()) {
    try {
      const buffer = await workerObj.page.screenshot({ type: 'jpeg', quality: 60, timeout: 2500 });
      return buffer;
    } catch (e) {}
  }
  return null;
}

// Bring Chrome worker window to front (Only called when user manually clicks Open in folder or Bring to Front)
async function bringChatGPTWorkerToFront(workerId = 1) {
  const wid = Number(workerId) || 1;
  const workerObj = activeWorkerPool.get(wid);
  const isOpen = Boolean(workerObj && isContextUsable(workerObj.context) && workerObj.page && !workerObj.page.isClosed());
  if (isOpen) {
    try {
      const session = await workerObj.page.context().newCDPSession(workerObj.page);
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: 60, top: 60, width: 1366, height: 860, windowState: 'normal' }
      });
      await session.detach().catch(() => {});
    } catch (e) {}
    await workerObj.page.bringToFront().catch(() => {});

    if (process.platform === 'win32') {
      try {
        const profileDir = getProfileDir(wid);
        const baseDirName = path.basename(profileDir);
        const psCmd = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${baseDirName}*' } | Select-Object -ExpandProperty ProcessId | ForEach-Object { (New-Object -ComObject WScript.Shell).AppActivate($_) }`;
        if (typeof exec === 'function') {
          exec(psCmd, () => {});
          exec('powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.AppActivate(\'ChatGPT\'); $ws.AppActivate(\'Google Chrome\')"', () => {});
        }
      } catch (e) {}
    }
    return { success: true, workerId: wid };
  }
  return { success: false, workerId: wid };
}

// Hide Chrome worker window back to background (Canvas only)
async function hideChatGPTWorker(workerId = 1) {
  const wid = Number(workerId) || 1;
  const workerObj = activeWorkerPool.get(wid);
  if (workerObj && isContextUsable(workerObj.context) && workerObj.page && !workerObj.page.isClosed()) {
    await applyChatGPTBackgroundWindowPlacement(workerObj.page);
  }
  return { success: true, workerId: wid };
}

// Open worker explicitly for login or inspection
async function openChatGPTWorker(workerId = 1) {
  const wid = Number(workerId) || 1;
  const worker = await getWorker(wid);
  await bringChatGPTWorkerToFront(wid);
  return { success: true, workerId: wid };
}

// Get telemetry status for all 7 workers
function getChatGPTWorkersTelemetry() {
  const list = [];
  for (let i = 1; i <= 7; i++) {
    const w = activeWorkerPool.get(i);
    const isLive = Boolean(w && isContextUsable(w.context) && w.page && !w.page.isClosed());
    list.push({
      workerId: i,
      isOpen: isLive,
      idle: w ? w.idle : true,
      status: w ? (w.status || (isLive ? 'Standby' : 'Offline')) : 'Offline',
      currentTask: w ? (w.currentTask || null) : null,
      progress: w ? (w.progress || 0) : 0,
      url: isLive ? (w.page.url() || '') : ''
    });
  }
  return list;
}

// Auto-dismiss common ChatGPT popups and locate active prompt input
async function ensureChatGPTReady(page, wid, onProgress) {
  const dismissModalSelectors = [
    'button:has-text("Stay logged out")',
    'a:has-text("Stay logged out")',
    'button:has-text("Continue without logging in")',
    'button:has-text("Okay, let\'s go")',
    'button:has-text("Next")',
    'button:has-text("Done")',
    'button:has-text("Accept all")',
    'button:has-text("Reject all")',
    'button:has-text("Reject optional cookies")',
    'button[aria-label="Close"]',
    'button[data-testid="close-button"]'
  ];

  const inputSelectors = [
    '#prompt-textarea',
    'div[contenteditable="true"]',
    'textarea[data-id="root"]',
    'div.ProseMirror',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
    '[role="textbox"]'
  ];

  const startTime = Date.now();
  let foundSelector = null;

  while (Date.now() - startTime < 60000) {
    // 1. Dismiss any overlay modals/cookies/log-in reminders if present
    for (const sel of dismissModalSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(400);
        }
      } catch (e) {}
    }

    // 2. Locate active prompt input
    for (const sel of inputSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
          foundSelector = sel;
          break;
        }
      } catch (e) {}
    }

    if (foundSelector) break;

    // 3. If after 6 seconds input is still not found, check if Cloudflare or login wall is up
    if (Date.now() - startTime > 6000) {
      const pageTitle = await page.title().catch(() => '');
      const isCloudflare = pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare') || (await page.locator('iframe[src*="cloudflare"], #challenge-stage').count().catch(() => 0)) > 0;
      
      const statusMsg = isCloudflare 
        ? 'Cloudflare verification detected — Check Live Canvas or run worker .bat'
        : 'Please sign in or dismiss popup — Check Live Canvas or run worker .bat';
      
      if (onProgress) {
        onProgress({ workerId: wid, status: statusMsg, progress: 20 });
      }
    }

    await page.waitForTimeout(1200);
  }

  if (!foundSelector) {
    throw new Error('ChatGPT prompt input not detected. Please verify ChatGPT is accessible in the Chrome window.');
  }

  return foundSelector;
}

// Executes a single ChatGPT prompt on a specific worker and returns the response
async function executeChatGPTTask(workerId, promptText, onProgress) {
  const wid = Number(workerId) || 1;
  const worker = await getWorker(wid);
  worker.idle = false;
  worker.status = 'Connecting to ChatGPT...';
  worker.currentTask = promptText.length > 35 ? promptText.slice(0, 35) + '...' : promptText;
  worker.progress = 10;
  const page = worker.page;

  try {
    if (!page.url().includes('chatgpt.com')) {
       worker.status = 'Navigating to chatgpt.com...';
       await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    }

    // 1. Record assistant message count before sending
    const initialAssistantCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-message-author-role="assistant"]').length;
    }).catch(() => 0);

    worker.status = 'Locating input...';
    worker.progress = 25;
    if (onProgress) onProgress({ workerId: wid, status: 'Locating input...', progress: 25 });

    // Locate active input using resilient multi-selector & modal dismisser
    const inputSelector = await ensureChatGPTReady(page, wid, onProgress);
    
    worker.status = 'Typing prompt...';
    worker.progress = 40;
    if (onProgress) onProgress({ workerId: wid, status: 'Typing prompt...', progress: 40 });
    
    const inputEl = page.locator(inputSelector).first();
    await inputEl.click({ timeout: 3000 }).catch(() => {});

    try {
      if (inputSelector === '#prompt-textarea' || inputSelector.includes('textarea')) {
        await page.fill(inputSelector, promptText, { timeout: 3000 });
      } else {
        await page.keyboard.insertText(promptText);
      }
    } catch (fillErr) {
      await inputEl.click().catch(() => {});
      await page.keyboard.insertText(promptText);
    }
    
    await page.waitForTimeout(300);

    // Press Send Button or Enter
    const sendButtonSelectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Submit"]',
      'button:has(svg path[d*="M0.5"])'
    ];

    let clickedSend = false;
    for (const btnSel of sendButtonSelectors) {
      try {
        const btn = page.locator(btnSel).first();
        if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
          const isDisabled = await btn.isDisabled().catch(() => false);
          if (!isDisabled) {
            await btn.click({ timeout: 1500 }).catch(() => {});
            clickedSend = true;
            break;
          }
        }
      } catch (e) {}
    }

    if (!clickedSend) {
      await page.keyboard.press('Enter');
    }

    worker.status = 'Generating response...';
    worker.progress = 60;
    if (onProgress) onProgress({ workerId: wid, status: 'Generating...', progress: 60 });

    // Wait for the new assistant response container to appear
    await page.waitForFunction((prevCount) => {
        const currentCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
        return currentCount > prevCount;
    }, initialAssistantCount, { timeout: 30000 }).catch(() => {});

    // Wait for streaming / generation to finish:
    // When done, .result-streaming is gone, stop-button is gone, and send-button is enabled
    await page.waitForFunction(() => {
        const isStreaming = document.querySelector('.result-streaming') !== null;
        const hasStopButton = document.querySelector('[data-testid="stop-button"]') !== null ||
                              document.querySelector('button[aria-label*="Stop"]') !== null;
        const sendBtn = document.querySelector('[data-testid="send-button"]') ||
                        document.querySelector('button[aria-label*="Send"]');
        const sendReady = sendBtn && !sendBtn.disabled && !sendBtn.hasAttribute('disabled');

        return !isStreaming && !hasStopButton && sendReady;
    }, { timeout: 180000, polling: 500 }).catch(async () => {
        // Fallback: wait a moment if custom elements differ
        await page.waitForTimeout(4000);
    });

    await page.waitForTimeout(1000);

    worker.status = 'Extracting response...';
    worker.progress = 90;
    if (onProgress) onProgress({ workerId: wid, status: 'Extracting response...', progress: 90 });

    // Extract the latest response
    const responseText = await page.evaluate(() => {
        const responses = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (responses.length > 0) {
            const latest = responses[responses.length - 1];
            return (latest.innerText || latest.textContent || '').trim();
        }
        const markdowns = document.querySelectorAll('.markdown');
        if (markdowns.length > 0) {
            const latest = markdowns[markdowns.length - 1];
            return (latest.innerText || latest.textContent || '').trim();
        }
        return '';
    });

    worker.status = 'Task Completed';
    worker.progress = 100;
    worker.idle = true;
    worker.currentTask = null;
    if (onProgress) onProgress({ workerId: wid, status: 'Completed', progress: 100, text: responseText });
    return { success: true, text: responseText, workerId: wid };

  } catch (err) {
    worker.idle = true;
    worker.status = 'Error: ' + err.message.slice(0, 30);
    worker.currentTask = null;
    console.error(`[ChatGPT Worker #${wid}] Error:`, err);
    throw err;
  }
}

// Orchestrator for Dependency Graph execution
async function runChatGPTPipelineBatch({ pipelineTasks, onProgress, onComplete, onError }) {
    if (isJobRunning) {
        if (onError) onError(new Error("Another pipeline job is already running."));
        return;
    }
    
    isJobRunning = true;
    const results = {};
    
    try {
        const isReady = (task) => {
            return (task.dependsOn || []).every(dep => results[dep] && results[dep].success);
        };

        const executeTask = async (task) => {
             let finalPrompt = task.prompt;
             for (const [depId, res] of Object.entries(results)) {
                 if (res && res.success) {
                     finalPrompt = finalPrompt.replace(new RegExp(`{{${depId}}}`, 'g'), res.text);
                 }
             }

             const targetWorkerId = Number(task.workerId) || 1;
             if (onProgress) onProgress({ taskId: task.id, status: 'Starting', workerId: targetWorkerId });
             
             try {
                 const result = await executeChatGPTTask(targetWorkerId, finalPrompt, (p) => {
                     if (onProgress) onProgress({ taskId: task.id, ...p });
                 });
                 results[task.id] = result;
                 if (onProgress) onProgress({ taskId: task.id, status: 'Done', text: result.text, workerId: targetWorkerId });
             } catch (err) {
                 results[task.id] = { success: false, error: err.message };
                 if (onProgress) onProgress({ taskId: task.id, status: 'Error', error: err.message, workerId: targetWorkerId });
                 throw err;
             }
        };

        let pendingTasks = [...pipelineTasks];
        let runningPromises = new Set();
        
        while (pendingTasks.length > 0 || runningPromises.size > 0) {
            if (!isJobRunning) break; // aborted

            for (let i = 0; i < pendingTasks.length; i++) {
                const task = pendingTasks[i];
                if (isReady(task)) {
                    pendingTasks.splice(i, 1);
                    i--;
                    
                    const promise = executeTask(task).finally(() => {
                        runningPromises.delete(promise);
                    });
                    runningPromises.add(promise);
                }
            }

            if (runningPromises.size > 0) {
                await Promise.race(runningPromises).catch(e => console.error("Task failed:", e));
            } else if (pendingTasks.length > 0) {
                throw new Error("Pipeline deadlock: Some tasks cannot be started due to missing dependencies.");
            }
        }

        isJobRunning = false;
        if (onComplete) onComplete({ success: true, results });

    } catch (err) {
        isJobRunning = false;
        if (onError) onError(err);
    }
}

function stopChatGPTJob() {
    isJobRunning = false;
    for (const [wid, workerObj] of activeWorkerPool.entries()) {
      if (workerObj) {
        workerObj.idle = true;
        workerObj.status = 'Stopped';
        workerObj.currentTask = null;
      }
    }
}

module.exports = {
    runChatGPTPipelineBatch,
    executeChatGPTTask,
    stopChatGPTJob,
    getWorker,
    getChatGPTLiveFrameBuffer,
    bringChatGPTWorkerToFront,
    hideChatGPTWorker,
    openChatGPTWorker,
    getChatGPTWorkersTelemetry
};

