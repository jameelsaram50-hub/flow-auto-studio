// AI Image Automation Studio - Ultra High Performance Client Script

const SAMPLE_PROMPTS = [
  "Cinematic portrait of a cyberpunk detective walking through neon-lit rain, reflections in puddles, atmospheric haze, 8k resolution",
  "Majestic snow leopard perched on Himalayan mountain cliffs during golden hour sunrise, crisp photorealistic textures",
  "Cozy warm vintage coffee shop interior on a rainy autumn evening, soft bokeh lights, steaming cup on wooden table",
  "Futuristic holographic laboratory with floating AI data visualizers, sleek minimalist architecture, deep blue and amber tones",
  "Mystical bioluminescent enchanted forest with glowing flora, ethereal gentle fog, moonlight filtering through ancient trees"
];

// DOM elements
const promptInput = document.getElementById('prompt-input');
const projectNameInput = document.getElementById('project-name-input');
const promptCounter = document.getElementById('prompt-counter');
const charCounter = document.getElementById('char-counter');
const btnGenerate = document.getElementById('btn-generate');
const btnGeneratePlaywright = document.getElementById('btn-generate-playwright');
const activeModeBadge = document.getElementById('active-mode-badge');
const btnSamplePrompts = document.getElementById('btn-sample-prompts');
const btnClearPrompts = document.getElementById('btn-clear-prompts');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnRelaunch = document.getElementById('btn-relaunch');
const chkAutoLaunch = document.getElementById('chk-auto-launch');

// Speed & Quality Mode Elements
const speedOptFast = document.getElementById('speed-opt-fast');
const speedOptBalanced = document.getElementById('speed-opt-balanced');
const speedOptSlow = document.getElementById('speed-opt-slow');
const qualityOptStd = document.getElementById('quality-opt-std');
const qualityOpt2k = document.getElementById('quality-opt-2k');

// Live Monitor Elements
const progressSection = document.getElementById('progress-section');
const runStatusPill = document.getElementById('run-status-pill');
const monitorSpeedBadge = document.getElementById('monitor-speed-badge');
const activeRunId = document.getElementById('active-run-id');
const btnDismissMonitor = document.getElementById('btn-dismiss-monitor');
const btnToggleMonitor = document.getElementById('btn-toggle-monitor');
const btnAlertDismiss = document.getElementById('btn-alert-dismiss');
const statusAlertText = document.getElementById('status-alert-text');

// Progress Bar Elements
const progressScenesText = document.getElementById('progress-scenes-text');
const progressPercentText = document.getElementById('progress-percent-text');
const progressFill = document.getElementById('progress-fill');

// Scenes & Terminal Logs
const scenesContainer = document.getElementById('scenes-container');
const scenesBadge = document.getElementById('scenes-badge');
const terminalLogs = document.getElementById('terminal-logs');
const terminalContainer = document.getElementById('terminal-container');

// Gallery Elements
const galleryGrid = document.getElementById('gallery-grid');
const galleryCounter = document.getElementById('gallery-counter');
const btnRefreshGallery = document.getElementById('btn-refresh-gallery');

// Modal Elements
const imageModal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-img');
const modalFilename = document.getElementById('modal-filename');
const modalDownload = document.getElementById('modal-download');
const modalClose = document.getElementById('modal-close');
const modalOverlay = document.getElementById('modal-overlay');

// App State
let currentSpeedMode = 'fast'; // Default: Turbo Ultra (3x speed)
let currentImageQuality = 'standard'; // Default: Instant 1080p (skips 8s upscaler delay)
let isMonitorDismissedByUser = false;
let lastRenderedLogCount = 0;
let lastRenderedGalleryKey = '';
let lastRenderedScenesKey = '';
let hasNotifiedCompletion = false;
let pollingTimer = null;

// Check Electron desktop environment
const isElectron = Boolean(window.electronAPI?.isElectron);
const serverStatus = document.getElementById('server-status');
if (isElectron && serverStatus) {
  serverStatus.innerHTML = '<span class="pulse-dot" style="background-color: #38bdf8; box-shadow: 0 0 10px #38bdf8;"></span><span class="status-text" style="color: #38bdf8;">Electron Desktop Controller</span>';
  serverStatus.style.borderColor = 'rgba(56, 189, 248, 0.4)';
  serverStatus.style.background = 'rgba(56, 189, 248, 0.12)';
}

// Generation mode: Playwright is the only engine
let currentGenerationMode = 'playwright';
const modeHintText = document.getElementById('mode-hint-text');

function setGenerationMode() {
  currentGenerationMode = 'playwright';
  const btnText = document.getElementById('btn-generate')?.querySelector('.btn-text');
  if (activeModeBadge) activeModeBadge.textContent = 'Active Mode: ⚡ Fast Generation';
  if (modeHintText) {
    modeHintText.innerHTML = '⚡ <b>Fast Mode:</b> Automates generation directly in the background with continuous live preview.';
  }
  if (btnText) btnText.textContent = 'Generate Images';
}
setGenerationMode();

// Speed Mode handlers
function setSpeedMode(mode) {
  currentSpeedMode = mode;
  [speedOptFast, speedOptBalanced, speedOptSlow].forEach((el) => el?.classList.remove('active'));
  if (mode === 'fast') {
    speedOptFast?.classList.add('active');
    if (monitorSpeedBadge) monitorSpeedBadge.textContent = '🚀 Turbo Ultra (3x)';
  } else if (mode === 'balanced') {
    speedOptBalanced?.classList.add('active');
    if (monitorSpeedBadge) monitorSpeedBadge.textContent = '⚡ Turbo Balanced (2x)';
  } else {
    speedOptSlow?.classList.add('active');
    if (monitorSpeedBadge) monitorSpeedBadge.textContent = '🛡️ Safe Slow (1x)';
  }
  console.log('[Speed] Mode set to:', mode);
}

speedOptFast?.addEventListener('click', () => setSpeedMode('fast'));
speedOptBalanced?.addEventListener('click', () => setSpeedMode('balanced'));
speedOptSlow?.addEventListener('click', () => setSpeedMode('slow'));

// Quality Mode handlers
function setQualityMode(quality) {
  currentImageQuality = quality;
  [qualityOptStd, qualityOpt2k].forEach((el) => el?.classList.remove('active'));
  if (quality === 'standard') {
    qualityOptStd?.classList.add('active');
  } else {
    qualityOpt2k?.classList.add('active');
  }
  console.log('[Quality] Mode set to:', quality);
}

qualityOptStd?.addEventListener('click', () => setQualityMode('standard'));
qualityOpt2k?.addEventListener('click', () => setQualityMode('2k'));

// Speed selector handlers
let currentWorkerCount = 1; // Default: 1 Worker (Safest & Maximum Stability)
const workerPills = document.querySelectorAll('#worker-count-group .speed-pill-option');
workerPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    workerPills.forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    const radio = pill.querySelector('input[type="radio"]');
    if (radio) {
      radio.checked = true;
      currentWorkerCount = parseInt(radio.value, 10) || 7;
      if (typeof updateWorkerCanvasTabs === 'function') {
        updateWorkerCanvasTabs(currentWorkerCount);
      }
      console.log('[Workers] Parallel Worker Count set to:', currentWorkerCount);
    }
  });
});

// Dismiss & Restore Monitor Handlers
function dismissMonitor() {
  console.log('[UI] Monitor dismissed by user');
  isMonitorDismissedByUser = true;
  if (progressSection) progressSection.style.display = 'none';
}

function showMonitor() {
  console.log('[UI] Monitor restored by user');
  isMonitorDismissedByUser = false;
  if (progressSection) progressSection.style.display = 'block';
}

btnDismissMonitor?.addEventListener('click', dismissMonitor);
btnAlertDismiss?.addEventListener('click', dismissMonitor);
btnToggleMonitor?.addEventListener('click', () => {
  if (progressSection && progressSection.style.display !== 'none') {
    dismissMonitor();
  } else {
    showMonitor();
  }
});

const btnFocusChrome = document.getElementById('btn-focus-chrome');
btnFocusChrome?.addEventListener('click', async () => {
  try {
    await fetch('/api/focus-chrome', { method: 'POST' });
  } catch (e) {
    console.warn('Error focusing Chrome:', e);
  }
});

const btnResetSession = document.getElementById('btn-reset-session');
btnResetSession?.addEventListener('click', async () => {
  try {
    await fetch('/api/clear-queue', { method: 'POST' });
    isMonitorDismissedByUser = true;
    dismissMonitor();
    fetchStatus();
  } catch (e) {
    console.warn('Error resetting session:', e);
  }
});

// Parse prompts from textarea
function getPromptsList() {
  const text = promptInput.value || '';
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

// Update counters
function updateCounters() {
  const prompts = getPromptsList();
  const count = prompts.length;
  promptCounter.textContent = `${count} ${count === 1 ? 'Prompt' : 'Prompts'}`;
  charCounter.textContent = `${count} ${count === 1 ? 'Prompt' : 'Prompts'}`;

  if (btnGenerate) btnGenerate.classList.toggle('disabled', count === 0);
  if (btnGeneratePlaywright) btnGeneratePlaywright.classList.toggle('disabled', count === 0);
}

promptInput.addEventListener('input', updateCounters);

// Load sample prompts
btnSamplePrompts?.addEventListener('click', () => {
  promptInput.value = SAMPLE_PROMPTS.join('\n\n');
  updateCounters();
  promptInput.focus();
});

// Clear prompts
btnClearPrompts?.addEventListener('click', () => {
  promptInput.value = '';
  updateCounters();
  promptInput.focus();
});

// Update Pipeline Stepper & Overall Progress Bar
function updateStepper(state, activeRun, currentRunCount) {
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step3 = document.getElementById('step-3');
  const step4 = document.getElementById('step-4');

  const line1 = document.getElementById('line-1');
  const line2 = document.getElementById('line-2');
  const line3 = document.getElementById('line-3');

  const step1Desc = document.getElementById('step-1-desc');
  const step2Desc = document.getElementById('step-2-desc');
  const step3Desc = document.getElementById('step-3-desc');
  const step4Desc = document.getElementById('step-4-desc');

  // Reset Stepper
  [step1, step2, step3, step4].forEach((s) => s?.classList.remove('active', 'done'));
  [line1, line2, line3].forEach((l) => l?.classList.remove('active'));

  if (!activeRun || !activeRun.runId) {
    if (isMonitorDismissedByUser) {
      if (progressSection) progressSection.style.display = 'none';
    } else {
      if (progressSection) progressSection.style.display = 'block';
    }
    return;
  }

  // Handle visibility based on user dismissal
  if (isMonitorDismissedByUser) {
    if (progressSection) progressSection.style.display = 'none';
  } else {
    if (progressSection) progressSection.style.display = 'block';
  }

  if (activeRunId) activeRunId.textContent = activeRun.runId;

  // Speed Badge update
  if (monitorSpeedBadge) {
    const sm = activeRun.speedMode || currentSpeedMode || 'fast';
    if (sm === 'fast') monitorSpeedBadge.textContent = '🚀 Turbo Ultra (3x)';
    else if (sm === 'balanced') monitorSpeedBadge.textContent = '⚡ Turbo Balanced (2x)';
    else monitorSpeedBadge.textContent = '🛡️ Safe Slow (1x)';
  }

  const total = activeRun.count || 0;
  const currentCount = currentRunCount || 0;
  const percent = total > 0 ? Math.min(100, Math.round((currentCount / total) * 100)) : 0;

  // Overall Progress Bar
  if (progressScenesText) progressScenesText.textContent = `${currentCount} of ${total} Scenes Ready`;
  if (progressPercentText) progressPercentText.textContent = `${percent}%`;
  if (progressFill) progressFill.style.width = `${percent}%`;

  // Step 1: Queued
  step1?.classList.add('done');
  if (step1Desc) step1Desc.textContent = `${total} Prompts ready`;
  line1?.classList.add('active');

  // Step 2: Chrome Launched
  if (activeRun.chromeLaunched) {
    step2?.classList.add('done');
    if (step2Desc) step2Desc.textContent = 'Engine running';
    line2?.classList.add('active');
  } else {
    step2?.classList.add('active');
    if (step2Desc) step2Desc.textContent = 'Launching...';
  }

  // Step 3: Prompts synced
  if (activeRun.status === 'syncing' || activeRun.status === 'generating' || activeRun.status === 'completed' || currentCount > 0) {
    step3?.classList.add('done');
    if (step3Desc) step3Desc.textContent = 'Prompts queued';
    line3?.classList.add('active');
  } else {
    step3?.classList.add('active');
    if (step3Desc) step3Desc.textContent = 'Waiting for prompts...';
  }

  // Step 4: Batch Generating / Complete
  const isDone = (total > 0 && currentCount >= total);
  const isPartial = (activeRun.status === 'completed' && currentCount < total);

  if (isDone) {
    step4?.classList.add('done');
    if (step4Desc) step4Desc.textContent = `Completed (${currentCount}/${total})`;
    if (runStatusPill) {
      runStatusPill.textContent = 'Completed';
      runStatusPill.style.background = 'rgba(52, 211, 153, 0.2)';
      runStatusPill.style.borderColor = 'rgba(52, 211, 153, 0.5)';
      runStatusPill.style.color = '#34d399';
    }
    if (statusAlertText) {
      statusAlertText.innerHTML = `🎉 <b>All ${total} images generated & saved successfully!</b> You can dismiss this monitor anytime.`;
    }
    if (btnAlertDismiss) {
      btnAlertDismiss.style.display = 'inline-block';
    }

    if (window.electronAPI?.showNotification && !hasNotifiedCompletion) {
      hasNotifiedCompletion = true;
      window.electronAPI.showNotification('🎉 Batch Images Complete', `All ${total} images generated successfully!`);
    }
  } else if (isPartial) {
    step4?.classList.add('active');
    if (step4Desc) step4Desc.textContent = `Partial (${currentCount}/${total} generated)`;
    if (runStatusPill) {
      runStatusPill.textContent = 'Partial Run';
      runStatusPill.style.background = 'rgba(245, 158, 11, 0.2)';
      runStatusPill.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      runStatusPill.style.color = '#fbbf24';
    }
    if (statusAlertText) {
      statusAlertText.innerHTML = `⚠️ <b>${currentCount} of ${total} images ready.</b> (${total - currentCount} scenes unfinished. Ensure your extra channels are signed in).`;
    }
    if (btnAlertDismiss) {
      btnAlertDismiss.style.display = 'inline-block';
    }
  } else if (currentCount > 0) {
    step4?.classList.add('active');
    if (step4Desc) step4Desc.textContent = `Generating (${currentCount}/${total} ready)`;
    if (runStatusPill) {
      runStatusPill.textContent = 'Generating';
      runStatusPill.style.background = 'rgba(245, 158, 11, 0.2)';
      runStatusPill.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      runStatusPill.style.color = '#fbbf24';
    }
    if (statusAlertText) {
      statusAlertText.innerHTML = `⏳ <b>${currentCount} of ${total} images ready.</b> Generating remaining scenes...`;
    }
    if (btnAlertDismiss) btnAlertDismiss.style.display = 'none';
  } else {
    step4?.classList.add('active');
    if (step4Desc) step4Desc.textContent = `Batch starting (${total} scenes)`;
    if (runStatusPill) {
      runStatusPill.textContent = 'Processing';
      runStatusPill.style.background = 'rgba(56, 189, 248, 0.15)';
      runStatusPill.style.borderColor = 'rgba(56, 189, 248, 0.3)';
      runStatusPill.style.color = '#38bdf8';
    }
    if (statusAlertText) {
      statusAlertText.innerHTML = `🚀 <b>Prompts transferred to Easy AI Hub!</b> Image generation is in progress.`;
    }
    if (btnAlertDismiss) btnAlertDismiss.style.display = 'none';
  }
}

// Render Scene-by-Scene Tracker (With Diff Caching to avoid UI re-rendering lag)
function renderScenesList(scenes, currentRunCount) {
  if (!scenesContainer) return;
  if (!scenes || scenes.length === 0) {
    scenesContainer.innerHTML = '<div class="empty-scenes-hint">Queued prompts will appear here scene-by-scene.</div>';
    if (scenesBadge) scenesBadge.textContent = '0 / 0';
    lastRenderedScenesKey = '';
    return;
  }

  if (scenesBadge) {
    scenesBadge.textContent = `${currentRunCount || 0} / ${scenes.length}`;
  }

  // Create a fingerprint of the current scene state to skip DOM thrashing
  const currentKey = scenes.map((s) => `${s.id}:${s.status}:${s.image || ''}`).join('|');
  if (currentKey === lastRenderedScenesKey) return;
  lastRenderedScenesKey = currentKey;

  scenesContainer.innerHTML = scenes
    .map((sc, idx) => {
      const isCompleted = sc.status === 'completed' || sc.image;
      const isGenerating = sc.status === 'generating' || (!isCompleted && idx === currentRunCount);
      const statusClass = isCompleted ? 'status-completed' : (isGenerating ? 'status-generating' : 'status-pending');
      const pillClass = isCompleted ? 'pill-completed' : (isGenerating ? 'pill-generating' : 'pill-pending');
      const statusLabel = isCompleted ? '✓ Done' : (isGenerating ? '⚡ Generating...' : '🕒 Pending');

      const thumbHtml = sc.imageUrl
        ? `<img src="${sc.imageUrl}" alt="Scene ${sc.id}" onclick="openPreview('${sc.imageUrl}', '${sc.image}')" title="Click to preview Scene ${sc.id}" />`
        : (isGenerating
            ? `<svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle></svg>`
            : `<span style="font-size: 0.72rem; color: #64748b;">#${sc.id}</span>`);

      const chromeShotBtn = sc.chromeScreenshotUrl ? `
        <button type="button" class="btn-scene-chrome" onclick="event.stopPropagation(); window.openPreview('${sc.chromeScreenshotUrl}', 'Scene ${sc.id} Canvas View')" title="View canvas viewport captured during generation of Scene ${sc.id}">
          📸 Canvas View
        </button>
      ` : '';

      return `
        <div class="scene-card-item ${statusClass}">
          <div class="scene-thumb-slot">
            ${thumbHtml}
          </div>
          <div class="scene-card-body">
            <div class="scene-card-meta">
              <span class="scene-number-tag">Scene ${sc.id}</span>
              <span class="scene-status-pill ${pillClass}">${statusLabel}</span>
              ${chromeShotBtn}
            </div>
            <span class="scene-prompt-snippet" title="${sc.prompt}">${sc.prompt}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// Render Real-time Activity Logs
function renderLogs(logs) {
  if (!terminalLogs || !logs || logs.length === 0) return;
  if (logs.length === lastRenderedLogCount) return;
  lastRenderedLogCount = logs.length;

  const latestShotLog = [...logs].reverse().find(l => l.screenshotUrl);
  const btnConsoleShot = document.getElementById('btn-console-latest-shot');
  if (btnConsoleShot) {
    if (latestShotLog && latestShotLog.screenshotUrl) {
      btnConsoleShot.style.display = 'inline-flex';
      btnConsoleShot.onclick = () => window.openPreview(latestShotLog.screenshotUrl, 'Latest Canvas View');
    }
  }

  terminalLogs.innerHTML = logs
    .map((l) => {
      let tagClass = 'tag-sys';
      const s = (l.source || '').toLowerCase();
      if (s.includes('flow')) tagClass = 'tag-flow';
      else if (s.includes('ext')) tagClass = 'tag-ext';
      else if (s.includes('studio') || s.includes('server') || s.includes('launch')) tagClass = 'tag-studio';
      else if (s.includes('store') || s.includes('disk')) tagClass = 'tag-store';

      let textClass = 'log-text-info';
      if (l.type === 'error' || (l.text && l.text.includes('❌'))) textClass = 'log-text-error';
      else if (l.type === 'success' || (l.text && (l.text.includes('✅') || l.text.includes('🎉')))) textClass = 'log-text-success';
      else if (l.type === 'warn' || (l.text && l.text.includes('⚠️'))) textClass = 'log-text-warn';

      const screenshotBtn = l.screenshotUrl ? `
        <button type="button" class="btn-log-screenshot" onclick="window.openPreview('${l.screenshotUrl}', 'Canvas Snapshot — ${l.time || ''}')" title="Click to view screenshot captured at this moment">
          📸 View Screen
        </button>
      ` : '';

      return `
        <div class="terminal-row ${textClass}">
          <span class="log-time" style="color: #475569; font-size: 0.7rem;">${l.time || ''}</span>
          <span class="log-tag ${tagClass}">[${l.source || 'Log'}]</span>
          <span>${l.text || ''}</span>
          ${screenshotBtn}
        </div>
      `;
    })
    .join('');

  if (terminalContainer) {
    terminalContainer.scrollTop = terminalContainer.scrollHeight;
  }
}

// Render Gallery (With Diff Caching to avoid UI repainting lag)
function renderGallery(images, currentRunCount) {
  if (galleryCounter) {
    galleryCounter.textContent = `${images.length} ${images.length === 1 ? 'Image' : 'Images'}`;
  }

  if (images.length === 0) {
    galleryGrid.innerHTML = `
      <div class="gallery-empty-state">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        </div>
        <h4>No Images Generated Yet</h4>
        <p>Generated images will appear here live from <code>Downloads/easyaihub</code>.</p>
      </div>
    `;
    lastRenderedGalleryKey = '';
    return;
  }

  // Fast hash check to skip DOM rebuild if images haven't changed
  const currentKey = images.map((img) => `${img.filename}:${img.mtime}`).join('|');
  if (currentKey === lastRenderedGalleryKey) return;
  lastRenderedGalleryKey = currentKey;

  galleryGrid.innerHTML = images
    .map((img) => {
      const date = new Date(img.mtime).toLocaleTimeString();
      return `
        <div class="gallery-card-item" onclick="openPreview('${img.url}', '${img.filename}')">
          <img src="${img.url}" alt="${img.filename}" loading="lazy" />
          ${img.isCurrentRun ? '<span class="gallery-badge-new">NEW</span>' : ''}
          <div class="gallery-overlay">
            <span class="gallery-filename">${img.filename}</span>
            <span style="font-size: 0.7rem; color: #94a3b8;">${date}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// Open modal preview
window.openPreview = function (url, filename) {
  if (!url) return;
  if (modalImg) modalImg.src = url;
  if (modalFilename) modalFilename.textContent = filename || 'Preview';
  if (modalDownload) {
    modalDownload.href = url;
    modalDownload.setAttribute('download', filename || 'image.png');
  }
  if (imageModal) imageModal.classList.add('open');
};

function closeModal() {
  if (imageModal) imageModal.classList.remove('open');
}

modalClose?.addEventListener('click', closeModal);
modalOverlay?.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    if (typeof closeProfileModal === 'function') closeProfileModal();
  }
});

// Fetch server status & live images with adaptive polling
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    window.serverActiveRun = data.activeRun || null;
    updateStepper(data.activeRun?.status, data.activeRun, data.currentRunCount);
    renderScenesList(data.scenes || [], data.currentRunCount);
    renderLogs(data.logs || []);
    renderGallery(data.images || [], data.currentRunCount);
    renderWorkerTelemetry(data.activeRun);
    updateWorkerCanvasTabs(data.activeRun?.workerCount || currentWorkerCount || 7);

    // Schedule next poll adaptively: 1000ms when active, 2500ms when idle
    const isBusy = data.activeRun?.status === 'generating' || data.activeRun?.status === 'launched' || data.activeRun?.status === 'syncing';
    scheduleNextPoll(isBusy ? 1000 : 2500);
  } catch (err) {
    console.warn('Status fetch error:', err);
    scheduleNextPoll(3000);
  }
}

// Render Multi-Worker Live Status Cards
function renderWorkerTelemetry(activeRun) {
  const grid = document.getElementById('workers-live-grid');
  const badge = document.getElementById('workers-active-count-badge');
  if (!grid) return;

  const numWorkers = activeRun?.workerCount || currentWorkerCount || 7;
  const isGenerating = activeRun?.status === 'generating';
  const workerStatus = activeRun?.workerStatus || {};

  if (badge) {
    badge.textContent = isGenerating ? `${numWorkers} Workers Active` : `${numWorkers} Workers Standby`;
    badge.style.color = isGenerating ? '#4ade80' : '#38bdf8';
    badge.style.borderColor = isGenerating ? 'rgba(74, 222, 128, 0.4)' : 'rgba(56, 189, 248, 0.3)';
    badge.style.background = isGenerating ? 'rgba(74, 222, 128, 0.15)' : 'rgba(56, 189, 248, 0.15)';
  }

  let html = '';
  for (let w = 1; w <= numWorkers; w++) {
    const st = workerStatus[w];
    const isWNotLoggedIn = st?.status === 'not_logged_in';
    const isWActive = isGenerating && Boolean(st) && !isWNotLoggedIn;
    let progressDesc = st ? `${st.localIndex || 0}/${st.workerScenes || 0}` : 'Idle';
    if (isWNotLoggedIn) progressDesc = 'Reassigned to W#1';
    let statusText = 'Standby';
    let statusColor = '#64748b';
    if (isWNotLoggedIn) {
      statusText = '⚠️ Sign in Needed';
      statusColor = '#f87171';
    } else if (isWActive) {
      statusText = st.status === 'generating_scene' ? `⚡ Scene ${st.sceneIndex}` : (st.status === 'running_fallback' ? '🔄 Fallback' : 'Active');
      statusColor = '#38bdf8';
    }
    const borderCol = isWNotLoggedIn ? 'rgba(248, 113, 113, 0.4)' : (isWActive ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255,255,255,0.08)');
    const bgCol = isWNotLoggedIn ? 'rgba(248, 113, 113, 0.1)' : (isWActive ? 'rgba(56, 189, 248, 0.1)' : 'rgba(15, 23, 42, 0.6)');

    html += `
      <div style="background: ${bgCol}; border: 1px solid ${borderCol}; border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 0.76rem; font-weight: 700; color: #f8fafc;">Worker #${w}</span>
          <span style="font-size: 0.65rem; color: ${statusColor}; font-weight: 600;">${statusText}</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #94a3b8;">
          <span>Progress:</span>
          <span style="font-weight: 600; color: ${isWNotLoggedIn ? '#f87171' : '#e2e8f0'};">${progressDesc}</span>
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;
}

function scheduleNextPoll(delayMs) {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = setTimeout(fetchStatus, delayMs);
}

// Start Generation function handling both modes cleanly
async function startGeneration() {
  const activeMode = 'playwright';
  console.log('[UI Click] Start generation requested in mode:', activeMode);

  let prompts = getPromptsList();
  if (prompts.length === 0) {
    console.log('[UI] Prompt input empty, loading sample prompts automatically...');
    promptInput.value = SAMPLE_PROMPTS.join('\n\n');
    updateCounters();
    prompts = getPromptsList();
  }

  const launchBrowser = chkAutoLaunch ? chkAutoLaunch.checked : true;

  // Disable buttons while launching
  const buttonsToDisable = [btnGenerate, btnGeneratePlaywright].filter(Boolean);
  buttonsToDisable.forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = '0.7';
  });

  const targetBtn = btnGeneratePlaywright || btnGenerate;
  const originalHtml = targetBtn ? targetBtn.innerHTML : '';
  if (targetBtn) {
    targetBtn.innerHTML = `
      <span class="btn-content">
        <svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle></svg>
        <span>Queueing Prompts & Launching Flow...</span>
      </span>
    `;
  }

  try {
    const projectName = (projectNameInput?.value || '').trim() || 'Project_' + Date.now().toString().slice(-6);
    hasNotifiedCompletion = false;
    isMonitorDismissedByUser = false;

    console.log('[UI] Sending /api/generate for project:', projectName, 'with', prompts.length, 'prompts, mode:', activeMode);

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts,
        launchBrowser,
        projectName,
        generationMode: activeMode,
        workerCount: currentWorkerCount,
        speedMode: currentSpeedMode,
        imageQuality: currentImageQuality,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start generation');
    }

    console.log('[UI] Server acknowledged generation:', data);

    // Show progress monitor immediately
    if (progressSection) progressSection.style.display = 'block';
    if (btnToggleMonitor) btnToggleMonitor.style.display = 'none';
    if (btnAlertDismiss) btnAlertDismiss.style.display = 'none';

    if (statusAlertText) {
              statusAlertText.innerHTML = `🚀 <b>${prompts.length} Prompts Queued for "${data.projectId || projectName}"!</b> Generating across <b>${data.workerCount || currentWorkerCount} Parallel Channels</b> at <b>${(data.speedMode || currentSpeedMode).toUpperCase()}</b> speed.`;
    }

    // Immediately trigger status refresh
    fetchStatus();
  } catch (err) {
    console.error('[UI Error]', err);
    if (progressSection) progressSection.style.display = 'block';
    if (statusAlertText) {
      statusAlertText.innerHTML = `<span style="color: #ef4444; font-weight: 600;">❌ Error: ${err.message}</span>`;
    }
  } finally {
    setTimeout(() => {
      buttonsToDisable.forEach((btn) => {
        btn.disabled = false;
        btn.style.opacity = '1';
      });
      if (targetBtn && originalHtml) {
        targetBtn.innerHTML = originalHtml;
      }
    }, 1500);
  }
}

// Bind clicks
btnGenerate?.addEventListener('click', () => startGeneration());
btnGeneratePlaywright?.addEventListener('click', () => startGeneration());

// Open downloads folder
btnOpenFolder?.addEventListener('click', async () => {
  if (window.electronAPI?.openPath) {
    window.electronAPI.openPath();
    return;
  }
  try {
    const res = await fetch('/api/open-downloads', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      console.log('Opened folder:', data.path);
    }
  } catch (e) {
    alert('Could not open downloads folder: ' + e.message);
  }
});

// Relaunch Chrome button
btnRelaunch?.addEventListener('click', async () => {
  try {
    await fetch('/api/relaunch-chrome', { method: 'POST' });
    fetchStatus();
  } catch (e) {
    alert('Could not launch engine: ' + e.message);
  }
});

// 🔄 Reset Studio to Initial Clean State (Preserves Chrome Google Login)
const btnResetStudio = document.getElementById('btn-reset-studio');
const btnResetStudioMain = document.getElementById('btn-reset-studio-main');

async function handleStudioReset(btn) {
  const confirmed = confirm('Reset the studio to a fresh start?\n\n- Stops all workers and clears the queue\n- Clears prompts, logs, progress and the gallery view\n- Restores default settings (mode, workers, speed, quality)\n\nKept: your Google logins and all image files already saved in Downloads\\easyaihub.');
  if (!confirmed) return;

  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span><span>Resetting App...</span>';
  }

  try {
    const res = await fetch('/api/reset-app', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      // 1. Clear prompt input & counters
      if (promptInput) promptInput.value = '';
      updateCounters();

      // 2. Reset project name to fresh default
      if (projectNameInput) {
        projectNameInput.value = 'Project_' + Date.now().toString().slice(-6);
      }

      // 3. Reset speed and quality to default
      setSpeedMode('fast');
      setQualityMode('standard');

      // 4. Hide progress section & alerts
      if (progressSection) progressSection.style.display = 'none';
      if (btnToggleMonitor) btnToggleMonitor.style.display = 'inline-flex';
      if (statusAlertText) statusAlertText.innerHTML = '';

      // 5. Reset monitor error and states
      isMonitorDismissedByUser = false;
      hasNotifiedCompletion = false;

      if (btn) {
        btn.innerHTML = '<span>✅</span><span>Reset Done!</span>';
        btn.style.borderColor = 'rgba(34,197,94,0.5)';
        btn.style.color = '#4ade80';
      }

      // Forget remembered UI settings and reload the page so every panel,
      // counter, tab and timer starts exactly like a fresh app launch
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('flow_') || k.startsWith('easyaihub'))
          .forEach((k) => localStorage.removeItem(k));
      } catch (e) {}
      setTimeout(() => window.location.reload(), 600);
    } else {
      throw new Error(data.error || 'Failed to reset');
    }
  } catch (err) {
    alert('Error resetting app: ' + err.message);
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 3000);
    }
  }
}

btnResetStudio?.addEventListener('click', () => handleStudioReset(btnResetStudio));
btnResetStudioMain?.addEventListener('click', () => handleStudioReset(btnResetStudioMain));

// 🧹 Quick Clear Engine Cache
const btnFixUnusualQuick = document.getElementById('btn-fix-unusual-quick');
btnFixUnusualQuick?.addEventListener('click', async () => {
  const orig = btnFixUnusualQuick.innerHTML;
  btnFixUnusualQuick.disabled = true;
  btnFixUnusualQuick.innerHTML = '<span>⏳</span> Clearing...';
  try {
    const res = await fetch('/api/fix-unusual-activity', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      btnFixUnusualQuick.innerHTML = '<span>✅</span> Done!';
      showToast('🧹 Engine Cache Cleared', 'Engine site data reset and fresh canvas ready!', 6000);
    } else {
      throw new Error(data.error || 'Failed to clear');
    }
  } catch (e) {
    alert('Could not clear Flow cache: ' + e.message);
  } finally {
    setTimeout(() => {
      btnFixUnusualQuick.disabled = false;
      btnFixUnusualQuick.innerHTML = orig;
    }, 2500);
  }
});

// 🔑 Account Manager Modal Logic
const btnOpenAccountsMgr = document.getElementById('btn-open-accounts-mgr');
const profileModal = document.getElementById('profile-modal');
const profileModalClose = document.getElementById('profile-modal-close');
const profileModalOverlay = document.getElementById('profile-modal-overlay');
const profilesGrid = document.getElementById('profiles-grid');

function openProfileModal() {
  if (profileModal) {
    profileModal.style.display = 'flex';
    profileModal.classList.add('open');
  }
  loadProfilesStatus();
}

function closeProfileModal() {
  if (profileModal) {
    profileModal.classList.remove('open');
    profileModal.style.display = 'none';
  }
}

btnOpenAccountsMgr?.addEventListener('click', openProfileModal);
profileModalClose?.addEventListener('click', closeProfileModal);
profileModalOverlay?.addEventListener('click', closeProfileModal);

async function loadProfilesStatus() {
  if (!profilesGrid) return;
  profilesGrid.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; padding: 20px; text-align: center;">Checking speed channels...</div>';
  try {
    const res = await fetch('/api/profiles/status');
    const data = await res.json();
    if (data.success && Array.isArray(data.profiles)) {
      renderProfilesList(data.profiles);
    }
  } catch (err) {
    profilesGrid.innerHTML = `<div style="color: #ef4444; font-size: 0.85rem; padding: 12px;">Error loading profiles: ${err.message}</div>`;
  }
}

function renderProfilesList(profiles) {
  if (!profilesGrid) return;
  profilesGrid.innerHTML = profiles.map(p => {
    const hasLogin = p.hasLogin;
    const email = p.email;
    const badgeColor = hasLogin ? '#22c55e' : '#f59e0b';
    const badgeText = hasLogin ? (email ? `✓ ${email}` : '✓ Logged In') : '⚠️ Login Needed';
    const isPrimary = p.workerId === 1;

    return `
      <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid ${hasLogin ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-weight: 700; font-size: 0.88rem; color: #f8fafc;">
            🌐 Channel #${p.workerId} ${isPrimary ? '<span style="font-size: 0.65rem; background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); border-radius: 4px; padding: 1px 4px; margin-left: 4px;">MAIN</span>' : ''}
          </span>
          <span style="font-size: 0.72rem; color: ${badgeColor}; font-weight: 600;">
            ${badgeText}
          </span>
        </div>
        <div style="font-size: 0.72rem; color: #64748b; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.profileDir}">
          Profile #${p.workerId}
        </div>
        <button type="button" class="btn btn-xs" onclick="window.launchWorkerLogin(${p.workerId}, this)" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 0.78rem; font-weight: 600; padding: 6px 10px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 4px;">
          <span>🌐</span> ${hasLogin ? 'Active Channel #' + p.workerId : 'Activate Channel #' + p.workerId}
        </button>
      </div>
    `;
  }).join('');
}

window.launchWorkerLogin = async function(workerId, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Opening Window...';
  try {
    const res = await fetch('/api/profiles/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId })
    });
    const data = await res.json();
    if (data.success) {
      btn.innerHTML = '<span>✅</span> Window Opened!';
      btn.style.color = '#4ade80';
      showToast(`Channel #${workerId} Opened`, `Complete the one-time sign in. Your login will be saved permanently.`, 9000);
      setTimeout(() => loadProfilesStatus(), 4000);
    } else {
      throw new Error(data.error || 'Failed to open window');
    }
  } catch (err) {
    alert('Error opening Channel #' + workerId + ': ' + err.message);
    btn.innerHTML = orig;
    btn.disabled = false;
  }
};

// 💾 Save Login Session button
const btnSaveSession = document.getElementById('btn-save-session');
btnSaveSession?.addEventListener('click', async () => {
  const orig = btnSaveSession.innerHTML;
  btnSaveSession.disabled = true;
  btnSaveSession.innerHTML = '⏳ Saving...';
  try {
    const res = await fetch('/api/save-session', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      btnSaveSession.innerHTML = '✅ Session Saved!';
      btnSaveSession.style.color = '#22c55e';
      showToast('💾 Google Login Session Saved!',
        `Saved ${data.savedFiles.length} session files.<br><br>
         <b>Your session is saved for automatic generation.</b><br>
         No more manual login needed!`, 10000);
      checkSessionStatus();
    } else {
      alert('Error: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Could not save session: ' + e.message);
  } finally {
    setTimeout(() => {
      btnSaveSession.disabled = false;
      btnSaveSession.innerHTML = orig;
      btnSaveSession.style.color = '';
    }, 3000);
  }
});

// ❌ Close Chrome button
const btnKillChrome = document.getElementById('btn-kill-chrome');
btnKillChrome?.addEventListener('click', async () => {
  const orig = btnKillChrome.innerHTML;
  btnKillChrome.disabled = true;
  btnKillChrome.innerHTML = '⏳ Closing...';
  try {
    const res = await fetch('/api/kill-chrome', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      btnKillChrome.innerHTML = '✅ Window Closed';
    }
  } catch (e) {}
  finally {
    setTimeout(() => {
      btnKillChrome.disabled = false;
      btnKillChrome.innerHTML = orig;
    }, 2000);
  }
});

// Toast notification helper
function showToast(title, body, duration = 8000) {
  const existing = document.getElementById('tf-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'tf-toast';
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: rgba(15,23,42,0.97); border: 1px solid rgba(99,102,241,0.5);
    border-radius: 12px; padding: 16px 20px; max-width: 380px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5); color: #e2e8f0;
    font-size: 13px; line-height: 1.6;
  `;
  toast.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#818cf8;">${title}</div>
    <div style="color:#94a3b8;margin-bottom:12px;">${body}</div>
    <button onclick="this.parentNode.remove()" style="background:rgba(99,102,241,0.3);border:none;border-radius:6px;color:#c7d2fe;padding:6px 14px;cursor:pointer;font-size:12px;width:100%;">Got it ✓</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
}

// Session status indicator
async function checkSessionStatus() {
  try {
    const res = await fetch('/api/session-status');
    const data = await res.json();
    const badge = document.getElementById('session-status-badge');
    const badgeText = document.getElementById('session-status-text');
    if (badge && badgeText) {
      if (data.sessionSaved) {
        badge.style.display = 'flex';
        badgeText.textContent = 'Login Saved ✓';
      } else {
        badge.style.display = 'flex';
        badge.style.borderColor = 'rgba(251,191,36,0.3)';
        badge.style.background = 'rgba(251,191,36,0.1)';
        badge.style.color = '#fbbf24';
        badgeText.textContent = '⚠️ No Session — Log in & Save';
      }
    }
  } catch (e) {}
}

// Refresh gallery button
btnRefreshGallery?.addEventListener('click', fetchStatus);

// Check session status on load
checkSessionStatus();
setInterval(checkSessionStatus, 30000); // refresh every 30s

// Start adaptive polling
fetchStatus();

/* ============================================================== */
/* CONTINUOUS LIVE CHROME CANVAS STREAM (VIDEO-LIKE PLAYBACK)     */
/* ============================================================== */
let liveStreamActive = true;
let isFetchingFrame = false;

let currentLiveWorkerId = 1;

function updateWorkerCanvasTabs(workerCount) {
  const container = document.getElementById('live-worker-switcher');
  if (!container) return;
  const count = Math.max(1, Math.min(Number(workerCount) || 2, 7));
  let html = '';
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  for (const i of ids) {
    const isActive = i === currentLiveWorkerId;
    const bg = isActive ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)';
    const col = isActive ? '#38bdf8' : '#94a3b8';
    const border = isActive ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.1)';
    const label = `Worker #${i}`;
    html += `<button type="button" class="btn btn-xs live-worker-tab ${isActive ? 'active' : ''}" data-worker="${i}" style="padding: 2px 8px; font-size: 0.72rem; border-radius: 4px; background: ${bg}; color: ${col}; border: 1px solid ${border}; cursor: pointer; font-weight: ${isActive ? '600' : '500'};">${label}</button>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('.live-worker-tab').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wid = parseInt(btn.getAttribute('data-worker'), 10) || 1;
      currentLiveWorkerId = wid;
      updateWorkerCanvasTabs(count);
      const chromeOverlay = document.getElementById('chrome-view-overlay');
      if (chromeOverlay) chromeOverlay.textContent = `Live Canvas — Channel #${wid}`;
      const chromeStatus = document.getElementById('chrome-view-status');
      if (chromeStatus) chromeStatus.textContent = `● Live Stream (W#${wid})`;
    });
  });
}

function initLiveChromeStream() {
  const chromeImg = document.getElementById('chrome-live-img');
  const chromeStatus = document.getElementById('chrome-view-status');
  const chromeOverlay = document.getElementById('chrome-view-overlay');
  const btnOpenChrome = document.getElementById('btn-open-real-chrome');
  const btnHideChrome = document.getElementById('btn-hide-real-chrome');
  const btnFocus = document.getElementById('btn-focus-chrome');

  const triggerBringChrome = async (btn) => {
    const orig = btn ? btn.innerHTML : null;
    if (btn) btn.innerHTML = '🌐 Bringing...';
    try {
      await fetch(`/api/focus-chrome?workerId=${currentLiveWorkerId}`, { method: 'POST' });
    } catch (e) {
      console.warn('Focus chrome error:', e);
    } finally {
      if (btn && orig) {
        setTimeout(() => { btn.innerHTML = orig; }, 1200);
      }
    }
  };

  const triggerHideChrome = async (btn) => {
    const orig = btn ? btn.innerHTML : null;
    if (btn) btn.innerHTML = '👁️ Hiding...';
    try {
      await fetch(`/api/hide-chrome?workerId=${currentLiveWorkerId}`, { method: 'POST' });
    } catch (e) {
      console.warn('Hide chrome error:', e);
    } finally {
      if (btn && orig) {
        setTimeout(() => { btn.innerHTML = orig; }, 1200);
      }
    }
  };

  btnOpenChrome?.addEventListener('click', () => triggerBringChrome(btnOpenChrome));
  btnHideChrome?.addEventListener('click', () => triggerHideChrome(btnHideChrome));
  btnFocus?.addEventListener('click', () => triggerBringChrome(btnFocus));

  function fetchNextFrame() {
    if (!chromeImg || !liveStreamActive) return;

    // If monitor is hidden, poll slower to conserve resources
    if (progressSection && progressSection.style.display === 'none') {
      setTimeout(fetchNextFrame, 2000);
      return;
    }

    if (isFetchingFrame) return;
    isFetchingFrame = true;

    const offscreen = new Image();
    offscreen.onload = () => {
      chromeImg.src = offscreen.src;
      isFetchingFrame = false;
      const isExt = false;
      if (chromeStatus) {
        chromeStatus.textContent = isExt ? '● Live Extension Stream' : `● Live Stream (W#${currentLiveWorkerId})`;
        chromeStatus.style.background = 'rgba(34, 197, 94, 0.2)';
        chromeStatus.style.color = '#4ade80';
        chromeStatus.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      }
      if (chromeOverlay) {
        chromeOverlay.textContent = isExt ? 'Live Canvas — Extension Live' : `Live Canvas (Channel #${currentLiveWorkerId})`;
        chromeOverlay.style.display = 'block';
      }
      // Rapid frame refresh (~350ms) gives smooth, video-like visual feed
      setTimeout(fetchNextFrame, 350);
    };

    offscreen.onerror = () => {
      isFetchingFrame = false;
      const isExt = false;
      const isGenerating = window.serverActiveRun?.status === 'generating' || window.serverActiveRun?.status === 'launched' || window.serverActiveRun?.status === 'syncing';
      if (chromeStatus) {
        if (isExt && isGenerating) {
          chromeStatus.textContent = 'Chrome Loading Extension...';
          chromeStatus.style.background = 'rgba(56, 189, 248, 0.15)';
          chromeStatus.style.color = '#38bdf8';
          chromeStatus.style.borderColor = 'rgba(56, 189, 248, 0.35)';
        } else {
          chromeStatus.textContent = isExt ? 'Extension Standby' : `Worker #${currentLiveWorkerId} Standby`;
          chromeStatus.style.background = 'rgba(148, 163, 184, 0.15)';
          chromeStatus.style.color = '#94a3b8';
          chromeStatus.style.borderColor = 'rgba(148, 163, 184, 0.25)';
        }
      }
      if (chromeOverlay) {
        if (isExt && isGenerating) {
          chromeOverlay.textContent = 'Waiting for Chrome & Extension to stream...';
        } else {
          chromeOverlay.textContent = 'Live Canvas Standby';
        }
      }
      // If current img src is broken or empty, fall back to placeholder
      if (!chromeImg.src || chromeImg.src.includes('live-frame.jpg')) {
        chromeImg.src = '/debug/placeholder.svg';
      }
      setTimeout(fetchNextFrame, 1500);
    };

    offscreen.src = `/api/debug/live-frame.jpg?workerId=${currentLiveWorkerId}&t=${Date.now()}`;
  }

  fetchNextFrame();
}

// Start continuous live stream
initLiveChromeStream();
updateWorkerCanvasTabs(currentWorkerCount || 7);

// ─────────────────────────────────────────────────────────────────────────────
// Story Studio UI Logic
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    const viewImageStudio = document.getElementById('view-image-studio');
    const viewSmartPipeline = document.getElementById('view-smart-pipeline');

    sidebarItems.forEach(item => {
        item.addEventListener('click', (e) => {
            sidebarItems.forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');

            const view = e.currentTarget.getAttribute('data-view');
            if (view === 'image-studio') {
                if (viewImageStudio) viewImageStudio.style.display = 'block';
                if (viewSmartPipeline) viewSmartPipeline.style.display = 'none';
            } else if (view === 'smart-pipeline') {
                if (viewImageStudio) viewImageStudio.style.display = 'none';
                if (viewSmartPipeline) viewSmartPipeline.style.display = 'block';
                updatePipelineWorkerCanvasTabs(7);
                fetchPipelineStatus();
            }
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Story & Script Studio (Smart Pipeline) Controller
    // ─────────────────────────────────────────────────────────────────────────
    let currentPipelineWorkerId = 1;
    let isFetchingPipelineFrame = false;
    let pipelinePollInterval = null;
    let loadedPipelineTasks = [];
    let pipelineOutputs = {
        topic: '',
        script: '',
        image_prompts: '',
        video_prompts: ''
    };
    let activeOutputTab = 'topic';

    const pipelineImg = document.getElementById('pipeline-chrome-live-img');
    const pipelineStatusBadge = document.getElementById('pipeline-status-badge');
    const pipelineChromeStatus = document.getElementById('pipeline-chrome-status');
    const pipelineChromeOverlay = document.getElementById('pipeline-chrome-overlay');
    const pipelineWorkersGrid = document.getElementById('pipeline-workers-grid');
    const pipelineWorkersCountBadge = document.getElementById('pipeline-workers-count-badge');
    const pipelineTerminalLogs = document.getElementById('pipeline-terminal-logs');
    const pipelineOutputBox = document.getElementById('pipeline-output-box');
    const pipelineOutputTabs = document.querySelectorAll('#pipeline-output-tabs .p-tab');
    const btnPipelineDemoLoad = document.getElementById('btn-pipeline-demo-load');
    const btnPipelineRun = document.getElementById('btn-pipeline-run');
    const btnPipelineStop = document.getElementById('btn-pipeline-stop');
    const btnPipelineClear = document.getElementById('btn-pipeline-clear');
    const btnPipelineCopyOutput = document.getElementById('btn-pipeline-copy-output');
    const btnPipelineFocusChrome = document.getElementById('btn-pipeline-focus-chrome');
    const btnPipelineHideChrome = document.getElementById('btn-pipeline-hide-chrome');
    const selectPipelinePreset = document.getElementById('pipeline-demo-preset');

    // Add log row to pipeline terminal
    function addPipelineLog(tag, message, type = 'info') {
        if (!pipelineTerminalLogs) return;
        const row = document.createElement('div');
        row.className = 'terminal-row';
        const time = new Date().toLocaleTimeString();
        let tagClass = 'tag-sys';
        if (type === 'success') tagClass = 'tag-ok';
        if (type === 'error') tagClass = 'tag-err';
        if (type === 'warn') tagClass = 'tag-warn';

        row.innerHTML = `<span style="color: #64748b; font-size: 0.72rem; margin-right: 6px;">[${time}]</span><span class="log-tag ${tagClass}">[${tag}]</span> ${message}`;
        pipelineTerminalLogs.appendChild(row);
        pipelineTerminalLogs.scrollTop = pipelineTerminalLogs.scrollHeight;
    }

    // Output tab switcher
    pipelineOutputTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            pipelineOutputTabs.forEach(t => {
                t.classList.remove('active');
                t.style.background = 'rgba(255, 255, 255, 0.05)';
                t.style.color = '#94a3b8';
                t.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                t.style.fontWeight = '500';
            });
            const clicked = e.currentTarget;
            clicked.classList.add('active');
            clicked.style.background = 'rgba(56, 189, 248, 0.2)';
            clicked.style.color = '#38bdf8';
            clicked.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            clicked.style.fontWeight = '600';

            activeOutputTab = clicked.getAttribute('data-tab');
            updateOutputDisplay();
        });
    });

    function updateOutputDisplay() {
        if (!pipelineOutputBox) return;
        const content = pipelineOutputs[activeOutputTab];
        if (content && content.trim()) {
            pipelineOutputBox.textContent = content.trim();
        } else {
            pipelineOutputBox.textContent = `No ${activeOutputTab.replace('_', ' ')} generated yet. Click "Load Demo Job" or "Run Pipeline" to generate content.`;
        }
    }

    // Copy Output to Clipboard
    btnPipelineCopyOutput?.addEventListener('click', () => {
        const text = pipelineOutputs[activeOutputTab];
        if (!text || !text.trim()) {
            showToast('Output Empty', `No ${activeOutputTab.replace('_', ' ')} available to copy yet.`);
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied to Clipboard ✓', `Copied ${activeOutputTab.replace('_', ' ')} content to clipboard.`);
        }).catch(() => {
            showToast('Copy Error', 'Please select and copy text manually.');
        });
    });

    // Update Live Canvas Worker Tabs (1..7)
    function updatePipelineWorkerCanvasTabs(count = 7) {
        const container = document.getElementById('pipeline-worker-switcher');
        if (!container) return;
        let html = '';
        for (let i = 1; i <= count; i++) {
            const isActive = i === currentPipelineWorkerId;
            const bg = isActive ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)';
            const col = isActive ? '#38bdf8' : '#94a3b8';
            const border = isActive ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.1)';
            html += `<button type="button" class="btn btn-xs p-worker-tab ${isActive ? 'active' : ''}" data-worker="${i}" style="padding: 2px 8px; font-size: 0.72rem; border-radius: 4px; background: ${bg}; color: ${col}; border: 1px solid ${border}; cursor: pointer; font-weight: ${isActive ? '600' : '500'};">Worker #${i}</button>`;
        }
        container.innerHTML = html;
        container.querySelectorAll('.p-worker-tab').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wid = parseInt(btn.getAttribute('data-worker'), 10) || 1;
                currentPipelineWorkerId = wid;
                updatePipelineWorkerCanvasTabs(count);
                if (pipelineChromeOverlay) pipelineChromeOverlay.textContent = `Live Canvas — Worker #${wid}`;
                if (pipelineChromeStatus) pipelineChromeStatus.textContent = `● Live Stream (W#${wid})`;
            });
        });
    }

    // Continuous Live Chrome Canvas Frame Streaming for Pipeline
    function initPipelineLiveChromeStream() {
        function fetchNextPipelineFrame() {
            if (!pipelineImg) return;
            if (viewSmartPipeline && viewSmartPipeline.style.display === 'none') {
                setTimeout(fetchNextPipelineFrame, 2000);
                return;
            }

            if (isFetchingPipelineFrame) return;
            isFetchingPipelineFrame = true;

            const offscreen = new Image();
            offscreen.onload = () => {
                pipelineImg.src = offscreen.src;
                isFetchingPipelineFrame = false;
                if (pipelineChromeStatus) {
                    pipelineChromeStatus.textContent = `● Live Stream (W#${currentPipelineWorkerId})`;
                    pipelineChromeStatus.style.background = 'rgba(34, 197, 94, 0.2)';
                    pipelineChromeStatus.style.color = '#4ade80';
                    pipelineChromeStatus.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                }
                if (pipelineChromeOverlay) {
                    pipelineChromeOverlay.textContent = `Live Canvas — Channel #${currentPipelineWorkerId}`;
                    pipelineChromeOverlay.style.display = 'block';
                }
                setTimeout(fetchNextPipelineFrame, 350);
            };

            offscreen.onerror = () => {
                isFetchingPipelineFrame = false;
                if (pipelineChromeStatus) {
                    pipelineChromeStatus.textContent = `Worker #${currentPipelineWorkerId} Standby`;
                    pipelineChromeStatus.style.background = 'rgba(148, 163, 184, 0.15)';
                    pipelineChromeStatus.style.color = '#94a3b8';
                    pipelineChromeStatus.style.borderColor = 'rgba(148, 163, 184, 0.25)';
                }
                if (pipelineChromeOverlay) {
                    pipelineChromeOverlay.textContent = `Worker #${currentPipelineWorkerId} Standby`;
                }
                if (!pipelineImg.src || pipelineImg.src.includes('live-frame.jpg')) {
                    pipelineImg.src = '/debug/placeholder.svg';
                }
                setTimeout(fetchNextPipelineFrame, 1500);
            };

            offscreen.src = `/api/chatgpt/live-frame.jpg?workerId=${currentPipelineWorkerId}&t=${Date.now()}`;
        }

        fetchNextPipelineFrame();
    }

    // Window controls for Pipeline
    btnPipelineFocusChrome?.addEventListener('click', async () => {
        const orig = btnPipelineFocusChrome.innerHTML;
        btnPipelineFocusChrome.innerHTML = '🌐 Bringing...';
        try {
            await fetch(`/api/chatgpt/worker/focus?workerId=${currentPipelineWorkerId}`, { method: 'POST' });
            addPipelineLog('Window', `Brought Worker #${currentPipelineWorkerId} to front.`, 'info');
        } catch (e) {
            console.warn('Focus worker error:', e);
        } finally {
            setTimeout(() => { btnPipelineFocusChrome.innerHTML = orig; }, 1200);
        }
    });

    btnPipelineHideChrome?.addEventListener('click', async () => {
        const orig = btnPipelineHideChrome.innerHTML;
        btnPipelineHideChrome.innerHTML = '👁️ Hiding...';
        try {
            await fetch(`/api/chatgpt/worker/hide?workerId=${currentPipelineWorkerId}`, { method: 'POST' });
            addPipelineLog('Window', `Minimized Worker #${currentPipelineWorkerId}.`, 'info');
        } catch (e) {
            console.warn('Hide worker error:', e);
        } finally {
            setTimeout(() => { btnPipelineHideChrome.innerHTML = orig; }, 1200);
        }
    });

    // Render 7 Worker Chromes Telemetry Cards
    function renderPipelineWorkersGrid(workers) {
        if (!pipelineWorkersGrid) return;
        const count = 7;
        let activeCount = 0;
        let html = '';

        for (let i = 1; i <= count; i++) {
            const wData = Array.isArray(workers) ? workers.find(w => w.workerId === i) : null;
            const isOpen = wData ? Boolean(wData.isOpen) : false;
            const isIdle = wData ? Boolean(wData.idle) : true;
            const rawStatus = wData ? (wData.status || (isOpen ? 'Standby' : 'Offline')) : 'Offline';
            const currentTask = wData ? (wData.currentTask || 'Idle') : 'Idle';
            const progress = wData ? (wData.progress || 0) : 0;

            if (isOpen || !isIdle) activeCount++;

            let statusColor = '#94a3b8';
            let statusText = rawStatus;
            let borderCol = 'rgba(255, 255, 255, 0.08)';
            let bgCol = 'rgba(15, 23, 42, 0.6)';

            if (!isIdle || rawStatus.toLowerCase().includes('running') || rawStatus.toLowerCase().includes('generating')) {
                statusColor = '#38bdf8';
                statusText = '⚡ Working';
                borderCol = 'rgba(56, 189, 248, 0.4)';
                bgCol = 'rgba(56, 189, 248, 0.1)';
            } else if (isOpen) {
                statusColor = '#4ade80';
                statusText = '● Ready';
                borderCol = 'rgba(74, 222, 128, 0.3)';
                bgCol = 'rgba(74, 222, 128, 0.08)';
            } else if (rawStatus.toLowerCase().includes('error')) {
                statusColor = '#f87171';
                statusText = '⚠️ Error';
                borderCol = 'rgba(248, 113, 113, 0.4)';
                bgCol = 'rgba(248, 113, 113, 0.1)';
            }

            html += `
              <div style="background: ${bgCol}; border: 1px solid ${borderCol}; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="font-size: 0.78rem; font-weight: 700; color: #f8fafc;">Worker #${i}</span>
                  <span style="font-size: 0.68rem; color: ${statusColor}; font-weight: 600;">${statusText}</span>
                </div>
                <div style="font-size: 0.72rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${currentTask}">
                  ${currentTask}
                </div>
                <div style="width: 100%; background: rgba(255,255,255,0.1); border-radius: 4px; height: 4px; overflow: hidden; margin-top: 2px;">
                  <div style="width: ${progress}%; background: #38bdf8; height: 100%; transition: width 0.3s ease;"></div>
                </div>
                <div style="display: flex; gap: 4px; margin-top: 4px;">
                  <button type="button" class="btn btn-xs btn-p-open" data-wid="${i}" style="flex: 1; padding: 3px 6px; font-size: 0.68rem; border-radius: 4px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; cursor: pointer; font-weight: 500;">
                    🌐 Open
                  </button>
                  <button type="button" class="btn btn-xs btn-p-view" data-wid="${i}" style="flex: 1; padding: 3px 6px; font-size: 0.68rem; border-radius: 4px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #cbd5e1; cursor: pointer;">
                    Canvas
                  </button>
                </div>
              </div>
            `;
        }

        pipelineWorkersGrid.innerHTML = html;

        if (pipelineWorkersCountBadge) {
            pipelineWorkersCountBadge.textContent = activeCount > 0 ? `${activeCount}/7 Active` : '7 Channels Ready';
            pipelineWorkersCountBadge.style.color = activeCount > 0 ? '#4ade80' : '#38bdf8';
        }

        // Attach buttons handlers
        pipelineWorkersGrid.querySelectorAll('.btn-p-open').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const wid = parseInt(btn.getAttribute('data-wid'), 10) || 1;
                btn.innerHTML = 'Opening...';
                try {
                    await fetch(`/api/chatgpt/worker/open`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workerId: wid })
                    });
                    addPipelineLog('Worker', `Opened Chrome instance for Worker #${wid}.`, 'info');
                } catch (err) {
                    console.warn('Open worker error:', err);
                } finally {
                    setTimeout(() => { btn.innerHTML = '🌐 Open'; }, 1500);
                }
            });
        });

        pipelineWorkersGrid.querySelectorAll('.btn-p-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wid = parseInt(btn.getAttribute('data-wid'), 10) || 1;
                currentPipelineWorkerId = wid;
                updatePipelineWorkerCanvasTabs(7);
                if (pipelineChromeOverlay) pipelineChromeOverlay.textContent = `Live Canvas — Worker #${wid}`;
                if (pipelineChromeStatus) pipelineChromeStatus.textContent = `● Live Stream (W#${wid})`;
                fetch(`/api/chatgpt/worker/focus?workerId=${wid}`, { method: 'POST' }).catch(() => {});
            });
        });
    }

    // Update Pipeline Stepper (Topic -> Script -> Image Prompts -> Video Prompts)
    function updatePipelineStepper(activeStep, progressList = []) {
        const steps = [
            { id: 'topic', el: document.getElementById('p-step-1'), desc: document.getElementById('p-step-1-desc'), line: document.getElementById('p-line-1') },
            { id: 'script', el: document.getElementById('p-step-2'), desc: document.getElementById('p-step-2-desc'), line: document.getElementById('p-line-2') },
            { id: 'image_prompts', el: document.getElementById('p-step-3'), desc: document.getElementById('p-step-3-desc'), line: document.getElementById('p-line-3') },
            { id: 'video_prompts', el: document.getElementById('p-step-4'), desc: document.getElementById('p-step-4-desc'), line: null }
        ];

        steps.forEach((s) => {
            if (!s.el) return;
            const hasDone = progressList.some(p => p.taskId === s.id && (p.status === 'Done' || p.status === 'Completed'));
            const isRunning = progressList.some(p => p.taskId === s.id && p.status !== 'Done' && p.status !== 'Completed' && p.status !== 'Error');
            
            s.el.classList.remove('active', 'completed');
            if (hasDone) {
                s.el.classList.add('completed');
                if (s.desc) s.desc.textContent = 'Completed ✓';
                if (s.line) s.line.classList.add('completed');
            } else if (isRunning) {
                s.el.classList.add('active');
                if (s.desc) s.desc.textContent = 'Generating...';
            }
        });
    }

    // Fetch and sync Pipeline Status
    let lastRenderedProgressCount = 0;
    async function fetchPipelineStatus() {
        try {
            const res = await fetch('/api/chatgpt/pipeline/status');
            if (!res.ok) return;
            const data = await res.json();

            // Status Badge
            if (pipelineStatusBadge) {
                pipelineStatusBadge.textContent = (data.status || 'idle').toUpperCase();
                if (data.status === 'running') {
                    pipelineStatusBadge.style.background = 'rgba(56, 189, 248, 0.2)';
                    pipelineStatusBadge.style.color = '#38bdf8';
                    pipelineStatusBadge.style.borderColor = 'rgba(56, 189, 248, 0.5)';
                    if (btnPipelineStop) btnPipelineStop.style.display = 'inline-block';
                    if (btnPipelineRun) btnPipelineRun.style.display = 'none';
                } else if (data.status === 'completed') {
                    pipelineStatusBadge.style.background = 'rgba(34, 197, 94, 0.2)';
                    pipelineStatusBadge.style.color = '#4ade80';
                    pipelineStatusBadge.style.borderColor = 'rgba(34, 197, 94, 0.5)';
                    if (btnPipelineStop) btnPipelineStop.style.display = 'none';
                    if (btnPipelineRun) btnPipelineRun.style.display = 'inline-block';
                } else if (data.status === 'error') {
                    pipelineStatusBadge.style.background = 'rgba(248, 113, 113, 0.2)';
                    pipelineStatusBadge.style.color = '#f87171';
                    pipelineStatusBadge.style.borderColor = 'rgba(248, 113, 113, 0.5)';
                    if (btnPipelineStop) btnPipelineStop.style.display = 'none';
                    if (btnPipelineRun) btnPipelineRun.style.display = 'inline-block';
                } else {
                    pipelineStatusBadge.style.background = 'rgba(148, 163, 184, 0.15)';
                    pipelineStatusBadge.style.color = '#94a3b8';
                    pipelineStatusBadge.style.borderColor = 'rgba(148, 163, 184, 0.3)';
                    if (btnPipelineStop) btnPipelineStop.style.display = 'none';
                    if (btnPipelineRun) btnPipelineRun.style.display = 'inline-block';
                }
            }

            // Render workers telemetry
            renderPipelineWorkersGrid(data.workers || []);

            // Stepper update
            updatePipelineStepper(data.status, data.progress || []);

            // Progress event logs
            const progress = data.progress || [];
            if (progress.length > lastRenderedProgressCount) {
                for (let i = lastRenderedProgressCount; i < progress.length; i++) {
                    const p = progress[i];
                    const tag = p.workerId ? `Worker #${p.workerId}` : 'Pipeline';
                    let type = 'info';
                    if (p.status === 'Done' || p.status === 'Completed') type = 'success';
                    if (p.status && p.status.includes('Error')) type = 'error';
                    addPipelineLog(tag, `Task [${p.taskId}]: ${p.status} ${p.progress ? `(${p.progress}%)` : ''}`, type);
                }
                lastRenderedProgressCount = progress.length;
            }

            // Results Extraction for Output Inspector
            if (data.results) {
                if (data.results.topic?.text) pipelineOutputs.topic = data.results.topic.text;
                if (data.results.script?.text) pipelineOutputs.script = data.results.script.text;
                if (data.results.image_prompts?.text) pipelineOutputs.image_prompts = data.results.image_prompts.text;
                if (data.results.video_prompts?.text) pipelineOutputs.video_prompts = data.results.video_prompts.text;
                updateOutputDisplay();
            }

        } catch (e) {
            console.warn('Pipeline status poll error:', e);
        }
    }

    // Helper to get demo tasks locally as guaranteed fallback
    function getPresetDemoTasks(preset) {
        if (preset === 'parallel') {
            return [
                { id: 'topic', dependsOn: [], prompt: 'Suggest an epic documentary topic about forgotten ancient mega-cities with high viral intrigue.', workerId: 1 },
                { id: 'script', dependsOn: ['topic'], prompt: 'Write a gripping 60-second voiceover script for: {{topic}}', workerId: 1 },
                { id: 'scene_1', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 1 of: {{script}}', workerId: 2 },
                { id: 'scene_2', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 2 of: {{script}}', workerId: 3 },
                { id: 'scene_3', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 3 of: {{script}}', workerId: 4 },
                { id: 'scene_4', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 4 of: {{script}}', workerId: 5 },
                { id: 'scene_5', dependsOn: ['script'], prompt: 'Generate visual image prompt for Scene 5 of: {{script}}', workerId: 6 },
                { id: 'video_dir', dependsOn: ['script'], prompt: 'Generate camera motion directives for all 5 scenes of: {{script}}', workerId: 7 }
            ];
        }
        return [
            { id: 'topic', dependsOn: [], prompt: 'Generate a captivating historical video title and 3 core narrative angles about The Great Library of Alexandria.', workerId: 1 },
            { id: 'script', dependsOn: ['topic'], prompt: 'Write an immersive 90-second voiceover narration script based on:\n{{topic}}\nStructure with Intro Hook, Rising Mystery, Dramatic Turning Point, and Thought-Provoking Climax.', workerId: 1 },
            { id: 'image_prompts', dependsOn: ['script'], prompt: 'Based on this script:\n{{script}}\nCreate 5 ultra-detailed cinematic 16:9 Midjourney/Google Flow image prompts with atmospheric lighting, historical architecture, and 35mm lens specs.', workerId: 2 },
            { id: 'video_prompts', dependsOn: ['script'], prompt: 'Based on this script:\n{{script}}\nGenerate 5 dynamic cinematic camera movement prompts (e.g. slow crane push, orbital tracking, shallow depth of field rack focus) for each scene.', workerId: 3 }
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Manual Prompt & Step Tester Logic
    // ─────────────────────────────────────────────────────────────────────────
    const manualPromptInput = document.getElementById('manual-prompt-input');
    const manualWorkerSelect = document.getElementById('manual-worker-select');
    const manualStepSelect = document.getElementById('manual-step-select');
    const btnManualRun = document.getElementById('btn-manual-run');
    const sampleManualBtns = document.querySelectorAll('.sample-manual-btn');

    const SAMPLE_MANUAL_PROMPTS = {
        topic: 'Suggest 3 high-retention, viral documentary video topics about unsolved ancient mysteries of the Sahara desert. Return title and engaging hook for each.',
        script: 'Write an immersive 90-second voiceover narration script about The Richat Structure (Eye of the Sahara). Structure with Hook, Mystery, Historical theories, and Climax.',
        image: 'Create 5 detailed cinematic 16:9 image generation prompts for Midjourney/Google Flow based on ancient desert ruins, dramatic sunset, and 35mm lens specs.',
        short: 'Hello! Please confirm you are connected and ready to process video script automation tasks in 1 sentence.'
    };

    sampleManualBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sampleType = btn.getAttribute('data-sample');
            if (manualPromptInput && SAMPLE_MANUAL_PROMPTS[sampleType]) {
                manualPromptInput.value = SAMPLE_MANUAL_PROMPTS[sampleType];
                if (sampleType === 'topic' && manualStepSelect) manualStepSelect.value = 'topic';
                else if (sampleType === 'script' && manualStepSelect) manualStepSelect.value = 'script';
                else if (sampleType === 'image' && manualStepSelect) manualStepSelect.value = 'image_prompts';
                else if (manualStepSelect) manualStepSelect.value = 'custom';
            }
        });
    });

    manualStepSelect?.addEventListener('change', () => {
        const val = manualStepSelect.value;
        if (!manualPromptInput) return;
        if (val === 'topic') manualPromptInput.placeholder = 'Enter topic generation instructions...';
        else if (val === 'script') manualPromptInput.placeholder = 'Enter script writing instructions or paste topic...';
        else if (val === 'image_prompts') manualPromptInput.placeholder = 'Enter image prompts generation instructions...';
        else if (val === 'video_prompts') manualPromptInput.placeholder = 'Enter video camera direction instructions...';
        else manualPromptInput.placeholder = 'Enter custom prompt to execute manually on selected worker...';
    });

    btnManualRun?.addEventListener('click', async () => {
        const promptText = (manualPromptInput?.value || '').trim();
        if (!promptText) {
            showToast('Prompt Empty', 'Please enter a prompt or click a quick fill button.');
            return;
        }

        const workerId = parseInt(manualWorkerSelect?.value || '1', 10) || 1;
        const stepType = manualStepSelect?.value || 'custom';

        // Automatically switch canvas to this worker so the user watches live
        currentPipelineWorkerId = workerId;
        updatePipelineWorkerCanvasTabs(7);
        if (pipelineChromeOverlay) pipelineChromeOverlay.textContent = `Live Canvas — Worker #${workerId}`;
        if (pipelineChromeStatus) pipelineChromeStatus.textContent = `● Live Stream (W#${workerId})`;

        const origBtnText = btnManualRun.innerHTML;
        btnManualRun.disabled = true;
        btnManualRun.innerHTML = `<span>⏳ Worker #${workerId} Running...</span>`;

        addPipelineLog(`Worker #${workerId}`, `Manual run started: "${promptText.slice(0, 50)}..."`, 'info');
        showToast(`Worker #${workerId} Active`, `Running manual prompt on Worker #${workerId}...`);

        try {
            const res = await fetch('/api/chatgpt/single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: promptText, workerId })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Server returned an error');
            }

            const responseText = data.result?.text || '';
            addPipelineLog(`Worker #${workerId}`, `Manual execution completed successfully!`, 'success');

            // Store in output inspector
            if (stepType === 'topic') {
                pipelineOutputs.topic = responseText;
                activeOutputTab = 'topic';
            } else if (stepType === 'script') {
                pipelineOutputs.script = responseText;
                activeOutputTab = 'script';
            } else if (stepType === 'image_prompts') {
                pipelineOutputs.image_prompts = responseText;
                activeOutputTab = 'image_prompts';
            } else if (stepType === 'video_prompts') {
                pipelineOutputs.video_prompts = responseText;
                activeOutputTab = 'video_prompts';
            } else {
                pipelineOutputs[activeOutputTab] = responseText;
            }

            // Highlight the tab in output inspector
            pipelineOutputTabs.forEach(t => {
                const isTab = t.getAttribute('data-tab') === activeOutputTab;
                t.classList.toggle('active', isTab);
                t.style.background = isTab ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)';
                t.style.color = isTab ? '#38bdf8' : '#94a3b8';
                t.style.borderColor = isTab ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.1)';
                t.style.fontWeight = isTab ? '600' : '500';
            });
            updateOutputDisplay();

            showToast(`Task Complete ✓`, `Worker #${workerId} finished generating. Output is visible in Output Inspector.`);
        } catch (err) {
            addPipelineLog(`Worker #${workerId}`, `Error: ${err.message}`, 'error');
            showToast('Execution Error', err.message);
        } finally {
            btnManualRun.disabled = false;
            btnManualRun.innerHTML = origBtnText;
            fetchPipelineStatus();
        }
    });

    // Load Demo Job Button Action
    btnPipelineDemoLoad?.addEventListener('click', async () => {
        const preset = selectPipelinePreset?.value || 'standard';
        btnPipelineDemoLoad.innerHTML = 'Loading Demo...';
        try {
            const res = await fetch('/api/chatgpt/pipeline/demo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset, simulate: false })
            });
            let data = null;
            const text = await res.text();
            try {
                data = JSON.parse(text);
            } catch (jsonErr) {
                // If backend returned HTML (e.g. 404 on un-restarted server), fall back gracefully
                data = { tasks: getPresetDemoTasks(preset) };
            }

            if (data && data.tasks) {
                loadedPipelineTasks = data.tasks;
                addPipelineLog('Demo', `✅ Loaded ${data.tasks.length} pipeline tasks (${preset} preset). Click "Run Pipeline" to execute.`, 'success');
                showToast('Demo Job Ready', `Loaded ${data.tasks.length} tasks. Ready to run!`);
            }
        } catch (err) {
            loadedPipelineTasks = getPresetDemoTasks(preset);
            addPipelineLog('Demo', `✅ Loaded ${loadedPipelineTasks.length} tasks (${preset}). Ready to run!`, 'success');
            showToast('Demo Job Ready', `Loaded ${loadedPipelineTasks.length} tasks.`);
        } finally {
            btnPipelineDemoLoad.innerHTML = '🧪 Load Demo Job';
        }
    });

    // Run Pipeline Button Action
    btnPipelineRun?.addEventListener('click', async () => {
        const preset = selectPipelinePreset?.value || 'standard';
        if (preset === 'simulation') {
            // Trigger instant simulation
            addPipelineLog('Pipeline', '🚀 Launching Demo Pipeline Simulation...', 'info');
            try {
                await fetch('/api/chatgpt/pipeline/demo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preset: 'standard', simulate: true })
                });
            } catch (e) {
                addPipelineLog('Pipeline', `Simulation launch error: ${e.message}`, 'error');
            }
            return;
        }

        // If no tasks loaded yet, load preset automatically
        if (!loadedPipelineTasks || loadedPipelineTasks.length === 0) {
            loadedPipelineTasks = getPresetDemoTasks(preset);
        }

        if (loadedPipelineTasks.length === 0) {
            showToast('No Tasks', 'Please load a demo job first.');
            return;
        }

        addPipelineLog('Pipeline', `🚀 Starting ChatGPT Pipeline batch with ${loadedPipelineTasks.length} tasks...`, 'info');
        try {
            const res = await fetch('/api/chatgpt/pipeline/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pipelineTasks: loadedPipelineTasks })
            });
            const data = await res.json();
            if (!res.ok) {
                addPipelineLog('Pipeline', `Start failed: ${data.error || 'Server error'}`, 'error');
                showToast('Pipeline Error', data.error || 'Could not start pipeline');
            } else {
                addPipelineLog('Pipeline', `Pipeline running with Job ID: ${data.jobId}`, 'success');
            }
        } catch (err) {
            addPipelineLog('Pipeline', `Network error: ${err.message}`, 'error');
        }
    });

    // Stop Pipeline
    btnPipelineStop?.addEventListener('click', async () => {
        try {
            await fetch('/api/chatgpt/pipeline/stop', { method: 'POST' });
            addPipelineLog('Pipeline', '⏹️ Stop signal sent to pipeline.', 'warn');
        } catch (e) {}
    });

    // Clear Pipeline State
    btnPipelineClear?.addEventListener('click', async () => {
        try {
            await fetch('/api/chatgpt/pipeline/clear', { method: 'POST' });
            pipelineOutputs = { topic: '', script: '', image_prompts: '', video_prompts: '' };
            lastRenderedProgressCount = 0;
            if (pipelineTerminalLogs) {
                pipelineTerminalLogs.innerHTML = '<div class="terminal-row"><span class="log-tag tag-sys">[System]</span> Pipeline monitor cleared and reset. Ready.</div>';
            }
            updateOutputDisplay();
            fetchPipelineStatus();
            showToast('Reset Complete', 'Story & Script Studio reset to clean idle state.');
        } catch (e) {}
    });

    // Initialize Pipeline live stream, tabs, and initial status
    updatePipelineWorkerCanvasTabs(7);
    initPipelineLiveChromeStream();
    renderPipelineWorkersGrid([]);
    fetchPipelineStatus();

    // Start background status polling
    if (pipelinePollInterval) clearInterval(pipelinePollInterval);
    pipelinePollInterval = setInterval(fetchPipelineStatus, 1200);
});



