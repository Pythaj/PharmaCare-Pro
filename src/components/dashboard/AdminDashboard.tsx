'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  ArrowUpRight,
  ArrowDownRight,
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
        const [statsRes, chartsRes, recentRes] = await Promise.allSettled([
          fetch('/api/dashboard/stats'),
          fetch('/api/dashboard/charts'),
          fetch('/api/dashboard/recent'),
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
            stockAlerts: (data.stockAlerts ?? []).map((a: any) => ({
              productId: a.productId,
              productName: a.productName,
              currentQty: a.message.match(/(\d+)\s*units/)?.[1] ? parseInt(a.message.match(/(\d+)\s*units/)[1]) : 0,
              reorderLevel: 0,
              type: a.type === 'low_stock' ? 'low' as const : 'expiring' as const,
            })),
            auditLogs: [],
          });
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
    { label: "Today's Sales", value: stats?.todaySales ?? 0, icon: DollarSign, bg: 'bg-emerald-500', change: 12.5 },
    { label: 'Weekly Sales', value: stats?.weeklySales ?? 0, icon: TrendingUp, bg: 'bg-teal-500', change: 8.3 },
    { label: 'Monthly Sales', value: stats?.monthlySales ?? 0, icon: Calendar, bg: 'bg-green-500', change: -2.1 },
    { label: 'Total Revenue', value: stats?.totalRevenue ?? 0, icon: Wallet, bg: 'bg-emerald-500', change: 15.7 },
    { label: 'Total Profit', value: stats?.totalProfit ?? 0, icon: PiggyBank, bg: 'bg-teal-500', change: 9.2 },
    { label: 'Inventory Value', value: stats?.totalInventoryValue ?? 0, icon: Package, bg: 'bg-green-500', change: 3.4 },
    { label: 'Products In Stock', value: stats?.productsInStock ?? 0, icon: Pill, bg: 'bg-emerald-500', change: 1.2, isCount: true },
    { label: 'Low Stock Alerts', value: stats?.lowStockCount ?? 0, icon: AlertTriangle, bg: 'bg-amber-500', change: -5.0, isCount: true, invertChange: true },
    { label: 'Expiry Alerts', value: stats?.expiringCount ?? 0, icon: Clock, bg: 'bg-red-500', change: 10.0, isCount: true, invertChange: true },
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
          const isPositive = card.invertChange ? card.change < 0 : card.change > 0;
          return (
            <Card key={card.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                  <div className={`${card.bg} p-2 rounded-lg`}>
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold">{displayValue}</p>
                <div className="flex items-center mt-1 text-xs">
                  {isPositive ? (
                    <ArrowUpRight className="h-3 w-3 text-emerald-500 mr-1" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 text-red-500 mr-1" />
                  )}
                  <span className={isPositive ? 'text-emerald-600' : 'text-red-600'}>
                    {Math.abs(card.change)}%
                  </span>
                  <span className="text-muted-foreground ml-1">from last period</span>
                </div>
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
            <ChartContainer config={dailySalesConfig} className="h-64">
              <BarChart data={chartData?.dailySales ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--color-sales)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Monthly Revenue Area Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={monthlyRevenueConfig} className="h-64">
              <AreaChart data={chartData?.monthlyRevenue ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
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
          </CardContent>
        </Card>

        {/* Top Selling Medicines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Selling Medicines</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={topSellingConfig} className="h-64">
              <BarChart data={chartData?.topSelling ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={120} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--color-amount)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Profit Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profit Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={profitTrendConfig} className="h-64">
              <LineChart data={chartData?.profitTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="value" stroke="var(--color-profit)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="value2" stroke="var(--color-revenue)" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
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
                      <TableRow key={sale.id}>
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
                      <TableRow key={purchase.id}>
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
                  <div key={alert.productId} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="font-medium text-sm">{alert.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        Qty: {alert.currentQty} / Reorder: {alert.reorderLevel}
                        {alert.expiryDate && ` / Exp: ${new Date(alert.expiryDate).toLocaleDateString('en-GH')}`}
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
          <CardHeader>
            <CardTitle className="text-base">User Activity</CardTitle>
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