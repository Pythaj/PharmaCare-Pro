'use client';

import { useState, useEffect } from 'react';
import { Search, ChevronDown, ChevronRight, RotateCcw, Printer, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import { usePermissions } from '@/hooks/use-permissions';
import type { Sale, SaleItem, User } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

export default function SalesHistoryView() {
  const { isAdmin } = usePermissions();
  const [sales, setSales] = useState<Sale[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [salesPersonFilter, setSalesPersonFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<SaleItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState(false);

  const navigate = useAppStore((s) => s.navigate);

  const fetchSales = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (salesPersonFilter !== 'all') params.set('userId', salesPersonFilter);
      const res = await fetch(`/api/sales?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSales(data.sales ?? []);
      }
    } catch { /* silent */ }
  };

  useEffect(() => {
    async function init() {
      const [salesRes, usersRes] = await Promise.all([
        fetch('/api/sales'),
        fetch('/api/users'),
      ]);
      if (salesRes.ok) { const d = await salesRes.json(); setSales(d.sales ?? []); }
      if (usersRes.ok) { const d = await usersRes.json(); setUsers(d.users ?? []); }
      setLoading(false);
    }
    init();
  }, []);

  const handleSearch = () => {
    fetchSales();
  };

  const handleExpandRow = async (saleId: string) => {
    if (expandedRow === saleId) { setExpandedRow(null); return; }
    setExpandedRow(saleId);
    setLoadingItems(true);
    try {
      const res = await fetch(`/api/sales/${saleId}`);
      if (res.ok) {
        const data = await res.json();
        setExpandedItems(data.items ?? []);
      }
    } catch { /* silent */ }
    setLoadingItems(false);
  };

  const handleDateChange = () => {
    fetchSales();
  };

  const handleSalesPersonChange = (value: string) => {
    setSalesPersonFilter(value);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        if (salesPersonFilter !== 'all') params.set('userId', salesPersonFilter);
        const res = await fetch(`/api/sales?${params.toString()}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSales(data.sales ?? []);
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [salesPersonFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Completed</Badge>;
      case 'refunded': return <Badge variant="destructive">Refunded</Badge>;
      case 'partial': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Partial</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleRefund = (sale: Sale) => {
    toast.info(`Processing refund for sale ${sale.invoiceNo}...`);
    navigate('returns');
  };

  const handleDeleteSale = async () => {
    if (!saleToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales/${saleToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete sale');
      }
      toast.success(`Sale "${saleToDelete.invoiceNo}" deleted successfully`);
      setShowDeleteDialog(false);
      setSaleToDelete(null);
      fetchSales();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete sale');
    } finally {
      setDeleting(false);
    }
  };

  const handlePrintReceipt = (sale: Sale) => {
    const items = sale.items ?? [];
    const receiptHtml = `
<!DOCTYPE html>
<html>
<head>
<title>Receipt - ${sale.invoiceNo}</title>
<style>
  body { font-family: 'Courier New', monospace; max-width: 320px; margin: 0 auto; padding: 20px; color: #333; }
  .header { text-align: center; border-bottom: 2px dashed #ccc; padding-bottom: 12px; margin-bottom: 12px; }
  .pharmacy-name { font-size: 18px; font-weight: bold; color: #059669; }
  .info { font-size: 12px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { text-align: left; font-size: 11px; border-bottom: 1px solid #ccc; padding: 4px 0; }
  td { font-size: 12px; padding: 3px 0; }
  .total-row { font-weight: bold; border-top: 2px dashed #ccc; margin-top: 8px; padding-top: 8px; }
  .total-row td { font-size: 14px; }
  .footer { text-align: center; border-top: 2px dashed #ccc; padding-top: 12px; margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 0; padding: 10px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="pharmacy-name">GreenLife Pharmacy</div>
    <div class="info">Accra, Ghana</div>
    <div class="info">Tel: +233 30 123 4567</div>
  </div>
  <div class="info"><strong>Invoice:</strong> ${sale.invoiceNo}</div>
  <div class="info"><strong>Date:</strong> ${new Date(sale.createdAt).toLocaleString('en-GH')}</div>
  <div class="info"><strong>Customer:</strong> ${sale.customer?.name ?? 'Walk-in'}</div>
  <div class="info"><strong>Cashier:</strong> ${sale.user?.name ?? '-'}</div>
  <table>
    <thead>
      <tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr>
    </thead>
    <tbody>
      ${items.map((item) => `
        <tr>
          <td>${item.product?.name ?? 'Product'}</td>
          <td style="text-align:center">${item.quantity}</td>
          <td style="text-align:right">${formatGHS(item.unitPrice)}</td>
          <td style="text-align:right">${formatGHS(item.total)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div style="display:flex;justify-content:space-between;font-size:12px;margin:2px 0">
    <span>Subtotal:</span><span>${formatGHS(sale.subtotal)}</span>
  </div>
  ${sale.discount > 0 ? `
  <div style="display:flex;justify-content:space-between;font-size:12px;margin:2px 0">
    <span>Discount:</span><span>-${formatGHS(sale.discount)}</span>
  </div>` : ''}
  ${sale.tax > 0 ? `
  <div style="display:flex;justify-content:space-between;font-size:12px;margin:2px 0">
    <span>Tax:</span><span>${formatGHS(sale.tax)}</span>
  </div>` : ''}
  <div class="total-row" style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:2px dashed #ccc">
    <span>TOTAL:</span><span>${formatGHS(sale.totalAmount)}</span>
  </div>
  <div class="info" style="margin-top:8px"><strong>Payment:</strong> ${sale.paymentMethod.toUpperCase()}</div>
  <div class="info"><strong>Status:</strong> ${sale.status.toUpperCase()}</div>
  <div class="footer">
    <p>Thank you for your purchase!</p>
    <p>GreenLife Pharmacy - Your Health, Our Priority</p>
  </div>
  <div style="text-align:center;margin-top:20px">
    <button onclick="window.print()" style="padding:8px 24px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px">Print Receipt</button>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=400,height=600');
    if (win) {
      win.document.write(receiptHtml);
      win.document.close();
    }
  };

  return (
    <div className="space-y-4 p-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4 items-end">
            <div className="flex-1">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by invoice or customer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
              </div>
            </div>
            <div>
              <Label className="text-xs">From Date</Label>
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); }} />
            </div>
            <div>
              <Label className="text-xs">To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); }} />
            </div>
            <div>
              <Label className="text-xs">Sales Person</Label>
              <Select value={salesPersonFilter} onValueChange={handleSalesPersonChange}>
                <SelectTrigger className="w-44"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleDateChange}>
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Invoice#</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : sales.length > 0 ? (
                  sales.map((sale) => {
                    const isExpanded = expandedRow === sale.id;
                    return (
                      <SaleRow
                        key={sale.id}
                        sale={sale}
                        isExpanded={isExpanded}
                        expandedItems={expandedItems}
                        loadingItems={loadingItems}
                        formatGHS={formatGHS}
                        getStatusBadge={getStatusBadge}
                        onExpand={handleExpandRow}
                        onRefund={handleRefund}
                        onPrint={handlePrintReceipt}
                        isAdmin={isAdmin}
                        onDelete={isAdmin ? (s: Sale) => { setSaleToDelete(s); setShowDeleteDialog(true); } : undefined}
                      />
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-12">
                      No sales found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete Sale Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sale — {saleToDelete?.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The sale and all its items will be permanently deleted.
              Sales with existing return records cannot be deleted.
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

// Extracted row component to avoid React fragment key warnings
function SaleRow({
  sale,
  isExpanded,
  expandedItems,
  loadingItems,
  formatGHS,
  getStatusBadge,
  onExpand,
  onRefund,
  onPrint,
  isAdmin,
  onDelete,
}: {
  sale: Sale;
  isExpanded: boolean;
  expandedItems: SaleItem[];
  loadingItems: boolean;
  formatGHS: (v: number) => string;
  getStatusBadge: (s: string) => React.ReactNode;
  onExpand: (id: string) => void;
  onRefund: (s: Sale) => void;
  onPrint: (s: Sale) => void;
  isAdmin?: boolean;
  onDelete?: (s: Sale) => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => onExpand(sale.id)}>
        <TableCell>
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-mono text-xs">{sale.invoiceNo}</TableCell>
        <TableCell>{sale.customer?.name ?? 'Walk-in'}</TableCell>
        <TableCell className="text-center">
          <Badge variant="outline">{sale.items?.length ?? 0}</Badge>
        </TableCell>
        <TableCell className="text-right font-medium">{formatGHS(sale.totalAmount)}</TableCell>
        <TableCell className="text-right text-emerald-600">{formatGHS(sale.profit)}</TableCell>
        <TableCell><Badge variant="outline" className="text-xs">{sale.paymentMethod}</Badge></TableCell>
        <TableCell>{getStatusBadge(sale.status)}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {new Date(sale.createdAt).toLocaleDateString('en-GH')}
        </TableCell>
        <TableCell className="text-sm">{sale.user?.name ?? '-'}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              onClick={(e) => { e.stopPropagation(); onRefund(sale); }}
              title="Refund"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              onClick={(e) => { e.stopPropagation(); onPrint(sale); }}
              title="Print Receipt"
            >
              <Printer className="h-4 w-4" />
            </Button>
            {isAdmin && onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={(e) => { e.stopPropagation(); onDelete(sale); }}
                title="Delete Sale"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow key={`${sale.id}-items`}>
          <TableCell colSpan={11} className="bg-muted/30 px-8 py-3">
            {loadingItems ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : expandedItems.length > 0 ? (
              <div className="text-sm">
                <p className="font-medium mb-2">Sale Items</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 font-medium">Product</th>
                      <th className="text-center py-1.5 font-medium">Qty</th>
                      <th className="text-right py-1.5 font-medium">Unit Price</th>
                      <th className="text-right py-1.5 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expandedItems.map((item) => (
                      <tr key={item.id} className="border-b border-dotted">
                        <td className="py-1.5">{item.product?.name ?? 'Product'}</td>
                        <td className="text-center">{item.quantity}</td>
                        <td className="text-right">{formatGHS(item.unitPrice)}</td>
                        <td className="text-right">{formatGHS(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No items found</p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
