# Flow Auto Studio 🎨🚀

> **1-Click Automated Batch Image Generator & Controller for Google Flow**

Flow Auto Studio is a high-performance desktop and web application designed to automate batch image generation inside Google Flow with real-time live canvas monitoring, single-output enforcement, and automated downloads.

---

## ✨ Features

- **⚡ Batch Image Automation:** Enter multiple prompts (one per line) and automatically generate scenes sequentially in Google Flow.
- **🖥️ Live Chrome Canvas View:** Real-time continuous in-app stream (~350ms refresh) showing Google Flow prompt typing, generating, and rendering.
- **🛡️ Strict 1x Output Control:** Automatically enforces single-image output per prompt to prevent duplicate generation.
- **📥 Direct & Upscaled Download Modes:**
  - *Instant 1080p:* Direct high-speed download straight from Google Flow.
  - *2K Upscaled:* Triggers Google's 2K upscaler before saving.
- **💾 Session Persistence:** Saves Google authentication cookies and state so you don't need to log in repeatedly.
- **🖥️ Dual Mode Support:** Run as a standalone Electron desktop app or as a local web application (`http://localhost:3001`).

---

## 🛠️ Architecture

- **Backend:** Node.js + Express (Port `3001`)
- **Automation Engine:** Playwright Core (Chromium stealth mode)
- **Frontend:** Vanilla HTML5, Modern CSS Design System, Vanilla JavaScript
- **Desktop Wrapper:** Electron

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Flow Auto Studio
To start the Electron desktop application:
```bash
npm start
```
Or start the backend server directly:
```bash
npm run server
```
Then navigate to `http://localhost:3001` in your browser.

---

## 🗂️ Folder structure

```
easyaihub image generater tool/
├─ server.js              Express API + run control (port 3001, loopback only)
├─ playwright_worker.js   Workers #1–#7 (Playwright-driven Chrome)
├─ electron/              Desktop window (main.js, preload.js)
├─ public/                UI (index.html, app.js, style.css; /minimal = compact UI)
├─ launchers/             Open_Chrome_Worker_1..7.bat (open a worker's Chrome by hand)
├─ scripts/               build-exe.js, sync_packaged.js, create-shortcut.ps1, check-ids.js
├─ data/projects/         Saved runs (project.json per run)
├─ start.bat              Syncs the source into the exe, then starts it
└─ FlowAutoStudio-win32-x64/   Built desktop app (generated — don't edit files in here)
```


**After changing code:** start the app with `start.bat` (or run `node scripts/sync_packaged.js`), otherwise
`FlowAutoStudio.exe` keeps running its previous copy in `FlowAutoStudio-win32-x64/resources/app/`.

---

## 📁 Output Directory

All generated images are automatically saved to:
```
%USERPROFILE%\Downloads\easyaihub
```

---

## 📄 License
MIT License
