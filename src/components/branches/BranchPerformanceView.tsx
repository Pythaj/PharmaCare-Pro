import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { money } from '@/lib/currency';
import { UNKNOWN_SALESPERSON } from '@/lib/salesperson';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Building2, ChevronDown, ChevronRight, Package, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Branch Performance — every shop side by side.
 *
 * ## The question this page exists to answer
 *
 * "How is each branch doing, and who in each branch is selling what?"
 *
 * The rest of the app is deliberately branch-scoped: park the session on Branch
 * A and every screen shows Branch A. That is correct for transacting and for
 * reading a single shop, but it makes the owner's actual question unanswerable —
 * comparing this month's Branch B against last month's Branch A by hand is how
 * a good branch gets closed by mistake.
 *
 * This page is therefore explicitly NOT branch-scoped, and says so in the
 * subtitle rather than letting a reader assume it respects the branch switcher.
 * It is read-only: nothing here moves stock, money or settings. The routes that
 * do keep their "select a branch first" refusals.
 */

interface CashierRow {
  userId: string;
  name: string;
  role: string;
  sales: number;
  revenue: number;
  items: number;
  refunds: number;
  netRevenue: number;
}

interface ProductRow {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  revenue: number;
  refundedQuantity: number;
  refunds: number;
  netQuantity: number;
  netRevenue: number;
}

interface BranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  active: boolean;
  revenue: number;
  refunds: number;
  netRevenue: number;
  profit: number;
  netProfit: number;
  sales: number;
  items: number;
  tradingDays: number;
  averageSaleValue: number;
  averageDailyRevenue: number;
  lastSaleAt: string | null;
  revenueShare: number;
  cashiers: CashierRow[];
  topProducts: ProductRow[];
}

interface BranchResponse {
  from: string;
  to: string;
  branchCount: number;
  totals: {
    revenue: number;
    grossRevenue: number;
    refunds: number;
    profit: number;
    grossProfit: number;
    sales: number;
    items: number;
  };
  branches: BranchRow[];
  topBranchByRevenue: {
    branchId: string;
    branchName: string;
    revenue: number;
    grossRevenue: number;
    refunds: number;
  } | null;
}

interface DailyItemRow {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  revenue: number;
  profit: number;
  batches: string[];
  sales: number;
  refundedQuantity: number;
  refunds: number;
  netQuantity: number;
  netRevenue: number;
}

interface DailyResponse {
  date: string;
  branchId: string | null;
  /** Which salesperson's till this response is scoped to, echoed back by the
   *  API so the UI can label the view from the response rather than from its own
   *  request state — a filter silently dropped server-side would otherwise show a
   *  whole-business total under a single-till heading. */
  userId: string | null;
  summary: {
    sales: number;
    revenue: number;
    grossRevenue: number;
    refunds: number;
    refundCount: number;
    profit: number;
    grossProfit: number;
    items: number;
    distinctProducts: number;
    averageSaleValue: number;
  };
  byBranch: {
    branchId: string;
    branchName: string;
    branchCode: string;
    revenue: number;
    profit: number;
    items: number;
    sales: number;
    refunds: number;
    refundedProfit: number;
    netRevenue: number;
    netProfit: number;
  }[];
  /** The same day and the same money, grouped by whose till it was. */
  bySalesperson: {
    userId: string | null;
    name: string;
    role: string | null;
    revenue: number;
    profit: number;
    items: number;
    sales: number;
    refunds: number;
    refundedProfit: number;
    netRevenue: number;
    netProfit: number;
    /** Shops this person rang up at, for staff who cover more than one. */
    branches: string[];
  }[];
  items: DailyItemRow[];
  /** The day's individual receipts, newest first. */
  invoices: DailyInvoiceRow[];
}

interface DailyInvoiceRow {
  id: string;
  invoiceNo: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  cashierName: string;
  totalAmount: number;
  profit: number;
  refundedAmount: number;
  netAmount: number;
  createdAt: string;
  itemCount: number;
  items: {
    id: string;
    productName: string;
    unit: string;
    batchNumber: string | null;
    quantity: number;
    returnedQuantity: number;
    refundAmount: number;
    netQuantity: number;
    unitPrice: number;
    costPrice: number;
    total: number;
  }[];
}

type Period = 'today' | 'this_week' | 'this_month' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  custom: 'Custom range',
};

/** Local YYYY-MM-DD. `toISOString()` would shift the day for shops behind UTC. */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
}

function marginPercent(revenue: number, profit: number): number {
  if (revenue <= 0) return 0;
  return (profit / revenue) * 100;
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function BranchPerformanceView() {
  const [period, setPeriod] = useState<Period>('this_month');
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    return localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [toDate, setToDate] = useState(() => localDateKey(new Date()));

  const [data, setData] = useState<BranchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // The day's item drilldown. A separate date/branch pair from the comparison
  // window, because "how did we do this month" and "what left the shelf
  // yesterday" are different questions and forcing one range on both makes
  // neither readable.
  const [itemDate, setItemDate] = useState(() => localDateKey(new Date()));
  const [itemBranch, setItemBranch] = useState<string>('all');
  // Whose till to reconcile. `'all'` is every salesperson; a userId narrows the
  // whole report — summary, items, invoice list and refunds — to one person's
  // sales. Independent of the branch filter on purpose: staff cover shifts and
  // branches, so "Kofi at Central" and "Kofi anywhere" are both real questions.
  const [itemSalesperson, setItemSalesperson] = useState<string>('all');
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);

  const loadBranches = useCallback(async () => {
    const now = new Date();
    let url = '/api/reports/branches?';

    if (period === 'custom') {
      if (!fromDate || !toDate) {
        toast.error('Select both a start and an end date.');
        return;
      }
      if (fromDate > toDate) {
        toast.error('The start date must be on or before the end date.');
        return;
      }
      url += `from=${fromDate}&to=${toDate}`;
    } else {
      const today = localDateKey(now);
      const start =
        period === 'today'
          ? today
          : period === 'this_week'
            ? localDateKey(startOfWeek(now))
            : localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
      url += `from=${start}&to=${today}`;
    }

    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? 'Failed to load the branch comparison.');
        return;
      }
      const body = await res.json();
      setData(body);
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [period, fromDate, toDate]);

  const loadDailyItems = useCallback(async () => {
    setDailyLoading(true);
    try {
      const params = new URLSearchParams({ date: itemDate });
      if (itemBranch !== 'all') params.set('branchId', itemBranch);
      if (itemSalesperson !== 'all') params.set('userId', itemSalesperson);
      const res = await fetch(`/api/reports/daily-items?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? 'Failed to load that day\u2019s items.');
        return;
      }
      setDaily(await res.json());
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.');
    } finally {
      setDailyLoading(false);
    }
  }, [itemDate, itemBranch, itemSalesperson]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    loadDailyItems();
  }, [loadDailyItems]);

  const branches = data?.branches ?? [];

  // Rank medals only for branches still trading — handing "best performing" to a
  // branch that closed last month would be absurd.
  const activeBranches = useMemo(() => branches.filter((b) => b.active), [branches]);

  const branchOptions = useMemo(
    () => [
      { id: 'all', name: 'All branches', code: '' },
      ...branches.map((b) => ({ id: b.branchId, name: b.branchName, code: b.branchCode })),
    ],
    [branches]
  );

  /* People who have traded on the selected day, accumulated across requests.
   *
   * Derived from the response rather than from a separate /api/users fetch, for
   * two reasons: the only useful salespeople here are the ones who actually rang
   * something up on that day, and this view is already admin-only so a user list
   * would be a wider data grab than the report needs.
   *
   * Accumulated rather than replaced, because the response is already filtered by
   * the current selection. Deriving options straight from it means choosing
   * "Ama" collapses the dropdown to just Ama, and the owner then has no way back
   * to the whole-business view except reloading the page. */
  const [salespersonOptions, setSalespersonOptions] = useState<
    { id: string; name: string; role: string | null }[]
  >([]);

  useEffect(() => {
    if (!daily?.bySalesperson) return;
    setSalespersonOptions((prev) => {
      const merged = new Map(prev.map((p) => [p.id, p]));
      let changed = false;
      for (const person of daily.bySalesperson) {
        // A sale whose user row has since been deleted still needs an entry, or
        // that money becomes unfilterable. Keyed on a sentinel that cannot
        // collide with a cuid.
        const id = person.userId ?? UNKNOWN_SALESPERSON;
        if (!merged.has(id)) {
          merged.set(id, { id, name: person.name, role: person.role });
          changed = true;
        } else if (merged.get(id)!.name === 'Unknown salesperson' && person.name !== 'Unknown salesperson') {
          merged.set(id, { id, name: person.name, role: person.role });
          changed = true;
        }
      }
      return changed ? [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)) : prev;
    });
  }, [daily]);

  const toggle = (id: string) => setExpanded((prev) => (prev === id ? null : id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Branch Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every branch compared side by side, with each shop&rsquo;s sales and the
            items it moved. This view always spans the whole business — it is not
            affected by the branch switcher, and it is read-only.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'this_week', 'this_month'] as Period[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'outline'}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
          <Button
            size="sm"
            variant={period === 'custom' ? 'default' : 'outline'}
            onClick={() => setPeriod('custom')}
          >
            {PERIOD_LABELS.custom}
          </Button>
        </div>
      </div>

      {period === 'custom' ? (
        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="bp-from">
                From
              </label>
              <Input
                id="bp-from"
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full sm:w-44"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="bp-to">
                To
              </label>
              <Input
                id="bp-to"
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full sm:w-44"
              />
            </div>
            <Button size="sm" onClick={loadBranches}>
              Apply range
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* `totals.revenue`/`totals.profit` are NET — the API reduced them by
              approved refunds. The tile says so explicitly, because the same
              words on the register mean gross and an owner comparing the two
              screens would otherwise conclude one of them is wrong. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Chain revenue (net)"
              value={money(data.totals.revenue)}
              hint={
                data.totals.refunds > 0
                  ? `Gross ${money(data.totals.grossRevenue)} less ${money(data.totals.refunds)} refunded`
                  : `Across ${activeBranches.length} trading branch${activeBranches.length === 1 ? '' : 'es'}`
              }
              icon={TrendingUp}
            />
            <StatCard
              label="Sales recorded"
              value={data.totals.sales.toLocaleString()}
              hint={
                data.totals.sales > 0
                  ? `${money(data.totals.revenue / data.totals.sales)} average sale`
                  : 'No completed sales in this range'
              }
              icon={Building2}
            />
            <StatCard
              label="Items sold"
              value={data.totals.items.toLocaleString()}
              hint="Units that left a shelf, before returns"
              icon={Package}
            />
            <StatCard
              label="Net profit"
              value={money(data.totals.profit)}
              hint={
                data.totals.revenue > 0
                  ? `${marginPercent(data.totals.revenue, data.totals.profit).toFixed(1)}% margin after refunds`
                  : '—'
              }
              icon={Users}
            />
          </div>

          {data.topBranchByRevenue ? (
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 py-4">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-sm">
                  <span className="text-muted-foreground">Top branch by revenue: </span>
                  <span className="font-semibold">{data.topBranchByRevenue.branchName}</span>
                  <span className="text-muted-foreground"> at </span>
                  <span className="font-semibold tabular-nums">
                    {money(data.topBranchByRevenue.revenue)}
                  </span>
                  {/* Ranked on net, so the branch that took the most cash and
                      gave nearly all of it back cannot hold the top spot. */}
                  {data.topBranchByRevenue.refunds > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      (net of {money(data.topBranchByRevenue.refunds)} refunded, from{' '}
                      {money(data.topBranchByRevenue.grossRevenue)} gross)
                    </span>
                  ) : null}
                </span>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Branch by branch</CardTitle>
              <CardDescription>
                {data.from} to {data.to}. Select a row to see that branch&rsquo;s sales
                staff and its best-selling items.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {branches.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No branches yet. Add one to start comparing.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Branch</TableHead>
                        {/* Net, with gross and refunds on the expanded row: a
                            leaderboard that ranked gross would reward the shop
                            with the worst returns. */}
                        <TableHead className="text-right">Revenue (net)</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Net profit</TableHead>
                        <TableHead className="text-right">Avg / day</TableHead>
                        <TableHead>Last sale</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {branches.map((branch, index) => {
                        const isOpen = expanded === branch.branchId;
                        const rank = activeBranches.findIndex((b) => b.branchId === branch.branchId);
                        return (
                          <BranchDetailRow
                            key={branch.branchId}
                            branch={branch}
                            rank={rank}
                            isOpen={isOpen}
                            onToggle={() => toggle(branch.branchId)}
                            showDivider={index > 0}
                          />
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ---------- Daily item drilldown ---------- */}
      <Card>
        <CardHeader>
          <CardTitle>Items sold on a given day</CardTitle>
          <CardDescription>
            The reconciliation view: which items left the shelf, in which branch, and
            how much margin each one carried.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="bp-item-date">
                Day
              </label>
              <Input
                id="bp-item-date"
                type="date"
                value={itemDate}
                max={localDateKey(new Date())}
                onChange={(e) => setItemDate(e.target.value)}
                className="w-full sm:w-44"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="bp-item-branch">
                Branch
              </label>
              <Select value={itemBranch} onValueChange={setItemBranch}>
                <SelectTrigger id="bp-item-branch" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branchOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Salesperson is deliberately independent of Branch. Staff cover
                shifts and work more than one shop, so "Ama at Central" and "Ama
                anywhere" are both questions an owner actually asks, and tying the
                second to the first would make one of them unanswerable. */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="bp-item-salesperson">
                Salesperson
              </label>
              <Select value={itemSalesperson} onValueChange={setItemSalesperson}>
                <SelectTrigger id="bp-item-salesperson" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All salespeople</SelectItem>
                  {salespersonOptions.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {dailyLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : daily ? (
            // A day with no sales but a processed refund is NOT an empty day — it is the one
            // day an owner most wants to see, because money left a till with no
            // till takings to reconcile it against.
            daily.summary.sales === 0 && daily.summary.refunds === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No completed sales on {daily.date}
                {daily.branchId ? ' at this branch' : ' across the business'}
                {/* Naming the salesperson stops the copy reading as a statement
                    about the whole business when it is really about one till. */}
                {daily.userId
                  ? ` for ${salespersonOptions.find((p) => p.id === daily.userId)?.name ?? 'that salesperson'}`
                  : ''}
                . Pick another day to see what moved.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Revenue that day (net)"
                    value={money(daily.summary.revenue)}
                    hint={
                      daily.summary.refunds > 0
                        ? `Gross ${money(daily.summary.grossRevenue)} less ${money(daily.summary.refunds)} refunded (${daily.summary.refundCount})`
                        : `${daily.summary.sales} sale${daily.summary.sales === 1 ? '' : 's'} · ${money(daily.summary.averageSaleValue)} average`
                    }
                    icon={TrendingUp}
                  />
                  <StatCard
                    label="Items sold"
                    value={daily.summary.items.toLocaleString()}
                    hint={`${daily.summary.distinctProducts} distinct product${daily.summary.distinctProducts === 1 ? '' : 's'}`}
                    icon={Package}
                  />
                  <StatCard
                    label="Net profit"
                    value={money(daily.summary.profit)}
                    hint={`${marginPercent(daily.summary.revenue, daily.summary.profit).toFixed(1)}% margin after refunds`}
                    icon={TrendingUp}
                  />
                  <StatCard
                    label={daily.userId ? 'Salespeople trading' : 'Branches trading'}
                    value={String(daily.userId ? daily.bySalesperson.length : daily.byBranch.length)}
                    hint={
                      daily.userId
                        ? 'Already narrowed to one salesperson'
                        : 'Shops that recorded a sale or a refund that day'
                    }
                    icon={Building2}
                  />
                </div>

                {/* Hidden while a single salesperson is selected: the table would
                    hold exactly one row and restate the cards above it. The
                    "All salespeople" state is the one that needs it. */}
                {!daily.userId && daily.bySalesperson.length > 1 ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Split by salesperson</h3>
                    <div className="flex flex-wrap gap-2">
                      {daily.bySalesperson.map((person) => {
                        const names = person.branches
                          .map((id) => branchOptions.find((b) => b.id === id)?.name)
                          .filter(Boolean);
                        return (
                          <button
                            key={person.userId ?? UNKNOWN_SALESPERSON}
                            type="button"
                            onClick={() => setItemSalesperson(person.userId ?? UNKNOWN_SALESPERSON)}
                            className="rounded-md border px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{person.name}</span>
                              {/* More than one shop is worth surfacing rather than
                                  collapsing: someone covering two branches in a
                                  shift is exactly what an owner cannot see from a
                                  per-branch report. */}
                              {names.length > 1 && (
                                <Badge variant="outline" className="text-[10px]">
                                  {names.length} branches
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                              {money(person.netRevenue)} net · {person.items} item
                              {person.items === 1 ? '' : 's'} · {person.sales} sale
                              {person.sales === 1 ? '' : 's'}
                              {person.refunds > 0 ? ` · ${money(person.refunds)} back` : ''}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {daily.byBranch.length > 1 ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Split by branch</h3>
                    <div className="flex flex-wrap gap-2">
                      {daily.byBranch.map((b) => (
                        <div
                          key={b.branchId}
                          className="rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {b.branchCode}
                            </Badge>
                            <span className="font-medium">{b.branchName}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                            {money(b.netRevenue)} net · {b.items} item{b.items === 1 ? '' : 's'} ·{' '}
                            {b.sales} sale{b.sales === 1 ? '' : 's'}
                            {b.refunds > 0 ? ` · ${money(b.refunds)} back` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-center">Qty sold</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                        <TableHead>Batches drawn</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {daily.items.map((item, index) => (
                        <TableRow key={item.productId}>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {index + 1}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.sales > 0
                                ? `sold across ${item.sales} sale${item.sales === 1 ? '' : 's'}`
                                : 'sold before this day — returned today'}
                            </div>
                          </TableCell>
                          <TableCell className="text-center tabular-nums font-medium">
                            {/* Net of what came back. The returned figure sits
                                underneath so a heavily-returned line cannot look
                                like a strong seller on quantity alone. */}
                            {item.netQuantity} {item.unit}
                            {item.refundedQuantity > 0 ? (
                              <div className="text-[10px] font-normal text-muted-foreground">
                                {item.refundedQuantity} returned
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(item.netRevenue)}
                            {item.refunds > 0 ? (
                              <div className="text-[10px] text-muted-foreground">
                                from {money(item.revenue)}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(item.profit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {marginPercent(item.revenue, item.profit).toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            {item.batches.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {item.batches.slice(0, 3).map((batch) => (
                                  <Badge
                                    key={batch}
                                    variant="secondary"
                                    className="font-mono text-[10px]"
                                  >
                                    {batch}
                                  </Badge>
                                ))}
                                {item.batches.length > 3 ? (
                                  <span className="text-xs text-muted-foreground">
                                    +{item.batches.length - 3} more
                                  </span>
                                ) : null}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* The individual receipts behind those totals. The product table
                    above answers "what moved"; this answers "which receipt" —
                    the drilldown an owner needs when a customer disputes a sale
                    or a batch is recalled. */}
                <InvoiceDrilldown invoices={daily.invoices} />
              </>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The day's individual receipts, each expandable to its line items.
 *
 * The product table above deliberately aggregates: a product sold five times is
 * one row. That is right for reconciliation in aggregate and useless the moment
 * someone asks "which sale was that, and what was on it" — so the raw receipts
 * are available one click away rather than being the only view, which would
 * make a busy day unreadable.
 */
function InvoiceDrilldown({ invoices }: { invoices: DailyInvoiceRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>('all');

  if (!invoices || invoices.length === 0) return null;

  const branchIds = [...new Set(invoices.map((i) => i.branchId))];
  const rows = branchFilter === 'all' ? invoices : invoices.filter((i) => i.branchId === branchFilter);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h3 className="text-sm font-medium">
          Individual sales
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            {rows.length} receipt{rows.length === 1 ? '' : 's'}
          </span>
        </h3>
        {branchIds.length > 1 ? (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                All branches
              </SelectItem>
              {branchIds.map((id) => {
                const match = invoices.find((i) => i.branchId === id);
                return (
                  <SelectItem key={id} value={id} className="text-xs">
                    {match?.branchName ?? id}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Invoice</TableHead>
              <TableHead>Time</TableHead>
              {branchIds.length > 1 ? <TableHead>Branch</TableHead> : null}
              <TableHead>Cashier</TableHead>
              <TableHead className="text-center">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((invoice) => {
              const open = expandedId === invoice.id;
              return (
                <Fragment key={invoice.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedId(open ? null : invoice.id)}
                  >
                    <TableCell>
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{invoice.invoiceNo}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(invoice.createdAt).toLocaleTimeString('en-GH', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    {branchIds.length > 1 ? (
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          <Building2 className="h-2.5 w-2.5 mr-1" />
                          {invoice.branchCode || invoice.branchName}
                        </Badge>
                      </TableCell>
                    ) : null}
                    <TableCell className="text-xs">{invoice.cashierName}</TableCell>
                    <TableCell className="text-center tabular-nums">{invoice.itemCount}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {/* Headline is net: this is the receipt's real takings.
                          Gross only appears when money actually came back. */}
                      {money(invoice.netAmount)}
                      {invoice.refundedAmount > 0 ? (
                        <div className="text-[10px] font-normal text-muted-foreground">
                          {money(invoice.refundedAmount)} back of{' '}
                          {money(invoice.totalAmount)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600 tabular-nums">
                      {money(invoice.profit)}
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={branchIds.length > 1 ? 8 : 7} className="px-8 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1 font-medium text-muted-foreground">Product</th>
                              <th className="text-left py-1 font-medium text-muted-foreground">Batch</th>
                              <th className="text-center py-1 font-medium text-muted-foreground">Qty</th>
                              <th className="text-right py-1 font-medium text-muted-foreground">Unit price</th>
                              <th className="text-right py-1 font-medium text-muted-foreground">Total</th>
                              {/* Only meaningful when something came back, so the
                                  column exists solely for a refunded receipt. */}
                              {invoice.refundedAmount > 0 ? (
                                <th className="text-right py-1 font-medium text-muted-foreground">
                                  Returned
                                </th>
                              ) : null}
                            </tr>
                          </thead>
                          <tbody>
                            {invoice.items.map((line) => (
                              <tr key={line.id} className="border-b border-dotted">
                                <td className="py-1">{line.productName}</td>
                                <td className="py-1 font-mono text-[10px] text-muted-foreground">
                                  {line.batchNumber ?? '—'}
                                </td>
                                <td className="text-center py-1">
                                  {line.quantity} {line.unit}
                                </td>
                                <td className="text-right py-1">{money(line.unitPrice)}</td>
                                <td className="text-right py-1 font-medium">{money(line.total)}</td>
                                {invoice.refundedAmount > 0 ? (
                                  <td className="text-right py-1 text-amber-600">
                                    {line.returnedQuantity > 0 ? (
                                      <>
                                        {line.returnedQuantity} · {money(line.refundAmount)}
                                      </>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * One branch, plus its cashier leaderboard and best sellers when expanded.
 *
 * Split out because a `Fragment` inside the table body cannot carry the
 * `colSpan` that a detail row needs, and inlining it would mean repeating the
 * expansion markup for every branch rendered.
 */
function BranchDetailRow({
  branch,
  rank,
  isOpen,
  onToggle,
  showDivider,
}: {
  branch: BranchRow;
  rank: number;
  isOpen: boolean;
  onToggle: () => void;
  showDivider: boolean;
}) {
  return (
    <>
      <TableRow
        onClick={onToggle}
        className="cursor-pointer hover:bg-muted/50"
        data-state={isOpen ? 'open' : undefined}
      >
        <TableCell>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-medium">{branch.branchName}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {branch.branchCode}
            </Badge>
            {rank === 0 ? (
              <Badge className="text-[10px]">Top</Badge>
            ) : null}
            {!branch.active ? (
              <Badge variant="secondary" className="text-[10px]">
                No longer trading
              </Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums font-medium">
          {money(branch.netRevenue)}
          {/* A branch with returns says so on the collapsed row. Hiding it here
              would leave a net figure visibly below a gross one the owner
              remembers, with no explanation until they expand. */}
          {branch.refunds > 0 ? (
            <div className="text-[10px] font-normal text-muted-foreground">
              {money(branch.refunds)} refunded
            </div>
          ) : null}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {(branch.revenueShare * 100).toFixed(1)}%
        </TableCell>
        <TableCell className="text-right tabular-nums">{branch.sales}</TableCell>
        <TableCell className="text-right tabular-nums">{branch.items}</TableCell>
        <TableCell className="text-right tabular-nums">{money(branch.netProfit)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {branch.tradingDays > 0 ? money(branch.averageDailyRevenue) : '—'}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {branch.lastSaleAt
            ? new Date(branch.lastSaleAt).toLocaleString('en-GH', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'No sales yet'}
        </TableCell>
      </TableRow>

      {isOpen ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={9} className="p-0">
            <div className="grid gap-6 p-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sales staff at {branch.branchName}
                </h4>
                {branch.cashiers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No completed sales attributed to anyone in this range.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {branch.cashiers.map((cashier) => (
                        <TableRow key={cashier.userId}>
                          <TableCell>
                            <span className="font-medium">{cashier.name}</span>
                            {cashier.role !== 'admin' ? null : (
                              <Badge variant="secondary" className="ml-2 text-[10px]">
                                Admin
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {cashier.sales}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {cashier.items}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {/* Net: the ranking is by net revenue upstream, so
                                printing gross here would contradict the order. */}
                            {money(cashier.netRevenue)}
                            {cashier.refunds > 0 ? (
                              <div className="text-[10px] font-normal text-muted-foreground">
                                {money(cashier.refunds)} refunded
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Best-selling items here
                </h4>
                {branch.topProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing sold yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {branch.topProducts.map((product) => (
                        <TableRow key={product.productId}>
                          <TableCell>{product.name}</TableCell>
                          <TableCell className="text-center tabular-nums">
                            {product.netQuantity} {product.unit}
                            {product.refundedQuantity > 0 ? (
                              <div className="text-[10px] text-muted-foreground">
                                {product.refundedQuantity} back
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(product.netRevenue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
