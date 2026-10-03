'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/currency';
import {
  DollarSign,
  TrendingUp,
  Calendar,
  Wallet,
  PiggyBank,
  Package,
  Pill,
  AlertTriangle,
  Clock,
  CalendarX,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import type { DashboardStats, ChartDataPoint } from '@/types';

interface RecentSale {
  id: string;
  invoiceNo: string;
  customerName?: string;
  totalAmount: number;
  paymentMethod: string;
  createdAt: string;
  userName?: string;
  /** Null only in the consolidated view, where the sale is from every branch. */
  branchName?: string | null;
  branchCode?: string | null;
}

interface RecentPurchase {
  id: string;
  invoiceNo: string;
  supplierName?: string;
  totalAmount: number;
  createdAt: string;
}

interface StockAlert {
  key: string;
  productId: string;
  productName: string;
  quantity: number;
  reorderLevel?: number;
  type: 'low' | 'out' | 'expiring' | 'expired';
  expiryDate?: string;
}

interface AuditLogEntry {
  id: string;
  userName?: string;
  action: string;
  entity: string;
  details?: string;
  createdAt: string;
}

export default function AdminDashboard() {
  const navigate = useAppStore((s) => s.navigate);
// The branch column is only useful when the list can span branches. With one
// branch selected every row would repeat the same shop name, which is noise
// that pushes the amount and cashier columns off a phone screen.
const showBranch = !useAppStore((s) => s.activeBranch);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<{
    dailySales: ChartDataPoint[];
    monthlyRevenue: ChartDataPoint[];
    topSelling: ChartDataPoint[];
    profitTrend: ChartDataPoint[];
  } | null>(null);
  const [recentData, setRecentData] = useState<{
    recentSales: RecentSale[];
    recentPurchases: RecentPurchase[];
    stockAlerts: StockAlert[];
    auditLogs: AuditLogEntry[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [statsRes, chartsRes, recentRes, auditRes] = await Promise.allSettled([
          fetch('/api/dashboard/stats'),
          fetch('/api/dashboard/charts'),
          fetch('/api/dashboard/recent'),
          fetch('/api/audit-logs'),
        ]);

        if (cancelled) return;

        if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
          const data = await statsRes.value.json();
          setStats(data);
        }
        if (chartsRes.status === 'fulfilled' && chartsRes.value.ok) {
          const data = await chartsRes.value.json();
          setChartData(data);
        }
        if (recentRes.status === 'fulfilled' && recentRes.value.ok) {
          const data = await recentRes.value.json();
          setRecentData({
            recentSales: (data.recentSales ?? []).map((s: any) => ({
              id: s.id,
              invoiceNo: s.invoiceNo,
              customerName: s.customer?.name,
              totalAmount: s.totalAmount,
              paymentMethod: s.paymentMethod,
              createdAt: s.createdAt,
              userName: s.user?.name,
              branchName: s.branch?.name ?? null,
              branchCode: s.branch?.code ?? null,
            })),
            recentPurchases: (data.recentPurchases ?? []).map((p: any) => ({
              id: p.id,
              invoiceNo: p.invoiceNo,
              supplierName: p.supplier?.name,
              totalAmount: p.totalAmount,
              createdAt: p.createdAt,
            })),
            // Alerts arrive structured from the API (key, type, quantity,
            // expiryDate, reorderLevel). They used to be reassembled here by
            // regex-scraping the message text, which silently produced 0s
            // whenever a product name contained a number.
            stockAlerts: (data.stockAlerts ?? []).map((a: any) => ({
              key: a.key ?? `${a.productId}:${a.type}`,
              productId: a.productId,
              productName: a.productName,
              quantity: Number(a.quantity ?? 0),
              reorderLevel: a.reorderLevel === undefined ? undefined : Number(a.reorderLevel),
              type:
                a.type === 'low_stock' ? 'low'
                : a.type === 'out_of_stock' ? 'out'
                : a.type === 'expired' ? 'expired'
                : 'expiring',
              expiryDate: a.expiryDate,
            })),
            auditLogs: [],
          });
        }
        if (auditRes.status === 'fulfilled' && auditRes.value.ok) {
          const auditData = await auditRes.value.json();
          const logs = (auditData.logs ?? []).slice(0, 10);
          setRecentData((prev) =>
            prev
              ? { ...prev, auditLogs: logs.map((log: any) => ({
                  id: log.id,
                  // user is null for an account that was later deleted — the
                  // audit row is deliberately kept.
                  userName: log.user?.name,
                  action: log.action,
                  entity: log.entity ?? '',
                  details: log.details,
                  createdAt: log.createdAt,
                })) }
              : prev,
          );
        }
        setLastRefresh(new Date());
      } catch {
        // Silent fail for dashboard
      } finally {
        setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // The money tiles headline NET and carry the gross figure they were reduced
  // from, because a shop that took 500 and gave 200 back must not read as a shop
  // that took 500. `refunds` is omitted when nothing came back, so a clean day
  // does not wear a permanent "- 0.00" caveat.
  const refundCaveat = (gross: number, refunds: number) => {
    if (!refunds) return undefined;
    return `Gross ${money(gross)} · ${money(refunds)} refunded`;
  };

  const overviewCards = [
    {
      label: "Today's Sales",
      value: stats?.todayNetSales ?? 0,
      note: refundCaveat(stats?.todaySales ?? 0, stats?.todayRefunds ?? 0),
      icon: DollarSign,
      bg: 'bg-emerald-500',
    },
    {
      label: 'Weekly Sales',
      value: stats?.weeklyNetSales ?? 0,
      note: refundCaveat(stats?.weeklySales ?? 0, stats?.weeklyRefunds ?? 0),
      icon: TrendingUp,
      bg: 'bg-teal-500',
    },
    {
      label: 'Monthly Sales',
      value: stats?.monthlyNetSales ?? 0,
      note: refundCaveat(stats?.monthlySales ?? 0, stats?.monthlyRefunds ?? 0),
      icon: Calendar,
      bg: 'bg-green-500',
    },
    {
      label: 'Total Revenue',
      value: stats?.netRevenue ?? 0,
      note: refundCaveat(stats?.totalRevenue ?? 0, stats?.totalRefunds ?? 0),
      icon: Wallet,
      bg: 'bg-emerald-500',
    },
    {
      label: 'Net Profit',
      value: stats?.netProfit ?? 0,
      note: refundCaveat(stats?.grossProfit ?? 0, stats?.refundedProfit ?? 0),
      icon: PiggyBank,
      bg: 'bg-teal-500',
    },
    { label: 'Inventory Value', value: stats?.totalInventoryValue ?? 0, icon: Package, bg: 'bg-green-500' },
    { label: 'Products In Stock', value: stats?.productsInStock ?? 0, icon: Pill, bg: 'bg-emerald-500', isCount: true, navTo: 'products' as const },
    { label: 'Low Stock Alerts', value: stats?.lowStockCount ?? 0, icon: AlertTriangle, bg: 'bg-amber-500', isCount: true, navTo: 'inventory' as const },
    { label: 'Expiring Soon', value: stats?.expiringCount ?? 0, icon: Clock, bg: 'bg-orange-500', isCount: true, navTo: 'inventory' as const },
    { label: 'Expired Batches', value: stats?.expiredCount ?? 0, icon: CalendarX, bg: 'bg-red-500', isCount: true, navTo: 'inventory' as const },
  ];

  const dailySalesConfig = { sales: { label: 'Sales', color: '#10b981' } };
  const monthlyRevenueConfig = { revenue: { label: 'Revenue', color: '#14b8a6' } };
  const topSellingConfig = { amount: { label: 'Sales', color: '#22c55e' } };
  const profitTrendConfig = { profit: { label: 'Profit', color: '#10b981' }, revenue: { label: 'Revenue', color: '#94a3b8' } };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-8 rounded-lg" />
                </div>
                <Skeleton className="mt-3 h-8 w-32" />
                <Skeleton className="mt-2 h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Live-refresh banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/70 backdrop-blur px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-semibold text-emerald-600">LIVE</span>
          <span className="text-xs text-muted-foreground">Auto-refreshing every 30s</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
        </span>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {overviewCards.map((card) => {
          const Icon = card.icon;
          const displayValue = card.isCount ? card.value.toLocaleString() : money(card.value);
          return (
            <Card
              key={card.label}
              className={`hover:shadow-md transition-shadow ${card.navTo ? 'cursor-pointer' : ''}`}
              {...(card.navTo ? { onClick: () => { navigate(card.navTo!); toast.success(`Navigating to ${card.label}`); } } : {})}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                  <div className={`${card.bg} p-2 rounded-lg`}>
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold">{displayValue}</p>
                {/* Present only when money actually came back — the tile explains
                    its own number instead of asking the reader to remember the
                    difference between two definitions of "sales". */}
                {'note' in card && card.note ? (
                  <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Sales Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Sales (Last 14 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <ChartContainer config={dailySalesConfig} className="h-64 min-w-[350px]">
                <BarChart data={chartData?.dailySales ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} minTickGap={10} tickMargin={8} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickMargin={8} width={45} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="var(--color-sales)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Revenue Area Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <ChartContainer config={monthlyRevenueConfig} className="h-64 min-w-[350px]">
                <AreaChart data={chartData?.monthlyRevenue ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} minTickGap={10} tickMargin={8} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickMargin={8} width={45} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke="var(--color-revenue)" fill="url(#revenueGrad)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Selling Medicines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Selling Medicines</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <ChartContainer config={topSellingConfig} className="h-64 min-w-[350px]">
                <BarChart data={chartData?.topSelling ?? []} layout="vertical" margin={{ top: 10, right: 20, left: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" fontSize={12} tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={100} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="var(--color-amount)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        {/* Profit Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profit Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <ChartContainer config={profitTrendConfig} className="h-64 min-w-[350px]">
                <LineChart data={chartData?.profitTrend ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} minTickGap={10} tickMargin={8} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickMargin={8} width={45} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="value" stroke="var(--color-profit)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="value2" stroke="var(--color-revenue)" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                </LineChart>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monitoring Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Sales */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice#</TableHead>
                    {/* Only meaningful on the consolidated view: when a single
                        branch is selected every row says the same thing, so the
                        column is hidden rather than repeated nine times. */}
                    {showBranch ? <TableHead>Branch</TableHead> : null}
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Cashier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentData?.recentSales && recentData.recentSales.length > 0 ? (
                    recentData.recentSales.map((sale) => (
                      <TableRow
                        key={sale.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={(e) => { e.stopPropagation(); navigate('sales-history'); toast.success(`Viewing sale details for ${sale.invoiceNo}`); }}
                      >
                        <TableCell className="font-mono text-xs">{sale.invoiceNo}</TableCell>
                        {showBranch ? (
                          <TableCell className="text-xs">
                            {sale.branchName ? (
                              <span className="flex items-center gap-1.5">
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {sale.branchCode}
                                </Badge>
                                <span className="truncate">{sale.branchName}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        ) : null}
                        <TableCell>{sale.customerName ?? 'Walk-in'}</TableCell>
                        <TableCell className="text-right">{money(sale.totalAmount)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{sale.paymentMethod}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(sale.createdAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="text-xs">{sale.userName ?? '-'}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No recent sales
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Recent Purchases */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Purchases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice#</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentData?.recentPurchases && recentData.recentPurchases.length > 0 ? (
                    recentData.recentPurchases.map((purchase) => (
                      <TableRow
                        key={purchase.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={(e) => { e.stopPropagation(); navigate('products'); }}
                      >
                        <TableCell className="font-mono text-xs">{purchase.invoiceNo}</TableCell>
                        <TableCell>{purchase.supplierName ?? '-'}</TableCell>
                        <TableCell className="text-right">{money(purchase.totalAmount)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(purchase.createdAt).toLocaleDateString('en-GH')}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No recent purchases
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Stock Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-y-auto space-y-2">
              {recentData?.stockAlerts && recentData.stockAlerts.length > 0 ? (
                recentData.stockAlerts.map((alert) => (
                  <div
                    key={alert.key}
                    className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                    onClick={() => { navigate('inventory'); toast.success(`Viewing inventory for ${alert.productName}`); }}
                  >
                    <div>
                      <p className="font-medium text-sm">{alert.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {alert.type === 'expiring' || alert.type === 'expired'
                          ? `Qty: ${alert.quantity} / Exp: ${alert.expiryDate ? new Date(alert.expiryDate).toLocaleDateString('en-GH') : '-'}`
                          : alert.type === 'out'
                            ? 'Out of stock'
                            : `Qty: ${alert.quantity} / Reorder at: ${alert.reorderLevel ?? 0}`
                        }
                      </p>
                    </div>
                    <Badge
                      variant={alert.type === 'low' ? 'default' : 'destructive'}
                      className={
                        alert.type === 'low' ? 'bg-amber-500 hover:bg-amber-600' : ''
                      }
                    >
                      {alert.type === 'low' ? 'Low Stock'
                        : alert.type === 'out' ? 'Out of Stock'
                        : alert.type === 'expired' ? 'Expired'
                        : 'Expiring'}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="text-center text-muted-foreground py-8">No stock alerts</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* User Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">User Activity</CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate('audit-logs')}>
              View All
            </Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentData?.auditLogs && recentData.auditLogs.length > 0 ? (
                    recentData.auditLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString('en-GH')}
                        </TableCell>
                        <TableCell className="text-sm">{log.userName ?? '-'}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              log.action === 'LOGIN' ? 'border-blue-300 text-blue-700 bg-blue-50' :
                              log.action === 'SALE' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                              log.action === 'STOCK' ? 'border-amber-300 text-amber-700 bg-amber-50' :
                              'border-gray-300 text-gray-700 bg-gray-50'
                            }
                          >
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{log.details ?? '-'}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No recent activity
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
