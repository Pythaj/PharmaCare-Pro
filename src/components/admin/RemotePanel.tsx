'use client';

import { useEffect, useCallback, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Link2,
  Copy,
  ExternalLink,
  Wifi,
  WifiOff,
  ShieldCheck,
  Download,
  Loader2,
  Smartphone,
  KeyRound,
  Power,
  PowerOff,
  CheckCircle2,
  AlertTriangle,
  MonitorSmartphone,
  ShieldAlert,
  FolderOpen,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  getRemoteState,
  getLaunchAtLogin,
  setLaunchAtLogin,
  updateRemoteConfig,
  startRemoteTunnel,
  stopRemoteTunnel,
  ensureNgrokInstalled,
  installNgrokFromFile,
  subscribeRemoteStatus,
  isDesktopRemoteAvailable,
  REMOTE_REGIONS,
  type RemoteState,
  type RemoteRegion,
} from '@/lib/remote-access';

const EMPTY_STATE: RemoteState = {
  region: 'us',
  authtokenSet: false,
  startOnBoot: false,
  ngrokReady: false,
  downloading: false,
  starting: false,
  running: false,
  url: null,
  ngrokPath: null,
  error: null,
};

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Link copied to clipboard'),
      () => toast.error('Could not copy link'),
    );
  } else {
    toast.error('Copying not supported in this browser');
  }
}

const stepCard = (num: number, title: string, children: React.ReactNode) => (
  <div className="flex gap-3 rounded-xl border bg-muted/20 p-3">
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-xs font-bold text-white">
      {num}
    </span>
    <div className="min-w-0 space-y-0.5">
      <p className="text-sm font-medium">{title}</p>
      <div className="text-xs text-muted-foreground leading-relaxed">{children}</div>
    </div>
  </div>
);

const truncatePath = (p: string | null | undefined, max: number) => {
  if (!p) return 'the PharmaCare Pro data folder';
  const parts = p.split(/[\\/]/);
  if (parts.length <= 1) return p;
  const name = parts[parts.length - 1];
  if (p.length <= max) return p;
  return `…\\${parts[parts.length - 2]}\\${name}`;
};

export default function RemotePanel() {
  const desktop = isDesktopRemoteAvailable();
  const [state, setState] = useState<RemoteState>(EMPTY_STATE);
  const [loginItem, setLoginItem] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentLink, setCurrentLink] = useState<string | null>(null);

  const applyState = useCallback((s: RemoteState) => {
    setState((prev) => ({ ...prev, ...s }));
    setSavingToken(false);
    setBusy(false);
  }, []);

  // Load initial state + OS login-item flag + last known link (for phone view).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, login, linkRes] = await Promise.all([
        getRemoteState(),
        getLaunchAtLogin(),
        fetch('/api/remote/link').catch(() => null),
      ]);
      if (cancelled) return;
      applyState(s);
      setLoginItem(login);
      if (linkRes?.ok) {
        try {
          const data = await linkRes.json();
          if (typeof data.url === 'string' && data.url) setCurrentLink(data.url);
        } catch { /* ignore */ }
      }
    })();
    const unsubscribe = subscribeRemoteStatus((s) => {
      if (!cancelled) applyState(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyState]);

  // Keep the phone-visible "current link" in sync while the tunnel is live.
  useEffect(() => {
    if (!desktop || !state.running || !state.url) return;
    fetch('/api/remote/link', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: state.url }),
    }).catch(() => undefined);
  }, [desktop, state.running, state.url]);

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) {
      toast.error('Paste your ngrok authtoken first');
      return;
    }
    setSavingToken(true);
    const next = await updateRemoteConfig({ authtoken: tokenInput.trim() });
    applyState(next);
    if (next.authtokenSet) {
      setTokenInput('');
      toast.success('Authtoken saved — click Start tunnel');
    } else {
      toast.error(next.error ?? 'Could not save authtoken');
    }
  };

  const handleStart = async () => {
    setBusy(true);
    if (!state.ngrokReady) {
      const result = await ensureNgrokInstalled();
      const s = await getRemoteState();
      applyState(s);
      if (!s.ngrokReady) {
        if (result === 'blocked' || s.ngrokBlocked) {
          toast.error('Windows security is blocking ngrok — allow it or choose your own ngrok.exe');
        } else {
          toast.error(s.error ?? 'ngrok is not available yet');
        }
        setBusy(false);
        return;
      }
    }
    if (!state.authtokenSet) {
      toast.warning('Add your ngrok authtoken before starting');
      setBusy(false);
      return;
    }
    const s = await startRemoteTunnel();
    applyState(s);
    if (s.error) toast.error(s.error);
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true);
    const s = await stopRemoteTunnel();
    applyState(s);
    toast('Tunnel stopped');
  };

  const handleRegion = async (region: RemoteRegion) => {
    const s = await updateRemoteConfig({ region });
    applyState(s);
  };

  const handleStartOnBoot = async (val: boolean) => {
    const s = await updateRemoteConfig({ startOnBoot: val });
    applyState(s);
    toast(val ? 'Tunnel will start automatically' : 'Automatic tunnel startup disabled');
  };

  const handleLoginItem = async (val: boolean) => {
    const applied = await setLaunchAtLogin(val);
    setLoginItem(applied);
    toast(applied ? 'PharmaCare Pro will open when Windows starts' : 'Windows startup launch disabled');
  };

  const handleInstallNgrok = async () => {
    setBusy(true);
    const result = await ensureNgrokInstalled();
    const s = await getRemoteState();
    applyState(s);
    if (result === 'downloaded' || result === 'ready') {
      toast.success('ngrok is installed and ready');
    } else if (result === 'blocked' || s.ngrokBlocked) {
      toast.warning('Windows security blocked ngrok — use the steps below or choose your own ngrok.exe');
    } else {
      toast.error(s.error ?? 'ngrok download failed. Check your internet connection.');
    }
    setBusy(false);
  };

  const handlePickNgrokFile = async () => {
    setBusy(true);
    const s = await installNgrokFromFile();
    applyState(s);
    setBusy(false);
    if (s.ngrokReady) toast.success('ngrok installed and ready');
    else if (s.error) toast.error(s.error);
  };

  const running = state.running && !!state.url;

  return (
    <div className="space-y-6">
      {/* ── Browser / phone notice ── */}
      {!desktop && (
        <Card className="overflow-hidden border-amber-200 bg-amber-50/40">
          <CardContent className="p-4 flex items-start gap-3">
            <MonitorSmartphone className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">You are viewing from a phone or browser.</p>
              <p className="text-amber-800/80 mt-0.5">
                The tunnel is controlled from the pharmacy PC. If the link below is live you can use it now — it opens the
                same login you see here. {currentLink && <span className="font-medium">Your saved link: {currentLink}</span>}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Status hero ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary-light)] text-[var(--accent-primary)]">
              <Wifi className="h-4 w-4" />
            </span>
            Owner Remote Access
            <Badge
              variant="secondary"
              className={cn(
                'h-5 text-[10px] font-semibold px-2',
                running
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                  : state.starting
                    ? 'bg-blue-100 text-blue-700 border-blue-200'
                    : state.downloading
                      ? 'bg-slate-100 text-slate-600 border-slate-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200',
              )}
            >
              <span
                className={cn(
                  'mr-1.5 inline-block h-1.5 w-1.5 rounded-full',
                  running ? 'bg-emerald-500 animate-pulse' : state.starting ? 'bg-blue-500 animate-pulse' : 'bg-slate-400',
                )}
              />
              {state.downloading
                ? 'Installing ngrok…'
                : state.starting
                  ? 'Connecting…'
                  : running
                    ? 'Live'
                    : 'Off'}
            </Badge>
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground ml-[42px]">
            Expose this PC&apos;s PharmaCare Pro to your phone over a secure public tunnel, then open the link on any device to watch every sale live.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* If ngrok isn't usable because Windows security blocked it */}
          {desktop && state.ngrokBlocked && !state.ngrokReady && (
            <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/70 p-4">
              <p className="text-sm font-medium flex items-center gap-2 text-amber-900">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                Windows security is blocking ngrok
              </p>
              <p className="text-xs text-amber-800/90 leading-relaxed">
                ngrok is a genuine, widely-used app — but Windows flags freshly-downloaded tunnel tools as
                “potentially unwanted”, which blocks them from running. Pick one of these:
              </p>
              {stepCard(1, 'Add a folder exclusion (recommended by ngrok)', <>
                In <span className="font-medium">Windows Security → Virus &amp; threat protection → Manage settings →
                Exclusions</span>, add this folder:{' '}
                <span className="block mt-1 rounded bg-amber-100/80 px-2 py-1 font-mono text-[11px] break-all">
                  {truncatePath(state.ngrokPath, 90)}
                </span>
                Then press <span className="font-medium">Check again</span> below.
              </>)}
              {stepCard(2, 'Allow it in Protection history', <>
                Open <span className="font-medium">Virus &amp; threat protection → Protection history</span>, find the
                blocked ngrok item, expand <span className="font-medium">Actions…</span> and choose{' '}
                <span className="font-medium">Allow on device</span>. Then press <span className="font-medium">Check again</span>.
              </>)}
              {stepCard(3, 'Or choose your own ngrok.exe', <>
                Download ngrok from <span className="font-medium">ngrok.com/download</span>, unzip it, and pick
                <span className="font-medium"> ngrok.exe</span> with the button below.
              </>)}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  className="flex-1 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                  onClick={handleInstallNgrok}
                  disabled={busy || state.downloading}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Check again
                </Button>
                <Button variant="outline" className="flex-1" onClick={handlePickNgrokFile} disabled={busy}>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Choose ngrok.exe…
                </Button>
              </div>
            </div>
          )}

          {/* If ngrok isn't installed */}
          {!state.ngrokBlocked && !state.ngrokReady && desktop && (
            <div className="space-y-3 rounded-xl border p-4 bg-slate-50/50">
              <p className="text-sm font-medium flex items-center gap-2">
                <Download className="h-4 w-4 text-[var(--accent-primary)]" />
                One-time ngrok setup
              </p>
              {stepCard(1, 'Create a free ngrok account', <>Visit <span className="font-medium">dashboard.ngrok.com</span>, sign up, and copy your Authtoken (in “Your Authtoken”).</>)}
              {stepCard(2, 'Install ngrok on this PC', <>
                Click below — PharmaCare Pro downloads the official ngrok app automatically into its own folder.
              </>)}
              {stepCard(3, 'Start the tunnel', <>
                Paste the Authtoken, choose a region, then press <span className="font-medium">Start tunnel</span> below.
              </>)}
              <Button
                className="w-full bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                onClick={handleInstallNgrok}
                disabled={busy || state.downloading}
              >
                {state.downloading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Downloading ngrok…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download ngrok
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Live URL + QR */}
          {running ? (
            <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--accent-primary-border)' }}>
              <div className="flex items-center gap-2 text-emerald-700">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-sm font-medium">Tunnel is live — business is reachable worldwide</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="flex-1 min-w-0 w-full">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Public link</p>
                  <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2.5">
                    <Link2 className="h-4 w-4 text-[var(--accent-primary)] shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{state.url}</span>
                    <button onClick={() => copyText(state.url!)} className="text-slate-500 hover:text-slate-800 transition-colors shrink-0" aria-label="Copy link">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button onClick={() => window.open(state.url!, '_blank')} className="text-slate-500 hover:text-slate-800 transition-colors shrink-0" aria-label="Open link">
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground flex items-start gap-1.5">
                    <Smartphone className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Open it on any phone. Everyone sees the login screen — sales staff only see their own side; your
                    admin login unlocks full monitoring.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 w-full sm:w-auto border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={handleStop}
                    disabled={busy}
                  >
                    <PowerOff className="h-4 w-4 mr-2" />
                    Stop tunnel
                  </Button>
                </div>
                <div className="shrink-0 mx-auto sm:mx-0">
                  <div className="flex h-[176px] w-[176px] items-center justify-center rounded-2xl border bg-white p-3">
                    <QRCodeSVG value={state.url!} size={152} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                  </div>
                  <p className="mt-1.5 text-center text-[10px] font-medium text-muted-foreground">Scan to open on your phone</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                {state.starting || state.downloading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <WifiOff className="h-6 w-6" />
                )}
              </div>
              <p className="text-sm font-medium text-slate-600">
                {state.starting
                  ? 'Contacting the tunnel service…'
                  : state.downloading
                    ? 'Downloading ngrok…'
                    : 'Your tunnel is stopped'}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {!state.ngrokReady
                  ? 'Install ngrok first, then start the tunnel to get your public link.'
                  : !state.authtokenSet
                    ? 'Add your ngrok authtoken below, then start the tunnel.'
                    : 'Press Start tunnel to make the pharmacy accessible on your phone.'}
              </p>
            </div>
          )}

          {/* Error banner */}
          {state.error && !running && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/60 p-3">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{state.error}</p>
            </div>
          )}

          {/* Start when ready */}
          {state.ngrokReady && !running && !state.starting && (
            <Button
              className="w-full bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white h-11"
              onClick={handleStart}
              disabled={busy}
            >
              <Power className="h-4 w-4 mr-2" />
              Start tunnel
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Credentials & region ── */}
      {desktop && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary-light)] text-[var(--accent-primary)]">
                <KeyRound className="h-4 w-4" />
              </span>
              ngrok Authtoken
              {state.authtokenSet && (
                <Badge className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/20 h-5 text-[10px] font-semibold">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Saved
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground ml-[42px]">
              Find your token at dashboard.ngrok.com → “Your Authtoken”. Stored only on this PC.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ngrok-token" className="text-sm font-medium">Authtoken</Label>
                <div className="relative">
                  <Input
                    id="ngrok-token"
                    type="password"
                    placeholder={state.authtokenSet ? '•••••••••••••••• (saved)' : 'Paste your ngrok authtoken'}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="pr-24"
                  />
                  <button
                    onClick={handleSaveToken}
                    disabled={savingToken}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {savingToken ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Tunnel region</Label>
                <Select value={state.region} onValueChange={(v) => handleRegion(v as RemoteRegion)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {REMOTE_REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r.toUpperCase()} — {regionLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Choose the region closest to your pharmacy for lower latency.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Startup toggles ── */}
      {desktop && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary-light)] text-[var(--accent-primary)]">
                <Power className="h-4 w-4" />
              </span>
              Startup
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground ml-[42px]">
              Keep the pharmacy reachable — and your phone connected — without pressing anything on the PC.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="pc-autostart" className="text-sm font-medium">Launch PharmaCare Pro when Windows starts</Label>
                <p className="text-xs text-muted-foreground">Auto-open the app (and its server) as soon as the PC turns on, no login needed.</p>
              </div>
              <Switch id="pc-autostart" checked={loginItem} onCheckedChange={handleLoginItem} className="data-[state=checked]:bg-[var(--accent-primary)]" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="boot-tunnel" className="text-sm font-medium">Reconnect the phone link automatically</Label>
                <p className="text-xs text-muted-foreground">Restart the public tunnel whenever the app starts, so the phone link comes back by itself.</p>
              </div>
              <Switch id="boot-tunnel" checked={state.startOnBoot} onCheckedChange={handleStartOnBoot} className="data-[state=checked]:bg-[var(--accent-primary)]" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Security note ── */}
      <div className="rounded-xl border bg-muted/20 p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-[var(--accent-primary)] shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-sm text-foreground mb-1">How the phone stays secure</p>
          Anyone with the link only sees the <span className="font-medium">login screen</span> — it is the same
          password system you already use. Sales accounts cannot see admin areas, sales history of others, reports,
          users or settings. Treat the public link like your shop key: only the owner should keep it. Stop the tunnel
          any time you leave the counter.
        </div>
      </div>
    </div>
  );
}

function regionLabel(region: string): string {
  const map: Record<string, string> = {
    us: 'United States',
    eu: 'Europe',
    ap: 'Asia Pacific',
    au: 'Australia',
    sa: 'South America',
    jp: 'Japan',
    in: 'India',
  };
  return map[region] ?? region;
}