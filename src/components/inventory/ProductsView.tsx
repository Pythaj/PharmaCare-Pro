'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Plus, Search, ChevronDown, ChevronRight, Trash2, Tag, TrendingUp, DollarSign, Pencil, ArrowRightLeft, CircleAlert, Percent, Calculator, Zap, Check, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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

function formatNum(value: number): string {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function calcMargin(cost: number, selling: number): number {
  if (!selling || selling <= 0) return 0;
  return ((selling - cost) / selling) * 100;
}

function calcMarkup(cost: number, selling: number): number {
  if (!cost || cost <= 0) return 0;
  return ((selling - cost) / cost) * 100;
}

function applyMarkup(cost: number, markupPct: number): number {
  return Math.round((cost * (1 + markupPct / 100)) * 100) / 100;
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

// ─── Premium Margin Badge ───
function MarginBadge({ cost, selling }: { cost: number; selling: number }) {
  const margin = calcMargin(cost, selling);
  const markup = calcMarkup(cost, selling);

  if (cost === 0 && selling === 0) {
    return <span className="text-slate-400 text-xs">Not set</span>;
  }
  if (selling === 0) {
    return <span className="text-slate-400 text-xs">No price</span>;
  }

  const isProfit = margin > 0;
  const isLoss = margin < 0;

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-[11px] font-bold tabular-nums ${
        isProfit ? 'text-emerald-600' : isLoss ? 'text-red-500' : 'text-slate-500'
      }`}>
        {isProfit ? '+' : ''}{margin.toFixed(1)}% margin
      </span>
      <span className="text-[9px] text-slate-400 tabular-nums">
        {markup.toFixed(0)}% markup
      </span>
    </div>
  );
}

// ─── Premium Markup Calculator ───
function MarkupCalculator({
  costPrice,
  sellingPrice,
  onCostChange,
  onSellingChange,
}: {
  costPrice: number;
  sellingPrice: number;
  onCostChange: (v: number) => void;
  onSellingChange: (v: number) => void;
}) {
  const [markupInput, setMarkupInput] = useState('');
  const [activePreset, setActivePreset] = useState<number | null>(null);

  const presets = [
    { label: '25%', value: 25 },
    { label: '30%', value: 30 },
    { label: '50%', value: 50 },
    { label: '75%', value: 75 },
    { label: '100%', value: 100 },
    { label: '150%', value: 150 },
  ];

  const handleApplyMarkup = (pct: number) => {
    if (costPrice <= 0) {
      toast.error('Set cost price first');
      return;
    }
    const newSelling = applyMarkup(costPrice, pct);
    onSellingChange(newSelling);
    setMarkupInput(String(pct));
    setActivePreset(pct);
  };

  const handleCustomMarkup = () => {
    const pct = parseFloat(markupInput);
    if (isNaN(pct) || pct < 0) return;
    handleApplyMarkup(pct);
  };

  const profit = sellingPrice - costPrice;
  const margin = calcMargin(costPrice, sellingPrice);
  const markup = calcMarkup(costPrice, sellingPrice);

  return (
    <div className="space-y-3">
      {/* Preset markup buttons */}
      <div>
        <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5 block">
          Quick Markup
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleApplyMarkup(p.value)}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all ${
                activePreset === p.value
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom markup */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-[11px] text-slate-500">Custom %</Label>
          <div className="relative mt-1">
            <Input
              type="number"
              placeholder="e.g. 40"
              value={markupInput}
              onChange={(e) => { setMarkupInput(e.target.value); setActivePreset(null); }}
              className="pr-7 h-9 text-sm bg-white/70 border-emerald-200/50"
              onKeyDown={(e) => e.key === 'Enter' && handleCustomMarkup()}
            />
            <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 px-3 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          onClick={handleCustomMarkup}
        >
          Apply
        </Button>
      </div>

      {/* Live stats */}
      {(costPrice > 0 || sellingPrice > 0) && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded-lg bg-white/60 border border-slate-100 px-2.5 py-2 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">Profit</p>
            <p className={`text-sm font-bold tabular-nums mt-0.5 ${profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-red-500' : 'text-slate-500'}`}>
              {formatGHS(profit)}
            </p>
          </div>
          <div className="rounded-lg bg-white/60 border border-slate-100 px-2.5 py-2 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">Margin</p>
            <p className={`text-sm font-bold tabular-nums mt-0.5 ${margin > 0 ? 'text-emerald-600' : margin < 0 ? 'text-red-500' : 'text-slate-500'}`}>
              {margin.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg bg-white/60 border border-slate-100 px-2.5 py-2 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">Markup</p>
            <p className="text-sm font-bold tabular-nums mt-0.5 text-slate-700">
              {markup.toFixed(0)}%
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline Quick Price Popover ───
function InlinePriceEditor({
  product,
  onUpdated,
}: {
  product: ProductWithStock;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [costPrice, setCostPrice] = useState(product.defaultCostPrice ?? 0);
  const [sellingPrice, setSellingPrice] = useState(product.defaultSellingPrice ?? 0);
  const [applyToBatches, setApplyToBatches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markupInput, setMarkupInput] = useState('');

  useEffect(() => {
    if (open) {
      setCostPrice(product.defaultCostPrice ?? 0);
      setSellingPrice(product.defaultSellingPrice ?? 0);
      setApplyToBatches(false);
      setMarkupInput('');
    }
  }, [open, product]);

  const handleQuickSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${product.id}/update-prices`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCostPrice: costPrice, defaultSellingPrice: sellingPrice, applyToBatches }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update');
      }
      toast.success(`Price updated for "${product.name}"`);
      setOpen(false);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickMarkup = () => {
    const pct = parseFloat(markupInput);
    if (isNaN(pct) || pct < 0 || costPrice <= 0) return;
    setSellingPrice(applyMarkup(costPrice, pct));
  };

  const profit = sellingPrice - costPrice;
  const margin = calcMargin(costPrice, sellingPrice);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="group inline-flex items-center gap-1.5 font-bold text-emerald-700 hover:text-emerald-800 transition-colors rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-emerald-50/80"
          onClick={(e) => e.stopPropagation()}
        >
          {product.defaultSellingPrice > 0 ? formatGHS(product.defaultSellingPrice) : <span className="text-amber-500 font-medium text-xs">Set Price</span>}
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0 gap-0" align="start" side="bottom" sideOffset={4}>
        <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/50">
          <p className="font-semibold text-xs text-slate-800 truncate">{product.name}</p>
          <p className="text-[10px] text-slate-400">Quick Price Editor</p>
        </div>
        <div className="p-3.5 space-y-3">
          {/* Price inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Cost Price</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costPrice || ''}
                onChange={(e) => setCostPrice(parseFloat(e.target.value) || 0)}
                className="mt-1 h-8 text-sm bg-white border-slate-200 font-mono"
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Selling Price</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice || ''}
                onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                className="mt-1 h-8 text-sm bg-white border-emerald-200 font-mono font-semibold text-emerald-700 focus-visible:ring-emerald-300/50"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Quick markup row */}
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              placeholder="%"
              value={markupInput}
              onChange={(e) => setMarkupInput(e.target.value)}
              className="h-7 w-16 text-[11px] text-center bg-slate-50 border-slate-200"
              onKeyDown={(e) => e.key === 'Enter' && handleQuickMarkup()}
            />
            <Percent className="h-3 w-3 text-slate-400 -ml-5" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 ml-1"
              onClick={handleQuickMarkup}
            >
              <Calculator className="h-3 w-3 mr-1" />
              Apply Markup
            </Button>
          </div>

          {/* Live profit preview */}
          {(costPrice > 0 || sellingPrice > 0) && (
            <div className={`flex items-center justify-between rounded-lg px-2.5 py-2 border ${
              profit > 0 ? 'bg-emerald-50/80 border-emerald-200/60' : profit < 0 ? 'bg-red-50/80 border-red-200/60' : 'bg-slate-50 border-slate-200'
            }`}>
              <span className="text-[10px] text-slate-500">Profit per unit</span>
              <span className={`text-xs font-bold tabular-nums ${profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                {formatGHS(profit)} · {margin.toFixed(1)}% margin
              </span>
            </div>
          )}

          {/* Apply to batches */}
          {(product._count?.batches ?? 0) > 0 && (
            <label className="flex items-center gap-2 cursor-pointer group">
              <Switch checked={applyToBatches} onCheckedChange={setApplyToBatches} className="scale-90" />
              <span className="text-[11px] text-slate-500 group-hover:text-slate-700 transition-colors">
                Also update <span className="font-semibold text-slate-700">{product._count?.batches}</span> batch{((product._count?.batches ?? 0) !== 1) ? 'es' : ''}
              </span>
            </label>
          )}

          {/* Save */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleQuickSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : <><Check className="h-3 w-3 mr-1" /> Save Price</>}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ═══════════════════════════════════════════════
// ─── MAIN COMPONENT ───
// ═══════════════════════════════════════════════

export default function ProductsView() {
  const { canManageProducts } = usePermissions();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    genericName: '',
    categoryId: '',
    unit: 'pcs',
    reorderLevel: 10,
    defaultCostPrice: 0,
    defaultSellingPrice: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [productToDelete, setProductToDelete] = useState<ProductWithStock | null>(null);
  const [deleting, setDeleting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit Price dialog state
  const [showEditPriceDialog, setShowEditPriceDialog] = useState(false);
  const [editPriceProduct, setEditPriceProduct] = useState<ProductWithStock | null>(null);
  const [editCostPrice, setEditCostPrice] = useState(0);
  const [editSellingPrice, setEditSellingPrice] = useState(0);
  const [editApplyToBatches, setEditApplyToBatches] = useState(false);
  const [updatingPrice, setUpdatingPrice] = useState(false);

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

  const getProductStatusBadges = (product: ProductWithStock) => {
    const badges: { label: string; className: string }[] = [];

    if (product.totalStock === 0) {
      badges.push({ label: 'Out of Stock', className: 'bg-red-500 text-white hover:bg-red-500' });
    } else if (product.totalStock <= product.reorderLevel) {
      badges.push({ label: 'Low Stock', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-300' });
    }

    if (product.hasExpiredBatches) {
      badges.push({ label: 'Expired Batch', className: 'bg-red-100 text-red-700 hover:bg-red-100' });
    } else if (product.hasExpiringBatches) {
      badges.push({ label: 'Expiring Soon', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-300' });
    }

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
      toast.success(`"${addForm.name}" added with price ${formatGHS(addForm.defaultSellingPrice)}`);
      setShowAddDialog(false);
      setAddForm({
        name: '',
        genericName: '',
        categoryId: '',
        unit: 'pcs',
        reorderLevel: 10,
        defaultCostPrice: 0,
        defaultSellingPrice: 0,
      });
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

  // ---- Edit Price handlers ----
  const openEditPriceDialog = (product: ProductWithStock) => {
    setEditPriceProduct(product);
    setEditCostPrice(product.defaultCostPrice ?? 0);
    setEditSellingPrice(product.defaultSellingPrice ?? 0);
    setEditApplyToBatches(false);
    setShowEditPriceDialog(true);
  };

  const handleUpdatePrice = async () => {
    if (!editPriceProduct) return;
    setUpdatingPrice(true);
    try {
      const res = await fetch(`/api/products/${editPriceProduct.id}/update-prices`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultCostPrice: editCostPrice,
          defaultSellingPrice: editSellingPrice,
          applyToBatches: editApplyToBatches,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update prices');
      }
      const data = await res.json();
      toast.success(data.message || `Prices updated for "${editPriceProduct.name}"`);
      setShowEditPriceDialog(false);
      setEditPriceProduct(null);
      fetchProducts(search, categoryFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update prices');
    } finally {
      setUpdatingPrice(false);
    }
  };

  // Price stats
  const productsWithPrice = products.filter(p => p.defaultSellingPrice > 0).length;
  const productsWithoutPrice = products.length - productsWithPrice;

  // Number of columns
  const totalCols = canManageProducts ? 11 : 10;

  return (
    <div className="space-y-4 p-6">

      {/* ─── Header Bar ─── */}
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

      {/* ─── Price Summary Cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-slate-200/80">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-slate-500" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Total Products</p>
                <p className="text-lg font-bold text-slate-800 tabular-nums">{products.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200/60 bg-emerald-50/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Tag className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] text-emerald-600/70 uppercase tracking-wider">Priced</p>
                <p className="text-lg font-bold text-emerald-700 tabular-nums">{productsWithPrice}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {productsWithoutPrice > 0 && (
          <Card className="border-amber-200/60 bg-amber-50/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <CircleAlert className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-[10px] text-amber-600/70 uppercase tracking-wider">No Price</p>
                  <p className="text-lg font-bold text-amber-700 tabular-nums">{productsWithoutPrice}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="border-slate-200/80">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Avg Margin</p>
                <p className="text-lg font-bold text-emerald-700 tabular-nums">
                  {productsWithPrice > 0
                    ? (products.filter(p => p.defaultSellingPrice > 0).reduce((sum, p) => sum + calcMargin(p.defaultCostPrice, p.defaultSellingPrice), 0) / productsWithPrice).toFixed(1) + '%'
                    : '—'
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Products Table ─── */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Cost Price</TableHead>
                  <TableHead className="text-right">Selling Price</TableHead>
                  <TableHead className="text-center hidden md:table-cell">Margin</TableHead>
                  <TableHead className="hidden md:table-cell">Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageProducts && <TableHead className="w-20 text-center">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      {canManageProducts && <TableCell><Skeleton className="h-4 w-20 mx-auto" /></TableCell>}
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
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium text-sm">{product.name}</span>
                              {product.genericName && (
                                <span className="text-[11px] text-muted-foreground">{product.genericName}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] px-1.5">{product.category?.name ?? '—'}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`font-mono font-semibold text-sm ${
                              product.totalStock === 0 ? 'text-red-600' :
                              product.totalStock <= product.reorderLevel ? 'text-amber-600' :
                              'text-slate-900'
                            }`}>
                              {product.totalStock}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-0.5">{product.unit}</span>
                          </TableCell>
                          <TableCell className="text-right hidden md:table-cell">
                            {product.defaultCostPrice > 0 ? (
                              <span className="text-xs text-slate-500 font-mono">{formatGHS(product.defaultCostPrice)}</span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {canManageProducts ? (
                              <InlinePriceEditor
                                product={product}
                                onUpdated={() => fetchProducts(search, categoryFilter)}
                              />
                            ) : (
                              product.defaultSellingPrice > 0 ? (
                                <span className="font-bold text-emerald-700 text-sm">{formatGHS(product.defaultSellingPrice)}</span>
                              ) : (
                                <span className="text-amber-500 font-medium text-xs">Not set</span>
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-center hidden md:table-cell">
                            <MarginBadge cost={product.defaultCostPrice} selling={product.defaultSellingPrice} />
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {product.earliestExpiry ? (
                              <div className="flex items-center gap-1">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  product.daysToExpiry !== null && product.daysToExpiry < 0 ? 'bg-red-500' :
                                  product.daysToExpiry !== null && product.daysToExpiry < 30 ? 'bg-red-500' :
                                  product.daysToExpiry !== null && product.daysToExpiry < 90 ? 'bg-amber-500' :
                                  'bg-emerald-500'
                                }`} />
                                <span className="text-[11px]">{new Date(product.earliestExpiry).toLocaleDateString('en-GH')}</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
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
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={(e) => { e.stopPropagation(); openEditPriceDialog(product); }}
                                  title="Edit Price"
                                >
                                  <Tag className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                  onClick={(e) => { e.stopPropagation(); setProductToDelete(product); setShowDeleteDialog(true); }}
                                  title="Remove Product"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${rowKey}-batches`}>
                            <TableCell colSpan={totalCols} className="bg-muted/30 px-8 py-3">
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
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-dotted">
                                          <th className="text-left py-1.5 font-medium text-muted-foreground">Batch#</th>
                                          <th className="text-right py-1.5 font-medium text-muted-foreground">Qty</th>
                                          <th className="text-right py-1.5 font-medium text-muted-foreground">Cost Price</th>
                                          <th className="text-right py-1.5 font-medium text-muted-foreground">Selling Price</th>
                                          <th className="text-center py-1.5 font-medium text-muted-foreground">Margin</th>
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

                                          const batchMargin = calcMargin(batch.costPrice, batch.sellingPrice);

                                          return (
                                            <tr key={batch.id || `batch-${batch.batchNumber}`} className={`border-b border-dotted ${isExpired ? 'bg-red-50/40' : ''}`}>
                                              <td className="py-1.5 font-mono">{batch.batchNumber}</td>
                                              <td className="text-right font-mono font-medium">{batch.currentQty}</td>
                                              <td className="text-right font-mono">{formatGHS(batch.costPrice)}</td>
                                              <td className="text-right font-mono font-semibold text-emerald-700">{formatGHS(batch.sellingPrice)}</td>
                                              <td className="text-center">
                                                <span className={`text-[10px] font-semibold tabular-nums ${
                                                  batchMargin > 0 ? 'text-emerald-600' : batchMargin < 0 ? 'text-red-500' : 'text-slate-400'
                                                }`}>
                                                  {batchMargin > 0 ? '+' : ''}{batchMargin.toFixed(1)}%
                                                </span>
                                              </td>
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
                                  {canManageProducts && batches.length > 0 && (
                                    <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
                                      <Tag className="h-3 w-3" />
                                      To update batch prices, click the <span className="font-medium text-emerald-600">selling price</span> above or use the <span className="font-medium text-emerald-600">Edit Price</span> button with <span className="font-medium">&quot;Apply to batches&quot;</span>.
                                    </p>
                                  )}
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
                    <TableCell colSpan={totalCols} className="text-center text-muted-foreground py-12">
                      No products found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── ADD PRODUCT DIALOG (Premium with Pricing) ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={showAddDialog} onOpenChange={(open) => {
        if (!open) {
          setAddForm({
            name: '',
            genericName: '',
            categoryId: '',
            unit: 'pcs',
            reorderLevel: 10,
            defaultCostPrice: 0,
            defaultSellingPrice: 0,
          });
        }
        setShowAddDialog(open);
      }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Plus className="h-4 w-4 text-white" />
              </div>
              Add New Product
            </DialogTitle>
            <DialogDescription>Set up the product details and pricing below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {/* Basic Info Section */}
            <div className="space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <div className="h-1 w-4 rounded-full bg-slate-300" />
                Basic Information
              </div>
              <div>
                <Label className="text-xs font-medium">Product Name <span className="text-red-500">*</span></Label>
                <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Paracetamol 500mg" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-medium">Generic Name</Label>
                <Input value={addForm.genericName} onChange={(e) => setAddForm({ ...addForm, genericName: e.target.value })} placeholder="e.g. Acetaminophen" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-medium">Category</Label>
                <Select value={addForm.categoryId} onValueChange={(v) => setAddForm({ ...addForm, categoryId: v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Unit</Label>
                  <Select value={addForm.unit} onValueChange={(v) => setAddForm({ ...addForm, unit: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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
                  <Label className="text-xs font-medium">Reorder Level</Label>
                  <Input type="number" value={addForm.reorderLevel} onChange={(e) => setAddForm({ ...addForm, reorderLevel: Number(e.target.value) || 0 })} className="mt-1" />
                </div>
              </div>
            </div>

            {/* ─── Premium Pricing Section ─── */}
            <div className="relative rounded-xl border-2 border-emerald-200/60 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/30 overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-100/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl pointer-events-none" />
              <div className="relative p-5 space-y-4">
                {/* Section header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-200">
                      <DollarSign className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <Label className="text-sm font-bold text-emerald-800">Set Product Price</Label>
                      <p className="text-[10px] text-emerald-600/60">Define cost and selling price for this drug</p>
                    </div>
                  </div>
                  {addForm.defaultSellingPrice > 0 && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
                      <Check className="h-2.5 w-2.5 mr-1" />
                      Price set
                    </Badge>
                  )}
                </div>

                {/* Price inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Cost Price (GHS)</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={addForm.defaultCostPrice || ''}
                        onChange={(e) => setAddForm({ ...addForm, defaultCostPrice: parseFloat(e.target.value) || 0 })}
                        className="h-10 bg-white/80 border-emerald-200/60 focus-visible:ring-emerald-300/50 font-mono text-sm pl-8"
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">GHS</span>
                    </div>
                    <p className="text-[10px] text-slate-400">What you paid the supplier</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wider">Selling Price (GHS)</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={addForm.defaultSellingPrice || ''}
                        onChange={(e) => setAddForm({ ...addForm, defaultSellingPrice: parseFloat(e.target.value) || 0 })}
                        className="h-10 bg-white/80 border-emerald-300/60 focus-visible:ring-emerald-400/50 font-mono text-sm font-bold text-emerald-700 pl-8"
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-emerald-500 font-semibold">GHS</span>
                    </div>
                    <p className="text-[10px] text-emerald-600/60">What the customer pays</p>
                  </div>
                </div>

                {/* Markup Calculator */}
                <MarkupCalculator
                  costPrice={addForm.defaultCostPrice}
                  sellingPrice={addForm.defaultSellingPrice}
                  onCostChange={(v) => setAddForm({ ...addForm, defaultCostPrice: v })}
                  onSellingChange={(v) => setAddForm({ ...addForm, defaultSellingPrice: v })}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px]"
              onClick={handleAddProduct}
              disabled={submitting}
            >
              {submitting ? (
                <span className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Adding...</span>
              ) : (
                <><Plus className="h-4 w-4 mr-1" /> Add Product</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── EDIT PRICE DIALOG (Premium with Comparison) ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={showEditPriceDialog} onOpenChange={setShowEditPriceDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Tag className="h-4 w-4 text-white" />
              </div>
              <div>
                <span className="block">Update Price</span>
                <span className="text-sm font-normal text-slate-500">{editPriceProduct?.name}</span>
              </div>
            </DialogTitle>
            <DialogDescription>Change the default cost and selling price for this product.</DialogDescription>
          </DialogHeader>

          {editPriceProduct && (
            <div className="space-y-4">
              {/* Current vs New comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Current Prices</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-slate-400">Cost</p>
                      <p className="text-base font-semibold font-mono">{formatGHS(editPriceProduct.defaultCostPrice ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400">Selling</p>
                      <p className="text-base font-bold font-mono text-emerald-700">{formatGHS(editPriceProduct.defaultSellingPrice ?? 0)}</p>
                    </div>
                    <div className="pt-1.5 border-t border-slate-200/60">
                      <MarginBadge cost={editPriceProduct.defaultCostPrice ?? 0} selling={editPriceProduct.defaultSellingPrice ?? 0} />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border-2 border-emerald-200/60 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/20 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-2">New Prices</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-slate-400">Cost</p>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editCostPrice || ''}
                        onChange={(e) => setEditCostPrice(parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm font-mono bg-white/70 border-emerald-200/50 focus-visible:ring-emerald-300/50"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400">Selling</p>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editSellingPrice || ''}
                        onChange={(e) => setEditSellingPrice(parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm font-mono font-bold text-emerald-700 bg-white/70 border-emerald-200/50 focus-visible:ring-emerald-300/50"
                      />
                    </div>
                    <div className="pt-1.5 border-t border-emerald-200/40">
                      <MarginBadge cost={editCostPrice} selling={editSellingPrice} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Price change indicator */}
              {(editCostPrice !== (editPriceProduct.defaultCostPrice ?? 0) || editSellingPrice !== (editPriceProduct.defaultSellingPrice ?? 0)) && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border ${
                  editSellingPrice > (editPriceProduct.defaultSellingPrice ?? 0)
                    ? 'bg-emerald-50 border-emerald-200/60'
                    : editSellingPrice < (editPriceProduct.defaultSellingPrice ?? 0)
                    ? 'bg-red-50 border-red-200/60'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <ArrowRightLeft className="h-4 w-4 text-slate-400 shrink-0" />
                  <div className="text-xs">
                    {editSellingPrice !== (editPriceProduct.defaultSellingPrice ?? 0) && (
                      <span className="font-medium">
                        Selling: {formatGHS(editPriceProduct.defaultSellingPrice ?? 0)} → {formatGHS(editSellingPrice)}
                        {' '}
                        <span className={editSellingPrice > (editPriceProduct.defaultSellingPrice ?? 0) ? 'text-emerald-600' : 'text-red-500'}>
                          ({editSellingPrice > (editPriceProduct.defaultSellingPrice ?? 0) ? '+' : ''}{formatGHS(editSellingPrice - (editPriceProduct.defaultSellingPrice ?? 0))})
                        </span>
                      </span>
                    )}
                    {editCostPrice !== (editPriceProduct.defaultCostPrice ?? 0) && (
                      <span className="text-muted-foreground ml-2">
                        Cost: {formatGHS(editCostPrice - (editPriceProduct.defaultCostPrice ?? 0))}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Markup Calculator */}
              <div className="rounded-lg border border-slate-200 p-4 bg-slate-50/30">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <Calculator className="h-3 w-3" />
                  Quick Markup Calculator
                </p>
                <MarkupCalculator
                  costPrice={editCostPrice}
                  sellingPrice={editSellingPrice}
                  onCostChange={setEditCostPrice}
                  onSellingChange={setEditSellingPrice}
                />
              </div>

              {/* Apply to batches toggle */}
              {(editPriceProduct._count?.batches ?? 0) > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-3.5 bg-white">
                  <Switch
                    checked={editApplyToBatches}
                    onCheckedChange={setEditApplyToBatches}
                    className="mt-0.5"
                    id="apply-to-batches"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="apply-to-batches" className="text-sm font-medium cursor-pointer">
                      Apply to existing batches
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Also update prices for all <span className="font-semibold text-slate-700">{editPriceProduct._count?.batches ?? 0}</span> existing batches of this product.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowEditPriceDialog(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[130px]"
              onClick={handleUpdatePrice}
              disabled={updatingPrice}
            >
              {updatingPrice ? (
                <span className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Updating...</span>
              ) : (
                <><Check className="h-4 w-4 mr-1" /> Update Prices</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Product Confirmation ─── */}
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