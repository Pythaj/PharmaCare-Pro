'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Plus, Search, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/use-permissions';
import type { Product, Batch, Category } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface ProductWithStock extends Product {
  totalStock: number;
  batches: (Batch & { currentQty: number })[];
  earliestExpiry?: string | null;
  daysToExpiry?: number | null;
  hasExpiringBatches?: boolean;
  hasExpiredBatches?: boolean;
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock';
  expiryStatus?: 'good' | 'expiring_soon' | 'expired';
}

export default function ProductsView() {
  const { canManageProducts } = usePermissions();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', genericName: '', categoryId: '', unit: 'pcs', reorderLevel: 10 });
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [productToDelete, setProductToDelete] = useState<ProductWithStock | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  /**
   * Returns combined stock + expiry status badges.
   * A product can have multiple statuses simultaneously:
   * - Out of Stock (stock === 0)
   * - Low Stock (stock > 0 && stock <= reorderLevel)
   * - Expiring Soon (has batches within 90 days)
   * - Expired (has batches past expiry)
   */
  const getProductStatusBadges = (product: ProductWithStock) => {
    const badges: { label: string; className: string }[] = [];

    // Stock status
    if (product.totalStock === 0) {
      badges.push({ label: 'Out of Stock', className: 'bg-red-500 text-white hover:bg-red-500' });
    } else if (product.totalStock <= product.reorderLevel) {
      badges.push({ label: 'Low Stock', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-300' });
    }

    // Expiry status
    if (product.hasExpiredBatches) {
      badges.push({ label: 'Expired Batch', className: 'bg-red-100 text-red-700 hover:bg-red-100' });
    } else if (product.hasExpiringBatches) {
      badges.push({ label: 'Expiring Soon', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-300' });
    }

    // If everything is fine
    if (badges.length === 0) {
      badges.push({ label: 'In Stock', className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-300' });
    }

    return badges;
  };

  const isAlertProduct = (product: ProductWithStock) => {
    return product.stockStatus !== 'in_stock' || product.hasExpiredBatches || product.hasExpiringBatches;
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

  const handleDeleteProduct = async () => {
    if (!productToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/products/${productToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove product');
      }
      toast.success(`Product "${productToDelete.name}" removed successfully`);
      setShowDeleteDialog(false);
      setProductToDelete(null);
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove product');
    } finally {
      setDeleting(false);
    }
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
          {canManageProducts && (
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Product
            </Button>
          )}
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
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageProducts && <TableHead className="w-10"></TableHead>}
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
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : products.length > 0 ? (
                  products.map((product, index) => {
                    const badges = getProductStatusBadges(product);
                    const hasAlert = isAlertProduct(product);
                    const isExpanded = expandedRow === product.id;
                    const rowKey = product.id || `product-${index}`;
                    return (
                      <Fragment key={rowKey}>
                        <TableRow
                          className={`cursor-pointer hover:bg-muted/50 ${
                            hasAlert
                              ? product.totalStock === 0
                                ? 'bg-red-50/40'
                                : product.hasExpiredBatches
                                  ? 'bg-red-50/20'
                                  : 'bg-amber-50/20'
                              : ''
                          }`}
                          onClick={() => handleExpandRow(rowKey)}
                        >
                          <TableCell>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{product.genericName ?? '-'}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{product.category?.name ?? '-'}</Badge></TableCell>
                          <TableCell className="text-sm">{product.unit}</TableCell>
                          <TableCell className="text-right">
                            <span className={`font-mono font-semibold ${
                              product.totalStock === 0 ? 'text-red-600' :
                              product.totalStock <= product.reorderLevel ? 'text-amber-600' :
                              'text-slate-900'
                            }`}>
                              {product.totalStock}
                            </span>
                          </TableCell>
                          <TableCell>
                            {product.earliestExpiry ? (
                              <div className="flex items-center gap-1">
                                <div className={`w-1.5 h-1.5 rounded-full ${
                                  product.daysToExpiry !== null && product.daysToExpiry < 0 ? 'bg-red-500' :
                                  product.daysToExpiry !== null && product.daysToExpiry < 30 ? 'bg-red-500' :
                                  product.daysToExpiry !== null && product.daysToExpiry < 90 ? 'bg-amber-500' :
                                  'bg-emerald-500'
                                }`} />
                                <span className="text-xs">{new Date(product.earliestExpiry).toLocaleDateString('en-GH')}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {badges.map((b) => (
                                <Badge
                                  key={b.label}
                                  variant="outline"
                                  className={`text-[10px] px-1.5 py-0 h-5 ${b.className}`}
                                >
                                  {b.label}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          {canManageProducts && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                onClick={(e) => { e.stopPropagation(); setProductToDelete(product); setShowDeleteDialog(true); }}
                                title="Remove Product"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${rowKey}-batches`}>
                            <TableCell colSpan={canManageProducts ? 9 : 8} className="bg-muted/30 px-8 py-3">
                              {loadingBatches ? (
                                <div className="space-y-2">
                                  {Array.from({ length: 2 }).map((_, i) => (
                                    <Skeleton key={`batch-skel-${i}`} className="h-10 w-full" />
                                  ))}
                                </div>
                              ) : batches.length > 0 ? (
                                <div className="text-sm">
                                  <p className="font-medium mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                                    Batches for {product.name}
                                  </p>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-dotted">
                                        <th className="text-left py-1.5 font-medium text-muted-foreground">Batch#</th>
                                        <th className="text-right py-1.5 font-medium text-muted-foreground">Qty</th>
                                        <th className="text-right py-1.5 font-medium text-muted-foreground">Cost Price</th>
                                        <th className="text-right py-1.5 font-medium text-muted-foreground">Selling Price</th>
                                        <th className="text-right py-1.5 font-medium text-muted-foreground">Expiry Date</th>
                                        <th className="text-center py-1.5 font-medium text-muted-foreground">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {batches.map((batch) => {
                                        const now = new Date();
                                        const expiry = new Date(batch.expiryDate);
                                        const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                                        const isExpired = diffDays < 0;
                                        const isExpiringSoon = !isExpired && diffDays < 90;
                                        const isDepleted = batch.currentQty <= 0;

                                        let statusLabel: string;
                                        let statusClass: string;
                                        let dotColor: string;

                                        if (isDepleted) {
                                          statusLabel = 'Depleted';
                                          statusClass = 'bg-slate-100 text-slate-500';
                                          dotColor = 'bg-slate-400';
                                        } else if (isExpired) {
                                          statusLabel = 'Expired';
                                          statusClass = 'bg-red-100 text-red-700';
                                          dotColor = 'bg-red-500';
                                        } else if (isExpiringSoon) {
                                          statusLabel = diffDays < 30 ? `${diffDays}d left` : 'Expiring Soon';
                                          statusClass = diffDays < 30
                                            ? 'bg-red-100 text-red-700'
                                            : 'bg-amber-100 text-amber-700';
                                          dotColor = diffDays < 30 ? 'bg-red-500' : 'bg-amber-500';
                                        } else {
                                          statusLabel = 'Good';
                                          statusClass = 'bg-emerald-100 text-emerald-700';
                                          dotColor = 'bg-emerald-500';
                                        }

                                        return (
                                          <tr key={batch.id || `batch-${batch.batchNumber}`} className={`border-b border-dotted ${isExpired ? 'bg-red-50/40' : ''}`}>
                                            <td className="py-1.5 font-mono">{batch.batchNumber}</td>
                                            <td className="text-right font-mono font-medium">{batch.currentQty}</td>
                                            <td className="text-right">{formatGHS(batch.costPrice)}</td>
                                            <td className="text-right">{formatGHS(batch.sellingPrice)}</td>
                                            <td className="text-right">
                                              <span className={isExpired ? 'text-red-600 font-medium' : ''}>
                                                {new Date(batch.expiryDate).toLocaleDateString('en-GH')}
                                              </span>
                                            </td>
                                            <td className="text-center">
                                              <Badge className={`text-[10px] px-1.5 py-0 h-5 ${statusClass}`}>
                                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor} mr-1`} />
                                                {statusLabel}
                                              </Badge>
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
                    <TableCell colSpan={canManageProducts ? 9 : 8} className="text-center text-muted-foreground py-12">
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

      {/* Delete Product Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Product — {productToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the product and hide it from all listings. Existing sales records containing
              this product will remain unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDeleteProduct}
              disabled={deleting}
            >
              {deleting ? 'Removing...' : 'Remove Product'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
