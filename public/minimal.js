// Minimalist AI Image Studio Client Script

const SAMPLE_PROMPTS = [
  "Cinematic portrait of a cyberpunk detective walking through neon-lit rain, reflections in puddles, atmospheric haze, 8k resolution",
  "Majestic snow leopard perched on Himalayan mountain cliffs during golden hour sunrise, crisp photorealistic textures",
  "Cozy warm vintage coffee shop interior on a rainy autumn evening, soft bokeh lights, steaming cup on wooden table",
  "Futuristic holographic laboratory with floating AI data visualizers, sleek minimalist architecture, deep blue and amber tones",
  "Mystical bioluminescent enchanted forest with glowing flora, ethereal gentle fog, moonlight filtering through ancient trees"
];

// DOM Elements
const promptInput = document.getElementById('prompt-input');
const promptCountBadge = document.getElementById('prompt-count-badge');
const btnGenerate = document.getElementById('btn-generate');
const btnSample = document.getElementById('btn-sample');
const workerSelect = document.getElementById('worker-select');
const galleryGrid = document.getElementById('gallery-grid');
const galleryCount = document.getElementById('gallery-count');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');

// Progress Bar Elements
const progressContainer = document.getElementById('live-progress-container');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const progressPercent = document.getElementById('progress-percent');

// Lightbox Elements
const lightboxModal = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxFilename = document.getElementById('lightbox-filename');
const lightboxDownload = document.getElementById('lightbox-download');
const lightboxClose = document.getElementById('lightbox-close');

// Drawer Elements
const btnOpenSettings = document.getElementById('btn-open-settings');
const drawerModal = document.getElementById('drawer-modal');
const drawerClose = document.getElementById('drawer-close');
const btnClearQueue = document.getElementById('btn-clear-queue');
const btnFixFlow = document.getElementById('btn-fix-flow');

let pollingTimer = null;
let lastImagesHash = '';
let isGenerating = false;

// Parse prompts from textarea
function getPromptsList() {
  const text = promptInput.value || '';
  return text
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.startsWith('#'));
}

// Update prompt counter
function updatePromptCounter() {
  const prompts = getPromptsList();
  const count = prompts.length;
  promptCountBadge.textContent = count === 1 ? '1 Prompt' : `${count} Prompts`;
  if (count > 0) {
    btnGenerate.disabled = false;
  }
}

promptInput.addEventListener('input', updatePromptCounter);

// Load sample prompts
btnSample?.addEventListener('click', () => {
  promptInput.value = SAMPLE_PROMPTS.join('\n\n');
  updatePromptCounter();
  promptInput.focus();
});

// Generate Button Click
btnGenerate?.addEventListener('click', async () => {
  let prompts = getPromptsList();
  if (prompts.length === 0) {
    promptInput.value = SAMPLE_PROMPTS.join('\n\n');
    updatePromptCounter();
    prompts = getPromptsList();
  }

  const workerCount = parseInt(workerSelect?.value, 10) || 7;
  const projectName = 'Project_' + Date.now().toString().slice(-6);

  btnGenerate.disabled = true;
  btnGenerate.innerHTML = `
    <svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle></svg>
    <span>Generating...</span>
  `;

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts,
        projectName,
        workerCount,
        speedMode: 'fast',
        imageQuality: 'standard',
        launchBrowser: true
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start generation');

    isGenerating = true;
    showProgressUI(prompts.length, workerCount);
    pollStatus();
  } catch (err) {
    alert('Error starting generation: ' + err.message);
    resetGenerateButton();
  }
});

function showProgressUI(totalPrompts, workerCount) {
  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressLabel.textContent = `Starting ${workerCount} Chrome Workers for ${totalPrompts} scene(s)...`;
    progressPercent.textContent = '0%';
  }
  if (statusDot) statusDot.classList.add('generating');
  if (statusText) statusText.textContent = `Generating with ${workerCount} Workers`;
}

function resetGenerateButton() {
  btnGenerate.disabled = false;
  btnGenerate.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
    <span>Generate Images</span>
  `;
}

// Fetch and render gallery
async function fetchGallery() {
  try {
    const res = await fetch('/api/images');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && Array.isArray(data.images)) {
      renderGallery(data.images);
    }
  } catch (e) {}
}

function renderGallery(images) {
  if (galleryCount) galleryCount.textContent = `${images.length} Images`;

  const newHash = images.map(img => `${img.filename}:${img.mtime}`).join('|');
  if (newHash === lastImagesHash) return;
  lastImagesHash = newHash;

  if (images.length === 0) {
    galleryGrid.innerHTML = `
      <div class="gallery-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
        <h4>No Images Yet</h4>
        <p>Enter your prompts above and click Generate to create images.</p>
      </div>
    `;
    return;
  }

  galleryGrid.innerHTML = images.map(img => {
    return `
      <div class="image-card" onclick="openLightbox('${img.url}', '${img.filename}')">
        <img src="${img.url}" alt="${img.filename}" loading="lazy" />
        <div class="image-card-overlay">
          <div class="image-card-info">
            <span class="image-card-title">${img.filename}</span>
            <a class="image-card-btn" href="${img.url}" download="${img.filename}" onclick="event.stopPropagation()" title="Download Image">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Poll status for live progress
async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    const activeRun = data.activeRun;

    if (activeRun && activeRun.runId) {
      const isComplete = activeRun.status === 'completed';
      const total = activeRun.count || 1;
      const current = data.currentRunCount || 0;
      const percent = Math.min(Math.round((current / total) * 100), 100);

      if (progressFill) progressFill.style.width = `${percent}%`;
      if (progressPercent) progressPercent.textContent = `${percent}%`;
      if (progressLabel) {
        progressLabel.textContent = isComplete
          ? `✓ All ${total} scene(s) generated successfully!`
          : `Scene ${current} of ${total} (${activeRun.workerCount || 7} Workers running in parallel)...`;
      }

      if (isComplete) {
        isGenerating = false;
        resetGenerateButton();
        if (statusDot) statusDot.classList.remove('generating');
        if (statusText) statusText.textContent = 'Ready';
        setTimeout(() => {
          if (progressContainer && !isGenerating) {
            progressContainer.style.display = 'none';
          }
        }, 5000);
      }
    }

    if (Array.isArray(data.images)) {
      renderGallery(data.images);
    }

    const nextDelay = (activeRun?.status === 'generating' || isGenerating) ? 1200 : 3000;
    clearTimeout(pollingTimer);
    pollingTimer = setTimeout(pollStatus, nextDelay);
  } catch (e) {
    clearTimeout(pollingTimer);
    pollingTimer = setTimeout(pollStatus, 3500);
  }
}

// Lightbox Modal functions
window.openLightbox = function(url, filename) {
  if (!lightboxModal) return;
  lightboxImg.src = url;
  lightboxFilename.textContent = filename;
  lightboxDownload.href = url;
  lightboxDownload.setAttribute('download', filename);
  lightboxModal.classList.add('active');
};

function closeLightbox() {
  if (lightboxModal) lightboxModal.classList.remove('active');
}

lightboxClose?.addEventListener('click', closeLightbox);
lightboxModal?.addEventListener('click', (e) => {
  if (e.target === lightboxModal) closeLightbox();
});

// Settings Drawer
btnOpenSettings?.addEventListener('click', () => {
  drawerModal?.classList.add('active');
});

drawerClose?.addEventListener('click', () => {
  drawerModal?.classList.remove('active');
});

drawerModal?.addEventListener('click', (e) => {
  if (e.target === drawerModal) drawerModal.classList.remove('active');
});

// Clear Queue
btnClearQueue?.addEventListener('click', async () => {
  try {
    await fetch('/api/clear-queue', { method: 'POST' });
    isGenerating = false;
    resetGenerateButton();
    if (progressContainer) progressContainer.style.display = 'none';
    if (statusDot) statusDot.classList.remove('generating');
    if (statusText) statusText.textContent = 'Ready';
    pollStatus();
    drawerModal?.classList.remove('active');
  } catch (e) {}
});

// Fix Flow Unusual Activity
btnFixFlow?.addEventListener('click', async () => {
  btnFixFlow.textContent = 'Clearing...';
  try {
    await fetch('/api/fix-unusual-activity', { method: 'POST' });
    btnFixFlow.textContent = '✓ Flow Cache Cleared';
    setTimeout(() => { btnFixFlow.textContent = '🧹 Clear Flow Cache'; }, 2000);
  } catch (e) {
    btnFixFlow.textContent = '🧹 Clear Flow Cache';
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLightbox();
    drawerModal?.classList.remove('active');
  }
});

// Add CSS keyframes for spinner
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

// Initial bootstrap
updatePromptCounter();
fetchGallery();
pollStatus();
