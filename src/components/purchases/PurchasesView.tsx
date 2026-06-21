'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, CalendarDays } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Purchase, Supplier, Product } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface PurchaseItem {
  productId: string;
  batchNumber: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  expiryDate: string;
}

export default function PurchasesView() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Delete state
  const [deletingPurchase, setDeletingPurchase] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({
    supplierId: '',
    invoiceNo: '',
  });
  const [items, setItems] = useState<PurchaseItem[]>([
    { productId: '', batchNumber: '', quantity: 1, costPrice: 0, sellingPrice: 0, expiryDate: '' },
  ]);

  useEffect(() => {
    async function init() {
      try {
        const [purchasesRes, suppliersRes, productsRes] = await Promise.all([
          fetch('/api/purchases'),
          fetch('/api/suppliers'),
          fetch('/api/products'),
        ]);
        if (purchasesRes.ok) { const d = await purchasesRes.json(); setPurchases(d.purchases ?? []); }
        if (suppliersRes.ok) { const d = await suppliersRes.json(); setSuppliers(d.suppliers ?? []); }
        if (productsRes.ok) { const d = await productsRes.json(); setProducts(d.products ?? []); }
      } catch { /* silent */ }
      setLoading(false);
    }
    init();
  }, []);

  const addItemRow = () => {
    setItems([...items, { productId: '', batchNumber: '', quantity: 1, costPrice: 0, sellingPrice: 0, expiryDate: '' }]);
  };

  const removeItemRow = (index: number) => {
    if (items.length > 1) setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof PurchaseItem, value: string | number) => {
    const updated = [...items];
    (updated[index] as Record<string, string | number>)[field] = value;
    setItems(updated);
  };

  const handleDeletePurchase = (purchase: Purchase) => {
    setDeletingPurchase(purchase);
  };

  const handleConfirmDelete = async () => {
    if (!deletingPurchase) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/purchases/${deletingPurchase.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete purchase');
      }
      toast.success('Purchase deleted successfully');
      setDeletingPurchase(null);
      const purchasesRes = await fetch('/api/purchases');
      if (purchasesRes.ok) { const d = await purchasesRes.json(); setPurchases(d.purchases ?? []); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete purchase');
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    if (!form.supplierId) { toast.error('Please select a supplier'); return; }
    if (!form.invoiceNo.trim()) { toast.error('Invoice number is required'); return; }
    const validItems = items.filter(i => i.productId && i.batchNumber && i.quantity > 0 && i.costPrice > 0 && i.sellingPrice > 0 && i.expiryDate);
    if (validItems.length === 0) { toast.error('Please add at least one valid item'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, items: validItems }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to record purchase');
      }
      toast.success('Purchase recorded successfully');
      setShowAddDialog(false);
      setForm({ supplierId: '', invoiceNo: '' });
      setItems([{ productId: '', batchNumber: '', quantity: 1, costPrice: 0, sellingPrice: 0, expiryDate: '' }]);
      const purchasesRes = await fetch('/api/purchases');
      if (purchasesRes.ok) { const d = await purchasesRes.json(); setPurchases(d.purchases ?? []); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record purchase');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex justify-end">
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Purchase
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice#</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Recorded By</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : purchases.length > 0 ? (
                  purchases.map((purchase) => (
                    <TableRow key={purchase.id}>
                      <TableCell className="font-mono text-xs">{purchase.invoiceNo}</TableCell>
                      <TableCell>{purchase.supplier?.name ?? '-'}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{purchase.batches?.length ?? 0}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatGHS(purchase.totalAmount)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(purchase.createdAt).toLocaleDateString('en-GH')}
                      </TableCell>
                      <TableCell className="text-sm">{purchase.user?.name ?? '-'}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDeletePurchase(purchase)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      No purchases recorded yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete Purchase AlertDialog */}
      <AlertDialog open={!!deletingPurchase} onOpenChange={(open) => { if (!open) setDeletingPurchase(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Purchase</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this purchase record? Associated batch data will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Purchase Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record New Purchase</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Supplier *</Label>
                <Select value={form.supplierId} onValueChange={(v) => setForm({ ...form, supplierId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Invoice Number *</Label>
                <Input value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} placeholder="e.g. INV-2024-001" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-base font-semibold">Items</Label>
                <Button variant="outline" size="sm" onClick={addItemRow}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                </Button>
              </div>
              <div className="space-y-3">
                {items.map((item, index) => (
                  <div key={index} className="border rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Item {index + 1}</span>
                      {items.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeItemRow(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Product *</Label>
                        <Select value={item.productId} onValueChange={(v) => updateItem(index, 'productId', v)}>
                          <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                          <SelectContent>
                            {products.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Batch Number *</Label>
                        <Input value={item.batchNumber} onChange={(e) => updateItem(index, 'batchNumber', e.target.value)} placeholder="e.g. BN-001" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Quantity *</Label>
                        <Input type="number" value={item.quantity || ''} onChange={(e) => updateItem(index, 'quantity', Number(e.target.value) || 0)} />
                      </div>
                      <div>
                        <Label className="text-xs">Cost Price *</Label>
                        <Input type="number" step="0.01" value={item.costPrice || ''} onChange={(e) => updateItem(index, 'costPrice', Number(e.target.value) || 0)} />
                      </div>
                      <div>
                        <Label className="text-xs">Selling Price *</Label>
                        <Input type="number" step="0.01" value={item.sellingPrice || ''} onChange={(e) => updateItem(index, 'sellingPrice', Number(e.target.value) || 0)} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Expiry Date *</Label>
                      <div className="relative">
                        <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          type="date"
                          value={item.expiryDate}
                          onChange={(e) => updateItem(index, 'expiryDate', e.target.value)}
                          className="pl-8"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSave} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Purchase'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}