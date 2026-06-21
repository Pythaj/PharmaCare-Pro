'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  BarChart3,
  Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart.tsx';
import { PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import type { ChartDataPoint } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

type Period = 'today' | 'this_week' | 'this_month' | 'this_year' | 'custom';

const COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#6b7280'];

interface ReportStats {
  totalRevenue: number;
  totalProfit: number;
  totalSales: number;
  totalItemsSold: number;
}

export default function ReportsView() {
  const [period, setPeriod] = useState<Period>('this_month');
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [revenueData, setRevenueData] = useState<ChartDataPoint[]>([]);
  const [paymentData, setPaymentData] = useState<ChartDataPoint[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; quantity: number; revenue: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const periods: { label: string; value: Period }[] = [
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'this_week' },
    { label: 'This Month', value: 'this_month' },
    { label: 'This Year', value: 'this_year' },
  ];

  const periodLabel = periods.find((p) => p.value === period)?.label ?? period;

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

  const buildReportText = (): string => {
    const s = stats ?? { totalRevenue: 0, totalProfit: 0, totalSales: 0, totalItemsSold: 0 };
    const lines: string[] = [];

    // Summary section
    lines.push('Pharmacy Sales Report');
    lines.push(`Period: ${periodLabel}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('--- Summary ---');
    lines.push(`Total Revenue,${s.totalRevenue.toFixed(2)}`);
    lines.push(`Total Profit,${s.totalProfit.toFixed(2)}`);
    lines.push(`Total Sales,${s.totalSales}`);
    lines.push(`Total Items Sold,${s.totalItemsSold}`);
    lines.push('');

    // Revenue data section
    if (revenueData.length > 0) {
      lines.push('--- Revenue by Period ---');
      lines.push('Period,Revenue');
      for (const d of revenueData) {
        lines.push(`${d.name},${d.value.toFixed(2)}`);
      }
      lines.push('');
    }

    // Payment data section
    if (paymentData.length > 0) {
      lines.push('--- Sales by Payment Method ---');
      lines.push('Payment Method,Amount');
      for (const d of paymentData) {
        lines.push(`${d.name},${d.value.toFixed(2)}`);
      }
      lines.push('');
    }

    // Top products section
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
    const content = buildReportText();
    downloadFile(content, `pharmacy-report-${period}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
  };

  // NOTE: Intentionally using TSV (tab-separated) format with .xls extension.
  // This provides Excel compatibility without requiring external libraries like xlsx.
  // Excel and LibreOffice both open TSV files natively when given an .xls extension.
  const handleExportExcel = () => {
    // Use TSV format which Excel opens natively
    const s = stats ?? { totalRevenue: 0, totalProfit: 0, totalSales: 0, totalItemsSold: 0 };
    const lines: string[] = [];

    lines.push('Pharmacy Sales Report');
    lines.push(`Period:\t${periodLabel}`);
    lines.push(`Generated:\t${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('Summary');
    lines.push('Total Revenue\tTotal Profit\tTotal Sales\tTotal Items Sold');
    lines.push(`${s.totalRevenue.toFixed(2)}\t${s.totalProfit.toFixed(2)}\t${s.totalSales}\t${s.totalItemsSold}`);
    lines.push('');

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

    const content = lines.join('\n');
    downloadFile(content, `pharmacy-report-${period}-${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel');
  };

  const handleExportPDF = () => {
    const s = stats ?? { totalRevenue: 0, totalProfit: 0, totalSales: 0, totalItemsSold: 0 };

    const revenueRows = revenueData
      .map((d) => `<tr><td>${d.name}</td><td class="num">${formatGHS(d.value)}</td></tr>`)
      .join('');

    const paymentRows = paymentData
      .map((d) => `<tr><td>${d.name}</td><td class="num">${formatGHS(d.value)}</td></tr>`)
      .join('');

    const productRows = topProducts
      .map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td class="num">${p.quantity}</td><td class="num">${formatGHS(p.revenue)}</td></tr>`)
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pharmacy Report - ${periodLabel}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1f2937; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 24px; color: #047857; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; margin-bottom: 32px; }
  .stat-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-card .label { font-size: 12px; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 20px; font-weight: 700; color: #111827; }
  .stat-card.profit .value { color: #047857; }
  h2 { font-size: 16px; color: #111827; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #10b981; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
  th { background: #f0fdf4; color: #047857; text-align: left; padding: 8px 12px; font-weight: 600; border-bottom: 2px solid #d1fae5; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #f9fafb; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
</style>
</head>
<body>
  <h1>Pharmacy Sales Report</h1>
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
    <div class="stat-card">
      <div class="label">Total Sales</div>
      <div class="value">${s.totalSales.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="label">Items Sold</div>
      <div class="value">${s.totalItemsSold.toLocaleString()}</div>
    </div>
  </div>

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

  <div class="footer">Pharmacy Management System &mdash; Auto-generated report</div>

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
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports?period=${period}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setStats(data.stats ?? null);
          setRevenueData(data.revenueData ?? []);
          setPaymentData(data.paymentData ?? []);
          setTopProducts(data.topProducts ?? []);
        }
      } catch { /* silent */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [period]);

  const revenueConfig = { revenue: { label: 'Revenue', color: '#10b981' } };
  const pieConfig = { value: { label: 'Amount' } };

  return (
    <div className="space-y-6 p-6">
      {/* Period Selector & Export */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {periods.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? 'default' : 'outline'}
              size="sm"
              className={period === p.value ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={loading}>
            <Download className="h-4 w-4 mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={loading}>
            <BarChart3 className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={loading}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                </div>
                <p className="text-2xl font-bold">{formatGHS(stats?.totalRevenue ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-teal-600" />
                  <p className="text-sm text-muted-foreground">Total Profit</p>
                </div>
                <p className="text-2xl font-bold text-teal-600">{formatGHS(stats?.totalProfit ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingCart className="h-4 w-4 text-green-600" />
                  <p className="text-sm text-muted-foreground">Total Sales</p>
                </div>
                <p className="text-2xl font-bold">{(stats?.totalSales ?? 0).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm text-muted-foreground">Items Sold</p>
                </div>
                <p className="text-2xl font-bold">{(stats?.totalItemsSold ?? 0).toLocaleString()}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ChartContainer config={revenueConfig} className="h-64">
                <AreaChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
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
            )}
          </CardContent>
        </Card>

        {/* Payment Method Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales by Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ChartContainer config={pieConfig} className="h-64">
                <PieChart>
                  <Pie
                    data={paymentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    fontSize={12}
                  >
                    {paymentData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Products Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Selling Products</CardTitle>
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
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{i + 1}</Badge>
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
                      No data for this period
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