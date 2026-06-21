'use client';

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
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

// ─── Types ───────────────────────────────────────────────────────

interface PharmacyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxRate: number;
}

interface ReceiptSettings {
  headerText: string;
  footerText: string;
  width: string;
}

interface DisplaySettings {
  currency: string;
  dateFormat: string;
  timeFormat: string;
}

interface POSSettings {
  defaultPaymentMethod: string;
  autoPrintReceipt: boolean;
  defaultDiscount: number;
}

interface NotificationSettings {
  lowStockThreshold: number;
  expiryAlertDays: number;
  enableNotifications: boolean;
}

interface AllSettings {
  pharmacy: PharmacyInfo;
  receipt: ReceiptSettings;
  display: DisplaySettings;
  pos: POSSettings;
  notifications: NotificationSettings;
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

// ─── Defaults ────────────────────────────────────────────────────

const STORAGE_KEY = 'pharmacy_settings';

const defaults: AllSettings = {
  pharmacy: {
    name: 'GreenLife Pharmacy',
    address: '123 Health Street, Accra, Ghana',
    phone: '+233 30 123 4567',
    email: 'info@greenlifepharmacy.com',
    taxRate: 12.5,
  },
  receipt: {
    headerText: 'GreenLife Pharmacy — Your Health, Our Priority',
    footerText: 'Thank you for your purchase!',
    width: '80mm',
  },
  display: {
    currency: 'GHS',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: 'HH:mm',
  },
  pos: {
    defaultPaymentMethod: 'cash',
    autoPrintReceipt: true,
    defaultDiscount: 0,
  },
  notifications: {
    lowStockThreshold: 10,
    expiryAlertDays: 30,
    enableNotifications: true,
  },
};

// ─── Component ───────────────────────────────────────────────────

export default function SettingsView() {
  const [pharmacy, setPharmacy] = useState<PharmacyInfo>(defaults.pharmacy);
  const [receipt, setReceipt] = useState<ReceiptSettings>(defaults.receipt);
  const [display, setDisplay] = useState<DisplaySettings>(defaults.display);
  const [pos, setPos] = useState<POSSettings>(defaults.pos);
  const [notifications, setNotifications] = useState<NotificationSettings>(defaults.notifications);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load settings from API first, then fall back to localStorage
  useEffect(() => {
    const applySettings = (s: Partial<AllSettings>) => {
      if (s.pharmacy) setPharmacy({ ...defaults.pharmacy, ...s.pharmacy });
      if (s.receipt) setReceipt({ ...defaults.receipt, ...s.receipt });
      if (s.display) setDisplay({ ...defaults.display, ...s.display });
      if (s.pos) setPos({ ...defaults.pos, ...s.pos });
      if (s.notifications) setNotifications({ ...defaults.notifications, ...s.notifications });
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
    return { pharmacy, receipt, display, pos, notifications };
  }, [pharmacy, receipt, display, pos, notifications]);

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

      {/* 1. Pharmacy Information */}
      <Card className="overflow-hidden border-emerald-100 dark:border-emerald-950/50">
        {sectionHeader(
          <Building2 className="h-4 w-4" />,
          'Pharmacy Information',
          'Basic details about your pharmacy',
        )}
        <CardContent className="space-y-4 pt-0">
          {/* Logo placeholder */}
          <div className="flex items-center gap-4 p-3 rounded-lg border border-dashed border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-emerald-100 dark:border-emerald-800">
              <ImageIcon className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Pharmacy Logo</p>
              <p className="text-xs text-muted-foreground">
                Logo upload will be available in a future update
              </p>
            </div>
            <Button variant="outline" size="sm" disabled className="text-xs">
              Upload
            </Button>
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
          </div>

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

      {/* 2. Receipt Settings */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Receipt className="h-4 w-4" />,
          'Receipt Settings',
          'Customize receipt appearance and content',
        )}
        <CardContent className="space-y-4 pt-0">
          <div>
            <Label htmlFor="receipt-header" className="text-sm font-medium">
              Receipt Header Text
            </Label>
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
              Receipt Footer Text
            </Label>
            <Textarea
              id="receipt-footer"
              value={receipt.footerText}
              onChange={(e) => setReceipt({ ...receipt, footerText: e.target.value })}
              className="mt-1.5 min-h-[60px] resize-none"
              placeholder="Footer text for receipts"
            />
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

      {/* 3. Display Settings */}
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

      {/* 4. POS Settings */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <ShoppingCart className="h-4 w-4" />,
          'POS Settings',
          'Point-of-sale behavior and defaults',
        )}
        <CardContent className="space-y-5 pt-0">
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

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="auto-print" className="text-sm font-medium flex items-center gap-1.5">
                <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />
                Auto-Print Receipt
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically print receipt after completing a sale
              </p>
            </div>
            <Switch
              id="auto-print"
              checked={pos.autoPrintReceipt}
              onCheckedChange={(checked) => setPos({ ...pos, autoPrintReceipt: checked })}
              className="data-[state=checked]:bg-emerald-600"
            />
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
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="enable-notifications" className="text-sm font-medium flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                Enable Notifications
              </Label>
              <p className="text-xs text-muted-foreground">
                Show alerts for low stock and expiring products
              </p>
            </div>
            <Switch
              id="enable-notifications"
              checked={notifications.enableNotifications}
              onCheckedChange={(checked) => setNotifications({ ...notifications, enableNotifications: checked })}
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>

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

      {/* 6. Data Management */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Database className="h-4 w-4" />,
          'Data Management',
          'Export data and manage system records',
        )}
        <CardContent className="space-y-4 pt-0">
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

      {/* 7. About System */}
      <Card className="overflow-hidden">
        {sectionHeader(
          <Info className="h-4 w-4" />,
          'About System',
          'System version and technology information',
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
                <span className="text-sm font-medium">SQLite (Prisma ORM)</span>
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
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bottom Save Bar */}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 rounded-xl border bg-background/80 backdrop-blur-sm p-4 shadow-sm">
        <Button
          variant="outline"
          onClick={() => {
            setPharmacy(defaults.pharmacy);
            setReceipt(defaults.receipt);
            setDisplay(defaults.display);
            setPos(defaults.pos);
            setNotifications(defaults.notifications);
            toast.info('Settings reset to defaults');
          }}
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