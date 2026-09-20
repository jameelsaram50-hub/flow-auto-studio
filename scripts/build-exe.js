const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'FlowAutoStudio-win32-x64');
const ELECTRON_DIST = path.join(ROOT_DIR, 'node_modules', 'electron', 'dist');

console.log('Building standalone FlowAutoStudio.exe...');
console.log('Source Electron:', ELECTRON_DIST);
console.log('Target Output:', DIST_DIR);

if (!fs.existsSync(ELECTRON_DIST)) {
  console.error('Error: Electron dist not found at', ELECTRON_DIST);
  process.exit(1);
}

// 1. Clean previous build if exists
if (fs.existsSync(DIST_DIR)) {
  console.log('Cleaning old build...');
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Copy Electron distribution files
console.log('Copying Electron binaries...');
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

for (const item of fs.readdirSync(ELECTRON_DIST)) {
  if (item === 'resources') continue; // We will handle resources separately
  copyRecursive(path.join(ELECTRON_DIST, item), path.join(DIST_DIR, item));
}

// 3. Rename electron.exe to FlowAutoStudio.exe
const oldExe = path.join(DIST_DIR, 'electron.exe');
const newExe = path.join(DIST_DIR, 'FlowAutoStudio.exe');
if (fs.existsSync(oldExe)) {
  fs.renameSync(oldExe, newExe);
  console.log('Created FlowAutoStudio.exe');
}

// 4. Create resources/app folder and copy project files
const resourcesDir = path.join(DIST_DIR, 'resources');
const appDir = path.join(resourcesDir, 'app');
fs.mkdirSync(appDir, { recursive: true });

console.log('Packaging application files into resources/app...');

// Items to copy into resources/app
const itemsToCopy = [
  'package.json',
  'server.js',
  'playwright_worker.js',
  'electron',
  'public',
  'turboflow-2.3.2.1-betaa',
  'node_modules',
];

for (const item of itemsToCopy) {
  const src = path.join(ROOT_DIR, item);
  const dest = path.join(appDir, item);
  if (fs.existsSync(src)) {
    console.log(`Copying ${item}...`);
    copyRecursive(src, dest);
  }
}

// Remove default_app.asar if copied, as resources/app takes precedence
const defaultAppAsar = path.join(resourcesDir, 'default_app.asar');
if (fs.existsSync(defaultAppAsar)) {
  try { fs.unlinkSync(defaultAppAsar); } catch (e) {}
}

console.log('==================================================');
console.log('✅ FlowAutoStudio.exe successfully built!');
console.log('Executable Location:');
console.log(newExe);
console.log('==================================================');
