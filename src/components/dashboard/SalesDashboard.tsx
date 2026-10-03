'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/currency';
import {
  ShoppingCart,
  Search,
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

interface RecentSale {
  id: string;
  invoiceNo: string;
  customer?: { name?: string | null } | null;
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
  // A failed load used to be indistinguishable from an empty one: the `if
  // (res.ok)` had no `else`, so a 500 — or a 403 from a session that had just
  // expired — left `stats` null and the tiles rendered their zero defaults. For
  // someone checking their own takings, "GHS 0.00 taken today" is worse than an
  // error message: it reads as a fact about their work rather than a broken
  // request. Tracked separately from `loading` so a partial failure (recent sales
  // loaded, stats did not) can say which half is missing.
  const [statsError, setStatsError] = useState<string | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setStatsError(null);
      setRecentError(null);
      setLoading(true);

      // Pulled out so a failure can name itself. The API's `error` field is the
      // useful one ("No active branches exist to seed the catalogue against" and
      // the like); the status alone tells the user nothing they can act on.
      async function readError(res: Response, fallback: string): Promise<string> {
        try {
          const body = await res.json();
          return typeof body?.error === 'string' && body.error ? body.error : fallback;
        } catch {
          return fallback;
        }
      }

      try {
        const res = await fetch('/api/dashboard/stats');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setStats(data);
        } else if (!cancelled) {
          setStats(null);
          setStatsError(await readError(res, `Could not load your figures (HTTP ${res.status})`));
        }
      } catch (e) {
        if (!cancelled) {
          setStats(null);
          setStatsError(e instanceof Error && e.message ? e.message : 'Could not reach the server');
        }
      }

      try {
        const res = await fetch('/api/dashboard/recent');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setRecentSales((data.recentSales ?? []).map((s: any) => ({
              id: s.id,
              invoiceNo: s.invoiceNo,
              customerName: s.customer?.name,
              totalAmount: s.totalAmount,
              paymentMethod: s.paymentMethod,
              createdAt: s.createdAt,
            })));
          }
        } else if (!cancelled) {
          setRecentSales([]);
          setRecentError(await readError(res, `Could not load recent sales (HTTP ${res.status})`));
        }
      } catch (e) {
        if (!cancelled) {
          setRecentSales([]);
          setRecentError(e instanceof Error && e.message ? e.message : 'Could not reach the server');
        }
      }

      if (!cancelled) setLoading(false);
    }
    fetchData();
    return () => { cancelled = true; };
  }, [retryNonce]);

  const quickActions = [
    { label: 'New Sale', icon: ShoppingCart, page: 'pos' as const, color: 'bg-emerald-500 hover:bg-emerald-600' },
    { label: 'View Products', icon: Search, page: 'products' as const, color: 'bg-green-500 hover:bg-green-600' },

  ];

  // A cashier's own till, so this is the screen where a refund is felt most
  // directly: it headlines what they actually took home after returns, and names
  // any refund processed against their sales rather than quietly shrinking the
  // number and leaving them to wonder why it disagrees with their own count.
  const todayRefunds = stats?.todayRefunds ?? 0;
  const statCards = [
    {
      label: "Today's Sales",
      value: stats?.todayNetSales ?? 0,
      icon: DollarSign,
      format: 'currency',
      note:
        todayRefunds > 0
          ? `Gross ${money(stats?.todaySales ?? 0)} · ${money(todayRefunds)} refunded`
          : undefined,
    },
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

      {/* A failed load says so, and says which part failed. Silently showing
          zeros here is indistinguishable from a genuinely empty day, which is the
          one thing this screen must never do. */}
      {(statsError || recentError) && (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <div className="space-y-1">
            <p className="font-semibold">
              {statsError && recentError
                ? 'Your figures and recent sales could not be loaded.'
                : statsError
                  ? 'Your figures could not be loaded.'
                  : 'Recent sales could not be loaded.'}
            </p>
            {/* The tiles still show their zero defaults, so this has to say that
                the numbers below are not real rather than only naming the fault. */}
            <p className="text-amber-800 dark:text-amber-300">
              {statsError
                ? 'The amounts below are placeholders, not your real takings.'
                : 'The list below is empty because it could not be loaded.'}
            </p>
            <ul className="list-disc pl-5 text-xs space-y-0.5">
              {statsError && <li>{statsError}</li>}
              {recentError && <li>{recentError}</li>}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium hover:bg-amber-100 dark:bg-transparent dark:hover:bg-amber-900/50"
          >
            Try again
          </button>
        </div>
      )}

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
                    {card.format === 'currency' ? money(card.value) : card.value.toLocaleString()}
                  </p>
                  {'note' in card && card.note ? (
                    <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
                        <TableCell className="text-right font-medium">{money(sale.totalAmount)}</TableCell>
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
