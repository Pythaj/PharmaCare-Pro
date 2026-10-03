'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { RotateCcw, Trash2, Check, X } from 'lucide-react';
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
import { allocateRefunds, sumRefunds } from '@/lib/returns';
import { LoadError } from '@/components/ui/load-error';

interface ReturnItemRow {
  saleItemId: string;
  productName: string;
  quantity: number;
  /** Units still returnable (bought minus already approved/pending). */
  maxQty: number;
  alreadyReturned: number;
  unitPrice: number;
}

type NewReturnStatus = 'approved' | 'pending';

export default function ReturnsView() {
  const [returns, setReturns] = useState<Return[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [returnToDelete, setReturnToDelete] = useState<Return | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actingOnId, setActingOnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const [form, setForm] = useState({ saleId: '', reason: '', status: 'approved' as NewReturnStatus });
  const [returnItems, setReturnItems] = useState<ReturnItemRow[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const loadReturns = useCallback(async () => {
    try {
      const res = await fetch('/api/returns');
      if (res.ok) {
        const data = await res.json();
        setReturns(data.returns ?? []);
        setError(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Could not load returns (HTTP ${res.status})`);
      }
    } catch {
      setError('Could not reach the server to load returns.');
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [returnsRes, salesRes] = await Promise.all([
          fetch('/api/returns'),
          fetch('/api/sales?limit=50'),
        ]);
        if (returnsRes.ok) { const d = await returnsRes.json(); setReturns(d.returns ?? []); setError(null); }
        else {
          const d = await returnsRes.json().catch(() => ({}));
          setError(d.error ?? `Could not load returns (HTTP ${returnsRes.status})`);
        }
        if (salesRes.ok) { const d = await salesRes.json(); setSales(d.sales ?? []); }
      } catch { setError('Could not reach the server to load returns.'); }
      setLoading(false);
    }
    init();
  }, [retryNonce]);

  const selectedSale = useMemo(
    () => sales.find((s) => s.id === form.saleId) ?? null,
    [sales, form.saleId]
  );

  const handleSaleSelect = async (saleId: string) => {
    setForm((prev) => ({ ...prev, saleId }));
    setReturnItems([]);
    if (!saleId) return;
    setLoadingItems(true);
    try {
      const res = await fetch(`/api/sales/${saleId}`);
      if (res.ok) {
        const data = await res.json();
        const items = (data.items ?? []).map(
          (item: {
            id: string;
            product?: { name: string };
            returnableQuantity?: number;
            returnedQuantity?: number;
            quantity: number;
            unitPrice: number;
          }) => ({
            saleItemId: item.id,
            productName: item.product?.name ?? 'Unknown',
            quantity: 0,
            // Prefer the server's remaining figure; fall back to the raw
            // quantity for older payloads.
            maxQty: item.returnableQuantity ?? item.quantity,
            alreadyReturned: item.returnedQuantity ?? 0,
            unitPrice: item.unitPrice,
          })
        );
        setReturnItems(items);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error('Could not load sale', { description: data.error || 'Please try again.' });
      }
    } catch {
      toast.error('Could not load sale', { description: 'Network error.' });
    } finally {
      setLoadingItems(false);
    }
  };

  const updateReturnQty = (index: number, qty: number) => {
    setReturnItems((prev) => {
      const next = [...prev];
      const max = next[index].maxQty;
      next[index] = { ...next[index], quantity: Math.max(0, Math.min(qty, max)) };
      return next;
    });
  };

  /**
   * Preview uses the SAME allocator the API prices the refund with, so the
   * figure shown here is the figure that gets refunded.
   */
  const { previewTotal, previewLines } = useMemo(() => {
    const lines = returnItems
      .filter((i) => i.quantity > 0)
      .map((i) => ({ saleItemId: i.saleItemId, quantity: i.quantity, unitPrice: i.unitPrice, batchId: null }));

    if (lines.length === 0 || !selectedSale) return { previewTotal: 0, previewLines: [] as { saleItemId: string; refundAmount: number }[] };

    const allocated = allocateRefunds(lines, {
      subtotal: Number(selectedSale.subtotal ?? 0),
      totalAmount: Number(selectedSale.totalAmount ?? 0),
    });

    return {
      previewTotal: sumRefunds(allocated),
      previewLines: allocated.map((l) => ({ saleItemId: l.saleItemId, refundAmount: l.refundAmount })),
    };
  }, [returnItems, selectedSale]);

  const resetForm = () => {
    setForm({ saleId: '', reason: '', status: 'approved' });
    setReturnItems([]);
  };

  const handleSubmitReturn = async () => {
    if (!form.saleId) { toast.error('Please select a sale'); return; }
    if (!form.reason.trim()) { toast.error('Please enter a reason'); return; }
    const validItems = returnItems.filter((i) => i.quantity > 0);
    if (validItems.length === 0) { toast.error('Please select at least one item to return'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: form.saleId,
          reason: form.reason.trim(),
          status: form.status,
          // The server prices the refund from the sale's own totals — no amount
          // is accepted from the client, so the figure cannot be tampered with.
          items: validItems.map((i) => ({ saleItemId: i.saleItemId, quantity: i.quantity })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process return');
      }
      toast.success(
        form.status === 'approved' ? 'Return processed successfully' : 'Return held for review',
        {
          description:
            form.status === 'approved'
              ? `Refunded ${money(previewTotal)} and restored stock.`
              : 'Stock and money are untouched until you approve it.',
        }
      );
      setShowAddDialog(false);
      resetForm();
      await loadReturns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to process return');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (ret: Return, status: 'approved' | 'rejected') => {
    setActingOnId(ret.id);
    try {
      const res = await fetch(`/api/returns/${ret.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update return');
      toast.success(
        status === 'approved' ? 'Return approved' : 'Return rejected',
        {
          description:
            status === 'approved'
              ? 'Stock restored and the sale has been updated.'
              : 'The claim is closed with no stock or money moved.',
        }
      );
      await loadReturns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update return');
    } finally {
      setActingOnId(null);
    }
  };

  const handleDeleteReturn = async () => {
    if (!returnToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/returns/${returnToDelete.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel return');
      }
      toast.success('Return cancelled');
      setShowDeleteDialog(false);
      setReturnToDelete(null);
      await loadReturns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel return');
    } finally {
      setDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Approved</Badge>;
      case 'pending': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pending</Badge>;
      case 'rejected': return <Badge variant="destructive">Rejected</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const returnableSales = useMemo(
    () => sales.filter((s) => s.status !== 'returned'),
    [sales]
  );

  return (
    <div className="space-y-4 p-6">
      <div className="flex justify-end">
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Process Return
        </Button>
      </div>

      {error && <LoadError message={error} onRetry={() => setRetryNonce((n) => n + 1)} />}

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
                  <TableHead className="w-24 text-right">Actions</TableHead>
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
                      <TableCell><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : returns.length > 0 ? (
                  returns.map((ret) => (
                    <TableRow key={ret.id}>
                      <TableCell className="font-mono text-xs">RET-{ret.id.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs">{ret.sale?.invoiceNo ?? '-'}</TableCell>
                      <TableCell>{ret.sale?.customer?.name ?? 'Walk-in'}</TableCell>
                      <TableCell className="hidden md:table-cell max-w-[200px] truncate">{ret.reason}</TableCell>
                      <TableCell className="text-right font-medium">{money(ret.totalRefund)}</TableCell>
                      <TableCell>{getStatusBadge(ret.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(ret.createdAt).toLocaleDateString('en-GH')}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {ret.status === 'pending' ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                disabled={actingOnId === ret.id}
                                onClick={() => handleStatusChange(ret, 'approved')}
                                title="Approve return"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                disabled={actingOnId === ret.id}
                                onClick={() => handleStatusChange(ret, 'rejected')}
                                title="Reject return"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                disabled={actingOnId === ret.id}
                                onClick={() => { setReturnToDelete(ret); setShowDeleteDialog(true); }}
                                title="Cancel pending return"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground pr-1">Permanent</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : error ? null : (
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
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open);
          if (!open) resetForm();
        }}
      >
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
                  {returnableSales.length === 0 ? (
                    <SelectItem value="none" disabled>No sales available to return</SelectItem>
                  ) : (
                    returnableSales.map((sale) => (
                      <SelectItem key={sale.id} value={sale.id}>
                        {sale.invoiceNo} - {sale.customer?.name ?? 'Walk-in'} ({money(sale.totalAmount)})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Process as *</Label>
              <Select
                value={form.status}
                onValueChange={(value) => setForm((prev) => ({ ...prev, status: value as NewReturnStatus }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Refund now — restore stock and credit the customer</SelectItem>
                  <SelectItem value="pending">Hold for review — nothing moves until approved</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {form.status === 'approved'
                  ? 'Stock goes back to the original batch and the sale is marked as returned straight away.'
                  : 'Use this when a return needs a second pair of eyes. Nothing moves until you approve it.'}
              </p>
            </div>

            <div>
              <Label>Reason *</Label>
              <Textarea
                value={form.reason}
                onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Reason for return"
                rows={2}
              />
            </div>

            {form.saleId && (
              <div>
                <Label className="text-base font-semibold mb-2 block">Items to Return</Label>
                {loadingItems ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                ) : returnItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3">This sale has no items.</p>
                ) : (
                  <div className="space-y-2">
                    {returnItems.map((item, index) => {
                      const preview = previewLines.find((l) => l.saleItemId === item.saleItemId)?.refundAmount ?? 0;
                      const soldOut = item.maxQty <= 0;
                      return (
                        <div
                          key={item.saleItemId}
                          className={`flex items-center gap-4 p-3 border rounded-lg ${soldOut ? 'opacity-50' : ''}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              {money(item.unitPrice)} each
                              {item.alreadyReturned > 0 && ` · ${item.alreadyReturned} already returned`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs">Qty:</Label>
                            <Input
                              type="number"
                              min={0}
                              max={item.maxQty}
                              disabled={soldOut}
                              value={item.quantity || ''}
                              onChange={(e) => updateReturnQty(index, Number(e.target.value) || 0)}
                              className="w-20 text-center"
                            />
                            <span className="text-xs text-muted-foreground">/ {item.maxQty}</span>
                          </div>
                          <span className="font-medium text-sm w-28 text-right">
                            {item.quantity > 0 ? money(preview) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-end items-baseline gap-3 mt-3 pt-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    Shelf price of the units being returned
                  </span>
                  <span className="font-bold">Total Refund: {money(previewTotal)}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSubmitReturn} disabled={submitting || loadingItems}>
              {submitting
                ? 'Processing...'
                : form.status === 'approved'
                  ? 'Refund Now'
                  : 'Hold for Review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Return Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Return — RET-{returnToDelete?.id.slice(0, 8)}?</AlertDialogTitle>
            <AlertDialogDescription>
              This pending return is removed. Only pending returns can be cancelled — an approved or
              rejected return is a permanent record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDeleteReturn}
              disabled={deleting}
            >
              {deleting ? 'Cancelling...' : 'Cancel Return'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
