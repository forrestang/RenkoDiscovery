# Electron Packaging Plan for RenkoDiscovery

Reference document for packaging RenkoDiscovery as a standalone desktop app using Electron (frontend) + PyInstaller (backend).

---

## Overview

The approach wraps the existing React/Vite frontend in an Electron shell and bundles the Python/FastAPI backend as a standalone executable via PyInstaller. Electron's main process spawns the backend as a child process on startup and loads the built frontend from local files.

**Why Electron over raw PyInstaller?**
- Proper Windows installer experience (Add/Remove Programs, Start Menu shortcut)
- No antivirus false positives (PyInstaller `.exe` files are frequently flagged by Windows Defender)
- Standard desktop app behavior (window chrome, tray icon if needed)
- Manual update path via GitHub Releases is straightforward

---

## Project Structure Changes

```
RenkoDiscovery/
├── electron/
│   ├── main.js              # Electron main process
│   └── preload.js           # Preload script (context bridge)
├── frontend/                # Existing (minor vite.config.js change)
│   ├── src/
│   │   └── App.jsx          # Remove hardcoded default path
│   └── vite.config.js       # Add base: './' for production
├── backend/
│   ├── main.py              # Add argparse for port, update CORS
│   └── main.spec            # PyInstaller spec file
├── package.json             # Root package.json for Electron + electron-builder
├── electron-builder.json5   # electron-builder config
└── ...existing files
```

---

## New Files

### `electron/main.js`

Electron main process. Spawns the Python backend, waits for it to be ready, then loads the frontend.

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow;
let backendProcess;
const BACKEND_PORT = 8000;

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findOpenPort(startPort + 1));
    });
  });
}

async function startBackend(port) {
  const isProd = app.isPackaged;
  const backendPath = isProd
    ? path.join(process.resourcesPath, 'backend', 'main.exe')
    : path.join(__dirname, '..', 'backend', 'main.py');

  const args = ['--port', String(port)];

  if (isProd) {
    backendProcess = spawn(backendPath, args);
  } else {
    backendProcess = spawn('python', [backendPath, ...args]);
  }

  backendProcess.stdout.on('data', (data) => {
    console.log(`[backend] ${data}`);
  });
  backendProcess.stderr.on('data', (data) => {
    console.error(`[backend] ${data}`);
  });

  // Wait for backend to be ready
  await waitForPort(port);
}

function waitForPort(port, retries = 50, delay = 200) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (++attempts >= retries) {
          reject(new Error(`Backend did not start on port ${port}`));
        } else {
          setTimeout(check, delay);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (++attempts >= retries) {
          reject(new Error(`Backend timeout on port ${port}`));
        } else {
          setTimeout(check, delay);
        }
      });
      socket.connect(port, '127.0.0.1');
    };
    check();
  });
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isProd = app.isPackaged;
  if (isProd) {
    // Load built frontend from local files
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend-dist', 'index.html'));
  } else {
    // Dev mode: load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }

  // Pass backend port to renderer via preload
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('backend-port', port);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const port = await findOpenPort(BACKEND_PORT);
  await startBackend(port);
  await createWindow(port);
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
```

### `electron/preload.js`

Exposes the backend port to the renderer process via context bridge.

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendPort: () => {
    return new Promise((resolve) => {
      ipcRenderer.on('backend-port', (_event, port) => {
        resolve(port);
      });
    });
  },
});
```

### Root `package.json`

This is the **root-level** `package.json` for Electron. The existing `frontend/package.json` stays unchanged.

```json
{
  "name": "renko-discovery",
  "version": "1.0.0",
  "description": "RenkoDiscovery Desktop Application",
  "main": "electron/main.js",
  "scripts": {
    "dev": "electron .",
    "build:frontend": "cd frontend && npm run build",
    "build:backend": "pyinstaller backend/main.spec",
    "build:electron": "electron-builder",
    "build": "npm run build:frontend && npm run build:backend && npm run build:electron"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  }
}
```

### `electron-builder.json5`

Configuration for electron-builder to produce a Windows installer.

```json5
{
  appId: "com.renkodiscovery.app",
  productName: "RenkoDiscovery",
  directories: {
    output: "release"
  },
  files: [
    "electron/**/*",
    "frontend-dist/**/*"
  ],
  extraResources: [
    {
      from: "dist/backend/",
      to: "backend",
      filter: ["**/*"]
    }
  ],
  win: {
    target: "nsis",
    icon: "assets/icon.ico"
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    installerIcon: "assets/icon.ico"
  }
}
```

### `backend/main.spec`

PyInstaller spec file to bundle the FastAPI backend into a single-folder executable.

```python
# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

block_cipher = None
backend_dir = Path('backend')

a = Analysis(
    [str(backend_dir / 'main.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'multipart',
        'renkodf',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='main',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # No console window in production
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend',
)
```

---

## Modifications to Existing Files

### `vite.config.js` — Add `base` for production builds

The built frontend must use relative paths so Electron can load it from the filesystem.

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',                    // <-- ADD THIS (relative paths for Electron)
  build: {
    outDir: '../frontend-dist',  // <-- ADD THIS (output alongside electron/)
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
```

### `backend/main.py` — Add argparse for port, update CORS

**At the top** (add argparse):
```python
import argparse
```

**CORS section** — add Electron origins:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "file://",          # Electron loads from file:// in production
        "app://.",          # Some Electron setups use custom protocol
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

> **Note on `file://` CORS**: Electron loading `file://` pages making requests to `http://localhost:PORT` can run into CORS issues. An alternative is to serve the frontend from the backend in production (add a `StaticFiles` mount) or use `allow_origins=["*"]` since the backend only listens on localhost anyway.

**`__main__` block** — accept port via CLI argument:
```python
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=args.port, reload=False)
```

Key changes:
- `host` changed from `0.0.0.0` to `127.0.0.1` (only accept local connections for security)
- `reload=False` (not needed in production; causes issues with PyInstaller)
- Port is configurable via `--port` flag so Electron can assign a free port

### `frontend/src/App.jsx` — Remove hardcoded default path

Change the localStorage fallback from a hardcoded path to empty string:

```javascript
// Before:
const saved = localStorage.getItem(`${STORAGE_PREFIX}workingDir`)
  || 'C:\\Users\\lawfp\\Desktop\\Data_renko'

// After:
const saved = localStorage.getItem(`${STORAGE_PREFIX}workingDir`) || ''
```

Also update `API_BASE` to use the port from Electron (or fall back to 8000 for dev):

```javascript
// Before:
const API_BASE = 'http://localhost:8000'

// After:
const getApiBase = async () => {
  if (window.electronAPI) {
    const port = await window.electronAPI.getBackendPort();
    return `http://localhost:${port}`;
  }
  return 'http://localhost:8000';
};
```

> **Implementation note**: Since `API_BASE` is used synchronously throughout `App.jsx`, the simplest approach is to initialize it as state and set it once the port is known. All fetch calls would wait until `apiBase` is set before firing. In dev mode (no Electron), it falls back to `http://localhost:8000` immediately.

---

## Dev vs Production Workflow

### Development (current workflow, unchanged)

```bash
# Terminal 1: Backend
cd backend
python main.py

# Terminal 2: Frontend
cd frontend
npm run dev

# Browser opens http://localhost:5173
```

Electron is optional during dev. If you want to test inside Electron:

```bash
# Terminal 1: Backend
cd backend
python main.py

# Terminal 2: Frontend dev server
cd frontend
npm run dev

# Terminal 3: Electron (loads from Vite dev server)
npm run dev    # from root package.json
```

### Production Build

```bash
# 1. Build frontend to static files
cd frontend && npm run build    # outputs to ../frontend-dist/

# 2. Bundle backend with PyInstaller
pyinstaller backend/main.spec   # outputs to dist/backend/

# 3. Package everything into installer
npx electron-builder            # outputs to release/
```

The final output in `release/` is a Windows installer (`.exe`) that users double-click to install.

---

## Build Process (Step by Step)

### One-time setup

```bash
# Install Electron deps at root
npm install

# Ensure PyInstaller is installed
pip install pyinstaller
```

### Full build

```bash
# From project root:
npm run build
```

This runs all three steps sequentially:
1. `build:frontend` — Vite builds React app to `frontend-dist/`
2. `build:backend` — PyInstaller bundles `main.py` to `dist/backend/`
3. `build:electron` — electron-builder packages everything into `release/`

### Testing the build locally

```bash
# After building, test the packaged app without installing:
./release/win-unpacked/RenkoDiscovery.exe
```

---

## Manual Update Strategy via GitHub Releases

No auto-updater. Updates are distributed manually through GitHub Releases.

### For you (developer):

1. Make code changes, test locally
2. Bump version in root `package.json`
3. Run `npm run build` to produce the installer
4. Create a GitHub Release:
   ```bash
   gh release create v1.x.x ./release/*.exe --title "v1.x.x" --notes "Changelog here"
   ```

### For your friends (users):

1. Go to the GitHub Releases page
2. Download the latest `.exe` installer
3. Run it — installs over the previous version automatically (NSIS handles this)

No need to uninstall first. NSIS overwrites the existing installation.

### Version checking (optional future enhancement)

If desired, the app could check the GitHub Releases API on startup to notify users of a new version:

```javascript
// In electron/main.js — optional
const https = require('https');

function checkForUpdates() {
  const url = 'https://api.github.com/repos/YOUR_USER/RenkoDiscovery/releases/latest';
  https.get(url, { headers: { 'User-Agent': 'RenkoDiscovery' } }, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      const latest = JSON.parse(data).tag_name;
      const current = app.getVersion();
      if (latest !== `v${current}`) {
        // Show dialog: "New version available, download from GitHub?"
      }
    });
  });
}
```

This is purely informational — no silent downloads or auto-installs.

---

## Checklist Before First Build

- [ ] Create `electron/` directory with `main.js` and `preload.js`
- [ ] Create root `package.json` and `electron-builder.json5`
- [ ] Create `backend/main.spec`
- [ ] Update `vite.config.js` (add `base: './'` and `build.outDir`)
- [ ] Update `backend/main.py` (argparse, CORS, host, reload)
- [ ] Update `App.jsx` (remove hardcoded path, dynamic API_BASE)
- [ ] Create or source an app icon (`assets/icon.ico`)
- [ ] Test: dev workflow still works unchanged
- [ ] Test: `npm run build` produces working installer
- [ ] Test: installed app launches, backend starts, frontend loads
- [ ] Test: working directory selection works on a fresh install (no localStorage)
