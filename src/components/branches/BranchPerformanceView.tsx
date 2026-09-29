import { useState, useEffect, useCallback, useMemo } from 'react';
import { money } from '@/lib/currency';
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
}

interface ProductRow {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  revenue: number;
}

interface BranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  active: boolean;
  revenue: number;
  profit: number;
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
  totals: { revenue: number; profit: number; sales: number; items: number };
  branches: BranchRow[];
  topBranchByRevenue: { branchId: string; branchName: string; revenue: number } | null;
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
}

interface DailyResponse {
  date: string;
  branchId: string | null;
  summary: {
    sales: number;
    revenue: number;
    profit: number;
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
  }[];
  items: DailyItemRow[];
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
  }, [itemDate, itemBranch]);

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Chain revenue"
              value={money(data.totals.revenue)}
              hint={`Across ${activeBranches.length} trading branch${activeBranches.length === 1 ? '' : 'es'}`}
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
              hint="Units that left a shelf"
              icon={Package}
            />
            <StatCard
              label="Gross profit"
              value={money(data.totals.profit)}
              hint={
                data.totals.revenue > 0
                  ? `${marginPercent(data.totals.revenue, data.totals.profit).toFixed(1)}% margin`
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
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
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
          </div>

          {dailyLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : daily ? (
            daily.summary.sales === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No completed sales on {daily.date}
                {daily.branchId ? ' at this branch' : ' across the business'}. Pick another
                day to see what moved.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Revenue that day"
                    value={money(daily.summary.revenue)}
                    hint={`${daily.summary.sales} sale${daily.summary.sales === 1 ? '' : 's'} · ${money(daily.summary.averageSaleValue)} average`}
                    icon={TrendingUp}
                  />
                  <StatCard
                    label="Items sold"
                    value={daily.summary.items.toLocaleString()}
                    hint={`${daily.summary.distinctProducts} distinct product${daily.summary.distinctProducts === 1 ? '' : 's'}`}
                    icon={Package}
                  />
                  <StatCard
                    label="Gross profit"
                    value={money(daily.summary.profit)}
                    hint={`${marginPercent(daily.summary.revenue, daily.summary.profit).toFixed(1)}% margin`}
                    icon={TrendingUp}
                  />
                  <StatCard
                    label="Branches trading"
                    value={String(daily.byBranch.length)}
                    hint="Shops that recorded a sale that day"
                    icon={Building2}
                  />
                </div>

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
                            {money(b.revenue)} · {b.items} item{b.items === 1 ? '' : 's'} ·{' '}
                            {b.sales} sale{b.sales === 1 ? '' : 's'}
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
                              sold across {item.sales} sale{item.sales === 1 ? '' : 's'}
                            </div>
                          </TableCell>
                          <TableCell className="text-center tabular-nums font-medium">
                            {item.quantity} {item.unit}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(item.revenue)}
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
              </>
            )
          ) : null}
        </CardContent>
      </Card>
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
          {money(branch.revenue)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {(branch.revenueShare * 100).toFixed(1)}%
        </TableCell>
        <TableCell className="text-right tabular-nums">{branch.sales}</TableCell>
        <TableCell className="text-right tabular-nums">{branch.items}</TableCell>
        <TableCell className="text-right tabular-nums">{money(branch.profit)}</TableCell>
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
                            {money(cashier.revenue)}
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
                            {product.quantity} {product.unit}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(product.revenue)}
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
