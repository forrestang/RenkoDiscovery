const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
  backendProcess.on('error', (err) => {
    console.error(`[backend] Failed to spawn: ${err.message}`);
  });

  // Wait for backend to be ready
  await waitForPort(port);
}

function waitForPort(port, retries = 150, delay = 200) {
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
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isProd = app.isPackaged;
  if (isProd) {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend-dist', 'index.html'));
  } else {
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
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  const port = await findOpenPort(BACKEND_PORT);

  try {
    await startBackend(port);
    await createWindow(port);
  } catch (err) {
    await createWindow(port);
    dialog.showMessageBoxSync(mainWindow, {
      type: 'error',
      title: 'Backend Failed to Start',
      message: 'The backend server could not be started.',
      detail: err.message
        + '\n\nThe application will not function correctly.'
        + '\n\nCheck that Python/backend files are present and try restarting.',
    });
  }
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
