/*
 * PharmaCare Pro — Desktop Edition: Owner Remote Access (ngrok) manager.
 *
 * Owns everything system-level about the public tunnel:
 *   - ngrok binary discovery + one-time auto-download into the writable
 *     userData folder (bundling the agent would bloat the installer; the app
 *     fetches the official zip from download.ngrok.com on first use).
 *   - Spawning `ngrok http 127.0.0.1:<port>` with the owner's authtoken,
 *     polling the local ngrok agent API to surface the live public URL.
 *   - Persisting Remote-Access config (authtoken, region, startOnBoot) in
 *     userData/remote-access.json.
 *
 * All functions are plain functions (no Electron BrowserWindow dependency);
 * main.cjs wires them to IPC and the app lifecycle. Status pushes go through
 * a tiny listener list so main.cjs can forward them to the renderer.
 */
const { app } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = 'remote-access.json';
const NGROK_DIR = 'ngrok';
// Mirror list: official v3 stable Windows x64. The old download.ngrok.com path
// 404s; bin.equinox.io is the documented CDN, bin.ngrok.com its newer alias.
const NGROK_URLS = [
  'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip',
  'https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip',
];
const AGENT_API = 'http://127.0.0.1:4040/api/tunnels';
const AGENT_HEALTH = 'http://127.0.0.1:4040/api/status';

const REGIONS = ['us', 'eu', 'ap', 'au', 'sa', 'jp', 'in'];

const defaultState = () => ({
  ngrokReady: false,
  ngrokBlocked: false,
  downloading: false,
  starting: false,
  running: false,
  url: null,
  region: 'us',
  authtokenSet: false,
  startOnBoot: false,
  ngrokPath: null,
  error: null,
  downloadProgress: null,
});

let state = defaultState();
let config = { authtoken: '', region: 'us', startOnBoot: false };
let curPort = 0;
let child = null;
let pollTimer = null;
let downloadInFlight = false;
const listeners = [];

function log(msg) {
  try {
    console.log(`[remote] ${msg}`);
  } catch { /* noop */ }
}

function emit() {
  const snapshot = { ...state, config: { ...config, authtoken: !!config.authtoken } };
  for (const cb of [...listeners]) {
    try { cb(snapshot); } catch { /* noop */ }
  }
}

function onStatus(cb) {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// ─── Configuration (userData/remote-access.json) ──────────────────────────

function remoteDir() {
  const dir = path.join(app.getPath('userData'), NGROK_DIR);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* noop */ }
  return dir;
}

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath())) {
      const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
      config = {
        authtoken: typeof parsed.authtoken === 'string' ? parsed.authtoken : '',
        region: REGIONS.includes(parsed.region) ? parsed.region : 'us',
        startOnBoot: !!parsed.startOnBoot,
      };
    }
  } catch (err) {
    log(`Could not read config: ${err.message}`);
  }
  state.region = config.region;
  state.authtokenSet = !!config.authtoken;
  state.startOnBoot = config.startOnBoot;
  emit();
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify({ ...config }, null, 2), { mode: 0o600 });
  } catch (err) {
    log(`Could not persist config: ${err.message}`);
    state.error = `Could not save config: ${err.message}`;
    emit();
  }
}

/** Update accepted config fields and persist. Returns the new snapshot. */
function setConfig(patch = {}) {
  if (typeof patch.authtoken === 'string') config.authtoken = patch.authtoken.trim();
  if (REGIONS.includes(patch.region)) config.region = patch.region;
  if (typeof patch.startOnBoot === 'boolean') config.startOnBoot = patch.startOnBoot;
  saveConfig();
  state.region = config.region;
  state.authtokenSet = !!config.authtoken;
  state.startOnBoot = config.startOnBoot;
  emit();
  return getState();
}

// ─── ngrok binary discovery / download ────────────────────────────────────

/** Preferred locations for ngrok.exe, in order of preference. */
function candidatePaths() {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'bin', 'ngrok.exe'));
  } else {
    candidates.push(path.join(__dirname, 'bin', 'ngrok.exe'));
  }
  candidates.push(path.join(remoteDir(), 'ngrok.exe'));
  return candidates;
}

function findOnPath() {
  const pathext = (process.env.PATHEXT || '.EXE;.BAT;.CMD').split(';');
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of ['', ...pathext]) {
      const full = path.join(dir, `ngrok${ext}`);
      try {
        if (fs.existsSync(full)) return full;
      } catch { /* noop */ }
    }
  }
  return null;
}

/** Locates a usable ngrok binary; null when it must still be downloaded. */
function findNgrok() {
  for (const candidate of candidatePaths()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* noop */ }
  }
  return findOnPath();
}

/**
 * Strips the Mark-of-the-Web (Zone.Identifier) a downloaded ZIP copied to the
 * extracted binary. Windows Defender sometimes marks freshly-downloaded ngrok
 * as PUA; removing MOTW clears that auto-flag in many configurations.
 */
function stripMotw(bin) {
  const script = `Unblock-File -LiteralPath '${bin.replace(/'/g, "''")}'`;
  try {
    spawnSync('powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  } catch { /* best effort */ }
}

/**
 * Runs `ngrok version`. Returns { ok, blocked, error } — `blocked` is set when
 * Windows security refuses to execute the binary (PUA / SmartScreen).
 */
function tryVersionCheck(bin) {
  try {
    const res = spawnSync(bin, ['version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    if (res.status === 0 && /ngrok version/i.test(res.stdout || '')) {
      return { ok: true, blocked: false, error: null };
    }
    if (res.error) {
      // Windows Defender "potentially unwanted app" blocks surface as child
      // spawn failures: status stays null and the OS error maps to a generic
      // UV_UNKNOWN (code "UNKNOWN", errno -4094) with no stdout/stderr.
      const raw = String(res.error?.code || '') + ' ' + String(res.error?.message || '');
      const blocked =
        Number(res.error?.errno) === -4094 ||
        /UNKNOWN|EPERM|EACCES|ECANCELED|access denied|winerror|operation|not allowed/gi.test(raw);
      return { ok: false, blocked, error: blocked ? 'Blocked by Windows security' : raw.trim() || 'Version check failed' };
    }
    const stderrBlocked = /virus|potentially unwanted|blocked/gi.test(res.stderr || '');
    return { ok: false, blocked: stderrBlocked, error: stderrBlocked ? 'Blocked by Windows security' : 'Version check failed' };
  } catch (err) {
    return { ok: false, blocked: false, error: err.message };
  }
}

function extractZip(zipPath, destDir) {
  // Prefer the built-in Windows tar (libarchive supports zip); fall back to
  // PowerShell Expand-Archive which exists on every Windows 10+ box.
  const withFlags = ['-xf', zipPath, '-C', destDir];
  let res = spawnSync('tar', withFlags, { encoding: 'utf8', windowsHide: true });
  if (res.status === 0) return true;
  res = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 }
  );
  return res.status === 0;
}

/**
 * Ensures ngrok.exe is available. Returns a status string for the renderer:
 * 'ready' | 'downloaded' | 'path' | 'error' | 'busy' | 'blocked'.
 */
async function ensureNgrok() {
  if (downloadInFlight) return 'busy';
  const existing = findNgrok();
  if (existing) {
    const chk = tryVersionCheck(existing);
    if (chk.ok) {
      state.ngrokPath = existing;
      state.ngrokReady = true;
      state.ngrokBlocked = false;
      state.error = null;
      emit();
      return 'ready';
    }
    if (chk.blocked) {
      state.ngrokPath = existing;
      state.ngrokReady = false;
      state.ngrokBlocked = true;
      state.error =
        'Windows security blocked ngrok from running. Allow it in Windows Security, then try again, or pick your own ngrok.exe.';
      emit();
      return 'blocked';
    }
  }

  downloadInFlight = true;
  state.downloading = true;
  state.ngrokBlocked = false;
  state.error = null;
  emit();

  const targetDir = remoteDir();
  const target = path.join(targetDir, 'ngrok.exe');
  const tmpZip = path.join(os.tmpdir(), `pharmacare-ngrok-${Date.now()}.zip`);

  try {
    let downloaded = false;
    let lastErr = null;
    for (const url of NGROK_URLS) {
      try {
        log(`Downloading ngrok from ${url}...`);
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(tmpZip, buf);
        downloaded = true;
        break;
      } catch (err) {
        lastErr = err;
        log(`Mirror failed (${url}): ${err.message}`);
      }
    }
    if (!downloaded) throw new Error(lastErr?.message || 'Could not download ngrok (all mirrors unreachable)');

    if (fs.existsSync(target)) fs.unlinkSync(target);
    if (!extractZip(tmpZip, targetDir)) throw new Error('Could not unzip ngrok binary');
    stripMotw(target); // helps against Defender PUA auto-flag on fresh downloads

    try { fs.unlinkSync(tmpZip); } catch { /* noop */ }

    const chk = tryVersionCheck(target);
    if (!fs.existsSync(target) || !chk.ok) {
      if (chk.blocked) {
        state.ngrokPath = target;
        state.ngrokBlocked = true;
        throw new Error(
          'Windows security is blocking ngrok from running. Allow it in Windows Security, or pick your own ngrok.exe.',
        );
      }
      throw new Error(`Downloaded ngrok binary is not usable (${chk.error})`);
    }

    state.ngrokPath = target;
    state.ngrokReady = true;
    state.ngrokBlocked = false;
    return 'downloaded';
  } catch (err) {
    state.error = err.message;
    log(`ngrok install failed: ${err.message}`);
    return state.ngrokBlocked ? 'blocked' : 'error';
  } finally {
    downloadInFlight = false;
    state.downloading = false;
    emit();
  }
}

/**
 * Installs ngrok from a file the user picked (manual fallback when Windows
 * security blocks the auto-download). Copies it into the writable ngrok dir.
 */
function installFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    state.error = 'No file selected.';
    emit();
    return getState();
  }
  try {
    stripMotw(filePath);
    const chk = tryVersionCheck(filePath);
    if (!chk.ok) {
      state.ngrokBlocked = !!chk.blocked;
      state.error = chk.blocked
        ? 'Windows security still blocks that ngrok.exe. Use a copy you can run (e.g. from the Microsoft Store location).'
        : `That file is not a working ngrok binary (${chk.error || 'version check failed'}).`;
      emit();
      return getState();
    }
    const targetDir = remoteDir();
    const target = path.join(targetDir, 'ngrok.exe');
    if (fs.existsSync(target)) fs.unlinkSync(target);
    fs.copyFileSync(filePath, target);
    stripMotw(target);
    state.ngrokPath = target;
    state.ngrokReady = true;
    state.ngrokBlocked = false;
    state.error = null;
    emit();
    return getState();
  } catch (err) {
    state.error = `Could not install ngrok: ${err.message}`;
    emit();
    return getState();
  }
}

// ─── Tunnel lifecycle ─────────────────────────────────────────────────────

function writeNgrokConfig() {
  const yaml = [
    'version: "2"',
    `region: ${config.region}`,
    '',
  ];
  if (config.authtoken) yaml.push(`authtoken: ${config.authtoken}`);
  const file = path.join(remoteDir(), 'ngrok.yml');
  fs.writeFileSync(file, yaml.join('\n'), 'utf8');
  return file;
}

function agentReachable() {
  return new Promise((resolve) => {
    const req = http.get(AGENT_API, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function fetchTunnels() {
  return fetch(AGENT_API, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : { tunnels: [] }));
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  const startedAt = Date.now();
  pollTimer = setInterval(async () => {
    if (!child || child.killed) {
      // Child is gone; if an orphan agent still serves the tunnel, adopt it.
      if (await agentReachable()) {
        await refreshTunnel();
        return;
      }
      stopPolling();
      state.running = false;
      state.starting = false;
      state.url = null;
      emit();
      return;
    }
    try {
      await refreshTunnel();
      // Give up after ~45s if the agent never publishes a URL.
      if (!state.url && Date.now() - startedAt > 45000) {
        stopPolling();
        state.starting = false;
        state.error = 'ngrok started but no public URL was assigned. Check your authtoken and region.';
        emit();
      }
    } catch (err) {
      log(`Tunnel poll error: ${err.message}`);
    }
  }, 1500);
}

async function refreshTunnel() {
  const data = await fetchTunnels();
  const tunnels = data.tunnels || [];
  const tunnel = tunnels.find((t) =>
    t.public_url && /http/.test(t.proto) && /127\.0\.0\.1:|localhost:/.test(t.config?.addr || '')
  ) || tunnels.find((t) => t.public_url && /http/.test(t.proto));

  if (tunnel && state.url !== tunnel.public_url) {
    state.url = tunnel.public_url;
    state.running = true;
    state.starting = false;
    state.error = null;
    emit();
  } else if (tunnel && !state.running) {
    state.running = true;
    state.starting = false;
    state.error = null;
    emit();
  }
}

/** Spawns (or adopts) the ngrok tunnel pointing at the local server port. */
async function start(port) {
  if (port) curPort = port;
  if (!curPort) {
    state.error = 'Local server port is not ready yet.';
    emit();
    return getState();
  }

  const ngrokBin = findNgrok();
  if (!ngrokBin) {
    state.error = 'ngrok is not installed. Download it from the Remote tab first.';
    emit();
    return getState();
  }
  const chk = tryVersionCheck(ngrokBin);
  if (!chk.ok) {
    state.ngrokBlocked = !!chk.blocked;
    state.error = chk.blocked
      ? 'Windows security blocked ngrok from running. Allow it in Windows Security, or pick your own ngrok.exe in the Remote tab.'
      : 'ngrok is not installed or not usable. Download it from the Remote tab first.';
    emit();
    return getState();
  }

  stop();
  state.starting = true;
  state.error = null;
  emit();

  const configFile = writeNgrokConfig();
  const args = ['http', `127.0.0.1:${curPort}`, '--log=stdout', '--log-format=logfmt', '--config', configFile];

  child = spawn(ngrokBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, NGROK_AUTHTOKEN: config.authtoken || '' },
  });

  let adopted = false;
  child.stdout.on('data', (d) => log(`[ngrok] ${String(d).trim()}`));
  child.stderr.on('data', (d) => log(`[ngrok:err] ${String(d).trim()}`));

  child.on('error', (err) => {
    state.starting = false;
    state.error = `Failed to launch ngrok: ${err.message}`;
    emit();
  });

  child.on('exit', (code) => {
    log(`ngrok exited (code=${code})`);
    // An existing agent on 4040 (orphan from a previous crash) makes our spawn
    // exit immediately — adopt its tunnels instead of failing.
    if (!adopted && agentReachable()) {
      adopted = true;
      refreshTunnel().catch(() => undefined);
    }
  });

  startPolling();
  return getState();
}

/** Stops the ngrok agent this app owns. */
function stop() {
  stopPolling();
  if (child && !child.killed) {
    try { child.kill(); } catch { /* noop */ }
    try { child.stdin?.end(); } catch { /* noop */ }
  }
  child = null;
  state.running = false;
  state.starting = false;
  state.url = null;
  state.error = null;
  emit();
}

// ─── Snapshot ─────────────────────────────────────────────────────────────

function getState() {
  return {
    region: state.region,
    authtokenSet: state.authtokenSet,
    startOnBoot: state.startOnBoot,
    ngrokReady: state.ngrokReady,
    ngrokBlocked: state.ngrokBlocked,
    downloading: state.downloading,
    starting: state.starting,
    running: state.running,
    url: state.url,
    ngrokPath: state.ngrokPath,
    error: state.error,
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────

function init() {
  loadConfig();
  // Report ngrok presence without blocking startup (sync version check is cheap).
  const found = findNgrok();
  state.ngrokPath = found;
  if (found) {
    const chk = tryVersionCheck(found);
    state.ngrokReady = chk.ok;
    state.ngrokBlocked = chk.blocked;
  }
  emit();
}

module.exports = {
  init,
  getState,
  setConfig,
  ensureNgrok,
  installFromFile,
  start,
  stop,
  onStatus,
  REGIONS,
};