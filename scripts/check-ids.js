const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '../public/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const ids = [
  'prompt-input',
  'project-name-input',
  'prompt-counter',
  'char-counter',
  'btn-generate-playwright',
  'btn-sample-prompts',
  'btn-clear-prompts',
  'btn-open-folder',
  'btn-reset-studio',
  'btn-reset-session',
  'btn-focus-chrome',
  'btn-dismiss-monitor',
  'chk-auto-launch',
  'progress-section',
  'run-status-pill',
  'active-run-id',
  'status-alert-text',
  'gallery-grid',
  'gallery-counter',
  'btn-refresh-gallery',
  'image-modal',
  'modal-img',
  'modal-filename',
  'modal-download',
  'modal-close',
  'modal-overlay'
];

let missing = 0;
for (const id of ids) {
  if (!html.includes(`id="${id}"`)) {
    console.log('MISSING:', id);
    missing++;
  } else {
    console.log('OK:', id);
  }
}

if (missing === 0) {
  console.log(`\n✅ ALL ${ids.length} CRITICAL DOM IDS VERIFIED IN INDEX.HTML!`);
} else {
  console.error(`\n❌ ${missing} IDS MISSING!`);
  process.exit(1);
}
