// =============================================================================
//   electron/preload.js -- contextBridge bridge between the sandboxed renderer
//                          and the Electron main process.
//
//   The renderer runs with nodeIntegration:false and sandbox:true, so it
//   has zero access to Node or Electron internals. We expose a single
//   narrow surface here (`window.launcherAPI`) so the renderer can:
//     * start / stop the dev stack
//     * open the default browser to the client URL
//     * subscribe to log + status events from the main process
//
//   IMPORTANT: this is the ONLY file that should be listed in
//   BrowserWindow.webPreferences.preload. Adding new IPC channels? Update
//   constants.js in renderer/renderer.js accordingly.
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (cb) => {
  const listener = (_event, payload) => {
    try { cb(payload); } catch (err) { /* swallow renderer-side errors */ }
  };
  ipcRenderer.on(channel, listener);
  // Return an unsubscribe function so the renderer can hold a teardown
  // handle in case it ever re-mounts (e.g., hot-reload during dev).
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('launcherAPI', {
  start:    () => ipcRenderer.invoke('launcher:start'),
  stop:     () => ipcRenderer.invoke('launcher:stop'),
  open:     () => ipcRenderer.invoke('launcher:open'),
  onLog:    subscribe('launcher:log'),
  onStatus: subscribe('launcher:status'),
});
