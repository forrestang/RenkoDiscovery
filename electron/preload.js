const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendPort: () => {
    return new Promise((resolve) => {
      ipcRenderer.on('backend-port', (_event, port) => {
        resolve(port);
      });
    });
  },
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});
