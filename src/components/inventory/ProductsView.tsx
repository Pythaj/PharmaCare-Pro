'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Plus, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Product, Batch, Category } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface ProductWithStock extends Product {
  totalStock: number;
  batches: (Batch & { currentQty: number })[];
}

export default function ProductsView() {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', genericName: '', categoryId: '', unit: 'pcs', reorderLevel: 10 });
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProducts = useCallback(async (query: string, cat: string) => {
    try {
      let url = `/api/products?search=${encodeURIComponent(query)}`;
      if (cat && cat !== 'all') url += `&categoryId=${cat}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [prodRes, catRes] = await Promise.all([
          fetch('/api/products'),
          fetch('/api/categories'),
        ]);
        if (prodRes.ok) {
          const data = await prodRes.json();
          setProducts(data.products ?? []);
        }
        if (catRes.ok) {
          const data = await catRes.json();
          setCategories(data.categories ?? []);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    init();
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchProducts(value, categoryFilter);
    }, 300);
  };

  const handleCategoryChange = (value: string) => {
    setCategoryFilter(value);
    fetchProducts(search, value);
  };

  const getStockStatus = (qty: number, reorderLevel: number) => {
    if (qty === 0) return { label: 'Out of Stock', variant: 'destructive' as const };
    if (qty <= reorderLevel) return { label: 'Low Stock', variant: 'default' as const };
    return { label: 'In Stock', variant: 'default' as const };
  };

  const handleAddProduct = async () => {
    if (!addForm.name.trim()) { toast.error('Product name is required'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add product');
      }
      toast.success('Product added successfully');
      setShowAddDialog(false);
      setAddForm({ name: '', genericName: '', categoryId: '', unit: 'pcs', reorderLevel: 10 });
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add product');
    } finally {
      setSubmitting(false);
    }
  };

  const [batches, setBatches] = useState<(Batch & { currentQty: number })[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  const handleExpandRow = async (productId: string) => {
    if (expandedRow === productId) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(productId);
    setLoadingBatches(true);
    try {
      const res = await fetch(`/api/products/${productId}`);
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches ?? []);
      }
    } catch { /* silent */ }
    setLoadingBatches(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search products..." value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-3 items-center">
          <Select value={categoryFilter} onValueChange={handleCategoryChange}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Product
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Generic Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Stock Qty</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : products.length > 0 ? (
                  products.map((product) => {
                    const status = getStockStatus(product.totalStock, product.reorderLevel);
                    const isExpanded = expandedRow === product.id;
                    return (
                      <Fragment key={product.id}>
                        <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => handleExpandRow(product.id)}>
                          <TableCell>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell className="text-muted-foreground">{product.genericName ?? '-'}</TableCell>
                          <TableCell><Badge variant="outline">{product.category?.name ?? '-'}</Badge></TableCell>
                          <TableCell>{product.unit}</TableCell>
                          <TableCell className="text-right font-mono">{product.totalStock}</TableCell>
                          <TableCell>
                            <Badge
                              variant={status.variant}
                              className={
                                status.label === 'In Stock' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' :
                                status.label === 'Low Stock' ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' :
                                ''
                              }
                            >
                              {status.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${product.id}-batches`}>
                            <TableCell colSpan={7} className="bg-muted/30 px-8 py-3">
                              {loadingBatches ? (
                                <div className="space-y-2">
                                  {Array.from({ length: 2 }).map((_, i) => (
                                    <Skeleton key={i} className="h-10 w-full" />
                                  ))}
                                </div>
                              ) : batches.length > 0 ? (
                                <div className="text-sm">
                                  <p className="font-medium mb-2">Batches for {product.name}</p>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="text-left py-1.5 font-medium">Batch#</th>
                                        <th className="text-right py-1.5 font-medium">Qty</th>
                                        <th className="text-right py-1.5 font-medium">Cost Price</th>
                                        <th className="text-right py-1.5 font-medium">Selling Price</th>
                                        <th className="text-right py-1.5 font-medium">Expiry Date</th>
                                        <th className="text-center py-1.5 font-medium">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {batches.map((batch) => {
                                        const isExpired = new Date(batch.expiryDate) < new Date();
                                        const isExpiringSoon = !isExpired && new Date(batch.expiryDate).getTime() - Date.now() < 90 * 24 * 60 * 60 * 1000;
                                        return (
                                          <tr key={batch.id} className="border-b border-dotted">
                                            <td className="py-1.5 font-mono">{batch.batchNumber}</td>
                                            <td className="text-right font-mono">{batch.currentQty}</td>
                                            <td className="text-right">{formatGHS(batch.costPrice)}</td>
                                            <td className="text-right">{formatGHS(batch.sellingPrice)}</td>
                                            <td className="text-right">{new Date(batch.expiryDate).toLocaleDateString('en-GH')}</td>
                                            <td className="text-center">
                                              {isExpired ? (
                                                <Badge variant="destructive">Expired</Badge>
                                              ) : isExpiringSoon ? (
                                                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Expiring Soon</Badge>
                                              ) : (
                                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Good</Badge>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">No batches found</p>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      No products found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Product Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Product Name *</Label>
              <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Paracetamol 500mg" />
            </div>
            <div>
              <Label>Generic Name</Label>
              <Input value={addForm.genericName} onChange={(e) => setAddForm({ ...addForm, genericName: e.target.value })} placeholder="e.g. Acetaminophen" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={addForm.categoryId} onValueChange={(v) => setAddForm({ ...addForm, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Unit</Label>
                <Select value={addForm.unit} onValueChange={(v) => setAddForm({ ...addForm, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">Pieces</SelectItem>
                    <SelectItem value="box">Box</SelectItem>
                    <SelectItem value="strip">Strip</SelectItem>
                    <SelectItem value="bottle">Bottle</SelectItem>
                    <SelectItem value="sachet">Sachet</SelectItem>
                    <SelectItem value="tube">Tube</SelectItem>
                    <SelectItem value="pack">Pack</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reorder Level</Label>
                <Input type="number" value={addForm.reorderLevel} onChange={(e) => setAddForm({ ...addForm, reorderLevel: Number(e.target.value) || 0 })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleAddProduct} disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}