'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { money, configuredCurrency } from '@/lib/currency';
import {
  CalendarDays,
  DollarSign,
  TrendingUp,
  Receipt,
  Clock,
  Lock,
  Unlock,
  ChevronRight,
  ChevronDown,
  Banknote,
  CreditCard,
  Smartphone,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Printer,
  RotateCcw,
  Trash2,
  CircleDot,
  Calendar,
  BarChart3,
  FileText,
  RefreshCw,
  Save,
  CalendarCheck,
  Search,
  Download,
  Building2,
  ChevronLeft,
  Users,
  Filter,
  Layers,
  Loader2,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadError } from '@/components/ui/load-error';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import { usePermissions } from '@/hooks/use-permissions';
import { usePharmacySettings } from '@/hooks/use-pharmacy-settings';
import type { Branch, DailySalesRecord, Sale, SaleItem, User } from '@/types';
import { ALL_BRANCHES } from '@/lib/branches';
import { previousDateKey } from '@/lib/dates';
import { switchActiveBranch } from '@/lib/switch-branch';
// `refund-shared`, not `refunds`: this is a client component, and `refunds.ts`
// imports the Prisma client through `@/lib/db`. The pure contract is split out
// so the register can render an empty refund row without a browser bundle.
import { ZERO_REFUNDS, type RefundTotals } from '@/lib/refund-shared';

/** Totals the register can show for a day that has sales but no register row yet. */
interface LiveTotals {
  totalRevenue: number;
  totalProfit: number;
  totalTransactions: number;
  totalItemsSold: number;
  cashTotal: number;
  cardTotal: number;
  mobileMoneyTotal: number;
}

/**
 * Money that left the till that day, as reported by the server alongside the
 * register. NOT persisted on the register record: `cashTotal` is a statement of
 * record meaning "cash taken in", and stays that way.
 *
 * Imported, not redeclared. This interface used to be copied into this file, so
 * a field added by the server would arrive here as `undefined` and quietly read
 * as zero in the reconciliation.
 */
/** A day with no refunds — the common case, and the safe default for an older
 *  cached response that predates the refund term. */
const EMPTY_REFUNDS: RefundTotals = ZERO_REFUNDS;

/**
 * The cash a drawer should actually hold: taken in, less what was handed back
 * out in cash that day.
 *
 * The reconciliation compares a PHYSICAL count against this figure, so it has to
 * be net. Comparing it against gross `cashTotal` instead means every cash refund
 * reports the cashier as short by exactly the refund they correctly paid out —
 * a false accusation on a till that balances, printed on the closing summary as
 * well as the screen.
 */
function expectedCash(
  totals: { cashTotal: number } | null | undefined,
  refunds: RefundTotals | null | undefined
): number {
  return (totals?.cashTotal ?? 0) - (refunds?.cashRefunds ?? 0);
}

/**
 * One branch's day, exactly as the server hands it back.
 *
 * `record` is the till. `liveTotals` is a fallback for the consolidated view,
 * where a branch may have taken money without anyone having opened its register:
 * showing a branch as empty while it is visibly trading is worse than showing
 * totals with a "register not opened" note.
 */
interface TodayBranchEntry {
  branch: Branch;
  record: DailySalesRecord | null;
  sales: Sale[];
  liveTotals: LiveTotals | null;
  /** Cash paid back out that day. Present on every branch entry, including the
   *  consolidated ones, so the count below never has to guess at it. */
  refunds: RefundTotals;
}

/**
 * Narrowing of the register's contents.
 *
 * There is deliberately NO branch field here. This used to carry one, and it was
 * the most misleading control in the app: it looked like "I am working in the
 * Airport branch now", and narrowed only the register's list, while every WRITE —
 * adding a product, receiving a delivery, editing a reorder level — went to the
 * session's branch. An admin who picked Airport here, read Airport's day, then
 * restocked a drug, put the stock in Main.
 *
 * So branch selection is not a filter: it is the operating branch, changed
 * through `switchActiveBranch` and therefore governing viewing AND writing
 * together. Comparing shops is still possible without switching, through the
 * "All branches" view, which renders every branch's day as its own section.
 *
 * The remaining filters are genuinely view-only and stay that way.
 */
interface RegisterFilters {
  paymentMethod: string;
  cashierId: string;
  query: string;
}

const NO_FILTERS: RegisterFilters = { paymentMethod: 'all', cashierId: 'all', query: '' };

/** Register cards per page in the Past Records tab. */
const PAST_PAGE_SIZE = 12;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-GH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ---- Audit grouping ---------------------------------------------------

type GroupMode = 'all' | 'cashier' | 'payment' | 'shift';

interface AuditGroup {
  key: string;
  label: string;
  sales: Sale[];
  count: number;
  itemsSold: number;
  revenue: number;
  profit: number;
  cash: number;
  card: number;
  momo: number;
}

const GROUP_BY_OPTIONS: { value: GroupMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'payment', label: 'Payment' },
  { value: 'shift', label: 'Shift' },
];

const PAY_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
};

function shiftLabelOf(date: Date): string {
  const h = date.getHours();
  if (h < 6) return 'Night (00:00–05:59)';
  if (h < 12) return 'Morning (06:00–11:59)';
  if (h < 17) return 'Afternoon (12:00–16:59)';
  return 'Evening (17:00–23:59)';
}

function buildAuditGroups(sales: Sale[], mode: GroupMode): AuditGroup[] {
  const summarize = (groupSales: Sale[]): AuditGroup => ({
    key: groupSales[0]?.invoiceNo ?? 'all',
    label: mode,
    sales: groupSales,
    count: groupSales.length,
    itemsSold: groupSales.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) ?? 0), 0),
    revenue: groupSales.reduce((sum, s) => sum + Number(s.totalAmount), 0),
    profit: groupSales.reduce((sum, s) => sum + Number(s.profit), 0),
    cash: groupSales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + Number(s.totalAmount), 0),
    card: groupSales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + Number(s.totalAmount), 0),
    momo: groupSales.filter((s) => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + Number(s.totalAmount), 0),
  });

  if (mode === 'all') return [summaryOfAll(sales, summarize)];

  const map = new Map<string, Sale[]>();
  for (const s of sales) {
    const key =
      mode === 'cashier'
        ? (s.user?.name ?? 'Unknown cashier')
        : mode === 'payment'
        ? (s.paymentMethod ?? 'other')
        : shiftLabelOf(new Date(s.createdAt));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return [...map.entries()].map(([key, list]) => ({
    ...summarize(list),
    key,
    label: mode === 'payment' ? (PAY_LABEL[key] ?? key) : key,
  }));
}

function summaryOfAll(sales: Sale[], summarize: (s: Sale[]) => AuditGroup): AuditGroup {
  return { ...summarize(sales), key: 'all', label: 'All transactions' };
}

function GroupByControl({ value, onChange }: { value: GroupMode; onChange: (m: GroupMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/70 rounded-lg p-0.5">
      {GROUP_BY_OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${value === o.value ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AuditGroupHeader({ group }: { group: AuditGroup }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-100 bg-gradient-to-r from-emerald-50/40 to-transparent">
      <div className="flex items-center gap-1.5 min-w-0">
        <p className="text-xs font-semibold text-slate-700 truncate">{group.label}</p>
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
          {group.count} tx
        </Badge>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
          {group.itemsSold} items
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-[10px] shrink-0">
        {group.cash > 0 && <span className="text-green-600 font-semibold">Cash {money(group.cash)}</span>}
        {group.card > 0 && <span className="text-blue-600 font-semibold">Card {money(group.card)}</span>}
        {group.momo > 0 && <span className="text-purple-600 font-semibold">MoMo {money(group.momo)}</span>}
        <span className="font-bold text-slate-800">{money(group.revenue)}</span>
      </div>
    </div>
  );
}

export default function DailySalesRegister() {
  const { currentUser, navigate, setPosPresetDate } = useAppStore();
  // The operating branch. The register's branch control changes THIS (and reloads),
  // rather than filtering the list, so it is the one thing the register must know
  // about the session beyond the signed-in user.
  const activeBranch = useAppStore((s) => s.activeBranch);
  // Receipt branding comes from system settings (single source of truth)
  const { settings } = usePharmacySettings();
  const { isAdmin } = usePermissions();
  // ISO 4217 code for the cash-count label and input prefix, so the unit shown
  // beside the field matches the unit the reconciliation is actually in.
  const currencyCode = configuredCurrency();
  const [activeTab, setActiveTab] = useState('today');

  // Today's data, one entry per branch. A single-branch request returns one
  // entry; the consolidated "All branches" request returns every active branch,
  // so the owner sees each shop's day rather than one shop's day (or, worse, an
  // empty page, which is what the old all-branches refusal rendered).
  const [todayBranches, setTodayBranches] = useState<TodayBranchEntry[]>([]);
  const [todayScope, setTodayScope] = useState<'branch' | 'all'>('branch');
  const [loadingToday, setLoadingToday] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [todayGroupMode, setTodayGroupMode] = useState<GroupMode>('cashier');

  // View-only filters, shared by every branch section so the owner can compare
  // shops on the same terms.
  const [filters, setFilters] = useState<RegisterFilters>(NO_FILTERS);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);

  /** The owner is on the consolidated view: every branch gets its own section. */
  const isConsolidated = todayScope === 'all';
  /** Single-branch mode renders the full-day hero and owns the close-day action. */
  const primaryEntry = todayBranches[0] ?? null;
  const todayRecord = primaryEntry?.record ?? null;
  const todaySales = primaryEntry?.sales ?? [];
  /** Cash refunds taken off the drawer being counted tonight. */
  const todayRefunds = primaryEntry?.refunds ?? EMPTY_REFUNDS;
  /** What the drawer should hold, net of those refunds. */
  const todayExpectedCash = expectedCash(todayRecord, todayRefunds);

  // Memoized audit groups for today's feed, after the view-only filters. The
  // feed used to render every sale on the day with no way to narrow it, so an
  // owner looking for one cashier's till had to scroll the whole day.
  const filteredTodaySales = useMemo(() => filterSales(todaySales, filters), [todaySales, filters]);
  const todayGroups = useMemo(() => buildAuditGroups(filteredTodaySales, todayGroupMode), [filteredTodaySales, todayGroupMode]);

  // Branch sections that actually have a register or takings to show. A branch
  // with neither is noise in an owner's daily view. The server already scopes
  // this to the operating branch, or to every branch on the consolidated view,
  // so nothing narrows it further here — narrowing is what used to make a
  // read-only branch picker look like an operating-branch selector.
  const visibleTodayEntries = useMemo(
    () => todayBranches.filter((e) => e.record || e.sales.length > 0 || e.liveTotals),
    [todayBranches]
  );

  /** Cashiers present in today's data, for the cashier filter. Derived from the
   *  sales themselves so the options can never name someone who rang nothing. */
  const todayCashiers = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of todayBranches) {
      for (const sale of entry.sales) {
        if (sale.userId) map.set(sale.userId, sale.user?.name ?? 'Unknown cashier');
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [todayBranches]);

  // Past records
  const [pastRecords, setPastRecords] = useState<DailySalesRecord[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);
  const [pastPage, setPastPage] = useState(1);
  const [pastTotal, setPastTotal] = useState(0);
  const [pastTotalPages, setPastTotalPages] = useState(1);

  // Expanded past record detail
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [expandedRecordSales, setExpandedRecordSales] = useState<Sale[]>([]);
  const [loadingRecordDetail, setLoadingRecordDetail] = useState(false);

  // Expanded sale items
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [expandedSaleItems, setExpandedSaleItems] = useState<SaleItem[]>([]);

  // Close day dialog
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeStep, setCloseStep] = useState(1);
  const [closingNotes, setClosingNotes] = useState('');
  const [cashCounted, setCashCounted] = useState('');
  const [closing, setClosing] = useState(false);

  // Closing report
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [closedRecord, setClosedRecord] = useState<DailySalesRecord | null>(null);
  // The close PATCH returns the record alone, so the refunds for the closed day
  // are read separately; zeroed here until they land so the report dialog never
  // renders a stale figure from a previously closed day.
  const [closedRefunds, setClosedRefunds] = useState<RefundTotals>(EMPTY_REFUNDS);
  /** Net of cash refunds, for the same reason as `todayExpectedCash`. */
  const closedExpectedCash = expectedCash(closedRecord, closedRefunds);
  const [previousDayStats, setPreviousDayStats] = useState<{ revenue: number; profit: number } | null>(null);

  // Reopen dialog
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  // Delete sale dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Refresh timer
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch today's data
  const fetchToday = useCallback(async () => {
    try {
      // No userId is sent by default. The route now honours ?userId=, and the
      // client used to send its own id unconditionally — which, now that the
      // route listens, would have silently reduced an admin's register to only
      // the sales they personally rang. The cashier filter below is the explicit
      // way to narrow; the server still forces a salesperson to their own.
      const params = new URLSearchParams();
      if (filters.cashierId !== 'all') params.set('userId', filters.cashierId);
      const query = params.toString();
      const res = await fetch(`/api/daily-sales/today${query ? `?${query}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setTodayScope(data.scope === 'all' ? 'all' : 'branch');
        setTodayBranches(
          (data.branches ?? []).map((entry: any) => ({
            branch: entry.branch,
            record: entry.record ?? null,
            sales: entry.sales ?? [],
            liveTotals: entry.liveTotals ?? null,
            refunds: { ...EMPTY_REFUNDS, ...(entry.refunds ?? {}) },
          }))
        );
        setLoadError(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setLoadError(data.error ?? `Could not load today's sales (HTTP ${res.status})`);
      }
    } catch { setLoadError("Could not reach the server to load today's sales."); }
  }, [filters.cashierId]);

  // Branch list for the view-only filter. Read-only, and the header switcher is
  // the thing that actually changes the app's branch — this one only narrows
  // what is on screen.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/branches');
        if (!res.ok) {
          if (!cancelled) toast.error('Could not load branch options for the filter.');
          return;
        }
        const data = await res.json();
        if (!cancelled) setAllBranches(data.branches ?? []);
      } catch { if (!cancelled) toast.error('Could not load branch options for the filter.'); }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Past records — paginated. The old hard-coded `limit=60` truncated a busy
  // fortnight and gave no indication anything was missing.
  const fetchPastRecords = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(PAST_PAGE_SIZE), page: String(pastPage) });
      const res = await fetch(`/api/daily-sales?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setPastRecords((data.records ?? []).filter((r: DailySalesRecord) => r.date !== todayRecord?.date));
        setPastTotal(data.total ?? 0);
        setPastTotalPages(Math.max(1, data.totalPages ?? 1));
        setLoadError(null);
      }
    } catch { setLoadError('Could not reach the server to load past records.'); }
  }, [pastPage, todayRecord?.date]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchToday();
      if (!cancelled) setLoadingToday(false);
      await fetchPastRecords();
      if (!cancelled) setLoadingPast(false);
    })();
    return () => { cancelled = true; };
    // Runs once. Page changes and filter changes are handled by their own
    // effects below, so this never refires on every keystroke of a filter.
  }, []);

  // Changing page re-reads the register list only; today's live data is already
  // on screen and must not flash.
  useEffect(() => {
    if (loadingPast) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) setLoadingPast(true);
      await fetchPastRecords();
      if (!cancelled) setLoadingPast(false);
    })();
    return () => { cancelled = true; };
  }, [pastPage]);

  // Switching the page size/page must close an expanded card: the id it held
  // belongs to a record that is no longer on screen.
  useEffect(() => {
    setExpandedRecordId(null);
    setExpandedRecordSales([]);
  }, [pastPage]);

  // Auto-refresh today's data every 15 seconds when tab is active
  useEffect(() => {
    if (activeTab === 'today' && (isConsolidated || todayRecord?.status === 'open')) {
      refreshIntervalRef.current = setInterval(fetchToday, 15000);
    }
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [activeTab, todayRecord?.status, isConsolidated, fetchToday]);

  // Handle close day — final step from multi-step dialog
  const handleCloseDay = async () => {
    if (!todayRecord || !currentUser) return;
    setClosing(true);
    try {
      const notes = [
        closingNotes,
        cashCounted ? `Cash counted: ${money(parseFloat(cashCounted))}` : '',
        // Net of cash refunds: the notes are the permanent record of WHY the
        // difference was what it was, so a shortfall that was really a refund
        // must not be written into the closed day as an unexplained loss.
        cashCounted && todayRecord ? `Cash taken in: ${money(todayRecord.cashTotal)}` : '',
        cashCounted && todayRefunds.cashRefunds > 0
          ? `Cash refunded out: -${money(todayRefunds.cashRefunds)}`
          : '',
        cashCounted && todayRecord ? `Expected cash: ${money(todayExpectedCash)}` : '',
        cashCounted && todayRecord
          ? `Cash difference: ${money(parseFloat(cashCounted) - todayExpectedCash)}`
          : '',
      ].filter(Boolean).join(' | ');

      const res = await fetch(`/api/daily-sales/${todayRecord.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', userId: currentUser.id, notes }),
      });
      if (res.ok) {
        const data = await res.json();
        setClosedRecord(data);
        setClosedRefunds({ ...EMPTY_REFUNDS, ...(data.refunds ?? {}) });
        setShowCloseDialog(false);
        setShowReportDialog(true);
        // PATCH returns the record without the branch relation, so merge rather
        // than replace — otherwise the register header loses the shop's name
        // the instant the day is closed.
        setTodayBranches((prev) =>
          prev.map((entry, i) =>
            i === 0 ? { ...entry, record: { ...(entry.record ?? {}), ...data } as DailySalesRecord } : entry
          )
        );
        setClosingNotes('');
        setCashCounted('');
        setCloseStep(1);
        fetchPastRecords();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to close day');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close day');
    } finally {
      setClosing(false);
    }
  };

  // Fetch previous day stats for comparison
  useEffect(() => {
    // Cleared up front, not only on success. Moving from a day that had a
    // comparison to one that has none used to leave the old figures on screen,
    // so a day was being compared against a number belonging to another day.
    setPreviousDayStats(null);
    if (!todayRecord) return;
    (async () => {
      try {
        // Pure calendar arithmetic on the key — see `shiftDateKey`. The previous
        // spelling round-tripped through `toISOString()`, which reports the UTC
        // day, so the comparison was only right in timezones whose midnight lines
        // up with UTC's.
        const prevDate = previousDateKey(todayRecord.date);
        // The day itself, not a page to scan. This asked for `limit=1` and then
        // searched that one record for `prevDate`, which is today's own row — so
        // `prev` was never found and this comparison never once rendered.
        const res = await fetch(`/api/daily-sales?date=${encodeURIComponent(prevDate)}&limit=1`);
        if (res.ok) {
          const data = await res.json();
          const prev: DailySalesRecord | undefined = (data.records ?? [])[0];
          if (prev) setPreviousDayStats({ revenue: prev.totalRevenue, profit: prev.totalProfit });
        }
      } catch { /* non-fatal: the day renders without its previous-day comparison */ }
    })();
  }, [todayRecord]);

  // Handle reopen day
  const handleReopenDay = async () => {
    if (!reopeningId || !currentUser) return;
    setReopening(true);
    try {
      const res = await fetch(`/api/daily-sales/${reopeningId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen', userId: currentUser.id }),
      });
      if (res.ok) {
        toast.success('Day reopened successfully.');
        setShowReopenDialog(false);
        setReopeningId(null);
        fetchToday();
        fetchPastRecords();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to reopen day');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reopen day');
    } finally {
      setReopening(false);
    }
  };

  // Expand past record to see its sales
  const handleExpandRecord = async (recordId: string) => {
    if (expandedRecordId === recordId) {
      setExpandedRecordId(null);
      setExpandedRecordSales([]);
      return;
    }
    setExpandedRecordId(recordId);
    setLoadingRecordDetail(true);
    try {
      const res = await fetch(`/api/daily-sales/${recordId}`);
      if (res.ok) {
        const data = await res.json();
        setExpandedRecordSales(data.sales ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        setExpandedRecordSales([]);
        toast.error(data.error ?? `Could not load this day's sales (HTTP ${res.status})`);
      }
    } catch {
      setExpandedRecordSales([]);
      toast.error("Could not reach the server to load this day's sales.");
    }
    setLoadingRecordDetail(false);
  };

  // Expand sale items
  const handleExpandSale = (saleId: string, items?: SaleItem[]) => {
    if (expandedSaleId === saleId) {
      setExpandedSaleId(null);
      setExpandedSaleItems([]);
      return;
    }
    setExpandedSaleId(saleId);
    setExpandedSaleItems(items ?? []);
  };

  // Delete sale
  const handleDeleteSale = async () => {
    if (!saleToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales/${saleToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete sale');
      }
      toast.success(`Sale "${saleToDelete.invoiceNo}" voided — stock restored`);
      setShowDeleteDialog(false);
      setSaleToDelete(null);
      setExpandedRecordId(null);
      setExpandedRecordSales([]);
      fetchToday();
      fetchPastRecords();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete sale');
    } finally {
      setDeleting(false);
    }
  };

  // Print receipt for a sale
  const handlePrintReceipt = (sale: Sale) => {
    const items = sale.items ?? [];
    const widthMap: Record<string, number> = { '58mm': 220, '80mm': 320, 'A4': 794 };
    const receiptWidth = widthMap[settings.receipt.width] ?? 320;
    const windowWidth = Math.max(receiptWidth + 80, 400);
    const receiptHtml = `
<!DOCTYPE html>
<html><head><title>Receipt - ${sale.invoiceNo}</title>
<style>
  body { font-family: 'Courier New', monospace; max-width: ${receiptWidth}px; margin: 0 auto; padding: 20px; color: #333; }
  .header { text-align: center; border-bottom: 2px dashed #ccc; padding-bottom: 12px; margin-bottom: 12px; }
  .pharmacy-name { font-size: 18px; font-weight: bold; color: #059669; }
  .info { font-size: 12px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { text-align: left; font-size: 11px; border-bottom: 1px solid #ccc; padding: 4px 0; }
  td { font-size: 12px; padding: 3px 0; }
  .footer { text-align: center; border-top: 2px dashed #ccc; padding-top: 12px; margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 0; padding: 10px; } }
</style></head><body>
  <div class="header">
    <div class="pharmacy-name">${settings.pharmacy.name}</div>
    <div class="info">${settings.pharmacy.address}</div>
    <div class="info">Tel: ${settings.pharmacy.phone}</div>
    ${settings.receipt.headerText ? `<div class="info" style="margin-top:8px">${settings.receipt.headerText}</div>` : ''}
  </div>
  <div class="info"><strong>Invoice:</strong> ${sale.invoiceNo}</div>
  <div class="info"><strong>Date:</strong> ${new Date(sale.createdAt).toLocaleString('en-GH')}</div>
  <div class="info"><strong>Customer:</strong> ${sale.customer?.name ?? 'Walk-in'}</div>
  <table>
    <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${items.map((item) => `<tr><td>${item.product?.name ?? 'Product'}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:right">${money(item.total)}</td></tr>`).join('')}</tbody>
  </table>
  <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;border-top:2px dashed #ccc;padding-top:8px;margin-top:8px">
    <span>TOTAL:</span><span>{money(sale.totalAmount)}</span>
  </div>
  <div class="footer"><p>${settings.receipt.footerText}</p></div>
  <div style="text-align:center;margin-top:20px">
    <button onclick="window.print()" style="padding:8px 24px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px">Print</button>
  </div>
</body></html>`;
    const win = window.open('', '_blank', `width=${windowWidth},height=600`);
    if (win) { win.document.write(receiptHtml); win.document.close(); }
  };

  // Navigate to POS
  const goToPOS = () => navigate('pos');

  const isOpen = todayRecord?.status === 'open';
  const avgSale = todayRecord && todayRecord.totalTransactions > 0
    ? todayRecord.totalRevenue / todayRecord.totalTransactions
    : 0;

  // Gross margin: profit as a share of what was taken. Guarded on revenue
  // because a day with sales but no recorded profit (or none at all) must
  // read 0% rather than NaN on the card.
  const grossMargin = todayRecord && todayRecord.totalRevenue > 0
    ? Math.round((todayRecord.totalProfit / todayRecord.totalRevenue) * 100)
    : 0;

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Sales Register</h1>
          <p className="text-sm text-muted-foreground">
            Track, save, and manage daily sales recordings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToPOS}>
            <Receipt className="h-4 w-4 mr-1.5" />
            Go to POS
          </Button>
        </div>
      </div>

      {loadError && <LoadError message={loadError} onRetry={() => { void fetchToday(); void fetchPastRecords(); }} />}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="today" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            Today
            {todayRecord && (
              <Badge variant={isOpen ? 'default' : 'secondary'} className="ml-1 text-[10px] px-1.5 py-0 h-4">
                {isOpen ? 'OPEN' : 'CLOSED'}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Calendar className="h-4 w-4" />
            Past Records
          </TabsTrigger>
        </TabsList>

        {/* ===== TODAY TAB ===== */}
        <TabsContent value="today" className="space-y-6">
          {loadingToday ? (
            <TodaySkeleton />
          ) : isConsolidated ? (
            <div className="space-y-6">
              <ConsolidatedSummary entries={visibleTodayEntries} isLoading={loadingToday} />
              <RegisterFiltersBar
                filters={filters}
                onChange={setFilters}
                branches={allBranches}
                cashiers={todayCashiers}
                shownCount={visibleTodayEntries.reduce((sum, e) => sum + filterSales(e.sales, filters).length, 0)}
                totalCount={todayBranches.reduce((sum, e) => sum + e.sales.length, 0)}
                isAdmin={isAdmin}
                activeBranchId={activeBranch?.id ?? null}
              />
              {visibleTodayEntries.length > 0 ? (
                visibleTodayEntries.map((entry) => (
                  <BranchDaySection
                    key={entry.branch.id}
                    entry={entry}
                    isAdmin={isAdmin}
                    groupMode={todayGroupMode}
                    onGroupModeChange={setTodayGroupMode}
                    filters={filters}
                    expandedSaleId={expandedSaleId}
                    expandedSaleItems={expandedSaleItems}
                    onExpandSale={handleExpandSale}
                    onPrint={handlePrintReceipt}
                    onDelete={(s) => { setSaleToDelete(s); setShowDeleteDialog(true); }}
                    onRefund={() => { navigate('returns'); }}
                  />
                ))
              ) : (
                <Card>
                  <CardContent className="py-16 text-center">
                    <Layers className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground">
                      {todayBranches.length === 0
                        ? 'No active branches to show'
                        : 'No branch has a register or takings today'}
                    </p>
                    {isAdmin && (
                      // The honest way back: the operating branch, not a filter.
                      <p className="text-xs text-muted-foreground mt-2">
                        {activeBranch
                          ? `Nothing has traded at ${activeBranch.name} today.`
                          : 'No active branches to show.'}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ) : todayRecord ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={todayRecord.id + todayRecord.status}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* Day Status Hero Banner */}
                <Card className={`relative overflow-hidden border-2 ${isOpen ? 'border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/50' : 'border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100'}`}>
                  <div className="pointer-events-none absolute top-0 right-0 w-40 h-40 -mt-8 -mr-8 rounded-full opacity-10" style={{ background: isOpen ? '#10b981' : '#64748b' }} />
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                            {isOpen ? <CircleDot className="h-3.5 w-3.5 animate-pulse" /> : <Lock className="h-3.5 w-3.5" />}
                            {isOpen ? 'DAY OPEN' : 'DAY CLOSED'}
                          </div>
                          {isOpen && (
                            <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-600">
                              Auto-saving
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-xl font-bold">{formatDate(todayRecord.date)}</h2>
                          {todayRecord.branch && <BranchBadge branch={todayRecord.branch} />}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Opened: {formatTime(todayRecord.openedAt)} by {todayRecord.openedAt ? (todayRecord.opener?.name ?? 'System') : 'System'}
                          </span>
                          {todayRecord.closedAt && (
                            <span className="flex items-center gap-1">
                              <Lock className="h-3.5 w-3.5" />
                              Closed: {formatTime(todayRecord.closedAt)} by {todayRecord.closer?.name ?? 'System'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {!isOpen && isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-amber-600 border-amber-300 hover:bg-amber-50"
                            onClick={() => { setReopeningId(todayRecord.id); setShowReopenDialog(true); }}
                          >
                            <Unlock className="h-4 w-4 mr-1.5" />
                            Reopen Day
                          </Button>
                        )}
                        {isOpen && (
                          <Button
                            size="lg"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200"
                            onClick={() => setShowCloseDialog(true)}
                          >
                            <Save className="h-4 w-4 mr-1.5" />
                            Save &amp; Close Day
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Summary Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <StatCard
                    label="Total Revenue"
                    value={money(todayRecord.totalRevenue)}
                    icon={DollarSign}
                    iconBg="bg-emerald-500"
                    trend="up"
                  />
                  <StatCard
                    label="Total Profit"
                    value={money(todayRecord.totalProfit)}
                    icon={TrendingUp}
                    iconBg="bg-teal-500"
                    trend="up"
                  />
                  <StatCard
                    label="Transactions"
                    value={todayRecord.totalTransactions.toString()}
                    icon={Receipt}
                    iconBg="bg-green-500"
                    isCount
                  />
                  <StatCard
                    label="Items Sold"
                    value={todayRecord.totalItemsSold.toString()}
                    icon={Package}
                    iconBg="bg-cyan-500"
                    isCount
                  />
                  <StatCard
                    label="Avg. Sale"
                    value={money(avgSale)}
                    icon={BarChart3}
                    iconBg="bg-emerald-600"
                  />
                  <StatCard
                    label="Margin"
                    value={`${grossMargin}%`}
                    icon={ArrowDownRight}
                    iconBg="bg-amber-500"
                  />
                </div>

                {/* Payment Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                        <Banknote className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Cash Payments</p>
                        <p className="text-lg font-bold text-green-700">{money(todayRecord.cashTotal)}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                        <CreditCard className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Card Payments</p>
                        <p className="text-lg font-bold text-blue-700">{money(todayRecord.cardTotal)}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                        <Smartphone className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Mobile Money</p>
                        <p className="text-lg font-bold text-purple-700">{money(todayRecord.mobileMoneyTotal)}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Profit margin bar */}
                {todayRecord.totalRevenue > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Profit Margin</span>
                        <span className="text-sm font-bold text-emerald-600">
                          {((todayRecord.totalProfit / todayRecord.totalRevenue) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <Progress
                        value={(todayRecord.totalProfit / todayRecord.totalRevenue) * 100}
                        className="h-2.5"
                      />
                    </CardContent>
                  </Card>
                )}

                <RegisterFiltersBar
                  filters={filters}
                  onChange={setFilters}
                  branches={allBranches}
                  cashiers={todayCashiers}
                  shownCount={filteredTodaySales.length}
                  totalCount={todaySales.length}
                  isAdmin={isAdmin}
                  activeBranchId={activeBranch?.id ?? null}
                />

                {/* Today's Transaction Feed */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-muted-foreground" />
                      Today&apos;s Transactions
                      <Badge variant="secondary" className="text-xs ml-1">
                        {filteredTodaySales.length}
                      </Badge>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <GroupByControl value={todayGroupMode} onChange={setTodayGroupMode} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => { fetchToday(); toast.success('Refreshed'); }}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        Refresh
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {filteredTodaySales.length > 0 ? (
                      <div className="max-h-[520px] overflow-y-auto">
                        {todayGroups.map((group) => (
                          <div key={group.key}>
                            <AuditGroupHeader group={group} />
                            <Table>
                              <TableBody>
                                {group.sales.map((sale, idx) => (
                                  <SaleRow
                                    key={sale.id}
                                    sale={sale}
                                    index={idx}
                                    expanded={expandedSaleId === sale.id}
                                    expandedItems={expandedSaleItems}
                                    isAdmin={isAdmin}
                                    onExpand={handleExpandSale}
                                    onPrint={handlePrintReceipt}
                                    onDelete={(s) => { setSaleToDelete(s); setShowDeleteDialog(true); }}
                                    onRefund={() => { navigate('returns'); }}
                                  />
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-16 text-center">
                        <Receipt className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-muted-foreground text-sm">
                          {todaySales.length > 0
                            ? 'No sales match the current filters'
                            : 'No transactions recorded today'}
                        </p>
                        {todaySales.length > 0 ? (
                          <Button variant="outline" size="sm" className="mt-4" onClick={() => setFilters(NO_FILTERS)}>
                            <X className="h-3.5 w-3.5 mr-1" />
                            Clear filters
                          </Button>
                        ) : isOpen ? (
                          <Button
                            className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={goToPOS}
                          >
                            Start Selling
                            <ArrowUpRight className="h-4 w-4 ml-1.5" />
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Notes (if closed) */}
                {todayRecord.notes && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Closing Notes</p>
                          <p className="text-sm">{todayRecord.notes}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            </AnimatePresence>
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <CalendarDays className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No sales record found for today</p>
                <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={goToPOS}>
                  Go to POS
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        {/* ===== HISTORY TAB ===== */}
        <TabsContent value="history" className="space-y-4">
          {loadingPast ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-8 w-24 mb-1" />
                    <Skeleton className="h-4 w-20" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : pastRecords.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pastRecords.map((record) => (
                  <PastDayCard
                    key={record.id}
                    record={record}
                    isExpanded={expandedRecordId === record.id}
                    expandedSales={expandedRecordSales}
                    loadingDetail={loadingRecordDetail}
                    isAdmin={isAdmin}
                    onExpand={() => handleExpandRecord(record.id)}
                    onReopen={() => { setReopeningId(record.id); setShowReopenDialog(true); }}
                    onBackfill={() => { setPosPresetDate(record.date); navigate('pos'); }}
                    onVoid={(s) => { setSaleToDelete(s); setShowDeleteDialog(true); }}
                     formatDate={formatDate}
                    onExpandSale={handleExpandSale}
                    expandedSaleId={expandedSaleId}
                    expandedSaleItems={expandedSaleItems}
                  />
                ))}
              </div>

              {/* Real pagination. The old fixed 60-record fetch meant a branch
                  trading every day simply vanished off the end of the list. */}
              {pastTotalPages > 1 && (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-xs text-muted-foreground">
                    Page {pastPage} of {pastTotalPages} · {pastTotal} register{pastTotal === 1 ? '' : 's'} on record
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={pastPage <= 1}
                      onClick={() => setPastPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Newer
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={pastPage >= pastTotalPages}
                      onClick={() => setPastPage((p) => Math.min(pastTotalPages, p + 1))}
                    >
                      Older
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No past sales records found</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Close Day Dialog — Multi-step */}
      <Dialog open={showCloseDialog} onOpenChange={(open) => { if (!open) { setCloseStep(1); setClosingNotes(''); setCashCounted(''); } setShowCloseDialog(open); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-emerald-600" />
              Save &amp; Close Day
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 py-2">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  closeStep === step
                    ? 'bg-emerald-600 text-white'
                    : closeStep > step
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-400'
                }`}>
                  {closeStep > step ? <CheckCircle2 className="h-4 w-4" /> : step}
                </div>
                {step < 3 && <div className={`h-px w-8 transition-colors ${closeStep > step ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              </div>
            ))}
          </div>

          {todayRecord && (
            <AnimatePresence mode="wait">
              {closeStep === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4 py-2"
                >
                  <p className="text-sm text-muted-foreground">Review today&apos;s final numbers before closing the register.</p>

                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Day Summary</h4>
                      <Badge variant="outline" className="text-xs">{todayRecord.totalTransactions} transactions</Badge>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Total Revenue</p>
                        <p className="text-lg font-bold text-emerald-600">{money(todayRecord.totalRevenue)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Total Profit</p>
                        <p className="text-lg font-bold text-teal-600">{money(todayRecord.totalProfit)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-green-50 p-2 text-center">
                        <p className="text-green-700 font-semibold">{money(todayRecord.cashTotal)}</p>
                        <p className="text-green-600">Cash</p>
                      </div>
                      <div className="rounded-md bg-blue-50 p-2 text-center">
                        <p className="text-blue-700 font-semibold">{money(todayRecord.cardTotal)}</p>
                        <p className="text-blue-600">Card</p>
                      </div>
                      <div className="rounded-md bg-purple-50 p-2 text-center">
                        <p className="text-purple-700 font-semibold">{money(todayRecord.mobileMoneyTotal)}</p>
                        <p className="text-purple-600">MoMo</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Items Sold</span>
                      <span className="font-medium">{todayRecord.totalItemsSold}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Average Sale</span>
                      <span className="font-medium">{money(todayRecord.totalTransactions > 0 ? todayRecord.totalRevenue / todayRecord.totalTransactions : 0)}</span>
                    </div>
                    {previousDayStats && (
                      <>
                        <Separator />
                        <p className="text-xs font-medium text-muted-foreground">vs Previous Day</p>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Revenue</span>
                          <span className={`font-medium ${todayRecord.totalRevenue >= previousDayStats.revenue ? 'text-emerald-600' : 'text-red-500'}`}>
                            {money(todayRecord.totalRevenue - previousDayStats.revenue)}
                            <span className="text-[10px] ml-1">
                              ({todayRecord.totalRevenue > 0 ? (((todayRecord.totalRevenue - previousDayStats.revenue) / previousDayStats.revenue) * 100).toFixed(1) : '0'}%)
                            </span>
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}

              {closeStep === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4 py-2"
                >
                  <p className="text-sm text-muted-foreground">Count the cash in the drawer and enter the amount below for reconciliation.</p>

                  <div className="rounded-lg border bg-card p-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="cash-counted">Actual Cash Counted ({currencyCode})</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">{currencyCode}</span>
                        <Input
                          id="cash-counted"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          className="pl-12 text-lg font-semibold h-12"
                          value={cashCounted}
                          onChange={(e) => setCashCounted(e.target.value)}
                        />
                      </div>
                    </div>

                    {cashCounted && parseFloat(cashCounted) >= 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`rounded-lg p-3 text-sm ${
                          Math.abs(parseFloat(cashCounted) - todayExpectedCash) < 0.01
                            ? 'bg-emerald-50 border border-emerald-200'
                            : parseFloat(cashCounted) > todayExpectedCash
                            ? 'bg-amber-50 border border-amber-200'
                            : 'bg-red-50 border border-red-200'
                        }`}
                      >
                        {/* Only shown when cash actually went back out. Otherwise
                            this block would list three rows of numbers to explain
                            a subtraction of zero. */}
                        {todayRefunds.cashRefunds > 0 && (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-muted-foreground">Cash taken in</span>
                              <span className="font-semibold">{money(todayRecord.cashTotal)}</span>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                              <span className="font-medium text-muted-foreground">Cash refunded out</span>
                              <span className="font-semibold">-{money(todayRefunds.cashRefunds)}</span>
                            </div>
                          </>
                        )}
                        <div className={`flex justify-between items-center ${todayRefunds.cashRefunds > 0 ? 'mt-2' : ''}`}>
                          <span className="font-medium">Expected Cash</span>
                          <span className="font-semibold">{money(todayExpectedCash)}</span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="font-medium">Counted Cash</span>
                          <span className="font-semibold">{money(parseFloat(cashCounted))}</span>
                        </div>
                        <Separator className="my-2" />
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Difference</span>
                          <span className={`font-bold text-base ${
                            Math.abs(parseFloat(cashCounted) - todayExpectedCash) < 0.01
                              ? 'text-emerald-600'
                              : parseFloat(cashCounted) > todayExpectedCash
                              ? 'text-amber-600'
                              : 'text-red-600'
                          }`}>
                            {parseFloat(cashCounted) - todayExpectedCash >= 0 ? '+' : ''}
                            {money(parseFloat(cashCounted) - todayExpectedCash)}
                            {Math.abs(parseFloat(cashCounted) - todayExpectedCash) < 0.01 && ' ✓'}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              )}

              {closeStep === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4 py-2"
                >
                  <p className="text-sm text-muted-foreground">Add any final notes and confirm closing.</p>

                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>All sales have been recorded and reconciled</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Day totals verified</span>
                    </div>
                    {cashCounted && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>Cash counted: <strong>{money(parseFloat(cashCounted))}</strong></span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="closing-notes">Closing Notes (optional)</Label>
                    <Textarea
                      id="closing-notes"
                      placeholder="Any notes about today's operations..."
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                      rows={3}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {closeStep > 1 ? (
              <Button
                variant="outline"
                onClick={() => setCloseStep(closeStep - 1)}
                disabled={closing}
              >
                Back
              </Button>
            ) : (
              <Button variant="outline" onClick={() => { setShowCloseDialog(false); setCloseStep(1); }}>
                Cancel
              </Button>
            )}

            {closeStep < 3 ? (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setCloseStep(closeStep + 1)}
              >
                Continue
              </Button>
            ) : (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]"
                onClick={handleCloseDay}
                disabled={closing}
              >
                {closing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                    Finalizing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Finalize &amp; Close
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Closing Report Dialog */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              Day Closed Successfully
            </DialogTitle>
          </DialogHeader>

          {closedRecord && (
            <div className="space-y-4" id="closing-report">
              {/* Report Header */}
              <div className="text-center border-b pb-4">
                <h2 className="text-xl font-bold">PharmaCare Pro</h2>
                <p className="text-sm text-muted-foreground">Day-End Closing Report</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {(() => {
                    const d = new Date(closedRecord.date + 'T12:00:00');
                    return d.toLocaleDateString('en-GH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                  })()}
                </p>
              </div>

              {/* Times */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-emerald-50 p-3 text-center">
                  <p className="text-[10px] text-emerald-600 uppercase tracking-wider font-semibold">Opened</p>
                  <p className="font-semibold">{new Date(closedRecord.openedAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="text-xs text-muted-foreground">{closedRecord.opener?.name ?? 'System'}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Closed</p>
                  <p className="font-semibold">{closedRecord.closedAt ? new Date(closedRecord.closedAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }) : '-'}</p>
                  <p className="text-xs text-muted-foreground">{closedRecord.closer?.name ?? 'System'}</p>
                </div>
              </div>

              {/* Revenue Highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Total Revenue</p>
                  <p className="text-xl font-bold text-emerald-600">{money(closedRecord.totalRevenue)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Total Profit</p>
                  <p className="text-xl font-bold text-teal-600">{money(closedRecord.totalProfit)}</p>
                </div>
              </div>

              {/* Payment Breakdown */}
              <div className="rounded-lg border p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment Breakdown</p>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <Banknote className="h-3.5 w-3.5 text-green-600" /> Cash
                  </span>
                  <span className="font-semibold">{money(closedRecord.cashTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-blue-600" /> Card
                  </span>
                  <span className="font-semibold">{money(closedRecord.cardTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <Smartphone className="h-3.5 w-3.5 text-purple-600" /> Mobile Money
                  </span>
                  <span className="font-semibold">{money(closedRecord.mobileMoneyTotal)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Transactions</span>
                  <span className="font-semibold">{closedRecord.totalTransactions}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Items Sold</span>
                  <span className="font-semibold">{closedRecord.totalItemsSold}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Gross Margin</span>
                  <span className="font-semibold">
                    {closedRecord.totalRevenue > 0
                      ? `${Math.round((closedRecord.totalProfit / closedRecord.totalRevenue) * 100)}%`
                      : '0%'}
                  </span>
                </div>
              </div>

              {/* Profit Margin */}
              {closedRecord.totalRevenue > 0 && (
                <div className="rounded-lg border p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-muted-foreground">Profit Margin</span>
                    <span className="text-sm font-bold text-emerald-600">
                      {((closedRecord.totalProfit / closedRecord.totalRevenue) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={(closedRecord.totalProfit / closedRecord.totalRevenue) * 100}
                    className="h-2"
                  />
                </div>
              )}

              {/* Cash Reconciliation */}
              {cashCounted && (
                <div className="rounded-lg border p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cash Reconciliation</p>
                  {closedRefunds.cashRefunds > 0 && (
                    <>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Cash taken in</span>
                        <span>{money(closedRecord.cashTotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Cash refunded out</span>
                        <span>-{money(closedRefunds.cashRefunds)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm">
                    <span>Expected Cash</span>
                    <span>{money(closedExpectedCash)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Counted Cash</span>
                    <span>{money(parseFloat(cashCounted))}</span>
                  </div>
                  <Separator />
                  <div className={`flex justify-between text-sm font-bold ${
                    Math.abs(parseFloat(cashCounted) - closedExpectedCash) < 0.01
                      ? 'text-emerald-600'
                      : parseFloat(cashCounted) > closedExpectedCash
                      ? 'text-amber-600'
                      : 'text-red-600'
                  }`}>
                    <span>Difference</span>
                    <span>{parseFloat(cashCounted) - closedExpectedCash >= 0 ? '+' : ''}{money(parseFloat(cashCounted) - closedExpectedCash)}</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              {closingNotes && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Closing Notes</p>
                  <p className="text-sm">{closingNotes}</p>
                </div>
              )}

              {/* Footer */}
              <div className="text-center text-[10px] text-muted-foreground border-t pt-3">
                <p>Report generated on {new Date().toLocaleString('en-GH')}</p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const content = document.getElementById('closing-report');
                if (!content) return;
                // The print template reads the state value directly, so it can
                // be null (or the report unmounted) even though the button only
                // renders inside the `closedRecord &&` block.
                if (!closedRecord) return;
                const win = window.open('', '_blank', 'width=500,height=700');
                if (win) {
                  win.document.write(`
<!DOCTYPE html>
<html><head><title>Day-End Report</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1e293b; }
  h1 { font-size: 22px; margin: 0; }
  .text-center { text-align: center; }
  .text-muted { color: #64748b; font-size: 13px; }
  .border-b { border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 12px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
  .card-sm { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
  .flex { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 14px; }
  .label { color: #64748b; font-size: 12px; }
  .value { font-weight: 600; }
  .value-green { font-weight: 700; color: #059669; }
  .value-teal { font-weight: 700; color: #0d9488; }
  .value-amber { font-weight: 600; color: #d97706; }
  .value-red { font-weight: 600; color: #dc2626; }
  .title-sm { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .sep { border-top: 1px solid #e2e8f0; margin: 8px 0; }
  .badge { background: #f1f5f9; border-radius: 4px; padding: 1px 6px; font-size: 11px; }
  .text-lg { font-size: 20px; }
  @media print { body { padding: 0; } }
</style></head><body>
  <div class="text-center border-b">
    <h1>PharmaCare Pro</h1>
    <p class="text-muted" style="margin:4px 0">Day-End Closing Report</p>
    <p class="text-muted" style="font-size:12px;margin:2px 0">${new Date(closedRecord.date + 'T12:00:00').toLocaleDateString('en-GH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>
  <div class="grid-2" style="margin-top:12px">
    <div class="card-sm" style="text-align:center;background:#ecfdf5">
      <p class="text-muted" style="font-size:10px;text-transform:uppercase;font-weight:600;margin:2px 0">Opened</p>
      <p style="font-weight:600;margin:2px 0">${new Date(closedRecord.openedAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}</p>
      <p class="text-muted" style="font-size:12px;margin:2px 0">${closedRecord.opener?.name ?? 'System'}</p>
    </div>
    <div class="card-sm" style="text-align:center;background:#f8fafc">
      <p class="text-muted" style="font-size:10px;text-transform:uppercase;font-weight:600;margin:2px 0">Closed</p>
      <p style="font-weight:600;margin:2px 0">${closedRecord.closedAt ? new Date(closedRecord.closedAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }) : '-'}</p>
      <p class="text-muted" style="font-size:12px;margin:2px 0">${closedRecord.closer?.name ?? 'System'}</p>
    </div>
  </div>
  <div class="grid-2">
    <div class="card">
      <p class="label">Total Revenue</p>
      <p class="value-green text-lg">{money(closedRecord.totalRevenue)}</p>
    </div>
    <div class="card">
      <p class="label">Total Profit</p>
      <p class="value-teal text-lg">{money(closedRecord.totalProfit)}</p>
    </div>
  </div>
  <div class="card">
    <p class="title-sm">Payment Breakdown</p>
    <div class="flex"><span>&#x1f4b5; Cash</span><span>{money(closedRecord.cashTotal)}</span></div>
    <div class="flex"><span>&#x1f0cf; Card</span><span>{money(closedRecord.cardTotal)}</span></div>
    <div class="flex"><span>&#x1f4f1; Mobile Money</span><span>{money(closedRecord.mobileMoneyTotal)}</span></div>
    <div class="sep"></div>
    <div class="flex"><span class="label">Transactions</span><span>${closedRecord.totalTransactions}</span></div>
    <div class="flex"><span class="label">Items Sold</span><span>${closedRecord.totalItemsSold}</span></div>
  </div>
  ${closedRecord.totalRevenue > 0 ? `
  <div class="card">
    <div class="flex"><span class="label">Profit Margin</span><span class="value-green">${((closedRecord.totalProfit / closedRecord.totalRevenue) * 100).toFixed(1)}%</span></div>
  </div>` : ''}
  ${cashCounted ? `
  <div class="card">
    <p class="title-sm">Cash Reconciliation</p>
    ${closedRefunds.cashRefunds > 0 ? `<div class="flex"><span>Cash taken in</span><span>${money(closedRecord.cashTotal)}</span></div>
    <div class="flex"><span>Cash refunded out</span><span>-${money(closedRefunds.cashRefunds)}</span></div>` : ''}
    <div class="flex"><span>Expected Cash</span><span>${money(closedExpectedCash)}</span></div>
    <div class="flex"><span>Counted Cash</span><span>${money(parseFloat(cashCounted))}</span></div>
    <div class="sep"></div>
    <div class="flex"><span>Difference</span><span class="${Math.abs(parseFloat(cashCounted) - closedExpectedCash) < 0.01 ? 'value-green' : parseFloat(cashCounted) > closedExpectedCash ? 'value-amber' : 'value-red'}">${parseFloat(cashCounted) - closedExpectedCash >= 0 ? '+' : ''}${money(parseFloat(cashCounted) - closedExpectedCash)}</span></div>
  </div>` : ''}
  ${closingNotes ? `<div class="card"><p class="title-sm">Notes</p><p style="font-size:13px">${closingNotes}</p></div>` : ''}
  <div class="text-center" style="margin-top:20px">
    <button onclick="window.print()" style="padding:10px 32px;background:#059669;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px">&#x1f5a8; Print Report</button>
  </div>
  <p class="text-muted" style="text-align:center;font-size:10px;margin-top:12px">Report generated on ${new Date().toLocaleString('en-GH')}</p>
</body></html>
`);
                  win.document.close();
                }
              }}
            >
              <Printer className="h-4 w-4 mr-1.5" />
              Print Report
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => { setShowReportDialog(false); setClosedRecord(null); setPreviousDayStats(null); }}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen Day Dialog */}
      <AlertDialog open={showReopenDialog} onOpenChange={setShowReopenDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen This Day?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reopen the sales register for this day, allowing new sales to be added. Use this only if the day was closed by mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowReopenDialog(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleReopenDay}
              disabled={reopening}
            >
              {reopening ? 'Reopening...' : 'Reopen Day'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Sale Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Sale — {saleToDelete?.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the sale from your records and returns every item to the exact batch
              it was sold from. Daily totals are recalculated automatically. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDeleteSale}
              disabled={deleting}
            >
              {deleting ? 'Voiding...' : 'Void Sale & Restore Stock'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===== Sub-components =====

function StatCard({
  label,
  value,
  icon: Icon,
  iconBg,
  trend,
  isCount,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  iconBg: string;
  trend?: 'up' | 'down';
  isCount?: boolean;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <div className={`${iconBg} p-1.5 rounded-lg`}>
            <Icon className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="flex items-end gap-1.5 mt-2">
          <p className={`text-lg font-bold ${isCount ? '' : ''}`}>{value}</p>
          {trend && !isCount && (
            trend === 'up'
              ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500 mb-0.5" />
              : <ArrowDownRight className="h-3.5 w-3.5 text-red-500 mb-0.5" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SaleRow({
  sale,
  index,
  expanded,
  expandedItems,
  isAdmin,
  showBranch = false,
  onExpand,
  onPrint,
  onDelete,
  onRefund,
}: {
  sale: Sale;
  index: number;
  expanded: boolean;
  expandedItems: SaleItem[];
  isAdmin: boolean;
  /** Shown only in the consolidated view, where a bare invoice number does not
   *  say which shop rang it up. */
  showBranch?: boolean;
  onExpand: (saleId: string, items?: SaleItem[]) => void;
  onPrint: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  onRefund: () => void;
}) {
  const items = expandedItems.length > 0 ? expandedItems : sale.items ?? [];
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => onExpand(sale.id, sale.items)}
      >
        <TableCell className="w-8">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground font-mono">#{index + 1}</span>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
          {formatTime(sale.createdAt)}
        </TableCell>
        <TableCell className="font-mono text-xs">{sale.invoiceNo}</TableCell>
        {showBranch && (
          <TableCell className="text-xs">
            <BranchBadge branch={sale.branch} />
          </TableCell>
        )}
        <TableCell className="text-sm">{sale.customer?.name ?? 'Walk-in'}</TableCell>
        <TableCell className="text-center">
          <Badge variant="outline" className="text-xs">{sale.items?.length ?? 0}</Badge>
        </TableCell>
        <TableCell className="text-right font-semibold">{money(sale.totalAmount)}</TableCell>
        <TableCell className="text-right text-emerald-600 font-medium hidden md:table-cell">{money(sale.profit)}</TableCell>
        <TableCell className="hidden sm:table-cell">
          <PaymentBadge method={sale.paymentMethod} />
        </TableCell>
        <TableCell className="text-xs hidden lg:table-cell">{sale.user?.name ?? '-'}</TableCell>
        <TableCell className="hidden sm:table-cell">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); onPrint(sale); }}
              title="Print Receipt"
            >
              <Printer className="h-3.5 w-3.5 text-emerald-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); onRefund(); }}
              title="Process Return"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-600" />
            </Button>
{isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => { e.stopPropagation(); onDelete(sale); }}
                title="Void Sale"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            )}
            </div>
          </TableCell>
        </TableRow>
      {expanded && (
        <TableRow key={`${sale.id}-items`} className="bg-muted/30">
          <TableCell colSpan={showBranch ? 11 : 10} className="px-10 py-3">
            <div className="text-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wider">
                  Items on {sale.invoiceNo}
                  {showBranch && sale.branch && (
                    <span className="ml-2 normal-case tracking-normal text-[11px] text-muted-foreground/80">
                      {sale.branch.name}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {items.length} line{items.length === 1 ? '' : 's'}
                </p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1.5 font-medium text-muted-foreground">Product</th>
                    <th className="text-left py-1.5 font-medium text-muted-foreground">Batch</th>
                    <th className="text-center py-1.5 font-medium text-muted-foreground">Qty</th>
                    <th className="text-center py-1.5 font-medium text-muted-foreground">Returned</th>
                    <th className="text-right py-1.5 font-medium text-muted-foreground">Unit Price</th>
                    <th className="text-right py-1.5 font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const returned = Number(item.returnedQuantity ?? 0);
                    return (
                      <tr key={item.id} className="border-b border-dotted">
                        <td className="py-1.5">{item.product?.name ?? 'Product'}</td>
                        <td className="py-1.5 font-mono text-[11px] text-muted-foreground">
                          {item.batch?.batchNumber ?? '-'}
                        </td>
                        <td className="text-center">{item.quantity}</td>
                        <td className="text-center">
                          {returned > 0 ? (
                            <span className="text-amber-600 font-medium" title="Units already returned">
                              {returned}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">-</span>
                          )}
                        </td>
                        <td className="text-right">{money(item.unitPrice)}</td>
                        <td className="text-right font-medium">{money(item.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** The shop a sale or register belongs to. Never guess: an unnamed row in a
 *  multi-branch view is exactly the ambiguity the owner opened the view to
 *  resolve, so fall back to an explicit placeholder rather than nothing. */
function BranchBadge({ branch }: { branch?: Branch | null }) {
  if (!branch) {
    return <span className="text-[11px] text-muted-foreground/60">Unknown branch</span>;
  }
  return (
    <Badge variant="outline" className="text-[10px] font-normal h-5">
      <Building2 className="h-2.5 w-2.5 mr-1" />
      {branch.code || branch.name}
    </Badge>
  );
}

const EMPTY_TOTALS: LiveTotals = {
  totalRevenue: 0,
  totalProfit: 0,
  totalTransactions: 0,
  totalItemsSold: 0,
  cashTotal: 0,
  cardTotal: 0,
  mobileMoneyTotal: 0,
};

/**
 * The numbers to show for a branch's day.
 *
 * The register is authoritative once it exists. Only when there is no register
 * row at all do the server-derived live totals stand in — a branch that has
 * taken money must never be shown as having taken none, just because nobody
 * opened its till.
 */
function totalsOf(entry: TodayBranchEntry): LiveTotals {
  if (entry.record) {
    return {
      totalRevenue: entry.record.totalRevenue,
      totalProfit: entry.record.totalProfit,
      totalTransactions: entry.record.totalTransactions,
      totalItemsSold: entry.record.totalItemsSold,
      cashTotal: entry.record.cashTotal,
      cardTotal: entry.record.cardTotal,
      mobileMoneyTotal: entry.record.mobileMoneyTotal,
    };
  }
  return entry.liveTotals ?? EMPTY_TOTALS;
}

/** Applies the view-only filters to one branch's sales. Payment and cashier are
 *  exact matches; the free-text box searches the receipt number, the customer,
 *  the cashier and every product name on the receipt, because an owner chasing a
 *  recall knows one of those and rarely all. */
function filterSales(sales: Sale[], filters: RegisterFilters): Sale[] {
  const q = filters.query.trim().toLowerCase();
  return sales.filter((sale) => {
    if (filters.paymentMethod !== 'all' && sale.paymentMethod !== filters.paymentMethod) return false;
    if (filters.cashierId !== 'all' && sale.userId !== filters.cashierId) return false;
    if (!q) return true;
    const haystack = [
      sale.invoiceNo,
      sale.customer?.name ?? '',
      sale.user?.name ?? '',
      ...(sale.items ?? []).map((item) => item.product?.name ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * The register's filter row.
 *
 * The payment / cashier / search controls narrow what is on screen and nothing
 * else. The BRANCH control is not one of them: it changes the operating branch,
 * so it governs every write in the app as well as this screen — it goes through
 * `switchActiveBranch`, which re-issues the signed cookie and reloads, so stock
 * and takings can never disagree about which shop is selected.
 *
 * Comparing branches needs no filter for this: "All branches" is an option
 * here, and it renders each branch's day as its own section.
 */
function RegisterFiltersBar({
  filters,
  onChange,
  branches,
  cashiers,
  shownCount,
  totalCount,
  isAdmin,
  activeBranchId,
}: {
  filters: RegisterFilters;
  onChange: (next: RegisterFilters) => void;
  branches: Branch[];
  cashiers: { id: string; name: string }[];
  shownCount: number;
  totalCount: number;
  isAdmin: boolean;
  activeBranchId: string | null;
}) {
  const set = (patch: Partial<RegisterFilters>) => onChange({ ...filters, ...patch });
  const hasFilters =
    filters.paymentMethod !== NO_FILTERS.paymentMethod ||
    filters.cashierId !== NO_FILTERS.cashierId ||
    filters.query.trim() !== '';
  const narrowable = isAdmin && branches.length > 1;
  const [switchingBranch, setSwitchingBranch] = useState(false);

  // Selecting a branch here re-scopes the whole app and reloads, so it cannot be
  // a filter: an admin narrowing to a branch and then restocking must not put
  // the stock somewhere else. The label says so, because a control that reloads
  // the page and changes what every other screen writes deserves to announce it.
  const onSelectBranch = async (branchId: string) => {
    const current = activeBranchId ?? ALL_BRANCHES;
    if (branchId === current) return;
    setSwitchingBranch(true);
    const result = await switchActiveBranch(branchId);
    if (!result.ok) {
      toast.error(result.error ?? 'Could not switch branch');
      setSwitchingBranch(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
            <Filter className="h-3.5 w-3.5" />
            Filters
          </div>

          {narrowable && (
            <div className="flex items-center gap-1.5">
              <Select
                value={activeBranchId ?? ALL_BRANCHES}
                onValueChange={onSelectBranch}
                disabled={switchingBranch}
              >
                <SelectTrigger
                  className="h-8 w-44 text-xs"
                  title="Which branch the whole app is working in. Changing this reloads the app, and stock added or edited will go to this branch."
                >
                  {switchingBranch ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin text-muted-foreground" />
                  ) : (
                    <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  )}
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES} className="text-xs">All branches</SelectItem>
                  {branches.filter((b) => b.active).map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Select value={filters.paymentMethod} onValueChange={(v) => set({ paymentMethod: v })}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All payments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All payments</SelectItem>
              {Object.entries(PAY_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {cashiers.length > 1 && (
            <Select value={filters.cashierId} onValueChange={(v) => set({ cashierId: v })}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <Users className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All cashiers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All cashiers</SelectItem>
                {cashiers.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filters.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="Invoice, customer, or product…"
              className="h-8 w-56 pl-7 text-xs"
            />
          </div>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onChange(NO_FILTERS)}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          )}

          <span className="text-[11px] text-muted-foreground ml-auto">
            Showing {shownCount} of {totalCount} sale{totalCount === 1 ? '' : 's'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One branch's day, in the consolidated view.
 *
 * Each section carries its own revenue, profit, item count and payment split, so
 * an owner scanning the page compares shops directly instead of mentally adding
 * up rows from different shops — which is the mistake a single unlabelled
 * all-branches table invites.
 */
function BranchDaySection({
  entry,
  isAdmin,
  groupMode,
  onGroupModeChange,
  filters,
  expandedSaleId,
  expandedSaleItems,
  onExpandSale,
  onPrint,
  onDelete,
  onRefund,
}: {
  entry: TodayBranchEntry;
  isAdmin: boolean;
  groupMode: GroupMode;
  onGroupModeChange: (mode: GroupMode) => void;
  filters: RegisterFilters;
  expandedSaleId: string | null;
  expandedSaleItems: SaleItem[];
  onExpandSale: (saleId: string, items?: SaleItem[]) => void;
  onPrint: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  onRefund: () => void;
}) {
  const totals = totalsOf(entry);
  const sales = filterSales(entry.sales, filters);
  const groups = buildAuditGroups(sales, groupMode);
  const registerOpen = entry.record?.status === 'open';
  const margin = totals.totalRevenue > 0 ? (totals.totalProfit / totals.totalRevenue) * 100 : 0;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3 border-b bg-slate-50/60">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
              <Building2 className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {entry.branch.name}
                <span className="text-[10px] font-mono font-normal text-muted-foreground">{entry.branch.code}</span>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                {entry.record
                  ? registerOpen
                    ? 'Register open'
                    : 'Register closed'
                  : 'Register not opened today — showing live takings'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Revenue</p>
              <p className="text-lg font-bold text-emerald-600 leading-tight">{money(totals.totalRevenue)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Profit</p>
              <p className="text-lg font-bold text-teal-600 leading-tight">{money(totals.totalProfit)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Margin</p>
              <p className="text-lg font-bold leading-tight">{margin.toFixed(1)}%</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="secondary" className="text-[10px]">
            {totals.totalTransactions} tx
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {totals.totalItemsSold} items
          </Badge>
          {totals.cashTotal > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-green-600 font-medium">
              <Banknote className="h-3 w-3" />
              {money(totals.cashTotal)}
            </span>
          )}
          {totals.cardTotal > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-blue-600 font-medium">
              <CreditCard className="h-3 w-3" />
              {money(totals.cardTotal)}
            </span>
          )}
          {totals.mobileMoneyTotal > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-purple-600 font-medium">
              <Smartphone className="h-3 w-3" />
              {money(totals.mobileMoneyTotal)}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {sales.length > 0 ? (
          <div className="max-h-[420px] overflow-y-auto">
            {groups.map((group) => (
              <div key={group.key}>
                <AuditGroupHeader group={group} />
                <Table>
                  <TableBody>
                    {group.sales.map((sale, idx) => (
                      <SaleRow
                        key={sale.id}
                        sale={sale}
                        index={idx}
                        expanded={expandedSaleId === sale.id}
                        expandedItems={expandedSaleItems}
                        isAdmin={isAdmin}
                        onExpand={onExpandSale}
                        onPrint={onPrint}
                        onDelete={onDelete}
                        onRefund={onRefund}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {entry.sales.length > 0
              ? 'No sales match the current filters'
              : 'No sales recorded at this branch today'}
          </p>
        )}
      </CardContent>

      <div className="flex items-center justify-end px-4 py-2 border-t bg-slate-50/60">
        <GroupByControl value={groupMode} onChange={onGroupModeChange} />
      </div>
    </Card>
  );
}

/**
 * The whole business for today, when the owner is on the consolidated view.
 *
 * Sits above the per-branch sections so the first thing on screen is the number
 * they came for, with the branch split immediately under it. It is a SUM of the
 * visible sections and nothing else — deliberately not a server-side total,
 * because a figure that could disagree with the sections beneath it is worse
 * than no figure at all.
 */
function ConsolidatedSummary({ entries, isLoading }: { entries: TodayBranchEntry[]; isLoading: boolean }) {
  const totals = entries.reduce<LiveTotals>(
    (acc, entry) => {
      const t = totalsOf(entry);
      return {
        totalRevenue: acc.totalRevenue + t.totalRevenue,
        totalProfit: acc.totalProfit + t.totalProfit,
        totalTransactions: acc.totalTransactions + t.totalTransactions,
        totalItemsSold: acc.totalItemsSold + t.totalItemsSold,
        cashTotal: acc.cashTotal + t.cashTotal,
        cardTotal: acc.cardTotal + t.cardTotal,
        mobileMoneyTotal: acc.mobileMoneyTotal + t.mobileMoneyTotal,
      };
    },
    EMPTY_TOTALS
  );
  const margin = totals.totalRevenue > 0 ? (totals.totalProfit / totals.totalRevenue) * 100 : 0;
  const trading = entries.filter((e) => e.sales.length > 0).length;
  const noRegister = entries.filter((e) => !e.record && e.sales.length > 0).length;

  return (
    <Card className="border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900">
              <Layers className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight">All Branches — Today</h2>
              <p className="text-[11px] text-muted-foreground">
                {trading} of {entries.length} branch{trading === 1 ? '' : 'es'} trading today
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            Consolidated view
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Revenue" value={money(totals.totalRevenue)} icon={DollarSign} iconBg="bg-emerald-500" trend="up" />
          <StatCard label="Total Profit" value={money(totals.totalProfit)} icon={TrendingUp} iconBg="bg-teal-500" trend="up" />
          <StatCard label="Transactions" value={totals.totalTransactions.toString()} icon={Receipt} iconBg="bg-green-500" isCount />
          <StatCard label="Items Sold" value={totals.totalItemsSold.toString()} icon={Package} iconBg="bg-cyan-500" isCount />
          <StatCard
            label="Avg. Sale"
            value={money(totals.totalTransactions > 0 ? totals.totalRevenue / totals.totalTransactions : 0)}
            icon={BarChart3}
            iconBg="bg-emerald-600"
          />
          <StatCard label="Margin" value={`${margin.toFixed(1)}%`} icon={ArrowDownRight} iconBg="bg-amber-500" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <MiniTotal label="Cash" value={totals.cashTotal} icon={Banknote} tone="text-green-700" bg="bg-green-100" iconTone="text-green-600" />
          <MiniTotal label="Card" value={totals.cardTotal} icon={CreditCard} tone="text-blue-700" bg="bg-blue-100" iconTone="text-blue-600" />
          <MiniTotal label="Mobile Money" value={totals.mobileMoneyTotal} icon={Smartphone} tone="text-purple-700" bg="bg-purple-100" iconTone="text-purple-600" />
        </div>

        {noRegister > 0 && !isLoading && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {noRegister} branch{noRegister === 1 ? ' has' : 'es have'} taken money today without an opened
            register. Their totals are calculated live from sales and will be written to the register when it is opened.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MiniTotal({
  label,
  value,
  icon: Icon,
  tone,
  bg,
  iconTone,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  tone: string;
  bg: string;
  iconTone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
        <Icon className={`h-4 w-4 ${iconTone}`} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-base font-bold ${tone}`}>{money(value)}</p>
      </div>
    </div>
  );
}

function PaymentBadge({ method }: { method: string }) {
  switch (method) {
    case 'cash':
      return <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 bg-green-50"><Banknote className="h-3 w-3 mr-0.5" /> Cash</Badge>;
    case 'card':
      return <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 bg-blue-50"><CreditCard className="h-3 w-3 mr-0.5" /> Card</Badge>;
    case 'mobile_money':
      return <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700 bg-purple-50"><Smartphone className="h-3 w-3 mr-0.5" /> MoMo</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{method}</Badge>;
  }
}

function PastDayCard({
  record,
  isExpanded,
  expandedSales,
  loadingDetail,
  isAdmin,
  onExpand,
  onReopen,
  onVoid,
  onBackfill,
  formatDate: fmtDate,
  onExpandSale,
  expandedSaleId,
  expandedSaleItems,
}: {
  record: DailySalesRecord;
  isExpanded: boolean;
  expandedSales: Sale[];
  loadingDetail: boolean;
  isAdmin: boolean;
  onExpand: () => void;
  onReopen: () => void;
  onVoid: (sale: Sale) => void;
  onBackfill: () => void;
  formatDate: (d: string) => string;
  onExpandSale: (saleId: string, items?: SaleItem[]) => void;
  expandedSaleId: string | null;
  expandedSaleItems: SaleItem[];
}) {
  const isClosed = record.status === 'closed';
  const profitMargin = record.totalRevenue > 0 ? (record.totalProfit / record.totalRevenue) * 100 : 0;
  const [itemTab, setItemTab] = useState<'sales' | 'items' | 'summary'>('sales');
  const [itemSearch, setItemSearch] = useState('');
  const [salesGroupMode, setSalesGroupMode] = useState<GroupMode>('cashier');

  // Memoized audit groups for this day's sales
  const dayGroups = useMemo(() => buildAuditGroups(expandedSales, salesGroupMode), [expandedSales, salesGroupMode]);

  // Flatten all items from all sales, sorted by time
  const allItems = useMemo(() => {
    if (!expandedSales.length) return [];
    const items: {
      id: string;
      time: string;
      invoiceNo: string;
      productName: string;
      productUnit: string;
      batchNumber: string;
      quantity: number;
      returnedQuantity: number;
      unitPrice: number;
      total: number;
      costPrice: number;
      paymentMethod: string;
      cashierName: string;
      customerName: string;
    }[] = [];
    for (const sale of expandedSales) {
      for (const item of sale.items ?? []) {
        items.push({
          id: item.id,
          time: formatTime(sale.createdAt),
          invoiceNo: sale.invoiceNo,
          productName: item.product?.name ?? 'Unknown',
          productUnit: item.product?.unit ?? '',
          batchNumber: item.batch?.batchNumber ?? '-',
          quantity: item.quantity,
          returnedQuantity: Number(item.returnedQuantity ?? 0),
          unitPrice: item.unitPrice,
          total: item.total,
          costPrice: item.costPrice,
          paymentMethod: sale.paymentMethod,
          cashierName: sale.user?.name ?? '-',
          customerName: sale.customer?.name ?? 'Walk-in',
        });
      }
    }
    items.sort((a, b) => {
      const tA = expandedSales.find(s => s.invoiceNo === a.invoiceNo)?.createdAt ?? '';
      const tB = expandedSales.find(s => s.invoiceNo === b.invoiceNo)?.createdAt ?? '';
      return tA.localeCompare(tB);
    });
    return items;
  }, [expandedSales]);

  // Product summary
  const productSummary = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; totalQty: number; totalRevenue: number; totalProfit: number; avgPrice: number; count: number }>();
    for (const item of allItems) {
      const key = item.productName;
      const existing = map.get(key);
      const profit = item.total - item.costPrice * item.quantity;
      if (existing) {
        existing.totalQty += item.quantity;
        existing.totalRevenue += item.total;
        existing.totalProfit += profit;
        existing.count += 1;
        existing.avgPrice = existing.totalRevenue / existing.totalQty;
      } else {
        map.set(key, { name: item.productName, unit: item.productUnit, totalQty: item.quantity, totalRevenue: item.total, totalProfit: profit, avgPrice: item.unitPrice, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [allItems]);

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return allItems;
    const q = itemSearch.toLowerCase();
    return allItems.filter(i =>
      i.productName.toLowerCase().includes(q) ||
      i.invoiceNo.toLowerCase().includes(q) ||
      i.cashierName.toLowerCase().includes(q) ||
      i.customerName.toLowerCase().includes(q)
    );
  }, [allItems, itemSearch]);

  // Filtered product summary
  const filteredSummary = useMemo(() => {
    if (!itemSearch.trim()) return productSummary;
    const q = itemSearch.toLowerCase();
    return productSummary.filter(p => p.name.toLowerCase().includes(q));
  }, [productSummary, itemSearch]);

  // Export items to CSV
  const exportCSV = useCallback(() => {
    const headers = ['Time', 'Invoice#', 'Branch', 'Product', 'Batch', 'Qty', 'Returned', 'Unit Price', 'Total', 'Payment', 'Cashier', 'Customer'];
    const rows = filteredItems.map(i => [
      i.time, i.invoiceNo, record.branch?.name ?? '-', i.productName, i.batchNumber,
      i.quantity.toString(), i.returnedQuantity.toString(), money(i.unitPrice), money(i.total),
      i.paymentMethod, i.cashierName, i.customerName,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-items-${record.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredItems, record.date, record.branch?.name]);

  return (
    <AnimatePresence>
      <motion.div layout>
        <Card
          className={`cursor-pointer hover:shadow-md transition-all border ${isClosed ? 'border-slate-200' : 'border-emerald-200'}`}
          onClick={onExpand}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{fmtDate(record.date)}</p>
                  <BranchBadge branch={record.branch} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {record.totalTransactions} transaction{record.totalTransactions !== 1 ? 's' : ''} · {record.totalItemsSold} items
                </p>
              </div>
              <Badge
                variant={isClosed ? 'secondary' : 'default'}
                className={`text-[10px] ${isClosed ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}
              >
                {isClosed ? <Lock className="h-3 w-3 mr-0.5" /> : <Unlock className="h-3 w-3 mr-0.5" />}
                {isClosed ? 'Closed' : 'Open'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="font-bold">{money(record.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Profit</p>
                <p className="font-bold text-emerald-600">{money(record.totalProfit)}</p>
              </div>
            </div>

            {/* Profit margin mini bar */}
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>Profit Margin</span>
                <span>{profitMargin.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min(profitMargin, 100)}%` }}
                />
              </div>
            </div>

            {/* Payment breakdown mini */}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <Banknote className="h-3 w-3 text-green-500" />
                {money(record.cashTotal)}
              </span>
              <span className="flex items-center gap-0.5">
                <CreditCard className="h-3 w-3 text-blue-500" />
                {money(record.cardTotal)}
              </span>
              <span className="flex items-center gap-0.5">
                <Smartphone className="h-3 w-3 text-purple-500" />
                {money(record.mobileMoneyTotal)}
              </span>
            </div>

            {/* Action buttons */}
            {isExpanded && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                    onClick={(e) => { e.stopPropagation(); onBackfill(); }}
                  >
                    <Receipt className="h-3 w-3 mr-1" />
                    {isClosed ? 'Backfill sales' : 'Enter sales'}
                  </Button>
                )}
                {isClosed && isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-amber-600 border-amber-300 hover:bg-amber-50"
                    onClick={(e) => { e.stopPropagation(); onReopen(); }}
                  >
                    <Unlock className="h-3 w-3 mr-1" />
                    Reopen
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expanded detail */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <Card className="mt-2">
                <CardContent className="p-4">
                  {loadingDetail ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : expandedSales.length > 0 ? (
                    <div className="space-y-3">
                      {/* Sub-tabs for admin: Sales | All Items | Product Summary */}
                      <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-0.5">
                          <button
                            onClick={() => setItemTab('sales')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${itemTab === 'sales' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                          >
                            <Receipt className="h-3.5 w-3.5 inline mr-1" />
                            Sales
                          </button>
                          <button
                            onClick={() => setItemTab('items')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${itemTab === 'items' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                          >
                            <Package className="h-3.5 w-3.5 inline mr-1" />
                            All Items
                            <span className="ml-1 text-[10px] text-muted-foreground">({allItems.length})</span>
                          </button>
                          <button
                            onClick={() => setItemTab('summary')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${itemTab === 'summary' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                          >
                            <BarChart3 className="h-3.5 w-3.5 inline mr-1" />
                            Summary
                          </button>
                        </div>
                        {(itemTab === 'items' || itemTab === 'summary') && (
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                placeholder="Search products..."
                                value={itemSearch}
                                onChange={(e) => setItemSearch(e.target.value)}
                                className="h-8 w-44 pl-7 text-xs"
                              />
                            </div>
                            {itemTab === 'items' && filteredItems.length > 0 && (
                              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); exportCSV(); }}>
                                <Download className="h-3.5 w-3.5 mr-1" />
                                CSV
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Sales Tab */}
                      {itemTab === 'sales' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">{expandedSales.length} transaction(s) this day</p>
                            <GroupByControl value={salesGroupMode} onChange={setSalesGroupMode} />
                          </div>
                          <ScrollArea className="max-h-80">
                            {dayGroups.map((group) => (
                              <div key={group.key}>
                                <AuditGroupHeader group={group} />
                                <Table>
                                  <TableBody>
                                    {group.sales.map((sale) => (
                                      <Fragment key={sale.id}>
                                        <TableRow
                                          className="cursor-pointer hover:bg-muted/50"
                                          onClick={() => onExpandSale(sale.id, sale.items)}
                                        >
                                          <TableCell className="w-6">
                                            {expandedSaleId === sale.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                          </TableCell>
                                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(sale.createdAt)}</TableCell>
                                          <TableCell className="font-mono text-xs">{sale.invoiceNo}</TableCell>
                                          <TableCell className="text-xs">{sale.customer?.name ?? 'Walk-in'}</TableCell>
                                          <TableCell className="text-right text-sm font-medium">{money(sale.totalAmount)}</TableCell>
                                          <TableCell><PaymentBadge method={sale.paymentMethod} /></TableCell>
                                          {isAdmin && (
                                            <TableCell className="w-12">
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                title="Void Sale"
                                                onClick={(e) => { e.stopPropagation(); onVoid(sale); }}
                                              >
                                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                              </Button>
                                            </TableCell>
                                          )}
                                        </TableRow>
                                        {expandedSaleId === sale.id && (
                                          <TableRow className="bg-muted/30">
                                            <TableCell colSpan={isAdmin ? 7 : 6} className="px-8 py-2">
                                              <table className="w-full text-xs">
                                                <thead>
                                                  <tr className="border-b">
                                                    <th className="text-left py-1 font-medium text-muted-foreground">Product</th>
                                                    <th className="text-left py-1 font-medium text-muted-foreground">Batch</th>
                                                    <th className="text-center py-1 font-medium text-muted-foreground">Qty</th>
                                                    <th className="text-center py-1 font-medium text-muted-foreground">Returned</th>
                                                    <th className="text-right py-1 font-medium text-muted-foreground">Total</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {(sale.items ?? []).map((item) => {
                                                    const returned = Number(item.returnedQuantity ?? 0);
                                                    return (
                                                      <tr key={item.id} className="border-b border-dotted">
                                                        <td className="py-1">{item.product?.name ?? 'Product'}</td>
                                                        <td className="py-1 font-mono text-[10px] text-muted-foreground">
                                                          {item.batch?.batchNumber ?? '-'}
                                                        </td>
                                                        <td className="text-center py-1">{item.quantity}</td>
                                                        <td className="text-center py-1">
                                                          {returned > 0 ? (
                                                            <span className="text-amber-600 font-medium">{returned}</span>
                                                          ) : (
                                                            <span className="text-muted-foreground/40">-</span>
                                                          )}
                                                        </td>
                                                        <td className="text-right py-1">{money(item.total)}</td>
                                                      </tr>
                                                    );
                                                  })}
                                                </tbody>
                                              </table>
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </Fragment>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ))}
                          </ScrollArea>
                        </div>
                      )}

                      {/* All Items Tab */}
                      {itemTab === 'items' && (
                        <ScrollArea className="max-h-96">
                          {filteredItems.length > 0 ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-[10px]">Time</TableHead>
                                  <TableHead className="text-[10px]">Product</TableHead>
                                  <TableHead className="text-[10px]">Batch</TableHead>
                                  <TableHead className="text-[10px] text-center">Qty</TableHead>
                                  <TableHead className="text-[10px] text-center">Returned</TableHead>
                                  <TableHead className="text-[10px] text-right">Unit Price</TableHead>
                                  <TableHead className="text-[10px] text-right">Total</TableHead>
                                  <TableHead className="text-[10px]">Payment</TableHead>
                                  <TableHead className="text-[10px]">Cashier</TableHead>
                                  <TableHead className="text-[10px]">Invoice</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredItems.map((item, idx) => (
                                  <TableRow key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-muted/20'}>
                                    <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">{item.time}</TableCell>
                                    <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                                    <TableCell className="text-[11px] text-muted-foreground font-mono">{item.batchNumber}</TableCell>
                                    <TableCell className="text-xs text-center">{item.quantity} {item.productUnit}</TableCell>
                                    <TableCell className="text-xs text-center">
                                      {item.returnedQuantity > 0 ? (
                                        <span className="text-amber-600 font-medium">{item.returnedQuantity}</span>
                                      ) : (
                                        <span className="text-muted-foreground/40">-</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs text-right">{money(item.unitPrice)}</TableCell>
                                    <TableCell className="text-xs text-right font-semibold">{money(item.total)}</TableCell>
                                    <TableCell><PaymentBadge method={item.paymentMethod} /></TableCell>
                                    <TableCell className="text-[11px] text-muted-foreground">{item.cashierName}</TableCell>
                                    <TableCell className="text-[11px] font-mono text-muted-foreground">{item.invoiceNo}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <p className="text-center text-sm text-muted-foreground py-6">No items match your search</p>
                          )}
                        </ScrollArea>
                      )}

                      {/* Product Summary Tab */}
                      {itemTab === 'summary' && (
                        <ScrollArea className="max-h-96">
                          {filteredSummary.length > 0 ? (
                            <div className="space-y-2">
                              {/* Top-level stats */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                                <div className="rounded-lg bg-emerald-50 p-2 text-center">
                                  <p className="text-[10px] text-emerald-600 font-medium">Total Products</p>
                                  <p className="text-lg font-bold text-emerald-700">{productSummary.length}</p>
                                </div>
                                <div className="rounded-lg bg-blue-50 p-2 text-center">
                                  <p className="text-[10px] text-blue-600 font-medium">Total Items Sold</p>
                                  <p className="text-lg font-bold text-blue-700">{allItems.reduce((s, i) => s + i.quantity, 0)}</p>
                                </div>
                                <div className="rounded-lg bg-purple-50 p-2 text-center">
                                  <p className="text-[10px] text-purple-600 font-medium">Top Product</p>
                                  <p className="text-sm font-bold text-purple-700 truncate">{productSummary[0]?.name ?? '-'}</p>
                                </div>
                              </div>

                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-[10px]">#</TableHead>
                                    <TableHead className="text-[10px]">Product</TableHead>
                                    <TableHead className="text-[10px] text-center">Qty Sold</TableHead>
                                    <TableHead className="text-[10px] text-right">Avg Price</TableHead>
                                    <TableHead className="text-[10px] text-right">Revenue</TableHead>
                                    <TableHead className="text-[10px] text-right">Profit</TableHead>
                                    <TableHead className="text-[10px] text-right w-24">Margin</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {filteredSummary.map((p, idx) => (
                                    <TableRow key={p.name} className={idx % 2 === 0 ? 'bg-white' : 'bg-muted/20'}>
                                      <TableCell className="text-[11px] text-muted-foreground">{idx + 1}</TableCell>
                                      <TableCell className="text-xs font-medium">{p.name}</TableCell>
                                      <TableCell className="text-xs text-center">
                                        <Badge variant="secondary" className="text-[10px] font-mono">{p.totalQty}</Badge>
                                      </TableCell>
                                      <TableCell className="text-xs text-right">{money(p.avgPrice)}</TableCell>
                                      <TableCell className="text-xs text-right font-semibold">{money(p.totalRevenue)}</TableCell>
                                      <TableCell className="text-xs text-right text-emerald-600 font-medium">{money(p.totalProfit)}</TableCell>
                                      <TableCell className="text-xs text-right">
                                        <span className={`font-medium ${p.totalRevenue > 0 ? (p.totalProfit / p.totalRevenue) * 100 > 30 ? 'text-emerald-600' : (p.totalProfit / p.totalRevenue) * 100 > 15 ? 'text-amber-600' : 'text-red-500' : ''}`}>
                                          {p.totalRevenue > 0 ? ((p.totalProfit / p.totalRevenue) * 100).toFixed(1) + '%' : '-'}
                                        </span>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <p className="text-center text-sm text-muted-foreground py-6">No products match your search</p>
                          )}
                        </ScrollArea>
                      )}
                    </div>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-8">No sales recorded for this day</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-6 w-32 mb-2" />
          <Skeleton className="h-4 w-64" />
          <div className="flex items-center gap-3 mt-3">
            <Skeleton className="h-8 w-40" />
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-6 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-5 w-40 mb-4" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full mb-2" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
