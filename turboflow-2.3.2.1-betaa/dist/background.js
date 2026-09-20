// TurboFlow Background Service Worker
// mx-a3f8b2c1.js is the core generation engine that handles START_BATCH from the sidepanel.
// Its document/window references are inside executeScript() — they run in the Flow tab, not here.
try {
  importScripts('mx-a3f8b2c1.js');
} catch(e) {
  console.error('[TurboFlow] Failed to import mx-a3f8b2c1.js:', e);
}

function bgLog(msg, data) {
  console.log('[TurboFlow Background]', msg, data || '');
  try {
    fetch('http://localhost:3001/api/extension/flow-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'extension-background', msg, data, time: new Date().toISOString() })
    }).catch(() => {});
  } catch(e) {}
}

bgLog('TurboFlow background service worker initialized');

// NOTE: mx-a3f8b2c1.js already registers setPanelBehavior, onUpdated, onActivated, onRemoved.
// Do NOT duplicate those here to avoid double-triggers.

let isCreatingSidePanel = false;
async function openSidePanelWindow() {
  if (isCreatingSidePanel) return;
  isCreatingSidePanel = true;
  try {
    const sidepanelUrl = chrome.runtime.getURL('sidepanel.html');
    let isAlreadyOpen = false;
    try {
      const allTabs = await chrome.tabs.query({});
      isAlreadyOpen = allTabs.some((t) => t.url && t.url.includes(sidepanelUrl));
    } catch (e) {}
    if (!isAlreadyOpen) {
      try {
        await chrome.windows.create({ url: sidepanelUrl, type: 'popup', width: 440, height: 840, top: 50, left: 40, focused: true });
        bgLog('Successfully opened SidePanel companion window.');
      } catch (winErr) {
        try {
          await chrome.tabs.create({ url: sidepanelUrl, active: false });
          bgLog('Opened SidePanel as companion tab fallback.');
        } catch (tabErr) {
          console.warn('[TurboFlow Background] Could not open sidepanel tab:', tabErr);
        }
      }
    }
  } catch (err) {
    console.warn('[TurboFlow Background] openSidePanelWindow error:', err);
  } finally {
    setTimeout(function() { isCreatingSidePanel = false; }, 2000);
  }
}

// Startup timer: open sidepanel ONCE when Flow tab is FULLY loaded (status=complete)
let startupPanelOpened = false;
let startupChecks = 0;
const startupTimer = setInterval(async function() {
  startupChecks++;
  if (startupChecks > 60) { clearInterval(startupTimer); return; }
  if (startupPanelOpened) { clearInterval(startupTimer); return; }
  try {
    const allTabs = await chrome.tabs.query({});
    // KEY FIX: Only open when status=complete (page fully loaded), not just URL match
    const flowTab = allTabs.find((t) => t.url &&
      (t.url.includes('flow.google.com') || t.url.includes('labs.google/fx/tools/flow')) &&
      t.status === 'complete');
    if (flowTab) {
      startupPanelOpened = true;
      bgLog('Flow tab fully loaded (' + flowTab.id + '). Opening sidepanel once.');
      openSidePanelWindow().catch(function() {});
    }
  } catch (e) {}
}, 1000);

// Message listener
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg && (msg.type === 'FLOW_PAGE_LOADED' || msg.type === 'OPEN_SIDEPANEL_WINDOW')) {
    openSidePanelWindow().then(function() { sendResponse({ ok: true }); }).catch(function() { sendResponse({ ok: false }); });
    return true;
  }
  if (msg && msg.type === 'FLOW_LOG') {
    bgLog(msg.msg, msg.data);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'CLOSE_AUTOMATION_WINDOWS') {
    try {
      chrome.tabs.query({}, function(tabs) {
        tabs.forEach(function(t) {
          if (t.url && (t.url.includes('flow.google.com') || t.url.includes('labs.google/fx/tools/flow') || t.url.includes('sidepanel.html'))) {
            if (t.id) chrome.tabs.remove(t.id).catch(function() {});
          }
        });
      });
    } catch (e) {}
    sendResponse({ ok: true });
    return true;
  }
});

// Batch runner state
let lastAutoBatchRunId = null;
let batchRetryCount = 0;
let batchFireCount = 0;
let syncAlreadyFiredForRunId = null; // guard: prevent double STUDIO_TRIGGER_SYNC

async function getFlowTabId() {
  try {
    const tabs = await chrome.tabs.query({});
    // Prefer fully-loaded project canvas tab first
    const projectTab = tabs.find((t) => t.url &&
      (t.url.includes('flow.google.com/project/') || t.url.includes('labs.google/fx/tools/flow/project/')) &&
      t.status === 'complete');
    if (projectTab) return projectTab.id;

    // Next prefer any fully-loaded flow tab
    const completeTab = tabs.find((t) => t.url &&
      (t.url.includes('flow.google.com') || t.url.includes('labs.google/fx/tools/flow')) &&
      t.status === 'complete');
    if (completeTab) return completeTab.id;

    // Log if tab exists but still loading
    const loadingTab = tabs.find((t) => t.url &&
      (t.url.includes('flow.google.com') || t.url.includes('labs.google/fx/tools/flow')));
    if (loadingTab) bgLog('Flow tab found (status=' + loadingTab.status + ') — waiting for complete...');
    return null; // Not ready yet
  } catch (e) { return null; }
}

async function getSidePanelTabId() {
  try {
    const allTabs = await chrome.tabs.query({});
    const spTab = allTabs.find((t) => t.url && t.url.includes('sidepanel.html'));
    return spTab ? spTab.id : null;
  } catch (e) { return null; }
}

// Trigger bridge.js syncPrompts() which fills textarea and clicks btn-start
// vk.js handles btn-start click -> sends START_BATCH to this SW
// mx.js (importScripts in this SW) receives START_BATCH -> generates images
async function triggerSidepanelSync(runId) {
  try { chrome.runtime.sendMessage({ type: 'STUDIO_TRIGGER_SYNC', runId: runId }).catch(function() {}); } catch (e) {}
  const spTabId = await getSidePanelTabId();
  if (spTabId) chrome.tabs.sendMessage(spTabId, { type: 'STUDIO_TRIGGER_SYNC', runId: runId }).catch(function() {});
  bgLog('STUDIO_TRIGGER_SYNC sent for run ' + runId + (spTabId ? ' (direct tab ' + spTabId + ')' : ' (broadcast only)'));
}

function reportProgress(runId, text) {
  fetch('http://localhost:3001/api/extension/turboflow-progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: runId, progressText: text }),
  }).catch(function() {});
}

async function checkAndAutoRunBatch() {
  try {
    const res = await fetch('http://localhost:3001/api/extension/turboflow-prompts');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.prompts || data.prompts.length === 0) return;
    if (data.runId === lastAutoBatchRunId) return;

    batchRetryCount++;

    // KEY FIX: wait for Flow tab to be status=complete before proceeding
    const flowTabId = await getFlowTabId();
    if (!flowTabId) {
      if (batchRetryCount === 1 || batchRetryCount % 10 === 0) {
        bgLog('Prompts ready (' + data.prompts.length + ' scenes), waiting for Flow tab to finish loading... attempt ' + batchRetryCount);
      }
      return;
    }

    lastAutoBatchRunId = data.runId;
    batchRetryCount = 0;
    batchFireCount++;
    bgLog('Flow tab fully loaded (' + flowTabId + '). Firing batch #' + batchFireCount + ' run ' + data.runId);

    // Step 1: Clear stale storage so sidepanel starts completely fresh
    try {
      await chrome.storage.local.remove(['flowAutoBatches', 'flowAutoCurrentBatch', 'flowAutoCurrentIndex']);
      bgLog('Cleared old batch queue from storage');
    } catch (e) {}

    // Step 2: Ensure sidepanel window is open
    await openSidePanelWindow().catch(function() {});

    // Step 3: CRITICAL — wait for sidepanel to fully initialize BEFORE sending sync
    // vk.js is ~220KB minified — needs 5-7s to parse, render UI, and call initBridge()
    bgLog('Waiting 6s for sidepanel + vk.js to fully initialize...');
    await new Promise(function(r) { setTimeout(r, 6000); });

    // Step 4: Trigger sync ONCE per runId — bridge.js fills prompts, clicks btn-start
    if (syncAlreadyFiredForRunId !== data.runId) {
      syncAlreadyFiredForRunId = data.runId;
      reportProgress(data.runId, 'Syncing ' + data.prompts.length + ' prompts to Google Flow...');
      await triggerSidepanelSync(data.runId);
    }

    // Step 5: Safety-net second sync 4s later in case first was missed
    setTimeout(async function() {
      try {
        const check = await fetch('http://localhost:3001/api/extension/turboflow-prompts');
        if (check.ok) {
          const current = await check.json();
          if (current.runId === data.runId) {
            bgLog('Sending backup STUDIO_TRIGGER_SYNC as safety net');
            await triggerSidepanelSync(data.runId);
          }
        }
      } catch (e) {}
    }, 4000);

  } catch (err) {
    bgLog('checkAndAutoRunBatch error: ' + (err && err.message ? err.message : String(err)));
  }
}

// Poll every 1 second for new prompts from server
setInterval(checkAndAutoRunBatch, 1000);
// Also fire immediately on startup
setTimeout(checkAndAutoRunBatch, 500);
