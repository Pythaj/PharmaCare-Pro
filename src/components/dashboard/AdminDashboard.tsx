'use client';

import { useEffect, useState } from 'react';
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
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart.tsx';
import { BarChart, Bar, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import type { DashboardStats, ChartDataPoint } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface RecentSale {
  id: string;
  invoiceNo: string;
  customerName?: string;
  totalAmount: number;
  paymentMethod: string;
  createdAt: string;
  userName?: string;
}

interface RecentPurchase {
  id: string;
  invoiceNo: string;
  supplierName?: string;
  totalAmount: number;
  createdAt: string;
}

interface StockAlert {
  productId: string;
  productName: string;
  currentQty: number;
  reorderLevel: number;
  type: 'low' | 'expiring';
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

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, chartsRes, recentRes, auditRes] = await Promise.allSettled([
          fetch('/api/dashboard/stats'),
          fetch('/api/dashboard/charts'),
          fetch('/api/dashboard/recent'),
          fetch('/api/audit-logs'),
        ]);

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
            })),
            recentPurchases: (data.recentPurchases ?? []).map((p: any) => ({
              id: p.id,
              invoiceNo: p.invoiceNo,
              supplierName: p.supplier?.name,
              totalAmount: p.totalAmount,
              createdAt: p.createdAt,
            })),
            stockAlerts: (data.stockAlerts ?? []).map((a: any) => {
              let currentQty = 0;
              let reorderLevel = 0;
              let expiryDate: string | undefined;

              if (a.type === 'low_stock') {
                const qtyMatch = a.message.match(/has only (\d+) units/);
                const reorderMatch = a.message.match(/reorder level: (\d+)/);
                currentQty = qtyMatch ? parseInt(qtyMatch[1]) : 0;
                reorderLevel = reorderMatch ? parseInt(reorderMatch[1]) : 0;
              } else if (a.type === 'expiring') {
                const qtyMatch = a.message.match(/\((\d+) units\)/);
                const daysMatch = a.message.match(/expires in (\d+) days/);
                currentQty = qtyMatch ? parseInt(qtyMatch[1]) : 0;
                if (daysMatch) {
                  const days = parseInt(daysMatch[1]);
                  expiryDate = new Date(Date.now() + days * 86400000).toISOString();
                }
              }

              return {
                productId: a.productId,
                productName: a.productName,
                currentQty,
                reorderLevel,
                type: (a.type === 'low_stock' ? 'low' : 'expiring') as 'low' | 'expiring',
                expiryDate,
              };
            }),
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
                  userName: log.user?.name,
                  action: log.action,
                  entity: '',
                  details: log.details,
                  createdAt: log.createdAt,
                })) }
              : prev,
          );
        }
      } catch {
        // Silent fail for dashboard
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const overviewCards = [
    { label: "Today's Sales", value: stats?.todaySales ?? 0, icon: DollarSign, bg: 'bg-emerald-500' },
    { label: 'Weekly Sales', value: stats?.weeklySales ?? 0, icon: TrendingUp, bg: 'bg-teal-500' },
    { label: 'Monthly Sales', value: stats?.monthlySales ?? 0, icon: Calendar, bg: 'bg-green-500' },
    { label: 'Total Revenue', value: stats?.totalRevenue ?? 0, icon: Wallet, bg: 'bg-emerald-500' },
    { label: 'Total Profit', value: stats?.totalProfit ?? 0, icon: PiggyBank, bg: 'bg-teal-500' },
    { label: 'Inventory Value', value: stats?.totalInventoryValue ?? 0, icon: Package, bg: 'bg-green-500' },
    { label: 'Products In Stock', value: stats?.productsInStock ?? 0, icon: Pill, bg: 'bg-emerald-500', isCount: true, navTo: 'products' as const },
    { label: 'Low Stock Alerts', value: stats?.lowStockCount ?? 0, icon: AlertTriangle, bg: 'bg-amber-500', isCount: true, navTo: 'inventory' as const },
    { label: 'Expiry Alerts', value: stats?.expiringCount ?? 0, icon: Clock, bg: 'bg-red-500', isCount: true, navTo: 'inventory' as const },
  ];

  const dailySalesConfig = { sales: { label: 'Sales', color: '#10b981' } };
  const monthlyRevenueConfig = { revenue: { label: 'Revenue', color: '#14b8a6' } };
  const topSellingConfig = { amount: { label: 'Sales', color: '#22c55e' } };
  const profitTrendConfig = { profit: { label: 'Profit', color: '#10b981' }, revenue: { label: 'Revenue', color: '#94a3b8' } };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
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
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {overviewCards.map((card) => {
          const Icon = card.icon;
          const displayValue = card.isCount ? card.value.toLocaleString() : formatGHS(card.value);
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
                        <TableCell>{sale.customerName ?? 'Walk-in'}</TableCell>
                        <TableCell className="text-right">{formatGHS(sale.totalAmount)}</TableCell>
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
                        <TableCell className="text-right">{formatGHS(purchase.totalAmount)}</TableCell>
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
                    key={alert.productId}
                    className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                    onClick={() => { navigate('inventory'); toast.success(`Viewing inventory for ${alert.productName}`); }}
                  >
                    <div>
                      <p className="font-medium text-sm">{alert.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {alert.type === 'low'
                          ? `Qty: ${alert.currentQty} / Reorder at: ${alert.reorderLevel}`
                          : alert.expiryDate
                            ? `Qty: ${alert.currentQty} / Exp: ${new Date(alert.expiryDate).toLocaleDateString('en-GH')}`
                            : `Qty: ${alert.currentQty}`
                        }
                      </p>
                    </div>
                    <Badge variant={alert.type === 'low' ? 'default' : 'destructive'} className={
                      alert.type === 'low' ? 'bg-amber-500 hover:bg-amber-600' : ''
                    }>
                      {alert.type === 'low' ? 'Low Stock' : 'Expiring'}
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