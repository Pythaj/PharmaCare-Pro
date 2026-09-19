// Shared detection helper for the packaged desktop (Electron) runtime.
// Used to disable browser-only features (service worker caching, PWA
// install prompts, etc.) that conflict with the Electron desktop shell.

export function isElectron(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  return ua.includes('Electron') || ua.includes('pharmacare-desktop');
}