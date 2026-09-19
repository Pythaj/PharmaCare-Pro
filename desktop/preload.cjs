/*
 * PharmaCare Pro — Desktop Edition preload script.
 *
 * Runs in an isolated context with a privileged bridge to the main process.
 * The app communicates with the OS layer via this minimal, explicit surface
 * (defense-in-depth, Rule 14). `pharmacare.remoteAccess` is the Owner Remote
 * Access (ngrok) bridge used by the Settings → Remote tab; it gracefully
 * no-ops for browser sessions (web/Netlify), where `window.pharmacare` is
 * simply undefined.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pharmacare', {
  isDesktop: true,
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform,

  remoteAccess: {
    /** Snapshot of tunnel + config state. */
    get: () => ipcRenderer.invoke('remote:get'),
    /** Persist config; accepts { authtoken?, region?, startOnBoot? }. */
    setConfig: (patch) => ipcRenderer.invoke('remote:config', patch),
    /** Start the tunnel to the local server. */
    start: () => ipcRenderer.invoke('remote:start'),
    /** Stop the tunnel. */
    stop: () => ipcRenderer.invoke('remote:stop'),
    /** Download/install ngrok binary on first use. */
    ensureNgrok: () => ipcRenderer.invoke('remote:ngrok:ensure'),
    /** Pick an existing ngrok.exe (fallback when Windows security blocks the download). */
    installFile: () => ipcRenderer.invoke('remote:ngrok:install-file'),
    /** Toggle "launch PharmaCare Pro when Windows starts". */
    setOpenAtLogin: (open) => ipcRenderer.invoke('remote:login-item', open),
    getOpenAtLogin: () => ipcRenderer.invoke('remote:get-login-item'),
    /** Subscribe to live tunnel status pushes. Returns an unsubscribe fn. */
    onStatus: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('remote:status', listener);
      return () => ipcRenderer.removeListener('remote:status', listener);
    },
  },
});