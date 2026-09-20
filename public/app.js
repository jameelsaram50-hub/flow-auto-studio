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

  if (count > 0) {
    btnGenerate.classList.remove('disabled');
  }
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
    if (step2Desc) step2Desc.textContent = 'Chrome running';
    line2?.classList.add('active');
  } else {
    step2?.classList.add('active');
    if (step2Desc) step2Desc.textContent = 'Launching...';
  }

  // Step 3: Extension Synced
  if (activeRun.status === 'syncing' || activeRun.status === 'generating' || activeRun.status === 'completed' || currentCount > 0) {
    step3?.classList.add('done');
    if (step3Desc) step3Desc.textContent = 'Prompts injected in TurboFlow';
    line3?.classList.add('active');
  } else {
    step3?.classList.add('active');
    if (step3Desc) step3Desc.textContent = 'Waiting for extension...';
  }

  // Step 4: Batch Generating / Complete
  const isDone = activeRun.status === 'completed' || (total > 0 && currentCount >= total);

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
      window.electronAPI.showNotification('🎉 Batch Images Complete', `All ${total} images generated in Google Flow!`);
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
      statusAlertText.innerHTML = `⏳ <b>${currentCount} of ${total} images ready.</b> Google Flow is generating remaining scenes...`;
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
      statusAlertText.innerHTML = `🚀 <b>Prompts transferred to TurboFlow!</b> Image generation is in progress in Google Flow.`;
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
        <button type="button" class="btn-scene-chrome" onclick="event.stopPropagation(); window.openPreview('${sc.chromeScreenshotUrl}', 'Scene ${sc.id} Chrome Viewport')" title="View Chrome viewport captured during generation of Scene ${sc.id}">
          📸 Chrome View
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
      btnConsoleShot.onclick = () => window.openPreview(latestShotLog.screenshotUrl, 'Latest Chrome Canvas View');
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
        <button type="button" class="btn-log-screenshot" onclick="window.openPreview('${l.screenshotUrl}', 'Chrome Canvas Snapshot — ${l.time || ''}')" title="Click to view Chrome screenshot captured at this moment">
          📸 View Chrome Screen
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
        <p>Once Google Flow finishes creating images, they will appear here live from <code>Downloads/turboflow</code>.</p>
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
  modalImg.src = url;
  modalFilename.textContent = filename;
  modalDownload.href = url;
  modalDownload.setAttribute('download', filename);
  imageModal.classList.add('open');
};

function closeModal() {
  imageModal.classList.remove('open');
}

modalClose?.addEventListener('click', closeModal);
modalOverlay?.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Fetch server status & live images with adaptive polling
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    updateStepper(data.activeRun?.status, data.activeRun, data.currentRunCount);
    renderScenesList(data.scenes || [], data.currentRunCount);
    renderLogs(data.logs || []);
    renderGallery(data.images || [], data.currentRunCount);

    // Schedule next poll adaptively: 1000ms when active, 2500ms when idle
    const isBusy = data.activeRun?.status === 'generating' || data.activeRun?.status === 'launched' || data.activeRun?.status === 'syncing';
    scheduleNextPoll(isBusy ? 1000 : 2500);
  } catch (err) {
    console.warn('Status fetch error:', err);
    scheduleNextPoll(3000);
  }
}

function scheduleNextPoll(delayMs) {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = setTimeout(fetchStatus, delayMs);
}

// Generate button click
btnGenerate?.addEventListener('click', async () => {
  console.log('[UI Click] Generate button pressed!');
  let prompts = getPromptsList();
  if (prompts.length === 0) {
    console.log('[UI] Prompt input empty, loading sample prompts automatically...');
    promptInput.value = SAMPLE_PROMPTS.join('\n\n');
    updateCounters();
    prompts = getPromptsList();
  }

  const launchBrowser = chkAutoLaunch ? chkAutoLaunch.checked : true;

  btnGenerate.disabled = true;
  const originalText = btnGenerate.innerHTML;
  btnGenerate.innerHTML = `
    <span class="btn-content">
      <svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle></svg>
      <span>Queueing Prompts & Launching Flow...</span>
    </span>
  `;

  try {
    const projectName = (projectNameInput?.value || '').trim() || 'Project_' + Date.now().toString().slice(-6);
    hasNotifiedCompletion = false;
    isMonitorDismissedByUser = false;

    console.log('[UI] Sending /api/generate for project:', projectName, 'with', prompts.length, 'prompts, speed:', currentSpeedMode, 'quality:', currentImageQuality);

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts,
        launchBrowser,
        projectName,
        speedMode: currentSpeedMode,
        imageQuality: currentImageQuality,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to start generation');
    }

    console.log('[UI] Server acknowledged generation:', data);

    // Show progress section immediately
    if (progressSection) progressSection.style.display = 'block';
    if (btnToggleMonitor) btnToggleMonitor.style.display = 'none';
    if (btnAlertDismiss) btnAlertDismiss.style.display = 'none';

    if (statusAlertText) {
      statusAlertText.innerHTML = `🚀 <b>${prompts.length} Prompts Queued for "${data.projectId || projectName}"!</b> Generating at <b>${(data.speedMode || currentSpeedMode).toUpperCase()}</b> speed with <b>${(data.imageQuality || currentImageQuality).toUpperCase()}</b> download mode.`;
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
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = originalText;
    }, 1500);
  }
});

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
    alert('Could not launch Chrome: ' + e.message);
  }
});

// 🔄 Reset Studio to Initial Clean State (Preserves Chrome Google Login)
const btnResetStudio = document.getElementById('btn-reset-studio');
btnResetStudio?.addEventListener('click', async () => {
  const confirmed = confirm('Are you sure you want to reset Flow Auto Studio to its clean initial state?\n\n- Clears prompts & queue\n- Resets project & error states\n- Resets Google Flow canvas cache\n- Preserves your Google Chrome login session');
  if (!confirmed) return;

  const originalHTML = btnResetStudio.innerHTML;
  btnResetStudio.disabled = true;
  btnResetStudio.innerHTML = '<span>⏳</span><span>Resetting App...</span>';

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
      setImageQuality('standard');

      // 4. Hide progress section & alerts
      if (progressSection) progressSection.style.display = 'none';
      if (btnToggleMonitor) btnToggleMonitor.style.display = 'inline-flex';
      if (statusAlertText) statusAlertText.innerHTML = '';

      // 5. Clear logs UI
      if (logEntries) {
        logEntries.innerHTML = '<div class="log-entry system"><span class="log-time">[Ready]</span> <span class="log-msg">App reset to initial launch conditions. Chrome login preserved.</span></div>';
      }

      // 6. Reset monitor error and states
      isMonitorDismissedByUser = false;
      hasNotifiedCompletion = false;

      btnResetStudio.innerHTML = '<span>✅</span><span>Reset Done!</span>';
      btnResetStudio.style.borderColor = 'rgba(34,197,94,0.5)';
      btnResetStudio.style.color = '#4ade80';

      showToast('🔄 Studio Reset Complete!',
        'Flow Auto Studio has been restored to fresh initial state. Your Google Chrome login is safely preserved.', 7000);

      fetchStatus();
    } else {
      throw new Error(data.error || 'Failed to reset');
    }
  } catch (err) {
    alert('Error resetting app: ' + err.message);
  } finally {
    setTimeout(() => {
      btnResetStudio.disabled = false;
      btnResetStudio.innerHTML = originalHTML;
      btnResetStudio.style.borderColor = '';
      btnResetStudio.style.color = '';
    }, 3000);
  }
});

// 🔌 Reload Extension button
const btnReloadExt = document.getElementById('btn-reload-ext');
btnReloadExt?.addEventListener('click', async () => {
  const originalHTML = btnReloadExt.innerHTML;
  btnReloadExt.disabled = true;
  btnReloadExt.innerHTML = '⏳ Syncing...';
  try {
    const res = await fetch('/api/reload-extension', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      btnReloadExt.innerHTML = '✅ Files Synced!';
      btnReloadExt.style.color = '#22c55e';
      btnReloadExt.style.borderColor = 'rgba(34,197,94,0.4)';
      showToast('🔌 Extension Files Updated!',
        '1. Open <b>chrome://extensions</b><br>2. Find <b>TurboFlow</b><br>3. Click the <b>↺ reload</b> icon', 15000);
    }
  } catch (e) {
    alert('Could not sync extension: ' + e.message);
  } finally {
    setTimeout(() => {
      btnReloadExt.disabled = false;
      btnReloadExt.innerHTML = originalHTML;
      btnReloadExt.style.color = '';
      btnReloadExt.style.borderColor = '';
    }, 3000);
  }
});

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
         <b>From now on Chrome will auto-login to Google every time it opens.</b><br>
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
      btnKillChrome.innerHTML = '✅ Chrome Closed';
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

function initLiveChromeStream() {
  const chromeImg = document.getElementById('chrome-live-img');
  const chromeStatus = document.getElementById('chrome-view-status');
  const chromeOverlay = document.getElementById('chrome-view-overlay');
  const btnOpenChrome = document.getElementById('btn-open-real-chrome');
  const btnFocus = document.getElementById('btn-focus-chrome');

  const triggerBringChrome = async (btn) => {
    const orig = btn ? btn.innerHTML : null;
    if (btn) btn.innerHTML = '🌐 Bringing Chrome...';
    try {
      await fetch('/api/focus-chrome', { method: 'POST' });
    } catch (e) {
      console.warn('Focus chrome error:', e);
    } finally {
      if (btn && orig) {
        setTimeout(() => { btn.innerHTML = orig; }, 1200);
      }
    }
  };

  btnOpenChrome?.addEventListener('click', () => triggerBringChrome(btnOpenChrome));
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
      if (chromeStatus) {
        chromeStatus.textContent = '● Live Video Stream';
        chromeStatus.style.background = 'rgba(34, 197, 94, 0.2)';
        chromeStatus.style.color = '#4ade80';
        chromeStatus.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      }
      if (chromeOverlay) {
        chromeOverlay.textContent = 'Google Flow Canvas Live';
        chromeOverlay.style.display = 'block';
      }
      // Rapid frame refresh (~350ms) gives smooth, video-like visual feed
      setTimeout(fetchNextFrame, 350);
    };

    offscreen.onerror = () => {
      isFetchingFrame = false;
      if (chromeStatus) {
        chromeStatus.textContent = 'Chrome Standby';
        chromeStatus.style.background = 'rgba(148, 163, 184, 0.15)';
        chromeStatus.style.color = '#94a3b8';
      }
      setTimeout(fetchNextFrame, 1500);
    };

    offscreen.src = `/api/debug/live-frame.jpg?t=${Date.now()}`;
  }

  fetchNextFrame();
}

// Start continuous live stream
initLiveChromeStream();

