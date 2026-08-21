'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  BarChart3,
  Download,
  Package,
  ArrowUpRight,
  CalendarDays,
  Trophy,
  Users,
  FileSpreadsheet,
  Receipt,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart.tsx';
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, Legend
} from 'recharts';
import type { ChartDataPoint } from '@/types';
import { toast } from 'sonner';

// ─── Helpers ────────────────────────────────────────────────────────

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ─── Types ──────────────────────────────────────────────────────────

type Period = 'today' | 'this_week' | 'this_month' | 'this_year' | 'custom';

const COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#6b7280', '#8b5cf6', '#ec4899'];

interface ReportStats {
  totalRevenue: number;
  totalProfit: number;
  totalSales: number;
  totalItemsSold: number;
  avgSaleValue: number;
  bestProduct: { name: string; quantity: number; revenue: number } | null;
}

interface DailyRow {
  date: string;
  sales: number;
  revenue: number;
  profit: number;
  items: number;
}

interface CashierRow {
  userId: string;
  name: string;
  sales: number;
  revenue: number;
  profit: number;
}

interface MonthlyRow {
  month: string;
  monthIndex: number;
  year: number;
  revenue: number;
  profit: number;
  sales: number;
  items: number;
}

// ─── Component ──────────────────────────────────────────────────────

export default function ReportsView() {
  const appName = useAppStore((s) => s.appName);
  const [period, setPeriod] = useState<Period>('this_month');
  const [fromDate, setFromDate] = useState(monthStartStr());
  const [toDate, setToDate] = useState(todayStr());

  const [stats, setStats] = useState<ReportStats | null>(null);
  const [revenueData, setRevenueData] = useState<ChartDataPoint[]>([]);
  const [paymentData, setPaymentData] = useState<ChartDataPoint[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; quantity: number; revenue: number }[]>([]);
  const [dailyBreakdown, setDailyBreakdown] = useState<DailyRow[]>([]);
  const [cashierPerformance, setCashierPerformance] = useState<CashierRow[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const periods: { label: string; value: Period }[] = [
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'this_week' },
    { label: 'This Month', value: 'this_month' },
    { label: 'This Year', value: 'this_year' },
    { label: 'Custom', value: 'custom' },
  ];

  const periodLabel =
    period === 'custom'
      ? `${fromDate} → ${toDate}`
      : periods.find((p) => p.value === period)?.label ?? period;

  const showMonthly = monthlySummary.length > 0;

  // ─── Fetch ─────────────────────────────────────────────────────
  const initializedRef = useRef(false);
  const prevParamsRef = useRef(`${period}|${fromDate}|${toDate}`);

  useEffect(() => {
    const params = `${period}|${fromDate}|${toDate}`;
    let shouldRun = false;

    if (!initializedRef.current) {
      initializedRef.current = true;
      prevParamsRef.current = params;
      shouldRun = true;
    } else if (params !== prevParamsRef.current) {
      prevParamsRef.current = params;
      shouldRun = true;
    }

    if (!shouldRun) return;

    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      let url = '/api/reports?';
      if (period === 'custom') {
        if (!fromDate || !toDate) {
          toast.error('Please select both from and to dates.');
          return;
        }
        url += `from=${fromDate}&to=${toDate}`;
      } else {
        url += `period=${period}`;
      }

      await new Promise<void>((resolve) => resolve());
      if (cancelled) return;

      setLoading(true);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setStats(data.stats ?? null);
          setRevenueData(data.revenueData ?? []);
          setPaymentData(data.paymentData ?? []);
          setTopProducts(data.topProducts ?? []);
          setDailyBreakdown(data.dailyBreakdown ?? []);
          setCashierPerformance(data.cashierPerformance ?? []);
          setMonthlySummary(data.monthlySummary ?? []);
        }
      } catch {
        if (!cancelled) toast.error('Failed to load report data.');
      }
      if (!cancelled) setLoading(false);
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [period, fromDate, toDate]);

  const handleApplyCustom = () => {
    if (!fromDate || !toDate) {
      toast.error('Please select both from and to dates.');
      return;
    }
    prevParamsRef.current = `${period}|${fromDate}|${toDate}`;
    // Directly invoke the async load (not from an effect)
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports?from=${fromDate}&to=${toDate}`);
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats ?? null);
          setRevenueData(data.revenueData ?? []);
          setPaymentData(data.paymentData ?? []);
          setTopProducts(data.topProducts ?? []);
          setDailyBreakdown(data.dailyBreakdown ?? []);
          setCashierPerformance(data.cashierPerformance ?? []);
          setMonthlySummary(data.monthlySummary ?? []);
        }
      } catch {
        toast.error('Failed to load report data.');
      }
      setLoading(false);
    })();
  };

  // ─── Computed ───────────────────────────────────────────────────
  const highestRevenueDay = dailyBreakdown.length > 0
    ? dailyBreakdown.reduce((max, d) => (d.revenue > max.revenue ? d : max), dailyBreakdown[0])
    : null;

  const topCashier = cashierPerformance.length > 0 ? cashierPerformance[0] : null;

  const bestMonth = monthlySummary.length > 0
    ? monthlySummary.reduce((max, m) => (m.revenue > max.revenue ? m : max), monthlySummary[0])
    : null;

  const maxMonthRevenue = monthlySummary.length > 0
    ? Math.max(...monthlySummary.map((m) => m.revenue))
    : 1;

  const dailyTotals = dailyBreakdown.reduce(
    (acc, d) => ({
      sales: acc.sales + d.sales,
      revenue: acc.revenue + d.revenue,
      profit: acc.profit + d.profit,
      items: acc.items + d.items,
    }),
    { sales: 0, revenue: 0, profit: 0, items: 0 },
  );

  const profitMargin =
    stats && stats.totalRevenue > 0
      ? ((stats.totalProfit / stats.totalRevenue) * 100).toFixed(1)
      : '0.0';

  // ─── Export Helpers ─────────────────────────────────────────────
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const buildCSVContent = (): string => {
    const s = stats ?? {
      totalRevenue: 0, totalProfit: 0, totalSales: 0, totalItemsSold: 0, avgSaleValue: 0, bestProduct: null,
    };
    const lines: string[] = [];
    lines.push(`${appName} - Sales Analytics Report`);
    lines.push(`Period,${periodLabel}`);
    lines.push(`Generated,${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('--- Summary ---');
    lines.push(`Total Revenue,${s.totalRevenue.toFixed(2)}`);
    lines.push(`Total Profit,${s.totalProfit.toFixed(2)}`);
    lines.push(`Profit Margin %,${profitMargin}`);
    lines.push(`Total Transactions,${s.totalSales}`);
    lines.push(`Total Items Sold,${s.totalItemsSold}`);
    lines.push(`Avg Transaction Value,${s.avgSaleValue.toFixed(2)}`);
    lines.push(`Best Selling Product,"${s.bestProduct?.name ?? 'N/A'} (${s.bestProduct?.quantity ?? 0} units)"`);
    lines.push('');

    if (dailyBreakdown.length > 0) {
      lines.push('--- Daily Sales Breakdown ---');
      lines.push('Date,Transactions,Revenue (GHS),Profit (GHS),Items Sold,Avg Transaction Value');
      for (const d of dailyBreakdown) {
        const avg = d.sales > 0 ? (d.revenue / d.sales).toFixed(2) : '0.00';
        lines.push(`${d.date},${d.sales},${d.revenue.toFixed(2)},${d.profit.toFixed(2)},${d.items},${avg}`);
      }
      lines.push('');
    }

    if (cashierPerformance.length > 0) {
      lines.push('--- Staff Performance ---');
      lines.push('Staff Name,Transactions,Revenue (GHS),Profit (GHS),Avg Sale Value');
      for (const c of cashierPerformance) {
        const avg = c.sales > 0 ? (c.revenue / c.sales).toFixed(2) : '0.00';
        lines.push(`"${c.name}",${c.sales},${c.revenue.toFixed(2)},${c.profit.toFixed(2)},${avg}`);
      }
      lines.push('');
    }

    if (revenueData.length > 0) {
      lines.push('--- Revenue by Period ---');
      lines.push('Period,Revenue');
      for (const d of revenueData) {
        lines.push(`${d.name},${d.value.toFixed(2)}`);
      }
      lines.push('');
    }

    if (paymentData.length > 0) {
      lines.push('--- Sales by Payment Method ---');
      lines.push('Payment Method,Amount');
      for (const d of paymentData) {
        lines.push(`${d.name},${d.value.toFixed(2)}`);
      }
      lines.push('');
    }

    if (topProducts.length > 0) {
      lines.push('--- Top Selling Products ---');
      lines.push('Rank,Product Name,Quantity Sold,Revenue');
      topProducts.forEach((p, i) => {
        lines.push(`${i + 1},"${p.name.replace(/"/g, '""')}",${p.quantity},${p.revenue.toFixed(2)}`);
      });
    }

    return lines.join('\n');
  };

  const handleExportCSV = () => {
    const content = buildCSVContent();
    downloadFile(content, `pharmacare-report-${period}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
    toast.success('CSV report downloaded.');
  };

  const handleExportExcel = () => {
    const s = stats ?? {
      totalRevenue: 0, totalProfit: 0, totalSales: 0, totalItemsSold: 0, avgSaleValue: 0, bestProduct: null,
    };
    const lines: string[] = [];

    lines.push(`${appName} - Sales Analytics Report`);
    lines.push(`Period:\t${periodLabel}`);
    lines.push(`Generated:\t${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('Summary');
    lines.push('Total Revenue\tTotal Profit\tProfit Margin %\tTransactions\tItems Sold\tAvg Transaction Value\tBest Selling Product');
    lines.push(
      `${s.totalRevenue.toFixed(2)}\t${s.totalProfit.toFixed(2)}\t${profitMargin}%\t${s.totalSales}\t${s.totalItemsSold}\t${s.avgSaleValue.toFixed(2)}\t${s.bestProduct?.name ?? 'N/A'}`
    );
    lines.push('');

    if (dailyBreakdown.length > 0) {
      lines.push('Daily Sales Breakdown');
      lines.push('Date\tTransactions\tRevenue (GHS)\tProfit (GHS)\tItems Sold\tAvg Transaction Value');
      for (const d of dailyBreakdown) {
        const avg = d.sales > 0 ? (d.revenue / d.sales).toFixed(2) : '0.00';
        lines.push(`${d.date}\t${d.sales}\t${d.revenue.toFixed(2)}\t${d.profit.toFixed(2)}\t${d.items}\t${avg}`);
      }
      lines.push('');
    }

    if (cashierPerformance.length > 0) {
      lines.push('Staff Performance');
      lines.push('Staff Name\tTransactions\tRevenue (GHS)\tProfit (GHS)\tAvg Sale Value');
      for (const c of cashierPerformance) {
        const avg = c.sales > 0 ? (c.revenue / c.sales).toFixed(2) : '0.00';
        lines.push(`${c.name}\t${c.sales}\t${c.revenue.toFixed(2)}\t${c.profit.toFixed(2)}\t${avg}`);
      }
      lines.push('');
    }

    if (revenueData.length > 0) {
      lines.push('Revenue by Period');
      lines.push('Period\tRevenue');
      for (const d of revenueData) {
        lines.push(`${d.name}\t${d.value.toFixed(2)}`);
      }
      lines.push('');
    }

    if (paymentData.length > 0) {
      lines.push('Sales by Payment Method');
      lines.push('Payment Method\tAmount');
      for (const d of paymentData) {
        lines.push(`${d.name}\t${d.value.toFixed(2)}`);
      }
      lines.push('');
    }

    if (topProducts.length > 0) {
      lines.push('Top Selling Products');
      lines.push('Rank\tProduct Name\tQuantity Sold\tRevenue');
      topProducts.forEach((p, i) => {
        lines.push(`${i + 1}\t${p.name}\t${p.quantity}\t${p.revenue.toFixed(2)}`);
      });
    }

    downloadFile(lines.join('\n'), `pharmacare-report-${period}-${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel');
    toast.success('Excel report downloaded.');
  };

  const handleExportPDF = () => {
    const s = stats ?? {
      totalRevenue: 0, totalProfit: 0, totalSales: 0, totalItemsSold: 0, avgSaleValue: 0, bestProduct: null,
    };

    const revenueRows = revenueData
      .map((d) => `<tr><td>${d.name}</td><td class="num">${formatGHS(d.value)}</td></tr>`)
      .join('');

    const paymentRows = paymentData
      .map((d) => `<tr><td>${d.name}</td><td class="num">${formatGHS(d.value)}</td></tr>`)
      .join('');

    const productRows = topProducts
      .map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td class="num">${p.quantity}</td><td class="num">${formatGHS(p.revenue)}</td></tr>`)
      .join('');

    const dailyRows = dailyBreakdown
      .map((d) => {
        const avg = d.sales > 0 ? (d.revenue / d.sales).toFixed(2) : '0.00';
        return `<tr><td>${d.date}</td><td class="num">${d.sales}</td><td class="num">${formatGHS(d.revenue)}</td><td class="num">${formatGHS(d.profit)}</td><td class="num">${d.items}</td><td class="num">${formatGHS(Number(avg))}</td></tr>`;
      })
      .join('');

    const cashierRows = cashierPerformance
      .map((c) => {
        const avg = c.sales > 0 ? (c.revenue / c.sales).toFixed(2) : '0.00';
        return `<tr><td>${c.name}</td><td class="num">${c.sales}</td><td class="num">${formatGHS(c.revenue)}</td><td class="num">${formatGHS(c.profit)}</td><td class="num">${formatGHS(Number(avg))}</td></tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{appName} - Sales Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1f2937; padding: 40px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 24px; color: #047857; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 32px; }
  .stat-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; text-align: center; }
  .stat-card .label { font-size: 11px; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 18px; font-weight: 700; color: #111827; }
  .stat-card.profit .value { color: #047857; }
  .stat-card.margin .value { color: #14b8a6; }
  h2 { font-size: 15px; color: #111827; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #10b981; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
  th { background: #f0fdf4; color: #047857; text-align: left; padding: 7px 10px; font-weight: 600; border-bottom: 2px solid #d1fae5; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #f9fafb; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
</style>
</head>
<body>
  <h1>{appName} - Sales Analytics</h1>
  <p class="subtitle">Period: ${periodLabel} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="label">Total Revenue</div>
      <div class="value">${formatGHS(s.totalRevenue)}</div>
    </div>
    <div class="stat-card profit">
      <div class="label">Total Profit</div>
      <div class="value">${formatGHS(s.totalProfit)}</div>
    </div>
    <div class="stat-card margin">
      <div class="label">Profit Margin</div>
      <div class="value">${profitMargin}%</div>
    </div>
    <div class="stat-card">
      <div class="label">Transactions</div>
      <div class="value">${s.totalSales.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Transaction</div>
      <div class="value">${formatGHS(s.avgSaleValue)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Items Sold</div>
      <div class="value">${s.totalItemsSold.toLocaleString()}</div>
    </div>
  </div>

  ${dailyBreakdown.length > 0 ? `
  <h2>Daily Sales Breakdown</h2>
  <table>
    <thead><tr><th>Date</th><th class="num">Txns</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Items</th><th class="num">Avg Txn</th></tr></thead>
    <tbody>${dailyRows}</tbody>
  </table>` : ''}

  ${cashierPerformance.length > 0 ? `
  <h2>Staff Performance</h2>
  <table>
    <thead><tr><th>Staff Name</th><th class="num">Txns</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Avg Sale</th></tr></thead>
    <tbody>${cashierRows}</tbody>
  </table>` : ''}

  ${revenueData.length > 0 ? `
  <h2>Revenue Trend</h2>
  <table>
    <thead><tr><th>Period</th><th class="num">Revenue</th></tr></thead>
    <tbody>${revenueRows}</tbody>
  </table>` : ''}

  ${paymentData.length > 0 ? `
  <h2>Sales by Payment Method</h2>
  <table>
    <thead><tr><th>Payment Method</th><th class="num">Amount</th></tr></thead>
    <tbody>${paymentRows}</tbody>
  </table>` : ''}

  ${topProducts.length > 0 ? `
  <h2>Top Selling Products</h2>
  <table>
    <thead><tr><th>#</th><th>Product Name</th><th class="num">Qty Sold</th><th class="num">Revenue</th></tr></thead>
    <tbody>${productRows}</tbody>
  </table>` : ''}

  <div class="footer">{appName} &mdash; Auto-generated report</div>

  <div class="no-print" style="margin-top:20px;text-align:center;">
    <button onclick="window.print()" style="padding:10px 24px;background:#047857;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Print / Save as PDF</button>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
    toast.success('PDF report opened in new tab.');
  };

  // ─── Chart Configs ──────────────────────────────────────────────
  const revenueConfig = { revenue: { label: 'Revenue', color: '#10b981' } };
  const pieConfig = { value: { label: 'Amount' } };
  const monthBarConfig = {
    revenue: { label: 'Revenue', color: '#10b981' },
    profit: { label: 'Profit', color: '#14b8a6' },
  };

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* ─── Header: Period Selector, Date Range, Export ─── */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          {/* Period Buttons */}
          <div className="flex gap-2 flex-wrap">
            {periods.map((p) => (
              <Button
                key={p.value}
                variant={period === p.value ? 'default' : 'outline'}
                size="sm"
                className={period === p.value ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
                onClick={() => setPeriod(p.value)}
              >
                {p.value === 'custom' && <CalendarDays className="h-3.5 w-3.5 mr-1.5" />}
                {p.label}
              </Button>
            ))}
          </div>

          {/* Custom Date Range */}
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-[160px] h-9 text-sm"
                max={toDate}
              />
              <span className="text-muted-foreground text-sm">→</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-[160px] h-9 text-sm"
                min={fromDate}
              />
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleApplyCustom}>
                Apply
              </Button>
            </div>
          )}
        </div>

        {/* Export Buttons */}
        <div className="flex gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={loading}>
            <Receipt className="h-4 w-4 mr-1.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={loading}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={loading}>
            <Download className="h-4 w-4 mr-1.5" /> CSV
          </Button>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-7 w-28" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            {/* Total Revenue */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-md bg-emerald-100">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">Total Revenue</p>
                </div>
                <p className="text-lg font-bold">{formatGHS(stats?.totalRevenue ?? 0)}</p>
                <div className="flex items-center gap-1 mt-1">
                  <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                  <span className="text-[11px] text-emerald-600 font-medium">Sales</span>
                </div>
              </CardContent>
            </Card>

            {/* Total Profit */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-md bg-teal-100">
                    <TrendingUp className="h-3.5 w-3.5 text-teal-600" />
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">Total Profit</p>
                </div>
                <p className="text-lg font-bold text-teal-600">{formatGHS(stats?.totalProfit ?? 0)}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-teal-600 border-teal-200 bg-teal-50">
                    {profitMargin}% margin
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Total Transactions */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-md bg-green-100">
                    <ShoppingCart className="h-3.5 w-3.5 text-green-600" />
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">Transactions</p>
                </div>
                <p className="text-lg font-bold">{(stats?.totalSales ?? 0).toLocaleString()}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[11px] text-muted-foreground">Completed orders</span>
                </div>
              </CardContent>
            </Card>

            {/* Avg Transaction Value */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-md bg-amber-100">
                    <BarChart3 className="h-3.5 w-3.5 text-amber-600" />
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">Avg Transaction</p>
                </div>
                <p className="text-lg font-bold">{formatGHS(stats?.avgSaleValue ?? 0)}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[11px] text-muted-foreground">Per transaction</span>
                </div>
              </CardContent>
            </Card>

            {/* Items Sold */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-md bg-violet-100">
                    <Package className="h-3.5 w-3.5 text-violet-600" />
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">Items Sold</p>
                </div>
                <p className="text-lg font-bold">{(stats?.totalItemsSold ?? 0).toLocaleString()}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[11px] text-muted-foreground">Units dispensed</span>
                </div>
              </CardContent>
            </Card>

            {/* Best Selling Product */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-md bg-rose-100">
                    <Trophy className="h-3.5 w-3.5 text-rose-600" />
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">Best Seller</p>
                </div>
                <p className="text-sm font-bold truncate" title={stats?.bestProduct?.name ?? 'N/A'}>
                  {stats?.bestProduct?.name ?? 'N/A'}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                  <span className="text-[11px] text-emerald-600 font-medium">
                    {stats?.bestProduct?.quantity ?? 0} units
                  </span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ─── Charts Row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : revenueData.length > 0 ? (
              <div className="overflow-x-auto">
                <ChartContainer config={revenueConfig} className="h-64 min-w-[350px]">
                  <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} minTickGap={10} tickMargin={8} />
                    <YAxis fontSize={11} tickLine={false} axisLine={false} tickMargin={8} width={45} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <defs>
                      <linearGradient id="reportRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="value" stroke="var(--color-revenue)" fill="url(#reportRevenueGrad)" strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No revenue data for this period
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Method Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Sales by Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : paymentData.length > 0 ? (
              <div className="overflow-x-auto">
                <ChartContainer config={pieConfig} className="h-64 min-w-[300px]">
                  <PieChart>
                    <Pie
                      data={paymentData}
                      cx="50%"
                      cy="45%"
                      innerRadius="45%"
                      outerRadius="65%"
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {paymentData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ChartContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No payment data for this period
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Monthly Summary (shown for yearly or long custom ranges) ─── */}
      {showMonthly && !loading && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Monthly Summary</CardTitle>
              <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">
                {monthlySummary.length} months
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {monthlySummary.map((m) => {
                const isBest = bestMonth && m.month === bestMonth.month && m.year === bestMonth.year;
                const barWidth = maxMonthRevenue > 0 ? (m.revenue / maxMonthRevenue) * 100 : 0;
                return (
                  <Card
                    key={`${m.year}-${m.monthIndex}`}
                    className={`p-3 transition-colors ${isBest ? 'ring-2 ring-emerald-500 bg-emerald-50' : ''}`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">{m.month}</p>
                        {isBest && (
                          <Badge className="bg-emerald-600 text-white text-[9px] px-1.5 py-0">
                            <Trophy className="h-2.5 w-2.5 mr-0.5" /> Best
                          </Badge>
                        )}
                      </div>
                      <p className="text-lg font-bold">{formatGHS(m.revenue)}</p>
                      <p className="text-xs text-muted-foreground">
                        Profit: <span className="text-teal-600 font-medium">{formatGHS(m.profit)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.sales} sales · {m.items} items
                      </p>
                      {/* Mini bar indicator */}
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Monthly bar chart */}
            {monthlySummary.length > 1 && (
              <div className="mt-6 overflow-x-auto">
                <ChartContainer config={monthBarConfig} className="h-48 min-w-[400px]">
                  <BarChart data={monthlySummary} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} minTickGap={10} tickMargin={8} />
                    <YAxis fontSize={11} tickLine={false} axisLine={false} tickMargin={8} width={45} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="profit" fill="var(--color-profit)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Daily Sales Breakdown Table ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Daily Sales Breakdown</CardTitle>
            <Badge variant="outline" className="text-muted-foreground">
              {dailyBreakdown.length} days
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Revenue (GHS)</TableHead>
                  <TableHead className="text-right">Profit (GHS)</TableHead>
                  <TableHead className="text-right">Items Sold</TableHead>
                  <TableHead className="text-right">Avg. Transaction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : dailyBreakdown.length > 0 ? (
                  <>
                    {dailyBreakdown.map((d) => {
                      const isHighest = highestRevenueDay?.date === d.date;
                      const avgTxn = d.sales > 0 ? d.revenue / d.sales : 0;
                      return (
                        <TableRow
                          key={d.date}
                          className={isHighest ? 'bg-emerald-50 hover:bg-emerald-100' : ''}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {isHighest && (
                                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
                              )}
                              {d.date}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">{d.sales}</TableCell>
                          <TableCell className="text-right font-medium">{formatGHS(d.revenue)}</TableCell>
                          <TableCell className="text-right text-teal-600 font-medium">{formatGHS(d.profit)}</TableCell>
                          <TableCell className="text-right font-mono">{d.items}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatGHS(avgTxn)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Totals Row */}
                    <TableRow className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <TableCell>Totals</TableCell>
                      <TableCell className="text-right font-mono">{dailyTotals.sales}</TableCell>
                      <TableCell className="text-right">{formatGHS(dailyTotals.revenue)}</TableCell>
                      <TableCell className="text-right text-teal-600">{formatGHS(dailyTotals.profit)}</TableCell>
                      <TableCell className="text-right font-mono">{dailyTotals.items}</TableCell>
                      <TableCell className="text-right font-mono">
                        {dailyTotals.sales > 0
                          ? formatGHS(dailyTotals.revenue / dailyTotals.sales)
                          : formatGHS(0)}
                      </TableCell>
                    </TableRow>
                  </>
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No sales data for this period
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Cashier / Staff Performance ─── */}
      {cashierPerformance.length > 0 && !loading && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-600" />
                <CardTitle className="text-base font-semibold">Staff Performance</CardTitle>
              </div>
              <Badge variant="outline" className="text-muted-foreground">
                {cashierPerformance.length} staff
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Member</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Revenue (GHS)</TableHead>
                  <TableHead className="text-right">Profit (GHS)</TableHead>
                  <TableHead className="text-right">Avg. Sale Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashierPerformance.map((c) => {
                  const isTop = topCashier?.userId === c.userId;
                  const avgSale = c.sales > 0 ? c.revenue / c.sales : 0;
                  return (
                    <TableRow key={c.userId} className={isTop ? 'bg-emerald-50 hover:bg-emerald-100' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback
                              className={`text-xs font-semibold ${isTop ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-600'}`}
                            >
                              {getInitials(c.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            {isTop && (
                              <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0">
                                <Trophy className="h-2.5 w-2.5 mr-0.5" /> Top
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{c.sales}</TableCell>
                      <TableCell className="text-right font-medium">{formatGHS(c.revenue)}</TableCell>
                      <TableCell className="text-right text-teal-600 font-medium">{formatGHS(c.profit)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{formatGHS(avgSale)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ─── Top Products Table ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Top Selling Products</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead className="text-right">Quantity Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : topProducts.length > 0 ? (
                  topProducts.map((product, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${
                              i === 0
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : i === 1
                                  ? 'bg-gray-100 text-gray-600 border-gray-300'
                                  : i === 2
                                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                          </Badge>
                          {product.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{product.quantity}</TableCell>
                      <TableCell className="text-right font-medium">{formatGHS(product.revenue)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No product data for this period
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}