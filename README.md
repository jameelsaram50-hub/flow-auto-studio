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
- **🔌 TurboFlow Extension Integration:** Bundled Chrome extension bridge for synchronization between the local engine and Google Flow.
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

## 📁 Output Directory

All generated images are automatically saved to:
```
%USERPROFILE%\Downloads\turboflow
```

---

## 📄 License
MIT License
