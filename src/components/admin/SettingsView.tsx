'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Save,
  Building2,
  Phone,
  Mail,
  MapPin,
  Percent,
  Receipt,
  Monitor,
  ShoppingCart,
  Bell,
  Database,
  Info,
  Download,
  Trash2,
  ImageIcon,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  ToggleLeft,
  Palette,
  Globe,
  Timer,
  Lock,
  Activity,
  HardDrive,
  Store,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useAccentTheme, THEME_SWATCHES, type AccentTheme } from '@/hooks/use-accent-theme';

// ─── Types ───────────────────────────────────────────────────────

interface PharmacyInfo {
  appName: string;
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  taxRate: number;
  logoUrl: string;
  faviconUrl: string;
}

interface ReceiptSettings {
  headerText: string;
  footerText: string;
  width: string;
  showTax: boolean;
  showDiscount: boolean;
}

interface DisplaySettings {
  currency: string;
  dateFormat: string;
  timeFormat: string;
  primaryColor: string;
}

interface POSSettings {
  defaultPaymentMethod: string;
  autoPrintReceipt: boolean;
  defaultDiscount: number;
  requireCustomer: boolean;
  allowNegativeStock: boolean;
  maxLineItems: number;
}

interface NotificationSettings {
  lowStockThreshold: number;
  expiryAlertDays: number;
  enableNotifications: boolean;
}

interface BusinessSettings {
  enableHours: boolean;
  openTime: string;
  closeTime: string;
  closedDays: string;
}

interface DataSettings {
  autoBackup: string;
  sessionTimeout: number;
  requirePassword: boolean;
}

interface AllSettings {
  pharmacy: PharmacyInfo;
  receipt: ReceiptSettings;
  display: DisplaySettings;
  pos: POSSettings;
  notifications: NotificationSettings;
  business: BusinessSettings;
  data: DataSettings;
}

// ─── Helpers: flatten / unflatten settings for API ─────────────

function flattenSettings(s: AllSettings): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, key);
      } else {
        result[key] = String(v);
      }
    }
  };
  walk(s as unknown as Record<string, unknown>, '');
  return result;
}

function unflattenSettings(flat: Record<string, string>): Partial<AllSettings> {
  const result: Record<string, unknown> = {};
  for (const [compoundKey, value] of Object.entries(flat)) {
    const parts = compoundKey.split('.');
    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    // Parse numbers and booleans
    let parsed: string | number | boolean = value;
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (value !== '' && !isNaN(Number(value))) parsed = Number(value);
    current[parts[parts.length - 1]] = parsed;
  }
  return result as unknown as Partial<AllSettings>;
}

// ─── Constants ──────────────────────────────────────────────────

// Re-exported from hook for convenience — COLOR_SWATCHES is now imported from useAccentTheme
const STORAGE_KEY = 'pharmacy_settings';

const DAYS_OF_WEEK = [
  { label: 'Sunday', value: '0' },
  { label: 'Monday', value: '1' },
  { label: 'Tuesday', value: '2' },
  { label: 'Wednesday', value: '3' },
  { label: 'Thursday', value: '4' },
  { label: 'Friday', value: '5' },
  { label: 'Saturday', value: '6' },
];

// ─── Defaults ────────────────────────────────────────────────────

const defaults: AllSettings = {
  pharmacy: {
    appName: 'PharmaCare Pro',
    name: 'GreenLife Pharmacy',
    tagline: 'Pharmacy Management',
    address: '123 Health Street, Accra, Ghana',
    phone: '+233 30 123 4567',
    email: 'info@greenlifepharmacy.com',
    taxRate: 12.5,
    logoUrl: '',
    faviconUrl: '',
  },
  receipt: {
    headerText: 'GreenLife Pharmacy — Your Health, Our Priority',
    footerText: 'Thank you for your purchase!',
    width: '80mm',
    showTax: true,
    showDiscount: false,
  },
  display: {
    currency: 'GHS',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: 'HH:mm',
    primaryColor: 'emerald',
  },
  pos: {
    defaultPaymentMethod: 'cash',
    autoPrintReceipt: true,
    defaultDiscount: 0,
    requireCustomer: false,
    allowNegativeStock: false,
    maxLineItems: 50,
  },
  notifications: {
    lowStockThreshold: 10,
    expiryAlertDays: 30,
    enableNotifications: true,
  },
  business: {
    enableHours: false,
    openTime: '08:00',
    closeTime: '18:00',
    closedDays: '0',
  },
  data: {
    autoBackup: 'off',
    sessionTimeout: 480,
    requirePassword: true,
  },
};

// ─── Component ───────────────────────────────────────────────────

export default function SettingsView() {
  // Accent theme hook — applies CSS vars and persists to localStorage
  const { theme: currentAccentTheme, setTheme: setAccentTheme } = useAccentTheme();

  const [pharmacy, setPharmacy] = useState<PharmacyInfo>(defaults.pharmacy);
  const [receipt, setReceipt] = useState<ReceiptSettings>(defaults.receipt);
  const [display, setDisplay] = useState<DisplaySettings>(defaults.display);
  const [pos, setPos] = useState<POSSettings>(defaults.pos);
  const [notifications, setNotifications] = useState<NotificationSettings>(defaults.notifications);
  const [business, setBusiness] = useState<BusinessSettings>(defaults.business);
  const [data, setData] = useState<DataSettings>(defaults.data);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [saved, setSaved] = useState(false);

  // System uptime tracking
  const loadTimeRef = useRef(Date.now());
  const [uptime, setUptime] = useState('0m 0s');

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - loadTimeRef.current) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      if (h > 0) setUptime(`${h}h ${m}m ${s}s`);
      else if (m > 0) setUptime(`${m}m ${s}s`);
      else setUptime(`${s}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load settings from API first, then fall back to localStorage
  useEffect(() => {
    const applySettings = (s: Partial<AllSettings>) => {
      if (s.pharmacy) setPharmacy({ ...defaults.pharmacy, ...s.pharmacy });
      if (s.receipt) setReceipt({ ...defaults.receipt, ...s.receipt });
      if (s.display) {
        setDisplay({ ...defaults.display, ...s.display });
        // Also apply the saved accent theme
        const savedColor = (s.display as any).primaryColor;
        if (savedColor && ['emerald', 'blue', 'violet', 'rose', 'amber', 'teal'].includes(savedColor)) {
          setAccentTheme(savedColor as AccentTheme);
        }
      }
      if (s.pos) setPos({ ...defaults.pos, ...s.pos });
      if (s.notifications) setNotifications({ ...defaults.notifications, ...s.notifications });
      if (s.business) setBusiness({ ...defaults.business, ...s.business });
      if (s.data) setData({ ...defaults.data, ...s.data });
    };

    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const { settings } = await res.json();
          if (settings && Object.keys(settings).length > 0) {
            const unflat = unflattenSettings(settings);
            applySettings(unflat);
            // Cache in localStorage
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
              pharmacy: { ...defaults.pharmacy, ...unflat.pharmacy },
              receipt: { ...defaults.receipt, ...unflat.receipt },
              display: { ...defaults.display, ...unflat.display },
              pos: { ...defaults.pos, ...unflat.pos },
              notifications: { ...defaults.notifications, ...unflat.notifications },
              business: { ...defaults.business, ...unflat.business },
              data: { ...defaults.data, ...unflat.data },
            }));
            return;
          }
        }
      } catch {
        // API unavailable — fall through to localStorage
      }
      // Fallback: load from localStorage
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: AllSettings = JSON.parse(raw);
          applySettings(parsed);
        }
      } catch {
        // silent — use defaults
      }
    })();
  }, []);

  // Gather all settings into one object
  const gatherSettings = useCallback((): AllSettings => {
    return { pharmacy, receipt, display, pos, notifications, business, data };
  }, [pharmacy, receipt, display, pos, notifications, business, data]);

  // Save all settings at once (API first, localStorage as backup)
  const handleSave = async () => {
    setSaving(true);
    const current = gatherSettings();
    try {
      // Try to persist via API
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: flattenSettings(current) }),
      });
      if (res.ok) {
        // API success — also cache to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        setSaved(true);
        toast.success('Settings saved successfully');
        setTimeout(() => setSaved(false), 2000);
        return;
      }
      // API returned non-OK
      throw new Error(`API returned ${res.status}`);
    } catch {
      // API failed — fall back to localStorage only
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        toast.warning('Settings saved locally (backend unavailable)');
      } catch {
        toast.error('Failed to save settings');
      }
    } finally {
      setSaving(false);
    }
  };

  // Export all data as JSON
  const handleExportData = async () => {
    setExporting(true);
    try {
      const endpoints = [
        '/api/dashboard/stats',
        '/api/products',
        '/api/sales',
        '/api/customers',
        '/api/suppliers',
        '/api/purchases',
        '/api/categories',
        '/api/batches',
        '/api/returns',
        '/api/users',
        '/api/audit-logs',
      ];

      const data: Record<string, unknown> = { _exportedAt: new Date().toISOString() };

      await Promise.all(
        endpoints.map(async (url) => {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const json = await res.json();
              data[url.replace('/api/', '')] = json;
            }
          } catch {
            data[url.replace('/api/', '')] = 'Failed to fetch';
          }
        }),
      );

      // Also include settings
      data._settings = gatherSettings();

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pharmacy-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Data exported successfully');
    } catch {
      toast.error('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  // Clear all sales data
  const handleClearSales = async () => {
    setClearing(true);
    try {
      await fetch('/api/sales', { method: 'DELETE' });
      toast.success('All sales data cleared');
    } catch {
      toast.error('Failed to clear sales data');
    } finally {
      setClearing(false);
    }
  };

  // Toggle a day in closedDays
  const toggleClosedDay = (dayValue: string) => {
    const currentDays = business.closedDays
      ? business.closedDays.split(',').filter(Boolean)
      : [];
    const idx = currentDays.indexOf(dayValue);
    if (idx >= 0) {
      currentDays.splice(idx, 1);
    } else {
      currentDays.push(dayValue);
      currentDays.sort((a, b) => Number(a) - Number(b));
    }
    setBusiness({ ...business, closedDays: currentDays.join(',') });
  };

  // Reset all settings to defaults
  const handleReset = () => {
    setPharmacy(defaults.pharmacy);
    setReceipt(defaults.receipt);
    setDisplay(defaults.display);
    setPos(defaults.pos);
    setNotifications(defaults.notifications);
    setBusiness(defaults.business);
    setData(defaults.data);
    toast.info('Settings reset to defaults');
  };

  // ─── Section card helper ────────────────────────────────────────
  const sectionHeader = (icon: React.ReactNode, title: string, description?: string) => (
    <CardHeader className="pb-4">
      <CardTitle className="text-base font-semibold flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
          {icon}
        </span>
        {title}
      </CardTitle>
      {description && (
        <CardDescription className="text-sm text-muted-foreground ml-[42px]">
          {description}
        </CardDescription>
      )}
    </CardHeader>
  );

  // Toggle row helper
  const toggleRow = (
    id: string,
    icon: React.ReactNode,
    label: string,
    description: string,
    checked: boolean,
    onChange: (val: boolean) => void,
  ) => (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium flex items-center gap-1.5">
          {icon}
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="data-[state=checked]:bg-emerald-600"
      />
    </div>
  );

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your pharmacy system preferences and configuration
          </p>
        </div>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200 dark:shadow-emerald-950/50 transition-all"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>

      <Separator />

      {/* 1. App Branding */}
      <Card className="overflow-hidden border-emerald-100 dark:border-emerald-950/50">
        {sectionHeader(
          <Palette className="h-4 w-4" />,
          'App Branding',
          'Customize your app name, logo, and visual identity',
        )}
        <CardContent className="space-y-4 pt-0">
          {/* Logo URL */}
          <div className="flex items-center gap-4 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            {pharmacy.logoUrl ? (
              <img
                src={pharmacy.logoUrl}
                alt="Pharmacy logo"
                className="h-12 w-12 shrink-0 rounded-lg object-contain bg-white dark:bg-slate-800 shadow-sm border border-emerald-100 dark:border-emerald-800"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-emerald-100 dark:border-emerald-800">
                <ImageIcon className="h-5 w-5 text-emerald-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <Label htmlFor="pharmacy-logo-url" className="text-sm font-medium">
                Logo URL
              </Label>
              <Input
                id="pharmacy-logo-url"
                value={pharmacy.logoUrl}
                onChange={(e) => setPharmacy({ ...pharmacy, logoUrl: e.target.value })}
                placeholder="https://example.com/logo.png"
                className="mt-1 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="app-name" className="text-sm font-medium">
                App Display Name
              </Label>
              <div className="relative mt-1.5">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="app-name"
                  value={pharmacy.appName}
                  onChange={(e) => setPharmacy({ ...pharmacy, appName: e.target.value })}
                  className="pl-10"
                  placeholder="PharmaCare Pro"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Shown in sidebar and header</p>
            </div>
            <div>
              <Label htmlFor="pharmacy-name" className="text-sm font-medium">
                Pharmacy Name
              </Label>
              <div className="relative mt-1.5">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="pharmacy-name"
                  value={pharmacy.name}
                  onChange={(e) => setPharmacy({ ...pharmacy, name: e.target.value })}
                  className="pl-10"
                  placeholder="Enter pharmacy name"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Business name for receipts</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pharmacy-tagline" className="text-sm font-medium">
                Tagline
              </Label>
              <div className="relative mt-1.5">
                <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="pharmacy-tagline"
                  value={pharmacy.tagline}
                  onChange={(e) => setPharmacy({ ...pharmacy, tagline: e.target.value })}
                  className="pl-10"
                  placeholder="Pharmacy Management"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Shown in sidebar under logo</p>
            </div>
            <div>
              <Label htmlFor="favicon-url" className="text-sm font-medium">
                Favicon URL
              </Label>
              <div className="relative mt-1.5">
                <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="favicon-url"
                  value={pharmacy.faviconUrl}
                  onChange={(e) => setPharmacy({ ...pharmacy, faviconUrl: e.target.value })}
                  className="pl-10"
                  placeholder="https://example.com/favicon.ico"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Browser tab icon (optional)</p>
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Primary Color</Label>
            <p className="text-xs text-muted-foreground mb-2">Choose the app&apos;s accent color theme</p>
            <div className="flex flex-wrap gap-2">
              {THEME_SWATCHES.map((swatch) => {
                const isActive = currentAccentTheme === swatch.value;
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    onClick={() => {
                      setAccentTheme(swatch.value);
                      setDisplay({ ...display, primaryColor: swatch.value });
                      toast.success(`Theme changed to ${swatch.name}`);
                    }}
                    className="group flex items-center gap-2 rounded-lg border-2 px-3 py-2 transition-all"
                    style={isActive
                      ? { borderColor: 'var(--accent-primary)', backgroundColor: 'var(--accent-primary-light)' }
                      : { borderColor: 'transparent' }
                    }
                  >
                    <span
                      className="h-5 w-5 rounded-full shadow-sm ring-2 ring-offset-2 ring-offset-background"
                      style={{
                        backgroundColor: swatch.preview,
                        ringColor: isActive ? swatch.preview : 'transparent',
                        boxShadow: isActive ? `0 0 0 2px ${swatch.preview}` : undefined,
                      }}
                    />
                    <span
                      className="text-xs font-medium"
                      style={isActive ? { color: 'var(--accent-primary-foreground)' } : { color: 'var(--foreground)' }}
                    >
                      {swatch.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator className="my-2" />

          <div>
            <Label htmlFor="pharmacy-address" className="text-sm font-medium">
              Address
            </Label>
            <div className="relative mt-1.5">
              <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Textarea
                id="pharmacy-address"
                value={pharmacy.address}
                onChange={(e) => setPharmacy({ ...pharmacy, address: e.target.value })}
                className="pl-10 min-h-[60px] resize-none"
                placeholder="Enter pharmacy address"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pharmacy-phone" className="text-sm font-medium">
                Phone Number
              </Label>
              <div className="relative mt-1.5">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="pharmacy-phone"
                  value={pharmacy.phone}
                  onChange={(e) => setPharmacy({ ...pharmacy, phone: e.target.value })}
                  className="pl-10"
                  placeholder="+233 ..."
                />
              </div>
            </div>
            <div>
              <Label htmlFor="pharmacy-email" className="text-sm font-medium">
                Email Address
              </Label>
              <div className="relative mt-1.5">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="pharmacy-email"
                  type="email"
                  value={pharmacy.email}
                  onChange={(e) => setPharmacy({ ...pharmacy, email: e.target.value })}
                  className="pl-10"
                  placeholder="pharmacy@example.com"
                />
              </div>
            </div>
          </div>

          <div className="w-full sm:w-1/2">
            <Label htmlFor="tax-rate" className="text-sm font-medium">
              Tax Rate
            </Label>
            <div className="relative mt-1.5">
              <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="tax-rate"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={pharmacy.taxRate}
                onChange={(e) => setPharmacy({ ...pharmacy, taxRate: Number(e.target.value) || 0 })}
                className="pl-10"
                placeholder="0"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Receipt Customization */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Receipt className="h-4 w-4" />,
          'Receipt Customization',
          'Configure what appears on printed receipts',
        )}
        <CardContent className="space-y-4 pt-0">
          <div>
            <Label htmlFor="receipt-header" className="text-sm font-medium">
              Header Line 1
            </Label>
            <p className="text-xs text-muted-foreground mb-1.5">Pharmacy name and tagline on receipt</p>
            <Textarea
              id="receipt-header"
              value={receipt.headerText}
              onChange={(e) => setReceipt({ ...receipt, headerText: e.target.value })}
              className="mt-1.5 min-h-[60px] resize-none"
              placeholder="Header text for receipts"
            />
          </div>
          <div>
            <Label htmlFor="receipt-footer" className="text-sm font-medium">
              Footer Message
            </Label>
            <p className="text-xs text-muted-foreground mb-1.5">Thank you message or contact info</p>
            <Textarea
              id="receipt-footer"
              value={receipt.footerText}
              onChange={(e) => setReceipt({ ...receipt, footerText: e.target.value })}
              className="mt-1.5 min-h-[60px] resize-none"
              placeholder="Footer text for receipts"
            />
          </div>

          <div className="space-y-3">
            {toggleRow(
              'show-tax-receipt',
              <Percent className="h-3.5 w-3.5 text-muted-foreground" />,
              'Show Tax on Receipt',
              'Display the tax breakdown line on printed receipts',
              receipt.showTax,
              (checked) => setReceipt({ ...receipt, showTax: checked }),
            )}
            {toggleRow(
              'show-discount-receipt',
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />,
              'Show Discount on Receipt',
              'Display applied discounts as a separate line item',
              receipt.showDiscount,
              (checked) => setReceipt({ ...receipt, showDiscount: checked }),
            )}
          </div>

          <div className="w-full sm:w-1/2">
            <Label htmlFor="receipt-width" className="text-sm font-medium">
              Receipt Width
            </Label>
            <Select
              value={receipt.width}
              onValueChange={(v) => setReceipt({ ...receipt, width: v })}
            >
              <SelectTrigger id="receipt-width" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="58mm">58mm — Small Thermal</SelectItem>
                <SelectItem value="80mm">80mm — Standard Thermal</SelectItem>
                <SelectItem value="A4">A4 — Full Page</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 3. POS Configuration */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <ShoppingCart className="h-4 w-4" />,
          'POS Configuration',
          'Point-of-sale behavior, defaults, and constraints',
        )}
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Default Payment Method
              </Label>
              <Select
                value={pos.defaultPaymentMethod}
                onValueChange={(v) => setPos({ ...pos, defaultPaymentMethod: v })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                  <SelectItem value="insurance">Insurance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="default-discount" className="text-sm font-medium flex items-center gap-1.5">
                <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                Default Discount (%)
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="default-discount"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={pos.defaultDiscount}
                  onChange={(e) => setPos({ ...pos, defaultDiscount: Number(e.target.value) || 0 })}
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="max-line-items" className="text-sm font-medium flex items-center gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
                Max Line Items
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="max-line-items"
                  type="number"
                  min="1"
                  max="200"
                  value={pos.maxLineItems}
                  onChange={(e) =>
                    setPos({
                      ...pos,
                      maxLineItems: Math.max(1, Math.min(200, Number(e.target.value) || 1)),
                    })
                  }
                  placeholder="50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  items
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Max items allowed in a single sale cart</p>
            </div>
          </div>

          <div className="space-y-3">
            {toggleRow(
              'auto-print',
              <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />,
              'Auto-Print Receipt',
              'Automatically print receipt after completing a sale',
              pos.autoPrintReceipt,
              (checked) => setPos({ ...pos, autoPrintReceipt: checked }),
            )}
            {toggleRow(
              'require-customer',
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />,
              'Require Customer for Sale',
              'Require customer selection before completing a sale',
              pos.requireCustomer,
              (checked) => setPos({ ...pos, requireCustomer: checked }),
            )}
            {toggleRow(
              'allow-negative-stock',
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
              'Allow Negative Stock',
              'Allow selling products even when stock is zero',
              pos.allowNegativeStock,
              (checked) => setPos({ ...pos, allowNegativeStock: checked }),
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. Display Settings */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Monitor className="h-4 w-4" />,
          'Display Settings',
          'Currency, date, and time formatting preferences',
        )}
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                Currency
              </Label>
              <Select
                value={display.currency}
                onValueChange={(v) => setDisplay({ ...display, currency: v })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GHS">GHS — Ghana Cedi</SelectItem>
                  <SelectItem value="USD">USD — US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR — Euro</SelectItem>
                  <SelectItem value="GBP">GBP — British Pound</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                Date Format
              </Label>
              <Select
                value={display.dateFormat}
                onValueChange={(v) => setDisplay({ ...display, dateFormat: v })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dd/MM/yyyy">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/dd/yyyy">MM/DD/YYYY</SelectItem>
                  <SelectItem value="yyyy-MM-dd">YYYY-MM-DD</SelectItem>
                  <SelectItem value="dd-MMM-yyyy">DD-MMM-YYYY</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Time Format
              </Label>
              <Select
                value={display.timeFormat}
                onValueChange={(v) => setDisplay({ ...display, timeFormat: v })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HH:mm">24-Hour (14:30)</SelectItem>
                  <SelectItem value="hh:mm a">12-Hour (2:30 PM)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. Notifications */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Bell className="h-4 w-4" />,
          'Notifications',
          'Alert thresholds and notification preferences',
        )}
        <CardContent className="space-y-5 pt-0">
          {toggleRow(
            'enable-notifications',
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />,
            'Enable Notifications',
            'Show alerts for low stock and expiring products',
            notifications.enableNotifications,
            (checked) => setNotifications({ ...notifications, enableNotifications: checked }),
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="low-stock-threshold" className="text-sm font-medium">
                Low Stock Alert Threshold
              </Label>
              <p className="text-xs text-muted-foreground mb-1.5">
                Alert when stock falls below this quantity
              </p>
              <Input
                id="low-stock-threshold"
                type="number"
                min="1"
                value={notifications.lowStockThreshold}
                onChange={(e) =>
                  setNotifications({
                    ...notifications,
                    lowStockThreshold: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                placeholder="10"
              />
            </div>
            <div>
              <Label htmlFor="expiry-alert-days" className="text-sm font-medium">
                Expiry Alert (Days)
              </Label>
              <p className="text-xs text-muted-foreground mb-1.5">
                Alert when products expire within this many days
              </p>
              <div className="relative">
                <Input
                  id="expiry-alert-days"
                  type="number"
                  min="1"
                  value={notifications.expiryAlertDays}
                  onChange={(e) =>
                    setNotifications({
                      ...notifications,
                      expiryAlertDays: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  placeholder="30"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  days
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 6. Business Hours */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Clock className="h-4 w-4" />,
          'Business Hours',
          'Set operating hours and closed days for your pharmacy',
        )}
        <CardContent className="space-y-4 pt-0">
          {toggleRow(
            'enable-hours',
            <Store className="h-3.5 w-3.5 text-muted-foreground" />,
            'Enable Business Hours',
            'Restrict POS availability to operating hours',
            business.enableHours,
            (checked) => setBusiness({ ...business, enableHours: checked }),
          )}

          {business.enableHours && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="open-time" className="text-sm font-medium">
                    Opening Time
                  </Label>
                  <div className="relative mt-1.5">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="open-time"
                      type="time"
                      value={business.openTime}
                      onChange={(e) => setBusiness({ ...business, openTime: e.target.value })}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="close-time" className="text-sm font-medium">
                    Closing Time
                  </Label>
                  <div className="relative mt-1.5">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="close-time"
                      type="time"
                      value={business.closeTime}
                      onChange={(e) => setBusiness({ ...business, closeTime: e.target.value })}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Closed Days</Label>
                <p className="text-xs text-muted-foreground mb-2">Select days the business is closed</p>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const isChecked = business.closedDays
                      .split(',')
                      .filter(Boolean)
                      .includes(day.value);
                    return (
                      <label
                        key={day.value}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium cursor-pointer transition-all ${
                          isChecked
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                            : 'border-muted bg-muted/30 text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleClosedDay(day.value)}
                          className="sr-only"
                        />
                        <span className="select-none">{day.label.slice(0, 3)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3 w-3" />
                Business hours affect POS availability. Sales outside hours will show a warning.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 7. Data & Security */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <ShieldCheck className="h-4 w-4" />,
          'Data & Security',
          'Backup, session, and data management settings',
        )}
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                Auto Backup Interval
              </Label>
              <Select
                value={data.autoBackup}
                onValueChange={(v) => setData({ ...data, autoBackup: v })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Automatic data backup schedule</p>
            </div>
            <div>
              <Label htmlFor="session-timeout" className="text-sm font-medium flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Session Timeout
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="session-timeout"
                  type="number"
                  min="5"
                  max="1440"
                  value={data.sessionTimeout}
                  onChange={(e) =>
                    setData({
                      ...data,
                      sessionTimeout: Math.max(5, Math.min(1440, Number(e.target.value) || 5)),
                    })
                  }
                  placeholder="480"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  min
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Auto-logout after idle (default: 8 hrs)</p>
            </div>
          </div>

          <div className="space-y-3">
            {toggleRow(
              'require-password',
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />,
              'Require Password on Return from Idle',
              'Prompt for password when resuming an idle session',
              data.requirePassword,
              (checked) => setData({ ...data, requirePassword: checked }),
            )}
          </div>

          <Separator />

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1 h-11"
              onClick={handleExportData}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {exporting ? 'Exporting...' : 'Export All Data'}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="flex-1 h-11"
                  disabled={clearing}
                >
                  {clearing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  {clearing ? 'Clearing...' : 'Clear Sales Data'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </span>
                    Clear All Sales Data?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-sm leading-relaxed">
                    This action <strong className="text-foreground">cannot be undone</strong>. This will
                    permanently delete all sales records, sale items, and related return records from the
                    system. Product inventory and customer data will be preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearSales}
                    className="bg-destructive hover:bg-destructive/90 text-white"
                  >
                    Yes, Clear All Sales
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <p className="text-xs text-muted-foreground">
            Export creates a JSON backup of all system data. Sales data clear affects transactions only.
          </p>
        </CardContent>
      </Card>

      {/* 8. About System */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Info className="h-4 w-4" />,
          'About System',
          'System version, technology stack, and runtime information',
        )}
        <CardContent className="pt-0">
          <div className="rounded-lg border bg-muted/30">
            <div className="divide-y">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Version</span>
                <span className="text-sm font-medium">1.0.0</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Build Date</span>
                <span className="text-sm font-medium">
                  {new Date().toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Framework</span>
                <span className="text-sm font-medium">Next.js 16 (App Router)</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Language</span>
                <span className="text-sm font-medium">TypeScript 5</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">UI Library</span>
                <span className="text-sm font-medium">shadcn/ui + Tailwind CSS 4</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Database</span>
                <div className="flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium">SQLite (local)</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">State Management</span>
                <span className="text-sm font-medium">Zustand + TanStack Query</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Security</span>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium">NextAuth.js v4</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">System Uptime</span>
                <div className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium tabular-nums">{uptime}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Database Size</span>
                <div className="flex items-center gap-1.5">
                  <Database className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium">SQLite (local)</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bottom Save Bar */}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 rounded-xl border bg-background/80 backdrop-blur-sm p-4 shadow-sm">
        <Button
          variant="outline"
          onClick={handleReset}
        >
          Reset to Defaults
        </Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200 dark:shadow-emerald-950/50 transition-all min-w-[180px]"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>
    </div>
  );
}