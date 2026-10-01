const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_APP_DIR = path.join(ROOT_DIR, 'FlowAutoStudio-win32-x64', 'resources', 'app');

console.log('[Sync] Syncing updated source files to packaged directory:');
console.log('       Target:', TARGET_APP_DIR);

if (!fs.existsSync(TARGET_APP_DIR)) {
  console.log('[Sync] Packaged app directory does not exist, skipping.');
  process.exit(0);
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

const items = [
  'server.js',
  'playwright_worker.js',
  'chatgpt_worker.js',
  'public',
  'electron',
  'package.json',
];

for (const item of items) {
  const src = path.join(ROOT_DIR, item);
  const dest = path.join(TARGET_APP_DIR, item);
  if (fs.existsSync(src)) {
    console.log(`[Sync] Copying ${item}...`);
    copyRecursive(src, dest);
  }
}

// Chrome worker launchers (Open_Chrome_Worker_1..7.bat) go next to FlowAutoStudio.exe
const launchersDir = path.join(ROOT_DIR, 'launchers');
if (fs.existsSync(launchersDir)) {
  console.log('[Sync] Copying launchers next to FlowAutoStudio.exe...');
  for (const f of fs.readdirSync(launchersDir)) {
    fs.copyFileSync(path.join(launchersDir, f), path.join(ROOT_DIR, 'FlowAutoStudio-win32-x64', f));
  }
}

console.log('✅ [Sync] Successfully synced all updated files to FlowAutoStudio-win32-x64/resources/app!');
