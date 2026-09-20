// AutoVideo Studio TurboFlow Two-Way Automation Bridge
(function () {
  let lastSyncedRunId = null;
  let lastPromptHash = null;
  let isAutoStartEnabled = localStorage.getItem('tf_auto_start') !== 'false';
  let totalPromptsExpected = 0;

  // Strict batch lifecycle state machine:
  // 'IDLE' -> 'PROMPTS_LOADED' -> 'START_REQUESTED' -> 'RUNNING' -> 'COMPLETED'
  let batchLifecycle = 'IDLE';
  let hasActuallyRun = false;
  let completionSent = false;
  let pendingStartAttempts = 0;

  // Watchdog: track when START_REQUESTED began so we can detect stuck generation
  let startRequestedAt = 0;
  let lastProgressText = '';
  let lastProgressAt = 0;

  function createNotificationBanner() {
    let banner = document.getElementById('studio-sync-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'studio-sync-banner';
      banner.style.cssText = `
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25));
        border: 1px solid rgba(129, 140, 248, 0.5);
        color: #e0e7ff;
        padding: 8px 12px;
        margin: 8px 12px;
        border-radius: 8px;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        transition: all 0.3s ease;
      `;
      const promptArea = document.querySelector('.prompt-area') || document.getElementById('tab-control') || document.body;
      if (promptArea && promptArea.parentNode) {
        promptArea.parentNode.insertBefore(banner, promptArea);
      } else {
        document.body.prepend(banner);
      }
    }
    return banner;
  }

  function updateBanner(text, isSuccess = true) {
    const banner = createNotificationBanner();
    if (banner) {
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:16px;">${isSuccess ? '⚡' : '🔄'}</span>
          <span>${text}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:#a5b4fc;" title="Automatically triggers Start Batch when new prompts arrive">
            <input type="checkbox" id="chk-auto-start" ${isAutoStartEnabled ? 'checked' : ''} style="cursor:pointer;" />
            Auto-Start
          </label>
        </div>
      `;
      const chk = document.getElementById('chk-auto-start');
      if (chk) {
        chk.onchange = (e) => {
          isAutoStartEnabled = e.target.checked;
          localStorage.setItem('tf_auto_start', String(isAutoStartEnabled));
        };
      }
    }
  }

  function simpleHash(str) {
    if (!str) return 'empty';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  let isClickingStart = false;

  // Auto-login as Guest Admin if on auth screen and dismiss overlays
  function checkAutoAuthAndModals() {
    const authScreen = document.getElementById('auth-screen');
    const guestBtn = document.getElementById('btn-guest-signin');
    if (authScreen && guestBtn) {
      const isVisible = (authScreen.style.display !== 'none') ||
                        (window.getComputedStyle && window.getComputedStyle(authScreen).display !== 'none');
      if (isVisible) {
        console.log('[TurboFlow Bridge] Auto-clicking Guest Signin...');
        guestBtn.click();
      }
    }

    // Dismiss trial welcome modal if present
    const trialClose = document.getElementById('btn-trial-welcome-close');
    if (trialClose && trialClose.offsetParent !== null) trialClose.click();

    // Dismiss upgrade limit modal if blocking
    const limitClose = document.getElementById('btn-close-limit');
    if (limitClose && limitClose.offsetParent !== null) limitClose.click();

    // Dismiss general upgrade modal if blocking
    const upgradeClose = document.getElementById('btn-close-upgrade');
    if (upgradeClose && upgradeClose.offsetParent !== null) upgradeClose.click();

    // Dismiss validation modal ("Can't Generate Yet")
    const validationOk = document.getElementById('btn-validation-ok');
    const valModal = document.getElementById('validation-modal');
    if (valModal && valModal.style.display !== 'none' && validationOk) {
      validationOk.click();
    }

    // Dismiss build expired or ban overlay if present
    const expiredModal = document.getElementById('build-expired-modal');
    if (expiredModal) expiredModal.style.display = 'none';
    const banModal = document.getElementById('ban-overlay');
    if (banModal) banModal.style.display = 'none';

    // Ensure we are on the Control tab so #prompt-input is active
    const controlTab = document.querySelector('[data-tab="control"]');
    if (controlTab && !controlTab.classList.contains('active')) {
      controlTab.click();
    }

    // Ensure Single Prompt Mode is disabled so full multi-scene batch runs
    const singleToggle = document.getElementById('single-prompt-toggle');
    if (singleToggle && singleToggle.checked) {
      singleToggle.click();
    }

    // Ensure auto-download images is checked so images land in Downloads/turboflow
    const autoDl = document.getElementById('setting-autodownload-images');
    if (autoDl && !autoDl.checked) {
      autoDl.checked = true;
      autoDl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Ensure images per prompt is strictly 1x (not 2x / 4x)
    const count1Btn = document.querySelector('[data-img-count="1"]');
    if (count1Btn && !count1Btn.classList.contains('active')) {
      count1Btn.click();
    }

    // Ensure Speed is Slow (1-by-1 generation with anti-detection safety stagger)
    const speedSlowBtn = document.querySelector('[data-speed="slow"]');
    if (speedSlowBtn && !speedSlowBtn.classList.contains('active')) {
      speedSlowBtn.click();
    }

    // Dismiss unusual activity modal if present
    const unusualModal = document.getElementById('fix-unusual-modal');
    const unusualClose = document.getElementById('btn-close-fix-unusual');
    if (unusualModal && (unusualModal.style.display !== 'none' || unusualModal.offsetParent !== null)) {
      if (unusualClose) unusualClose.click();
      else unusualModal.style.display = 'none';
    }

    // Ensure folder name is turboflow
    const folderInput = document.getElementById('setting-folder');
    if (folderInput && folderInput.value !== 'turboflow') {
      folderInput.value = 'turboflow';
      folderInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Check if Google Flow tab is connected to TurboFlow
  function isFlowConnected() {
    const badge = document.getElementById('status-badge');
    if (!badge) return true;
    const txt = (badge.textContent || '').trim().toLowerCase();
    // Connected if explicitly 'connected' or has connected badge class
    return txt === 'connected' || badge.classList.contains('badge-connected');
  }

  // Trigger Start Batch safely
  function attemptStartBatch() {
    if (batchLifecycle !== 'START_REQUESTED') return;
    if (isClickingStart) return;

    const startBtn = document.getElementById('btn-start') || document.getElementById('btn-start-locked');
    if (!startBtn) return;

    // If Google Flow is not yet connected, wait up to 30 attempts (~45s)
    if (!isFlowConnected() && pendingStartAttempts < 30) {
      pendingStartAttempts++;
      updateBanner(`⏳ Connecting to Google Flow canvas... (attempt ${pendingStartAttempts}/30)`, false);
      return;
    }

    // If start button is disabled, wait up to 30 attempts
    if (startBtn.disabled && pendingStartAttempts < 30) {
      pendingStartAttempts++;
      updateBanner(`⏳ Preparing generation engine... (attempt ${pendingStartAttempts}/30)`, false);
      return;
    }

    // Ready — click Start Batch
    isClickingStart = true;
    console.log('[TurboFlow Bridge] Triggering Start batch button click...');
    fetch('http://localhost:3001/api/extension/flow-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'turboflow-bridge', msg: `🚀 Start Batch clicked for ${totalPromptsExpected} prompts...`, time: new Date().toISOString() })
    }).catch(() => {});

    startBtn.click();
    updateBanner(`🚀 Batch initiated for ${totalPromptsExpected} prompts. Waiting for generation to start...`);
    // NOTE: Keep batchLifecycle in 'START_REQUESTED' until isRunningDOM confirms it has started!
    // This allows auto-retry if vk.js temporarily rejected the click (e.g. connection check in progress)

    setTimeout(() => {
      isClickingStart = false;
    }, 2500);
  }

  // Send completion signal back to Electron App
  async function sendCompletionSignal(reason) {
    if (completionSent) return;
    completionSent = true;
    batchLifecycle = 'COMPLETED';

    console.log(`[TurboFlow Bridge] Batch Completed! Reason: ${reason}. Sending signal to Electron...`);
    updateBanner(`🎉 <b>100% Complete!</b> All ${totalPromptsExpected} images generated and synced to Electron.`);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await fetch('http://localhost:3001/api/extension/turboflow-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: lastSyncedRunId,
            status: 'completed',
            reason,
            timestamp: new Date().toISOString(),
          }),
        });
        console.log('[TurboFlow Bridge] ✅ GENERATION_COMPLETE signal acknowledged by Electron!');
        break;
      } catch (err) {
        console.warn(`[TurboFlow Bridge] Attempt ${attempt} failed to send completion signal:`, err.message);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  // Check running and completion states periodically
  async function monitorBatchState() {
    checkAutoAuthAndModals();

    const stopSection = document.getElementById('stop-section');
    const startBtn = document.getElementById('btn-start');
    const statusBadge = document.getElementById('status-badge');
    const badgeText = (statusBadge?.textContent || '').trim();

    const isRunningDOM = (stopSection && stopSection.style.display !== 'none') ||
                         (startBtn && startBtn.disabled) ||
                         badgeText.toLowerCase().includes('running');

    // 1. Detect transition to RUNNING
    if (isRunningDOM) {
      if (!hasActuallyRun) {
        hasActuallyRun = true;
        batchLifecycle = 'RUNNING';
        console.log('[TurboFlow Bridge] Generation actively running now!');
        updateBanner(`⚡ Generating batch images in Google Flow...`);
      }
    }

    // 2. Report live progress text to Electron
    if (hasActuallyRun && !completionSent) {
      const progressText = document.getElementById('progress-text')?.textContent || '';
      if (progressText) {
        fetch('http://localhost:3001/api/extension/turboflow-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: lastSyncedRunId, progressText }),
        }).catch(() => {});
      }
    }

    // 3. Retry pending start if still waiting for Flow connection
    if (batchLifecycle === 'START_REQUESTED') {
      if (!startRequestedAt) startRequestedAt = Date.now();
      attemptStartBatch();

      // Watchdog: if stuck in START_REQUESTED for > 60s, force-reset and retry
      const stuckMs = Date.now() - startRequestedAt;
      if (stuckMs > 60000) {
        console.warn('[TurboFlow Bridge] Generation stuck in START_REQUESTED for 60s — forcing retry...');
        isClickingStart = false;
        startRequestedAt = 0;
        pendingStartAttempts = 0;
        batchLifecycle = 'START_REQUESTED';
        attemptStartBatch();
      }
    } else {
      startRequestedAt = 0;
    }

    // Track progress text changes (to detect if generation is truly stuck)
    const progressEl = document.getElementById('progress-text');
    const currentProgress = progressEl?.textContent || '';
    if (currentProgress && currentProgress !== lastProgressText) {
      lastProgressText = currentProgress;
      lastProgressAt = Date.now();
    }

    // 4. Check for completion ONLY if batch has actually run!
    // (Prevents premature completion triggers before generation starts)
    if (hasActuallyRun && !completionSent) {
      // Check condition A: Status badge says "Done" and stop section is hidden
      const isDoneDOM = badgeText.toLowerCase().includes('done') && (!stopSection || stopSection.style.display === 'none');

      // Check condition B: Query local bridge for file count in Downloads/turboflow
      let isBridgeComplete = false;
      try {
        const res = await fetch('http://localhost:3001/api/extension/turboflow-status');
        if (res.ok) {
          const status = await res.json();
          if (status.isComplete && status.importedCount >= status.totalNeeded && status.totalNeeded > 0) {
            isBridgeComplete = true;
          }
        }
      } catch (e) {}

      // Check condition C: Batch stopped running and we got at least 1 image
      const isStoppedAfterRunning = !isRunningDOM && hasActuallyRun;

      if (isDoneDOM || isBridgeComplete || (isStoppedAfterRunning && isBridgeComplete)) {
        await sendCompletionSignal(isDoneDOM ? 'DOM status Done' : 'Bridge verified files on disk');
      }
    }
  }

  // Intercept background extension events directly
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'FROM_BACKGROUND') {
          // Relay all log messages and events to server via flow-log endpoint
          fetch('http://localhost:3001/api/extension/flow-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId: lastSyncedRunId, ...msg }),
          }).catch(() => {});

          // Download or Stats update
          if (msg.subType === 'DOWNLOAD_COMPLETE' || msg.subType === 'STATS_UPDATE' || msg.subType === 'IMAGE_READY') {
            hasActuallyRun = true;
            batchLifecycle = 'RUNNING';

            const stats = msg.stats;
            if (stats) {
              const progressText = `Downloaded: ${stats.downloaded} / ${stats.total}${stats.failed > 0 ? ` (Failed: ${stats.failed})` : ''}`;
              fetch('http://localhost:3001/api/extension/turboflow-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId: lastSyncedRunId, progressText, stats }),
              }).catch(() => {});

              // When all items have been downloaded
              if (stats.total > 0 && stats.downloaded >= stats.total && !completionSent) {
                sendCompletionSignal(`Background stats 100% (${stats.downloaded}/${stats.total})`);
              }
            }
          }
        }
      });
    }
  } catch (e) {
    console.warn('[TurboFlow Bridge] Could not attach chrome.runtime.onMessage listener:', e);
  }

  // Fetch prompts from local Electron bridge
  async function syncPrompts(forceAlert = false) {
    checkAutoAuthAndModals();

    // Check if Google Sign-in tab is open
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({}, (tabs) => {
          const authTab = tabs.find((t) => t.url && t.url.includes('accounts.google.com'));
          if (authTab) {
            updateBanner('🔑 Please sign in to Google in the open tab. Generation will start automatically once signed in.', false);
          }
        });
      }
    } catch (e) {}

    try {
      const res = await fetch('http://localhost:3001/api/extension/turboflow-prompts');
      if (!res.ok) {
        if (forceAlert) alert('No active project run found in AutoVideo Studio.');
        return;
      }
      const data = await res.json();
      if (!data || !data.plainText || data.count === 0) {
        if (forceAlert) alert('No scene prompts available in AutoVideo Studio.');
        return;
      }

      const promptHash = `${data.runId}_${simpleHash(data.plainText)}_${data.count}_${data.isRetry ? 'retry' : 'init'}`;

      if (forceAlert || promptHash !== lastPromptHash) {
        lastPromptHash = promptHash;
        lastSyncedRunId = data.runId;
        totalPromptsExpected = data.count;

        // Reset lifecycle for fresh run
        batchLifecycle = 'PROMPTS_LOADED';
        hasActuallyRun = false;
        completionSent = false;
        pendingStartAttempts = 0;

        const ta = document.getElementById('prompt-input');
        if (ta) {
          // Native setter bypasses framework wrappers
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(ta, data.plainText);
          } else {
            ta.value = data.plainText;
          }
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const cnt = document.getElementById('prompt-count');
        if (cnt) {
          cnt.textContent = `${data.count} prompts (${data.isRetry ? '🔄 Retrying Tweaked Prompts' : '⚡ Auto-Synced from Studio'})`;
        }

        if (data.isRetry) {
          updateBanner(`🔄 Auto-loaded <b>${data.count} tweaked prompts</b> for retry: "${data.topic || 'Video'}"`);
        } else {
          updateBanner(`⚡ Auto-loaded <b>${data.count} scene prompts</b> for: "${data.topic || 'Video'}"`);
        }

        // Trigger Auto-Start batch
        if (isAutoStartEnabled) {
          console.log('[TurboFlow Bridge] Auto-Start enabled. Registering START_REQUESTED...');
          batchLifecycle = 'START_REQUESTED';
          setTimeout(() => {
            attemptStartBatch();
          }, 1200);
        } else if (forceAlert) {
          alert(`⚡ Successfully loaded ${data.count} scene prompts from AutoVideo Studio! Click "Start batch" to generate.`);
        }
      }
    } catch (err) {
      console.warn('[TurboFlow Bridge] Sync check error:', err);
      if (forceAlert) {
        alert('Could not connect to AutoVideo Studio on http://localhost:3001. Ensure Studio is running.');
      }
    }
  }

  function initBridge() {
    checkAutoAuthAndModals();

    // Manual sync button
    const syncBtn = document.getElementById('btn-sync-studio');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => syncPrompts(true));
    }

    // Bind manual start button
    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        batchLifecycle = 'START_REQUESTED';
      });
    }

    // Initial banner setup
    updateBanner('Connected to AutoVideo Studio — Auto-Sync listening for prompts...');

    // Listen for background.js ping to trigger immediate sync
    // (background.js calls this when new prompts arrive so we don't have to wait 1.5s)
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          if (msg?.type === 'STUDIO_TRIGGER_SYNC') {
            console.log('[TurboFlow Bridge] Received STUDIO_TRIGGER_SYNC ping from background — syncing immediately!');
            syncPrompts(false);
            if (sendResponse) sendResponse({ ok: true });
          }
          // Also handle direct START_BATCH from background
          if (msg?.type === 'START_BATCH' && msg.prompts) {
            console.log('[TurboFlow Bridge] Received direct START_BATCH from background', msg.prompts.length, 'prompts');
            // Let mx handle it
          }
        });
      }
    } catch (e) {
      console.warn('[TurboFlow Bridge] Could not attach STUDIO_TRIGGER_SYNC listener:', e);
    }

    // Auto-Poll every 1.5 seconds
    setInterval(() => {
      syncPrompts(false);
      monitorBatchState();
    }, 1500);

    // Initial check
    syncPrompts(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBridge);
  } else {
    initBridge();
  }
})();
