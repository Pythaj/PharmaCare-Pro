'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
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
  AlertTriangle,
  FileText,
  RefreshCw,
  Save,
  CalendarCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogDescription,
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
import type { DailySalesRecord, Sale, SaleItem, User } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

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

export default function DailySalesRegister() {
  const { currentUser, navigate } = useAppStore();
  const { isAdmin } = usePermissions();
  const [activeTab, setActiveTab] = useState('today');

  // Today's data
  const [todayRecord, setTodayRecord] = useState<DailySalesRecord | null>(null);
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [loadingToday, setLoadingToday] = useState(true);

  // Past records
  const [pastRecords, setPastRecords] = useState<DailySalesRecord[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);

  // Expanded past record detail
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [expandedRecordSales, setExpandedRecordSales] = useState<Sale[]>([]);
  const [loadingRecordDetail, setLoadingRecordDetail] = useState(false);

  // Expanded sale items
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [expandedSaleItems, setExpandedSaleItems] = useState<SaleItem[]>([]);

  // Close day dialog
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closingNotes, setClosingNotes] = useState('');
  const [closing, setClosing] = useState(false);

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
      const params = new URLSearchParams();
      if (currentUser?.id) params.set('userId', currentUser.id);
      const res = await fetch(`/api/daily-sales/today?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTodayRecord(data.record);
        setTodaySales(data.sales ?? []);
      }
    } catch { /* silent */ }
  }, [currentUser?.id]);

  // Fetch past records
  const fetchPastRecords = useCallback(async () => {
    try {
      const res = await fetch('/api/daily-sales?limit=60');
      if (res.ok) {
        const data = await res.json();
        setPastRecords((data.records ?? []).filter((r: DailySalesRecord) => r.date !== todayRecord?.date));
      }
    } catch { /* silent */ }
  }, [todayRecord?.date]);

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
  }, [fetchToday, fetchPastRecords]);

  // Auto-refresh today's data every 15 seconds when tab is active
  useEffect(() => {
    if (activeTab === 'today' && todayRecord?.status === 'open') {
      refreshIntervalRef.current = setInterval(fetchToday, 15000);
    }
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [activeTab, todayRecord?.status, fetchToday]);

  // Handle close day
  const handleCloseDay = async () => {
    if (!todayRecord || !currentUser) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/daily-sales/${todayRecord.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', userId: currentUser.id, notes: closingNotes }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success('Day closed successfully! Sales record saved.', { duration: 4000 });
        setTodayRecord(data);
        setShowCloseDialog(false);
        setClosingNotes('');
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
      }
    } catch { /* silent */ }
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
      toast.success(`Sale "${saleToDelete.invoiceNo}" deleted`);
      setShowDeleteDialog(false);
      setSaleToDelete(null);
      fetchToday();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete sale');
    } finally {
      setDeleting(false);
    }
  };

  // Print receipt for a sale
  const handlePrintReceipt = (sale: Sale) => {
    const items = sale.items ?? [];
    const receiptHtml = `
<!DOCTYPE html>
<html><head><title>Receipt - ${sale.invoiceNo}</title>
<style>
  body { font-family: 'Courier New', monospace; max-width: 320px; margin: 0 auto; padding: 20px; color: #333; }
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
    <div class="pharmacy-name">GreenLife Pharmacy</div>
    <div class="info">Accra, Ghana</div>
    <div class="info">Tel: +233 30 123 4567</div>
  </div>
  <div class="info"><strong>Invoice:</strong> ${sale.invoiceNo}</div>
  <div class="info"><strong>Date:</strong> ${new Date(sale.createdAt).toLocaleString('en-GH')}</div>
  <div class="info"><strong>Customer:</strong> ${sale.customer?.name ?? 'Walk-in'}</div>
  <table>
    <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${items.map((item) => `<tr><td>${item.product?.name ?? 'Product'}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:right">${formatGHS(item.total)}</td></tr>`).join('')}</tbody>
  </table>
  <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;border-top:2px dashed #ccc;padding-top:8px;margin-top:8px">
    <span>TOTAL:</span><span>${formatGHS(sale.totalAmount)}</span>
  </div>
  <div class="footer"><p>Thank you for your purchase!</p></div>
  <div style="text-align:center;margin-top:20px">
    <button onclick="window.print()" style="padding:8px 24px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px">Print</button>
  </div>
</body></html>`;
    const win = window.open('', '_blank', 'width=400,height=600');
    if (win) { win.document.write(receiptHtml); win.document.close(); }
  };

  // Navigate to POS
  const goToPOS = () => navigate('pos');

  const isOpen = todayRecord?.status === 'open';
  const avgSale = todayRecord && todayRecord.totalTransactions > 0
    ? todayRecord.totalRevenue / todayRecord.totalTransactions
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
                        <h2 className="text-xl font-bold">{formatDate(todayRecord.date)}</h2>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Opened: {formatTime(todayRecord.openedAt)} by {todayRecord.opener?.name ?? 'System'}
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
                    value={formatGHS(todayRecord.totalRevenue)}
                    icon={DollarSign}
                    iconBg="bg-emerald-500"
                    trend="up"
                  />
                  <StatCard
                    label="Total Profit"
                    value={formatGHS(todayRecord.totalProfit)}
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
                    value={formatGHS(avgSale)}
                    icon={BarChart3}
                    iconBg="bg-emerald-600"
                  />
                  <StatCard
                    label="Discounts"
                    value={formatGHS(todayRecord.totalDiscount)}
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
                        <p className="text-lg font-bold text-green-700">{formatGHS(todayRecord.cashTotal)}</p>
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
                        <p className="text-lg font-bold text-blue-700">{formatGHS(todayRecord.cardTotal)}</p>
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
                        <p className="text-lg font-bold text-purple-700">{formatGHS(todayRecord.mobileMoneyTotal)}</p>
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

                {/* Today's Transaction Feed */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-muted-foreground" />
                      Today&apos;s Transactions
                      <Badge variant="secondary" className="text-xs ml-1">
                        {todaySales.length}
                      </Badge>
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => { fetchToday(); toast.success('Refreshed'); }}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Refresh
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    {todaySales.length > 0 ? (
                      <ScrollArea className="max-h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8" />
                              <TableHead>Time</TableHead>
                              <TableHead>Invoice#</TableHead>
                              <TableHead>Customer</TableHead>
                              <TableHead className="text-center">Items</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                              <TableHead className="text-right">Profit</TableHead>
                              <TableHead>Payment</TableHead>
                              <TableHead>Cashier</TableHead>
                              <TableHead className="w-28">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {todaySales.map((sale, idx) => (
                              <SaleRow
                                key={sale.id}
                                sale={sale}
                                index={idx}
                                expanded={expandedSaleId === sale.id}
                                expandedItems={expandedSaleItems}
                                isAdmin={isAdmin}
                                isDayOpen={isOpen}
                                onExpand={handleExpandSale}
                                onPrint={handlePrintReceipt}
                                onDelete={(s) => { setSaleToDelete(s); setShowDeleteDialog(true); }}
                                onRefund={() => { navigate('returns'); }}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <div className="py-16 text-center">
                        <Receipt className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-muted-foreground text-sm">No transactions recorded today</p>
                        {isOpen && (
                          <Button
                            className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={goToPOS}
                          >
                            Start Selling
                            <ArrowUpRight className="h-4 w-4 ml-1.5" />
                          </Button>
                        )}
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
        <TabsContent value="history" className="space-y-6">
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
                  formatGHS={formatGHS}
                  formatDate={formatDate}
                  onExpandSale={handleExpandSale}
                  expandedSaleId={expandedSaleId}
                  expandedSaleItems={expandedSaleItems}
                />
              ))}
            </div>
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

      {/* Close Day Dialog */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-emerald-600" />
              Save &amp; Close Day
            </DialogTitle>
            <DialogDescription>
              This will finalize today&apos;s sales record. The register will be prepared fresh for the next day.
            </DialogDescription>
          </DialogHeader>

          {todayRecord && (
            <div className="space-y-4 py-2">
              {/* Summary before close */}
              <div className="rounded-lg bg-muted/50 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Day Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transactions:</span>
                    <span className="font-medium">{todayRecord.totalTransactions}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items Sold:</span>
                    <span className="font-medium">{todayRecord.totalItemsSold}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Revenue:</span>
                    <span className="font-bold text-emerald-600">{formatGHS(todayRecord.totalRevenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Profit:</span>
                    <span className="font-bold text-teal-600">{formatGHS(todayRecord.totalProfit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash:</span>
                    <span className="font-medium">{formatGHS(todayRecord.cashTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Card:</span>
                    <span className="font-medium">{formatGHS(todayRecord.cardTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mobile Money:</span>
                    <span className="font-medium">{formatGHS(todayRecord.mobileMoneyTotal)}</span>
                  </div>
                  {todayRecord.totalDiscount > 0 && (
                    <div className="flex justify-between col-span-2">
                      <span className="text-muted-foreground">Total Discounts:</span>
                      <span className="font-medium text-amber-600">{formatGHS(todayRecord.totalDiscount)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="closing-notes">Closing Notes (optional)</Label>
                <Textarea
                  id="closing-notes"
                  placeholder="Any notes about today's sales..."
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowCloseDialog(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleCloseDay}
              disabled={closing}
            >
              {closing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  Save &amp; Close Day
                </>
              )}
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
            <AlertDialogTitle>Delete Sale — {saleToDelete?.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The sale and all its items will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDeleteSale}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete Sale'}
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
  isDayOpen,
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
  isDayOpen: boolean;
  onExpand: (saleId: string, items?: SaleItem[]) => void;
  onPrint: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  onRefund: () => void;
}) {
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
        <TableCell className="text-sm">{sale.customer?.name ?? 'Walk-in'}</TableCell>
        <TableCell className="text-center">
          <Badge variant="outline" className="text-xs">{sale.items?.length ?? 0}</Badge>
        </TableCell>
        <TableCell className="text-right font-semibold">{formatGHS(sale.totalAmount)}</TableCell>
        <TableCell className="text-right text-emerald-600 font-medium">{formatGHS(sale.profit)}</TableCell>
        <TableCell>
          <PaymentBadge method={sale.paymentMethod} />
        </TableCell>
        <TableCell className="text-xs">{sale.user?.name ?? '-'}</TableCell>
        <TableCell>
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
            {isAdmin && isDayOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => { e.stopPropagation(); onDelete(sale); }}
                title="Delete Sale"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow key={`${sale.id}-items`} className="bg-muted/30">
          <TableCell colSpan={10} className="px-10 py-3">
            <div className="text-sm">
              <p className="font-medium mb-2 text-xs text-muted-foreground uppercase tracking-wider">Sale Items</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1.5 font-medium text-muted-foreground">Product</th>
                    <th className="text-center py-1.5 font-medium text-muted-foreground">Qty</th>
                    <th className="text-right py-1.5 font-medium text-muted-foreground">Unit Price</th>
                    <th className="text-right py-1.5 font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(expandedItems.length > 0 ? expandedItems : sale.items ?? []).map((item) => (
                    <tr key={item.id} className="border-b border-dotted">
                      <td className="py-1.5">{item.product?.name ?? 'Product'}</td>
                      <td className="text-center">{item.quantity}</td>
                      <td className="text-right">{formatGHS(item.unitPrice)}</td>
                      <td className="text-right font-medium">{formatGHS(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sale.discount > 0 && (
                <div className="flex justify-end mt-2 text-xs text-amber-600">
                  Discount: -{formatGHS(sale.discount)}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
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
  formatGHS: fmtGHS,
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
  formatGHS: (v: number) => string;
  formatDate: (d: string) => string;
  onExpandSale: (saleId: string, items?: SaleItem[]) => void;
  expandedSaleId: string | null;
  expandedSaleItems: SaleItem[];
}) {
  const isClosed = record.status === 'closed';
  const profitMargin = record.totalRevenue > 0 ? (record.totalProfit / record.totalRevenue) * 100 : 0;

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
                <p className="font-semibold text-sm">{fmtDate(record.date)}</p>
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
                <p className="font-bold">{fmtGHS(record.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Profit</p>
                <p className="font-bold text-emerald-600">{fmtGHS(record.totalProfit)}</p>
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
                {fmtGHS(record.cashTotal)}
              </span>
              <span className="flex items-center gap-0.5">
                <CreditCard className="h-3 w-3 text-blue-500" />
                {fmtGHS(record.cardTotal)}
              </span>
              <span className="flex items-center gap-0.5">
                <Smartphone className="h-3 w-3 text-purple-500" />
                {fmtGHS(record.mobileMoneyTotal)}
              </span>
            </div>

            {/* Action buttons */}
            {isExpanded && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
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
                    <ScrollArea className="max-h-80">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-6" />
                            <TableHead>Time</TableHead>
                            <TableHead>Invoice#</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Payment</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expandedSales.map((sale) => (
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
                              <TableCell className="text-right text-sm font-medium">{fmtGHS(sale.totalAmount)}</TableCell>
                              <TableCell><PaymentBadge method={sale.paymentMethod} /></TableCell>
                            </TableRow>
                            {expandedSaleId === sale.id && (
                              <TableRow className="bg-muted/30">
                                <TableCell colSpan={6} className="px-8 py-2">
                                  <table className="w-full text-xs">
                                    <tbody>
                                      {(sale.items ?? []).map((item) => (
                                        <tr key={item.id} className="border-b border-dotted">
                                          <td className="py-1">{item.product?.name ?? 'Product'}</td>
                                          <td className="text-center py-1">{item.quantity}</td>
                                          <td className="text-right py-1">{fmtGHS(item.total)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </TableCell>
                              </TableRow>
                            )}
                            </Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
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
