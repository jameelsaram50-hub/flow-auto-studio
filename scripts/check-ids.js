const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const ids = [
  'prompt-input', 'project-name-input', 'prompt-counter', 'char-counter',
  'btn-generate', 'btn-sample-prompts', 'btn-clear-prompts', 'btn-open-folder',
  'btn-relaunch', 'chk-auto-launch', 'progress-section', 'run-status-pill',
  'active-run-id', 'status-alert-text', 'gallery-grid', 'gallery-counter',
  'btn-refresh-gallery', 'image-modal', 'modal-img', 'modal-filename',
  'modal-download', 'modal-close', 'modal-overlay'
];
for (const id of ids) {
  if (!html.includes(`id="${id}"`)) {
    console.log('MISSING:', id);
  } else {
    console.log('OK:', id);
  }
}
