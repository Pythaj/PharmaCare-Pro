'use client';

import { useState, useEffect } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import type { Return, Sale } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface ReturnItem {
  saleItemId: string;
  productName: string;
  quantity: number;
  maxQty: number;
  unitPrice: number;
}

export default function ReturnsView() {
  const [returns, setReturns] = useState<Return[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [returnToDelete, setReturnToDelete] = useState<Return | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({
    saleId: '',
    reason: '',
  });
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);

  useEffect(() => {
    async function init() {
      try {
        const [returnsRes, salesRes] = await Promise.all([
          fetch('/api/returns'),
          fetch('/api/sales?limit=50'),
        ]);
        if (returnsRes.ok) { const d = await returnsRes.json(); setReturns(d.returns ?? []); }
        if (salesRes.ok) { const d = await salesRes.json(); setSales(d.sales ?? []); }
      } catch { /* silent */ }
      setLoading(false);
    }
    init();
  }, []);

  const handleSaleSelect = async (saleId: string) => {
    setForm({ ...form, saleId });
    setReturnItems([]);
    if (!saleId) return;
    try {
      const res = await fetch(`/api/sales/${saleId}`);
      if (res.ok) {
        const data = await res.json();
        const items = (data.items ?? []).map((item: { id: string; product?: { name: string }; quantity: number; unitPrice: number }) => ({
          saleItemId: item.id,
          productName: item.product?.name ?? 'Unknown',
          quantity: 0,
          maxQty: item.quantity,
          unitPrice: item.unitPrice,
        }));
        setReturnItems(items);
      }
    } catch { /* silent */ }
  };

  const updateReturnQty = (index: number, qty: number) => {
    const updated = [...returnItems];
    updated[index] = { ...updated[index], quantity: Math.min(qty, updated[index].maxQty) };
    setReturnItems(updated);
  };

  const totalRefund = returnItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const handleSubmitReturn = async () => {
    if (!form.saleId) { toast.error('Please select a sale'); return; }
    if (!form.reason.trim()) { toast.error('Please enter a reason'); return; }
    const validItems = returnItems.filter(i => i.quantity > 0);
    if (validItems.length === 0) { toast.error('Please select at least one item to return'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: form.saleId,
          reason: form.reason,
          items: validItems.map(i => ({
            saleItemId: i.saleItemId,
            quantity: i.quantity,
            refundAmount: i.quantity * i.unitPrice,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to process return');
      }
      toast.success('Return processed successfully');
      setShowAddDialog(false);
      setForm({ saleId: '', reason: '' });
      setReturnItems([]);
      const returnsRes = await fetch('/api/returns');
      if (returnsRes.ok) { const d = await returnsRes.json(); setReturns(d.returns ?? []); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to process return');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Completed</Badge>;
      case 'pending': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pending</Badge>;
      case 'rejected': return <Badge variant="destructive">Rejected</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleDeleteReturn = async () => {
    if (!returnToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/returns/${returnToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete return');
      }
      toast.success('Return deleted successfully');
      setShowDeleteDialog(false);
      setReturnToDelete(null);
      const returnsRes = await fetch('/api/returns');
      if (returnsRes.ok) { const d = await returnsRes.json(); setReturns(d.returns ?? []); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete return');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex justify-end">
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Process Return
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return ID</TableHead>
                  <TableHead>Sale Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                  <TableHead className="text-right">Refund Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : returns.length > 0 ? (
                  returns.map((ret) => (
                    <TableRow key={ret.id}>
                      <TableCell className="font-mono text-xs">RET-{ret.id.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs">{ret.sale?.invoiceNo ?? '-'}</TableCell>
                      <TableCell>{ret.sale?.customer?.name ?? 'Walk-in'}</TableCell>
                      <TableCell className="hidden md:table-cell max-w-[200px] truncate">{ret.reason}</TableCell>
                      <TableCell className="text-right font-medium">{formatGHS(ret.totalRefund)}</TableCell>
                      <TableCell>{getStatusBadge(ret.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(ret.createdAt).toLocaleDateString('en-GH')}
                      </TableCell>
                      <TableCell>
                        {ret.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => { setReturnToDelete(ret); setShowDeleteDialog(true); }}
                            title="Delete Return"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      No returns recorded yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Process Return Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Process New Return</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Select Sale *</Label>
              <Select value={form.saleId} onValueChange={handleSaleSelect}>
                <SelectTrigger><SelectValue placeholder="Select a sale to return" /></SelectTrigger>
                <SelectContent>
                  {sales.map((sale) => (
                    <SelectItem key={sale.id} value={sale.id}>
                      {sale.invoiceNo} - {sale.customer?.name ?? 'Walk-in'} ({formatGHS(sale.totalAmount)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Reason *</Label>
              <Textarea
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Reason for return"
                rows={2}
              />
            </div>

            {returnItems.length > 0 && (
              <div>
                <Label className="text-base font-semibold mb-2 block">Items to Return</Label>
                <div className="space-y-2">
                  {returnItems.map((item, index) => (
                    <div key={index} className="flex items-center gap-4 p-3 border rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">{formatGHS(item.unitPrice)} each</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Qty:</Label>
                        <Input
                          type="number"
                          min={0}
                          max={item.maxQty}
                          value={item.quantity || ''}
                          onChange={(e) => updateReturnQty(index, Number(e.target.value) || 0)}
                          className="w-20 text-center"
                        />
                        <span className="text-xs text-muted-foreground">/ {item.maxQty}</span>
                      </div>
                      <span className="font-medium text-sm w-24 text-right">
                        {formatGHS(item.quantity * item.unitPrice)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-3 pt-3 border-t">
                  <span className="font-bold">Total Refund: {formatGHS(totalRefund)}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSubmitReturn} disabled={submitting}>
              {submitting ? 'Processing...' : 'Process Return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Return Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Return — RET-{returnToDelete?.id.slice(0, 8)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Only pending returns can be deleted. Approved or rejected returns are permanent records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDeleteReturn}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete Return'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}