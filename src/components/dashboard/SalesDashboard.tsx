'use client';

import { useEffect, useState } from 'react';
import {
  ShoppingCart,
  Truck,
  Search,
  Users,
  DollarSign,
  Receipt,
  Pill,
  PackageCheck,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAppStore } from '@/stores/app-store';
import type { DashboardStats } from '@/types';

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
  items?: { productName?: string; quantity: number; unitPrice: number }[];
}

export default function SalesDashboard() {
  const { navigate, currentUser } = useAppStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/dashboard/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch { /* silent */ }

      try {
        const res = await fetch('/api/dashboard/recent');
        if (res.ok) {
          const data = await res.json();
          setRecentSales(data.sales ?? []);
        }
      } catch { /* silent */ }

      setLoading(false);
    }
    fetchData();
  }, []);

  const quickActions = [
    { label: 'New Sale', icon: ShoppingCart, page: 'pos' as const, color: 'bg-emerald-500 hover:bg-emerald-600' },
    { label: 'New Purchase Entry', icon: Truck, page: 'purchases' as const, color: 'bg-teal-500 hover:bg-teal-600' },
    { label: 'Product Search', icon: Search, page: 'products' as const, color: 'bg-green-500 hover:bg-green-600' },
    { label: 'Customer Search', icon: Users, page: 'customers' as const, color: 'bg-emerald-600 hover:bg-emerald-700' },
  ];

  const statCards = [
    { label: "Today's Sales", value: stats?.todaySales ?? 0, icon: DollarSign, format: 'currency' },
    { label: 'Transactions', value: stats?.todayTransactions ?? 0, icon: Receipt, format: 'count' },
    { label: 'Products Sold Today', value: stats?.productsSoldToday ?? 0, icon: Pill, format: 'count' },
    { label: 'Stock Received Today', value: stats?.stockReceivedToday ?? 0, icon: PackageCheck, format: 'count' },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome, {currentUser?.name ?? 'Sales Person'}</h2>
        <p className="text-muted-foreground">Here&apos;s your sales overview for today</p>
      </div>

      {/* Quick Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-8 rounded-lg" />
                </div>
                <Skeleton className="mt-3 h-8 w-32" />
              </CardContent>
            </Card>
          ))
        ) : (
          statCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                    <div className="bg-emerald-100 p-2 rounded-lg">
                      <Icon className="h-5 w-5 text-emerald-600" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-bold">
                    {card.format === 'currency' ? formatGHS(card.value) : card.value.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.label}
                className={`${action.color} h-24 flex-col gap-2 text-white rounded-xl text-base font-medium shadow-md`}
                onClick={() => navigate(action.page)}
              >
                <Icon className="h-8 w-8" />
                {action.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* My Recent Sales */}
      <Card>
        <div className="p-6 pb-0">
          <h3 className="text-lg font-semibold">My Recent Sales</h3>
        </div>
        <CardContent className="p-6 pt-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSales.length > 0 ? (
                    recentSales.map((sale) => (
                      <TableRow key={sale.id}>
                        <TableCell className="font-mono text-xs">{sale.invoiceNo}</TableCell>
                        <TableCell>{sale.customerName ?? 'Walk-in'}</TableCell>
                        <TableCell className="text-right font-medium">{formatGHS(sale.totalAmount)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{sale.paymentMethod}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(sale.createdAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No sales yet today. Start by making a new sale!
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}