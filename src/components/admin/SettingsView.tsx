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
  LayoutGrid,
  FolderPlus,
  Package,
  Upload,
  FileDown,
  Plus,
  Pencil,
  X,
  Check,
  Sparkles,
  UserCog,
  KeyRound,
  ClipboardList,
  Search,
  Wifi,
} from 'lucide-react';
import RemotePanel from '@/components/admin/RemotePanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { useAppStore } from '@/stores/app-store';
import {
  defaultSettings,
  flattenSettings,
  unflattenSettings,
  SETTINGS_STORAGE_KEY as STORAGE_KEY,
  type AllSettings,
  type PharmacyInfo,
  type ReceiptSettings,
  type DisplaySettings,
  type POSSettings,
  type NotificationSettings,
  type BusinessSettings,
  type DataSettings,
} from '@/lib/app-settings';
import { parseCSV, downloadText, CATEGORY_CSV_TEMPLATE, PRODUCT_CSV_TEMPLATE } from '@/lib/csv';

// Settings types, defaults and flatten/unflatten helpers live in
// @/lib/app-settings — the single source of truth shared with consumers
// such as POSView (Rule 18).

// ─── Constants ──────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { label: 'Sunday', value: '0' },
  { label: 'Monday', value: '1' },
  { label: 'Tuesday', value: '2' },
  { label: 'Wednesday', value: '3' },
  { label: 'Thursday', value: '4' },
  { label: 'Friday', value: '5' },
  { label: 'Saturday', value: '6' },
];

const defaults: AllSettings = defaultSettings;

type TabKey =
  | 'account'
  | 'general'
  | 'receipt'
  | 'pos'
  | 'notifications'
  | 'catalog'
  | 'items'
  | 'data'
  | 'about'
  | 'remote';

const TAB_ITEMS: { key: TabKey; label: string; icon: React.ReactNode; description: string }[] = [
  { key: 'account', label: 'Account', icon: <UserCog className="h-4 w-4" />, description: 'Profile & security' },
  { key: 'general', label: 'General', icon: <Globe className="h-4 w-4" />, description: 'Branding & display' },
  { key: 'receipt', label: 'Receipt', icon: <Receipt className="h-4 w-4" />, description: 'Print layout' },
  { key: 'pos', label: 'Point of Sale', icon: <ShoppingCart className="h-4 w-4" />, description: 'Sales behavior' },
  { key: 'notifications', label: 'Alerts & Hours', icon: <Bell className="h-4 w-4" />, description: 'Thresholds & hours' },
  { key: 'catalog', label: 'Catalog', icon: <LayoutGrid className="h-4 w-4" />, description: 'Categories & bulk import' },
  { key: 'items', label: 'Items Import', icon: <Package className="h-4 w-4" />, description: 'Bulk product import' },
  { key: 'data', label: 'Data & Security', icon: <ShieldCheck className="h-4 w-4" />, description: 'Backup & privacy' },
  { key: 'remote', label: 'Remote', icon: <Wifi className="h-4 w-4" />, description: 'Mobile monitoring link' },
  { key: 'about', label: 'About', icon: <Info className="h-4 w-4" />, description: 'System information' },
];

interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  _count: { products: number };
}

interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; name: string; message: string }[];
  total: number;
}

// ─── Component ───────────────────────────────────────────────────

export default function SettingsView() {
  // Accent theme hook — applies CSS vars and persists to localStorage
  const { theme: currentAccentTheme, setTheme: setAccentTheme } = useAccentTheme();
  const setAppName = useAppStore((s) => s.setAppName);
  const setAppTagline = useAppStore((s) => s.setAppTagline);

  // Account/security mutation state
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const loginTime = useAppStore((s) => s.loginTime);
  const [profileName, setProfileName] = useState(currentUser?.name ?? '');
  const [profileEmail, setProfileEmail] = useState(currentUser?.email ?? '');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPwCurrent, setShowPwCurrent] = useState(false);
  const [showPwNew, setShowPwNew] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const applyUpdatedUser = (user: unknown) => {
    const u = user as {
      id: string; name: string; email: string; role: string; phone?: string;
      active: boolean; mustChangePassword?: boolean; createdAt: string; updatedAt: string;
    };
    setCurrentUser(u as never);
  };

  const handleSaveName = async () => {
    if (!profileName.trim()) {
      toast.error('Display name cannot be empty');
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profileName.trim() }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update name');
      applyUpdatedUser(result.user);
      toast.success('Display name updated');
    } catch (err) {
      toast.error('Update failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!profileEmail.trim() || !emailCurrentPassword) {
      toast.error('Enter your new email and current password');
      return;
    }
    setSavingEmail(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: profileEmail.trim(),
          currentPassword: emailCurrentPassword,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update email');
      applyUpdatedUser(result.user);
      setEmailCurrentPassword('');
      toast.success('Email address updated', {
        description: 'Your sign-in email has been changed.',
      });
    } catch (err) {
      toast.error('Update failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSavePassword = async () => {
    if (pwNew.length < 8) {
      toast.error('Password too short', { description: 'Use at least 8 characters.' });
      return;
    }
    if (pwNew !== pwConfirm) {
      toast.error('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to change password');
      applyUpdatedUser(result.user);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      toast.success('Password changed', {
        description: 'Use your new password next time you sign in.',
      });
    } catch (err) {
      toast.error('Password update failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const [activeTab, setActiveTab] = useState<TabKey>('general');

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

  // Catalog state
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categorySearch, setCategorySearch] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatDesc, setEditCatDesc] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [categoryCsv, setCategoryCsv] = useState('');
  const [categoryImporting, setCategoryImporting] = useState(false);
  const [categoryResult, setCategoryResult] = useState<ImportSummary | null>(null);

  // Items import state
  const [itemsCsv, setItemsCsv] = useState('');
  const [itemsImporting, setItemsImporting] = useState(false);
  const [itemsResult, setItemsResult] = useState<ImportSummary | null>(null);

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

  // Load categories once when the Catalog tab is first opened
  useEffect(() => {
    if (activeTab !== 'catalog' && activeTab !== 'items') return;
    loadCategories();
  }, [activeTab]);

  // Gather all settings into one object
  const gatherSettings = useCallback((): AllSettings => {
    return { pharmacy, receipt, display, pos, notifications, business, data };
  }, [pharmacy, receipt, display, pos, notifications, business, data]);

  // Save all settings at once (API first, localStorage as backup)
  const handleSave = async () => {
    setSaving(true);
    const current = gatherSettings();
    setAppName(current.pharmacy.appName.trim());
    setAppTagline(current.pharmacy.tagline.trim());
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: flattenSettings(current) }),
      });
      if (res.ok) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        setSaved(true);
        toast.success('Settings saved successfully');
        setTimeout(() => setSaved(false), 2000);
        return;
      }
      throw new Error(`API returned ${res.status}`);
    } catch {
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
      const res = await fetch('/api/sales?confirm=yes', { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to clear sales data');
      }
      toast.success('All sales data cleared');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear sales data');
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

  // ─── Catalog helpers ───────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const json = await res.json();
        setCategories(json.categories ?? []);
      }
    } catch {
      toast.error('Failed to load categories');
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  const handleAddCategory = async () => {
    const name = newCatName.trim();
    if (!name) {
      toast.error('Category name is required');
      return;
    }
    setAddingCategory(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: newCatDesc.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to add category');
      toast.success(`Category "${name}" added`);
      setNewCatName('');
      setNewCatDesc('');
      await loadCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add category');
    } finally {
      setAddingCategory(false);
    }
  };

  const startEdit = (cat: CategoryRow) => {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatDesc(cat.description ?? '');
  };

  const handleUpdateCategory = async () => {
    if (!editingCatId) return;
    const name = editCatName.trim();
    if (!name) {
      toast.error('Category name cannot be empty');
      return;
    }
    try {
      const res = await fetch(`/api/categories/${editingCatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: editCatDesc.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update category');
      toast.success('Category updated');
      setEditingCatId(null);
      await loadCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to delete category');
      toast.success(`Category "${json.name ?? 'Removed'}" deleted`);
      await loadCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete category');
    }
  };

  const readFileAsText = (file: File | null, setter: (text: string) => void) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result ?? ''));
    reader.onerror = () => toast.error('Failed to read file');
    reader.readAsText(file);
  };

  const handleCategoryImport = async () => {
    if (!categoryCsv.trim()) {
      toast.error('Paste or upload CSV content first');
      return;
    }
    setCategoryImporting(true);
    setCategoryResult(null);
    try {
      const records = parseCSV(categoryCsv);
      const items = records
        .map((r) => ({
          name: r.name || r.category || '',
          description: r.description || r.desc || '',
        }))
        .filter((row) => row.name);
      if (items.length === 0) {
        toast.error('No valid category rows found');
        setCategoryImporting(false);
        return;
      }
      const res = await fetch('/api/categories/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, onDuplicate: 'skip' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Import failed');
      setCategoryResult(json);
      toast.success(`Imported ${json.created} category${json.created === 1 ? '' : 'ies'}`);
      await loadCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setCategoryImporting(false);
    }
  };

  const handleItemsImport = async () => {
    if (!itemsCsv.trim()) {
      toast.error('Paste or upload CSV content first');
      return;
    }
    setItemsImporting(true);
    setItemsResult(null);
    try {
      const records = parseCSV(itemsCsv);
      const items = records
        .map((r) => ({
          name: r.name || r.productname || r.item || '',
          genericName: r.genericname || r.generic || '',
          category: r.category || r.categoryname || '',
          unit: r.unit || '',
          reorderLevel: r.reorderlevel ?? '',
          defaultCostPrice: r.defaultcostprice || r.cost || '',
          defaultSellingPrice: r.defaultsellingprice || r.price || '',
          batchNumber: r.batchnumber || '',
          quantity: r.quantity ?? '',
          costPrice: r.costprice || r.cost || '',
          sellingPrice: r.sellingprice || r.price || '',
          expiryDate: r.expirydate || r.expiry || '',
        }))
        .filter((row) => row.name);
      if (items.length === 0) {
        toast.error('No valid product rows found');
        setItemsImporting(false);
        return;
      }
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, onDuplicate: 'skip' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Import failed');
      setItemsResult(json);
      toast.success(`Imported ${json.created} item${json.created === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setItemsImporting(false);
    }
  };

  // ─── Section card helper ────────────────────────────────────────
  const sectionHeader = (icon: React.ReactNode, title: string, description?: string) => (
    <CardHeader className="pb-4">
      <CardTitle className="text-base font-semibold flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary-light)] text-[var(--accent-primary)]">
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
        className="data-[state=checked]:bg-[var(--accent-primary)]"
      />
    </div>
  );

  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase())
  );

  const renderImportSummary = (result: ImportSummary, kind: 'category' | 'items') => (
    <div className="mt-4 rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/20">
          {result.created} created
        </Badge>
        <Badge className="bg-blue-600/10 text-blue-700 dark:text-blue-300 border-blue-600/20">
          {result.updated} updated
        </Badge>
        <Badge variant="secondary">{result.skipped} skipped</Badge>
        {result.errors.length > 0 && (
          <Badge className="bg-rose-600/10 text-rose-700 dark:text-rose-300 border-rose-600/20">
            {result.errors.length} error{result.errors.length === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
      {result.errors.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 py-2">Row</TableHead>
                <TableHead className="py-2">Item</TableHead>
                <TableHead className="py-2">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.errors.slice(0, 25).map((err, idx) => (
                <TableRow key={idx}>
                  <TableCell className="py-2 font-medium tabular-nums">{err.row}</TableCell>
                  <TableCell className="py-2">{err.name || '—'}</TableCell>
                  <TableCell className="py-2 text-rose-600 dark:text-rose-400">{err.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {kind === 'category'
          ? 'Newly added categories are instantly available in the Products section.'
          : 'Newly added items appear in the Products section with full stock tracking.'}
      </p>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Page header — premium banner */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-r from-[var(--accent-gradient-from)] via-[var(--accent-gradient-via)] to-[var(--accent-gradient-to)] p-6 text-white shadow-sm">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-white" />
          <div className="absolute top-1/2 right-1/3 h-24 w-24 rounded-full bg-white" />
        </div>
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2.5">
              <Sparkles className="h-6 w-6" />
              Settings
            </h1>
            <p className="mt-1 text-white/85 text-sm">
              Manage your pharmacy system preferences, catalog, and configuration — all in one place.
            </p>
          </div>
          <Button
            className="bg-white/95 hover:bg-white text-[var(--accent-primary)] shadow-md backdrop-blur transition-all"
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
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Tab rail */}
        <nav className="lg:w-64 shrink-0">
          <div className="lg:sticky lg:top-4 space-y-1 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 -mx-1 px-1">
            {TAB_ITEMS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all min-w-[180px] ${
                    isActive
                      ? 'bg-[var(--accent-primary)] text-white shadow-md'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      isActive
                        ? 'bg-white/20'
                        : 'bg-[var(--accent-primary-light)] text-[var(--accent-primary)]'
                    }`}
                  >
                    {tab.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight">{tab.label}</span>
                    <span className={`block text-xs ${isActive ? 'text-white/75' : 'text-muted-foreground'}`}>
                      {tab.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0 space-y-6 max-w-3xl">
          {/* ── General ─────────────────────────────── */}
          {activeTab === 'general' && (
            <>
              <Card className="overflow-hidden">
                {sectionHeader(
                  <Palette className="h-4 w-4" />,
                  'App Branding',
                  'Customize your app name, logo, and visual identity',
                )}
                <CardContent className="space-y-4 pt-0">
                  <div className="flex items-center gap-4 p-3 rounded-lg border border-[var(--accent-primary-border)] bg-[var(--accent-primary-light)]/40">
                    {pharmacy.logoUrl ? (
                      <img
                        src={pharmacy.logoUrl}
                        alt="Pharmacy logo"
                        className="h-12 w-12 shrink-0 rounded-lg object-contain bg-white dark:bg-slate-800 shadow-sm border border-[var(--accent-primary-border)]"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-[var(--accent-primary-border)]">
                        <ImageIcon className="h-5 w-5 text-[var(--accent-primary)]" />
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
                      <Label htmlFor="app-name" className="text-sm font-medium">App Display Name</Label>
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
                      <Label htmlFor="pharmacy-name" className="text-sm font-medium">Pharmacy Name</Label>
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
                      <Label htmlFor="pharmacy-tagline" className="text-sm font-medium">Tagline</Label>
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
                      <Label htmlFor="favicon-url" className="text-sm font-medium">Favicon URL</Label>
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
                    <Label htmlFor="pharmacy-address" className="text-sm font-medium">Address</Label>
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
                      <Label htmlFor="pharmacy-phone" className="text-sm font-medium">Phone Number</Label>
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
                      <Label htmlFor="pharmacy-email" className="text-sm font-medium">Email Address</Label>
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
                    <Label htmlFor="tax-rate" className="text-sm font-medium">Tax Rate</Label>
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
                        <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
                        <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
                        <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HH:mm">24-Hour (14:30)</SelectItem>
                          <SelectItem value="hh:mm a">12-Hour (2:30 PM)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Receipt ─────────────────────────────── */}
          {activeTab === 'receipt' && (
            <Card className="overflow-hidden">
              {sectionHeader(
                <Receipt className="h-4 w-4" />,
                'Receipt Customization',
                'Configure what appears on printed receipts',
              )}
              <CardContent className="space-y-4 pt-0">
                <div>
                  <Label htmlFor="receipt-header" className="text-sm font-medium">Header Line 1</Label>
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
                  <Label htmlFor="receipt-footer" className="text-sm font-medium">Footer Message</Label>
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
                  <Label htmlFor="receipt-width" className="text-sm font-medium">Receipt Width</Label>
                  <Select
                    value={receipt.width}
                    onValueChange={(v) => setReceipt({ ...receipt, width: v })}
                  >
                    <SelectTrigger id="receipt-width" className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="58mm">58mm — Small Thermal</SelectItem>
                      <SelectItem value="80mm">80mm — Standard Thermal</SelectItem>
                      <SelectItem value="A4">A4 — Full Page</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── POS ─────────────────────────────────── */}
          {activeTab === 'pos' && (
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
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
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
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">items</span>
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
          )}

          {/* ── Alerts & Hours ──────────────────────── */}
          {activeTab === 'notifications' && (
            <>
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
                      <Label htmlFor="low-stock-threshold" className="text-sm font-medium">Low Stock Alert Threshold</Label>
                      <p className="text-xs text-muted-foreground mb-1.5">Alert when stock falls below this quantity</p>
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
                      <Label htmlFor="expiry-alert-days" className="text-sm font-medium">Expiry Alert (Days)</Label>
                      <p className="text-xs text-muted-foreground mb-1.5">Alert when products expire within this many days</p>
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
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">days</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

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
                          <Label htmlFor="open-time" className="text-sm font-medium">Opening Time</Label>
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
                          <Label htmlFor="close-time" className="text-sm font-medium">Closing Time</Label>
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
                                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary-light)] text-[var(--accent-primary)]'
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
            </>
          )}

          {/* ── Catalog (Categories) ─────────────────── */}
          {activeTab === 'catalog' && (
            <>
              <Card className="overflow-hidden">
                {sectionHeader(
                  <LayoutGrid className="h-4 w-4" />,
                  'Categories',
                  'Organize your products into categories used across POS, inventory and reports',
                )}
                <CardContent className="space-y-4 pt-0">
                  {/* Add single */}
                  <div className="rounded-xl border p-4 space-y-3 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <FolderPlus className="h-4 w-4 text-[var(--accent-primary)]" />
                      <span className="text-sm font-semibold">Add a category</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Input
                        placeholder="Name (e.g. Analgesics)"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                      />
                      <Input
                        placeholder="Description (optional)"
                        value={newCatDesc}
                        onChange={(e) => setNewCatDesc(e.target.value)}
                        className="sm:col-span-1"
                      />
                      <Button
                        onClick={handleAddCategory}
                        disabled={addingCategory || !newCatName.trim()}
                        className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                      >
                        {addingCategory ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                        Add Category
                      </Button>
                    </div>
                  </div>

                  {/* Toolbar */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search categories..."
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Button variant="outline" onClick={() => downloadText('pharmacare-categories-template.csv', CATEGORY_CSV_TEMPLATE)}>
                      <FileDown className="h-4 w-4 mr-2" />
                      Template
                    </Button>
                    <Button
                      variant={showImport ? 'default' : 'outline'}
                      onClick={() => setShowImport(!showImport)}
                      className={showImport ? 'bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white' : ''}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Bulk Import
                    </Button>
                  </div>

                  {/* Import panel */}
                  {showImport && (
                    <div className="rounded-xl border border-[var(--accent-primary-border)] bg-[var(--accent-primary-light)]/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold flex items-center gap-2">
                            <Upload className="h-4 w-4 text-[var(--accent-primary)]" />
                            Bulk import categories
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Paste CSV, or choose a file. Columns: <code>name</code>, <code>description</code>. Existing names are skipped.
                          </p>
                        </div>
                        <Input
                          type="file"
                          accept=".csv,text/csv,text/plain"
                          className="max-w-[240px] text-xs"
                          onChange={(e) => readFileAsText(e.target.files?.[0] ?? null, setCategoryCsv)}
                        />
                      </div>
                      <Textarea
                        placeholder={'name,description\nAnalgesics,Pain relief\nAntibiotics,Antibacterial agents'}
                        value={categoryCsv}
                        onChange={(e) => setCategoryCsv(e.target.value)}
                        className="min-h-[120px] font-mono text-xs resize-y"
                      />
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-xs text-muted-foreground">Example:
                          <button type="button" className="ml-1 underline decoration-dotted" onClick={() => setCategoryCsv(CATEGORY_CSV_TEMPLATE)}>use sample</button>
                        </span>
                        <Button
                          onClick={handleCategoryImport}
                          disabled={categoryImporting || !categoryCsv.trim()}
                          className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                        >
                          {categoryImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                          {categoryImporting ? 'Importing...' : 'Import Categories'}
                        </Button>
                      </div>
                      {categoryResult && renderImportSummary(categoryResult, 'category')}
                    </div>
                  )}

                  {/* List */}
                  {categoriesLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Loading categories...
                    </div>
                  ) : filteredCategories.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-10 text-center">
                      <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/50" />
                      <p className="mt-3 text-sm font-medium text-muted-foreground">
                        {categorySearch ? 'No categories match your search.' : 'No categories yet.'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Add your first category above, or bulk import them with a CSV.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead>Name</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="w-24 text-center">Products</TableHead>
                            <TableHead className="w-28 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredCategories.map((cat) => {
                            const isEditing = editingCatId === cat.id;
                            return (
                              <TableRow key={cat.id}>
                                <TableCell className="font-medium">
                                  {isEditing ? (
                                    <Input
                                      value={editCatName}
                                      onChange={(e) => setEditCatName(e.target.value)}
                                      className="h-8 text-sm"
                                      autoFocus
                                    />
                                  ) : (
                                    cat.name
                                  )}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {isEditing ? (
                                    <Input
                                      value={editCatDesc}
                                      onChange={(e) => setEditCatDesc(e.target.value)}
                                      className="h-8 text-sm"
                                      placeholder="Description (optional)"
                                    />
                                  ) : (
                                    cat.description || <span className="text-muted-foreground/50">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant="secondary" className="tabular-nums">
                                    {cat._count.products}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  {isEditing ? (
                                    <div className="flex items-center justify-end gap-1">
                                      <Button size="sm" variant="ghost" onClick={handleUpdateCategory} className="h-8 w-8 p-0" title="Save">
                                        <Check className="h-4 w-4 text-emerald-600" />
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setEditingCatId(null)} className="h-8 w-8 p-0" title="Cancel">
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-end gap-1">
                                      <Button size="sm" variant="ghost" onClick={() => startEdit(cat)} className="h-8 w-8 p-0" title="Rename">
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:text-destructive" title="Delete">
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle className="flex items-center gap-2">
                                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                                                <Trash2 className="h-4 w-4" />
                                              </span>
                                              Delete "{cat.name}"?
                                            </AlertDialogTitle>
                                            <AlertDialogDescription className="text-sm leading-relaxed">
                                              {cat._count.products > 0 ? (
                                                <>
                                                  This category is used by{' '}
                                                  <strong className="text-foreground">{cat._count.products} product{cat._count.products === 1 ? '' : 's'}</strong>.
                                                  Deleting it will move those products to{' '}
                                                  <strong className="text-foreground">Uncategorized</strong> — the products themselves are
                                                  <strong className="text-foreground"> not</strong> deleted, and you can reassign them later.
                                                </>
                                              ) : (
                                                'This category has no products and will be permanently removed. This action cannot be undone.'
                                              )}
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => handleDeleteCategory(cat.id)}
                                              className="bg-destructive hover:bg-destructive/90 text-white"
                                            >
                                              Delete
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Info className="h-3 w-3" />
                    Categories created here appear instantly in the Products section, POS item picker, and reports.
                  </p>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Items Import ─────────────────────────── */}
          {activeTab === 'items' && (
            <Card className="overflow-hidden">
              {sectionHeader(
                <Package className="h-4 w-4" />,
                'Bulk Import Items',
                'Import your full product catalog from a spreadsheet in one go',
              )}
              <CardContent className="space-y-4 pt-0">
                <div className="rounded-xl border border-[var(--accent-primary-border)] bg-[var(--accent-primary-light)]/20 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Upload className="h-4 w-4 text-[var(--accent-primary)]" />
                        CSV / spreadsheet import
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        Paste CSV or choose a file. A <code>category</code> name is created automatically if it does
                        not exist. Items already in the system are skipped.
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => downloadText('pharmacare-items-template.csv', PRODUCT_CSV_TEMPLATE)}>
                      <FileDown className="h-4 w-4 mr-2" />
                      Download template
                    </Button>
                  </div>

                  {/* Supported columns reference */}
                  <div className="rounded-lg bg-background/60 dark:bg-slate-900/40 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Supported columns:</p>
                    <p className="leading-relaxed">
                      <code className="text-[var(--accent-primary)]">name</code> (required),
                      <code className="text-[var(--accent-primary)]">genericName</code>,
                      <code className="text-[var(--accent-primary)]">category</code>,
                      <code className="text-[var(--accent-primary)]">unit</code>,
                      <code className="text-[var(--accent-primary)]">reorderLevel</code>,
                      <code className="text-[var(--accent-primary)]">defaultCostPrice</code>,
                      <code className="text-[var(--accent-primary)]">defaultSellingPrice</code> — plus optional opening stock:
                      <code className="text-[var(--accent-primary)]">batchNumber</code>,
                      <code className="text-[var(--accent-primary)]">quantity</code>,
                      <code className="text-[var(--accent-primary)]">costPrice</code>,
                      <code className="text-[var(--accent-primary)]">sellingPrice</code>,
                      <code className="text-[var(--accent-primary)]">expiryDate</code> (YYYY-MM-DD)
                    </p>
                  </div>

                  <Input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="text-xs"
                    onChange={(e) => readFileAsText(e.target.files?.[0] ?? null, setItemsCsv)}
                  />
                  <Textarea
                    placeholder={'name,genericName,category,unit,reorderLevel,defaultCostPrice,defaultSellingPrice,batchNumber,quantity,costPrice,sellingPrice,expiryDate'}
                    value={itemsCsv}
                    onChange={(e) => setItemsCsv(e.target.value)}
                    className="min-h-[140px] font-mono text-xs resize-y"
                  />
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-xs text-muted-foreground">Example:
                      <button type="button" className="ml-1 underline decoration-dotted" onClick={() => setItemsCsv(PRODUCT_CSV_TEMPLATE)}>use sample</button>
                    </span>
                    <Button
                      onClick={handleItemsImport}
                      disabled={itemsImporting || !itemsCsv.trim()}
                      className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                    >
                      {itemsImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Package className="h-4 w-4 mr-2" />}
                      {itemsImporting ? 'Importing...' : 'Import Items'}
                    </Button>
                  </div>
                  {itemsResult && renderImportSummary(itemsResult, 'items')}
                </div>

                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Info className="h-3 w-3" />
                  Imported items appear in the Products section with live stock, expiry and reorder tracking. Use a
                  <strong> category sheet</strong> first (Catalog tab) to keep everything organized.
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Data & Security ──────────────────────── */}
          {activeTab === 'data' && (
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
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">min</span>
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
          )}

          {/* ── About ─────────────────────────────────── */}
          {activeTab === 'account' && (
            <>
              {/* ─── Signed-in session info ─── */}
              <Card className="overflow-hidden">
                {sectionHeader(
                  <UserCog className="h-4 w-4" />,
                  'Account & Security',
                  'Manage your profile, sign-in credentials and session',
                )}
                <CardContent className="pt-0 space-y-6">
                  <div className="rounded-lg border bg-muted/30 overflow-hidden">
                    <div className="flex items-center gap-4 px-4 py-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white text-base font-bold uppercase">
                        {(currentUser?.name || '?').charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-foreground truncate">{currentUser?.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{currentUser?.email}</p>
                      </div>
                      <Badge
                        variant={currentUser?.role === 'admin' ? 'default' : 'secondary'}
                        className="ml-auto capitalize"
                      >
                        {currentUser?.role ?? 'user'}
                      </Badge>
                    </div>
                    <div className="divide-y">
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" /> Member since
                        </span>
                        <span className="text-xs font-medium">
                          {currentUser?.createdAt
                            ? new Date(currentUser.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" /> Last signed in
                        </span>
                        <span className="text-xs font-medium">
                          {loginTime > 0
                            ? new Date(loginTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </span>
                      </div>
                      {currentUser?.mustChangePassword && (
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-xs text-amber-600">Still using temporary password</span>
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">
                            Change it below
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Display name */}
                  <div className="space-y-2">
                    <Label htmlFor="profile-name" className="text-sm font-medium">Display name</Label>
                    <div className="flex gap-2">
                      <Input
                        id="profile-name"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="h-10"
                      />
                      <Button
                        variant="outline"
                        className="h-10 shrink-0"
                        onClick={handleSaveName}
                        disabled={savingProfile || profileName.trim() === (currentUser?.name ?? '')}
                      >
                        {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                      </Button>
                    </div>
                  </div>

                  {/* Email change — requires current password (credential rebinding) */}
                  <div className="space-y-2">
                    <Label htmlFor="profile-email" className="text-sm font-medium">Sign-in email</Label>
                    <div className="flex gap-2">
                      <Input
                        id="profile-email"
                        type="email"
                        value={profileEmail}
                        onChange={(e) => setProfileEmail(e.target.value)}
                        className="h-10"
                      />
                      <Button
                        variant="outline"
                        className="h-10 shrink-0"
                        onClick={handleSaveEmail}
                        disabled={savingEmail || profileEmail.trim() === (currentUser?.email ?? '') || !emailCurrentPassword}
                      >
                        {savingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Change email'}
                      </Button>
                    </div>
                    <Input
                      type={showPwCurrent ? 'text' : 'password'}
                      value={emailCurrentPassword}
                      onChange={(e) => setEmailCurrentPassword(e.target.value)}
                      placeholder="Current password to confirm this change"
                      className="h-10"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Your current password is required to change the email bound to your account — this keeps your
                      credentials secure even if this device is shared.
                    </p>
                  </div>

                  {/* Password change */}
                  <div className="rounded-xl border p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-[var(--accent-primary)]" />
                      <Label className="text-sm font-semibold">Change password</Label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="pw-current" className="text-xs text-muted-foreground">Current password</Label>
                        <Input
                          id="pw-current"
                          type={showPwCurrent ? 'text' : 'password'}
                          value={pwCurrent}
                          onChange={(e) => setPwCurrent(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="current-password"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="pw-new" className="text-xs text-muted-foreground">New password</Label>
                        <Input
                          id="pw-new"
                          type={showPwNew ? 'text' : 'password'}
                          value={pwNew}
                          onChange={(e) => setPwNew(e.target.value)}
                          placeholder="At least 8 characters"
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="pw-confirm" className="text-xs text-muted-foreground">Confirm new password</Label>
                        <Input
                          id="pw-confirm"
                          type={showPwNew ? 'text' : 'password'}
                          value={pwConfirm}
                          onChange={(e) => setPwConfirm(e.target.value)}
                          placeholder="Repeat password"
                          autoComplete="new-password"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSavePassword(); }}
                        />
                      </div>
                    </div>
                    <Button
                      className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                      onClick={handleSavePassword}
                      disabled={savingPassword || !pwCurrent || !pwNew || !pwConfirm}
                    >
                      {savingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Update password
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeTab === 'about' && (
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
                        <HardDrive className="h-4 w-4 text-[var(--accent-primary)]" />
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
                        <ShieldCheck className="h-4 w-4 text-[var(--accent-primary)]" />
                        <span className="text-sm font-medium">JWT + bcrypt (local)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm text-muted-foreground">System Uptime</span>
                      <div className="flex items-center gap-1.5">
                        <Activity className="h-4 w-4 text-[var(--accent-primary)]" />
                        <span className="text-sm font-medium tabular-nums">{uptime}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm text-muted-foreground">Database Size</span>
                      <div className="flex items-center gap-1.5">
                        <Database className="h-4 w-4 text-[var(--accent-primary)]" />
                        <span className="text-sm font-medium">SQLite (local)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'remote' && (
            <RemotePanel />
          )}

          {/* Bottom Save Bar — hidden on Remote & Account tabs (self-contained) */}
          {activeTab !== 'remote' && activeTab !== 'account' && (
          <div className="sticky bottom-0 flex items-center justify-end gap-3 rounded-xl border bg-background/85 backdrop-blur-md p-4 shadow-sm z-10">
            <Button
              variant="outline"
              onClick={handleReset}
            >
              Reset to Defaults
            </Button>
            <Button
              className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white shadow-sm transition-all min-w-[180px]"
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
          )}
        </div>
      </div>
    </div>
  );
}