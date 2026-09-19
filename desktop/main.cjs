/*
 * PharmaCare Pro — Desktop Edition
 * Electron main process.
 *
 * Responsibilities:
 *  1. Single-instance lock (only one POS may run at a time).
 *  2. Auto-provision the on-disk SQLite database on first launch
 *     (seeded template from the build is copied into the writable userData dir).
 *  3. Spawn the self-contained Next.js production server on a free loopback
 *     port (127.0.0.1 only — never exposed to the network, no firewall prompt).
 *  4. Wait for the server to be reachable, then open the app window.
 *  5. Minimize-to-tray, crash auto-restart of the server, graceful shutdown.
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

// Owner Remote Access (ngrok) manager — independent from the app window so a
// tunnel started at boot keeps serving until PharmaCare Pro fully quits.
const remote = require('./remote.cjs');

const APP_TITLE = 'PharmaCare Pro';
const RESTART_LIMIT = 5;

let mainWindow = null;
let tray = null;
let serverProc = null;
let isQuitting = false;
let restartCount = 0;
let currentPort = 0;
let logStream = null;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Root of the bundled Next.js server (resources/nextapp when packaged). */
function nextAppDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'nextapp')
    : path.join(__dirname, 'nextapp');
}

/** Writable, per-user data directory for the database and logs. */
function dataDir() {
  return app.getPath('userData');
}

/** Absolute path to the SQLite database file used at runtime. */
function dbFilePath() {
  return path.join(dataDir(), 'pharmacare.db');
}

/** Absolute path to the bundled query-engine DLL shipped inside nextapp. */
function queryEnginePath() {
  return path.join(nextAppDir(), 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node');
}

function logFile() {
  return path.join(dataDir(), 'server.log');
}

function wp(msg) {
  try {
    if (logStream) logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* never let logging break the app */
  }
  if (!app.isPackaged) console.log(msg);
}

// ---------------------------------------------------------------------------
// Database provisioning (first run)
// ---------------------------------------------------------------------------

/** Copies the seeded template DB into the userData dir on very first launch. */
function provisionDatabase() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const target = dbFilePath();
    if (fs.existsSync(target)) {
      wp(`Database already present at ${target}`);
      return;
    }
    const template = path.join(nextAppDir(), 'db', 'template.db');
    if (!fs.existsSync(template)) {
      wp('WARNING: template.db missing — starting with a fresh empty database.');
      fs.writeFileSync(target, '', { flag: 'a' });
      return;
    }
    fs.copyFileSync(template, target);
    wp(`Provisioned new database from template -> ${target}`);
  } catch (err) {
    wp(`Database provisioning failed: ${err.message}`);
    dialog.showErrorBox(APP_TITLE, `Could not initialise the local database:\n${err.message}`);
    app.exit(1);
  }
}

/** Returns (and on first run generates) a per-install JWT secret. */
function jwtSecret() {
  const secretFile = path.join(dataDir(), 'pharmacare.secret');
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const fresh = require('crypto').randomBytes(48).toString('base64url');
    fs.writeFileSync(secretFile, fresh, { mode: 0o600 });
    wp('Generated new per-install JWT secret');
    return fresh;
  } catch (err) {
    wp(`Could not persist JWT secret (using ephemeral): ${err.message}`);
    return require('crypto').randomBytes(48).toString('base64url');
  }
}

// ---------------------------------------------------------------------------
// Port selection
// ---------------------------------------------------------------------------

/** Resolves a free TCP port on the loopback interface. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Polls the embedded server until it answers (or the timeout elapses).
 * Cold first boot can be slow (AV scan + JIT of the bundled server chunk), so
 * the per-probe timeout is generous and the overall window allows ~2 minutes.
 * ANY HTTP response — even 4xx/5xx — proves the server is listening.
 */
function waitForServer(port, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Server did not start in time'));
        return;
      }
      const req = http.get({ host: '127.0.0.1', port, path: '/api/auth', timeout: 5000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => setTimeout(probe, 250));
      req.on('close', () => { /* benign for aborted probes */ });
    };
    probe();
  });
}

// ---------------------------------------------------------------------------
// Embedded Next.js server lifecycle
// ---------------------------------------------------------------------------

function buildServerEnv(port) {
  return {
    ...process.env,
    // CRITICAL: spawn the child as plain Node.js. Electron does NOT put this
    // in its own environment, so it must be injected here — otherwise the
    // child launches as a second full GUI instance, fails the single-instance
    // lock, and exits immediately.
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    DATABASE_URL: `file:${dbFilePath().replace(/\\/g, '/')}`,
    DATABASE_PROVIDER: 'sqlite',
    COOKIE_SECURE: 'false',
    // Per-install secret (persisted in userData) so sessions stay valid across
    // restarts without hardcoding credentials into the shipped binary.
    JWT_SECRET: jwtSecret(),
    NEXT_PUBLIC_APP_NAME: APP_TITLE,
    // Point Prisma at the bundled Windows query engine (offline, deterministic).
    PRISMA_QUERY_ENGINE_LIBRARY: queryEnginePath(),
  };
}

function startNextServer(port) {
  const appDir = nextAppDir();
  const serverEntry = path.join(appDir, 'server.js');
  if (!fs.existsSync(serverEntry)) {
    dialog.showErrorBox(APP_TITLE, `Missing application server:\n${serverEntry}\nPlease reinstall PharmaCare Pro.`);
    app.exit(1);
    return;
  }

  try {
    fs.mkdirSync(dataDir(), { recursive: true });
  } catch (err) {
    wp(`Failed to create data dir: ${err.message}`);
  }
  logStream = fs.createWriteStream(logFile(), { flags: 'a' });

  wp(`Starting Next.js server (port ${port})...`);
  // ELECTRON_RUN_AS_NODE makes this Electron binary behave as plain Node.js,
  // so the installed app does not require a system Node runtime.
  serverProc = spawn(process.execPath, [serverEntry], {
    cwd: appDir,
    env: buildServerEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProc.stdout.on('data', (d) => wp(`[server] ${String(d).trim()}`));
  serverProc.stderr.on('data', (d) => wp(`[server] ${String(d).trim()}`));

  serverProc.on('exit', (code, signal) => {
    wp(`Server exited (code=${code}, signal=${signal})`);
    if (isQuitting) return;
    // Crash recovery — restart with backoff up to the limit.
    if (restartCount < RESTART_LIMIT) {
      restartCount += 1;
      const delay = Math.min(2000 * restartCount, 15000);
      wp(`Restarting server (attempt ${restartCount}/${RESTART_LIMIT}) in ${delay}ms...`);
      setTimeout(() => {
        if (!isQuitting) startNextServer(currentPort);
      }, delay);
    } else {
      wp('Restart limit reached — giving up.');
      dialog.showErrorBox(APP_TITLE, 'The application server has stopped unexpectedly.\nPlease restart PharmaCare Pro.');
    }
  });

  serverProc.on('error', (err) => {
    wp(`Server spawn error: ${err.message}`);
  });
}

function stopNextServer() {
  if (serverProc && !serverProc.killed) {
    wp('Stopping server...');
    serverProc.kill('SIGTERM');
  }
  serverProc = null;
}

// ---------------------------------------------------------------------------
// Owner Remote Access IPC (ngrok)
// ---------------------------------------------------------------------------

/**
 * Registers the renderer-facing Remote Access bridge. Safe to call once
 * (guards against double-registration if this ran on a hot reload path).
 */
let remoteIpcRegistered = false;
function registerRemoteIpc() {
  if (remoteIpcRegistered) return;
  remoteIpcRegistered = true;

  remote.onStatus((s) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:status', s);
    }
  });

  ipcMain.handle('remote:get', () => remote.getState());
  ipcMain.handle('remote:config', (_event, patch) => remote.setConfig(patch));
  ipcMain.handle('remote:start', () => remote.start(currentPort));
  ipcMain.handle('remote:stop', () => remote.stop());
  ipcMain.handle('remote:ngrok:ensure', () => remote.ensureNgrok());
  ipcMain.handle('remote:ngrok:install-file', async () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose ngrok.exe for PharmaCare Pro',
      properties: ['openFile'],
      filters: [{ name: 'ngrok executable', extensions: ['exe'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return remote.getState();
    return remote.installFromFile(result.filePaths[0]);
  });
  ipcMain.handle('remote:login-item', (_event, open) => {
    const openAtLogin = !!open;
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin, path: process.execPath });
    } else {
      app.setLoginItemSettings({ openAtLogin });
    }
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('remote:get-login-item', () => app.getLoginItemSettings().openAtLogin);
}

/**
 * Applies "launch at Windows startup" (default ON) and auto-starts the public
 * tunnel when the owner enabled it before quitting. Called after the server is
 * healthy so ngrok immediately has a reachable port to point at.
 */
function applyStartupBehavior() {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  } else {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  remote.init();
  const state = remote.getState();
  if (state.startOnBoot) {
    wp('Owner Remote Access is set to auto-start — starting tunnel...');
    remote.start(currentPort).catch((err) => wp(`Tunnel auto-start failed: ${err.message}`));
  }
}

// ---------------------------------------------------------------------------
// Window & tray
// ---------------------------------------------------------------------------

function iconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'nextapp', 'public', 'icon-512x512.png');
  }
  return path.join(__dirname, '..', 'public', 'icon-512x512.png');
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath());
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ' + APP_TITLE, click: showMainWindow },
    { type: 'separator' },
    { label: 'Restart Server', click: () => { restartCount = 0; stopNextServer(); startNextServer(currentPort || 0); } },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showMainWindow);
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    icon: iconPath(),
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Cold first boot can still be settling right after waitForServer resolves;
  // retry the page load a few times instead of showing a dead page.
  let loadAttempts = 0;
  mainWindow.loadURL(`http://127.0.0.1:${port}`).catch(() => { /* handled via did-fail-load */ });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    if (isQuitting || mainWindow.isDestroyed()) return;
    if (loadAttempts >= 20) {
      wp(`Renderer failed to load the app: ${code} ${desc}`);
      return;
    }
    loadAttempts += 1;
    wp(`Page load failed (${code}) — retrying (${loadAttempts}/20)...`);
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.loadURL(`http://127.0.0.1:${port}`).catch(() => { /* next retry */ });
      }
    }, 800);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Minimize-to-tray (and close-to-tray): the POS keeps running in the
  // background so the pharmacy counter never loses state.
  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Security: never let the renderer navigate away from the app.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      e.preventDefault();
    }
  });

  // window.open is used by Receipt / Report print views. Allow only our own
  // origin (and blank/print windows); external URLs open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === '' || url.startsWith(`http://127.0.0.1:${port}`) || url.startsWith('about:blank')) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(async () => {
    try {
      provisionDatabase();
      currentPort = await findFreePort();
      startNextServer(currentPort);
      await waitForServer(currentPort);
      restartCount = 0;
      registerRemoteIpc();
      applyStartupBehavior();
      createWindow(currentPort);
      createTray();
    } catch (err) {
      wp(`Startup error: ${err.message}`);
      dialog.showErrorBox(APP_TITLE, `PharmaCare Pro failed to start:\n${err.message}`);
      app.quit();
    }

    app.on('activate', () => {
      if (mainWindow) showMainWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopNextServer();
    remote.stop();
  });

  // Keep the app alive with the tray even when every window is hidden/closed.
  app.on('window-all-closed', () => {
    /* Intentionally no-op: lifecycle is managed by the tray. */
  });

  app.on('will-quit', () => {
    if (logStream) { try { logStream.end(); } catch { /* noop */ } }
  });
}