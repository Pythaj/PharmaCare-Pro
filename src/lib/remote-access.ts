'use client';

/**
 * Typed client-side bridge to the desktop's Owner Remote Access (ngrok)
 * manager. In the packaged Electron app this talks to the main process via
 * `window.pharmacare.remoteAccess`; in a plain browser (web deploy or the
 * phone opening the tunnel) `window.pharmacare` does not exist, so every call
 * degrades to safe defaults and the Remote tab explains why.
 */

export interface RemoteState {
  region: string;
  authtokenSet: boolean;
  startOnBoot: boolean;
  ngrokReady: boolean;
  ngrokBlocked: boolean;
  downloading: boolean;
  starting: boolean;
  running: boolean;
  url: string | null;
  ngrokPath: string | null;
  error: string | null;
}

export type RemoteConfigPatch = {
  authtoken?: string;
  region?: string;
  startOnBoot?: boolean;
};

export const REMOTE_REGIONS = ['us', 'eu', 'ap', 'au', 'sa', 'jp', 'in'] as const;
export type RemoteRegion = (typeof REMOTE_REGIONS)[number];

interface DesktopRemoteAccess {
  get(): Promise<RemoteState>;
  setConfig(patch: RemoteConfigPatch): Promise<RemoteState>;
  start(): Promise<RemoteState>;
  stop(): Promise<RemoteState>;
  ensureNgrok(): Promise<string>;
  installFile(): Promise<RemoteState>;
  setOpenAtLogin(open: boolean): Promise<boolean>;
  getOpenAtLogin(): Promise<boolean>;
  onStatus(callback: (state: RemoteState) => void): () => void;
}

interface DesktopBridge {
  remoteAccess: DesktopRemoteAccess;
}

const fallbackState: RemoteState = {
  region: 'us',
  authtokenSet: false,
  startOnBoot: false,
  ngrokReady: false,
  ngrokBlocked: false,
  downloading: false,
  starting: false,
  running: false,
  url: null,
  ngrokPath: null,
  error: null,
};

function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { pharmacare?: DesktopBridge }).pharmacare;
  return b?.remoteAccess ? b : null;
}

export function isDesktopRemoteAvailable(): boolean {
  return !!bridge();
}

export function getDesktopPlatform(): string {
  if (typeof window === 'undefined') return 'web';
  const p = (window as unknown as { pharmacare?: { platform?: string } }).pharmacare;
  return p?.platform ?? 'web';
}

/** Live snapshot of the tunnel manager. Always resolves (never throws). */
export async function getRemoteState(): Promise<RemoteState> {
  const b = bridge();
  if (!b) return fallbackState;
  try {
    return await b.remoteAccess.get();
  } catch {
    return fallbackState;
  }
}

export async function updateRemoteConfig(patch: RemoteConfigPatch): Promise<RemoteState> {
  const b = bridge();
  if (!b) return fallbackState;
  try {
    return await b.remoteAccess.setConfig(patch);
  } catch (err) {
    return { ...fallbackState, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function startRemoteTunnel(): Promise<RemoteState> {
  const b = bridge();
  if (!b) return fallbackState;
  try {
    return await b.remoteAccess.start();
  } catch (err) {
    return { ...fallbackState, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function stopRemoteTunnel(): Promise<RemoteState> {
  const b = bridge();
  if (!b) return fallbackState;
  try {
    return await b.remoteAccess.stop();
  } catch {
    return fallbackState;
  }
}

export async function ensureNgrokInstalled(): Promise<'ready' | 'downloaded' | 'blocked' | 'path' | 'error' | 'busy'> {
  const b = bridge();
  if (!b) return 'error';
  try {
    return (await b.remoteAccess.ensureNgrok()) as 'ready' | 'downloaded' | 'blocked' | 'path' | 'error' | 'busy';
  } catch {
    return 'error';
  }
}

/** Opens a file picker so the owner can supply their own ngrok.exe. */
export async function installNgrokFromFile(): Promise<RemoteState> {
  const b = bridge();
  if (!b) return fallbackState;
  try {
    return await b.remoteAccess.installFile();
  } catch (err) {
    return { ...fallbackState, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setLaunchAtLogin(open: boolean): Promise<boolean> {
  const b = bridge();
  if (!b) return false;
  try {
    return await b.remoteAccess.setOpenAtLogin(open);
  } catch {
    return false;
  }
}

export async function getLaunchAtLogin(): Promise<boolean> {
  const b = bridge();
  if (!b) return false;
  try {
    return await b.remoteAccess.getOpenAtLogin();
  } catch {
    return false;
  }
}

/** Subscribes to push state updates from the desktop manager. */
export function subscribeRemoteStatus(callback: (state: RemoteState) => void): () => void {
  const b = bridge();
  if (!b) return () => undefined;
  try {
    return b.remoteAccess.onStatus(callback);
  } catch {
    return () => undefined;
  }
}