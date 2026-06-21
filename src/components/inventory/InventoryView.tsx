'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Package,
  DollarSign,
  AlertTriangle,
  Clock,
  XCircle,
  PackageX,
  TrendingDown,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useAppStore } from '@/stores/app-store';
import { usePermissions } from '@/hooks/use-permissions';
import { motion, AnimatePresence } from 'framer-motion';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

// ===== Alert Types =====
interface OutOfStockItem {
  productId: string;
  productName: string;
  genericName: string | null;
  categoryName: string | null;
  unit: string;
  reorderLevel: number;
  totalStock: number;
}

interface LowStockItem {
  productId: string;
  productName: string;
  genericName: string | null;
  categoryName: string | null;
  unit: string;
  totalStock: number;
  reorderLevel: number;
  shortage: number;
}

interface ExpiringSoonItem {
  productId: string;
  productName: string;
  genericName: string | null;
  categoryName: string | null;
  batchId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  daysToExpiry: number;
}

interface ExpiredItem {
  productId: string;
  productName: string;
  genericName: string | null;
  categoryName: string | null;
  batchId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  daysExpired: number;
}

interface AlertSummary {
  totalItems: number;
  itemsInStock: number;
  totalInventoryValue: number;
  outOfStockCount: number;
  lowStockCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  criticalAlerts: number;
}

interface InventoryAlerts {
  summary: AlertSummary;
  outOfStock: OutOfStockItem[];
  lowStock: LowStockItem[];
  expiringSoon: ExpiringSoonItem[];
  expired: ExpiredItem[];
}

interface ProductWithBatches {
  id: string;
  name: string;
  genericName?: string | null;
  unit: string;
  reorderLevel: number;
  totalStock: number;
  inventoryValue?: number;
  earliestExpiry?: string | null;
  daysToExpiry?: number | null;
  hasExpiringBatches: boolean;
  hasExpiredBatches: boolean;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  expiryStatus: 'good' | 'expiring_soon' | 'expired';
  category?: { id: string; name: string } | null;
  batches: {
    id: string;
    batchNumber: string;
    currentQty: number;
    quantity: number;
    costPrice: number;
    sellingPrice: number;
    expiryDate: string;
  }[];
}

type StockFilter = 'all' | 'out_of_stock' | 'low_stock' | 'expiring_soon' | 'expired';

export default function InventoryView() {
  const [alerts, setAlerts] = useState<InventoryAlerts | null>(null);
  const [products, setProducts] = useState<ProductWithBatches[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useAppStore((s) => s.navigate);
  const { canManageInventory } = usePermissions();

  // Expanded alert sections
  const [expandedAlerts, setExpandedAlerts] = useState<Record<string, boolean>>({
    out_of_stock: true,
    low_stock: true,
    expiring_soon: true,
    expired: true,
  });

  const toggleAlert = (key: string) => {
    setExpandedAlerts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/alerts');
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch { /* silent */ }
  }, []);

  const fetchProducts = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.products ?? []).map((p: any) => ({
          ...p,
          batches: p.batches?.map((b: any) => ({ ...b, currentQty: b.quantity })) ?? [],
        }));
        setProducts(mapped);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [alertsRes, productsRes] = await Promise.all([
          fetch('/api/inventory/alerts'),
          fetch('/api/products?search='),
        ]);
        if (alertsRes.ok && !cancelled) {
          const data = await alertsRes.json();
          setAlerts(data);
        }
        if (productsRes.ok && !cancelled) {
          const data = await productsRes.json();
          const mapped = (data.products ?? []).map((p: any) => ({
            ...p,
            batches: p.batches?.map((b: any) => ({ ...b, currentQty: b.quantity })) ?? [],
          }));
          setProducts(mapped);
        }
      } catch { /* silent */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProducts(value), 300);
  };

  // Filter products based on selected filter
  const filteredProducts = products.filter((p) => {
    switch (filter) {
      case 'out_of_stock': return p.stockStatus === 'out_of_stock';
      case 'low_stock': return p.stockStatus === 'low_stock';
      case 'expiring_soon': return p.expiryStatus === 'expiring_soon' || p.hasExpiringBatches;
      case 'expired': return p.expiryStatus === 'expired' || p.hasExpiredBatches;
      default: return true;
    }
  });

  const getBatchStatus = (batch: { expiryDate: string; currentQty: number }) => {
    const now = new Date();
    const expiry = new Date(batch.expiryDate);
    const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (batch.currentQty <= 0) return { label: 'Depleted', className: 'bg-slate-100 text-slate-500', dotColor: 'bg-slate-400' };
    if (diffDays < 0) return { label: 'Expired', className: 'bg-red-100 text-red-700', dotColor: 'bg-red-500' };
    if (diffDays < 30) return { label: `${diffDays}d left`, className: 'bg-red-100 text-red-700', dotColor: 'bg-red-500' };
    if (diffDays < 90) return { label: `${diffDays}d left`, className: 'bg-amber-100 text-amber-700', dotColor: 'bg-amber-500' };
    return { label: 'Good', className: 'bg-emerald-100 text-emerald-700', dotColor: 'bg-emerald-500' };
  };

  const getProductStatusBadge = (product: ProductWithBatches) => {
    const badges: { label: string; variant: 'default' | 'destructive' | 'outline'; className: string }[] = [];

    if (product.stockStatus === 'out_of_stock') {
      badges.push({ label: 'Out of Stock', variant: 'destructive', className: 'bg-red-500 text-white hover:bg-red-600' });
    } else if (product.stockStatus === 'low_stock') {
      badges.push({ label: 'Low Stock', variant: 'default', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-300' });
    }

    if (product.hasExpiredBatches) {
      badges.push({ label: 'Expired Batch', variant: 'destructive', className: 'bg-red-100 text-red-700 hover:bg-red-100' });
    } else if (product.hasExpiringBatches) {
      badges.push({ label: 'Expiring Soon', variant: 'default', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-300' });
    }

    if (product.stockStatus === 'in_stock' && !product.hasExpiringBatches && !product.hasExpiredBatches) {
      badges.push({ label: 'In Stock', variant: 'default', className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-300' });
    }

    return badges;
  };

  const filterButtons: { label: string; value: StockFilter; icon: React.ElementType; count: number; activeColor: string }[] = [
    { label: 'All Items', value: 'all', icon: Package, count: products.length, activeColor: 'bg-emerald-600 hover:bg-emerald-700' },
    { label: 'Out of Stock', value: 'out_of_stock', icon: PackageX, count: alerts?.summary.outOfStockCount ?? 0, activeColor: 'bg-red-600 hover:bg-red-700' },
    { label: 'Low Stock', value: 'low_stock', icon: TrendingDown, count: alerts?.summary.lowStockCount ?? 0, activeColor: 'bg-amber-500 hover:bg-amber-600' },
    { label: 'Expiring Soon', value: 'expiring_soon', icon: Clock, count: alerts?.summary.expiringSoonCount ?? 0, activeColor: 'bg-orange-500 hover:bg-orange-600' },
    { label: 'Expired', value: 'expired', icon: AlertOctagon, count: alerts?.summary.expiredCount ?? 0, activeColor: 'bg-red-500 hover:bg-red-600' },
  ];

  // ---- Loading skeleton ----
  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const summary = alerts?.summary;
  const healthScore = summary ? Math.round((summary.itemsInStock / Math.max(summary.totalItems, 1)) * 100) : 0;

  return (
    <div className="space-y-6 p-6">

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor stock levels, expiry dates, and inventory health across all products.
        </p>
      </div>

      {/* ===== Summary Dashboard Cards ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Total Items */}
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Items</p>
                <p className="text-2xl font-bold mt-1">{summary?.totalItems ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{summary?.itemsInStock ?? 0} in stock</p>
              </div>
              <div className="bg-slate-100 p-2.5 rounded-xl">
                <Package className="h-5 w-5 text-slate-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inventory Value */}
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inventory Value</p>
                <p className="text-2xl font-bold mt-1">{formatGHS(summary?.totalInventoryValue ?? 0)}</p>
              </div>
              <div className="bg-emerald-50 p-2.5 rounded-xl">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Out of Stock — CRITICAL */}
        <Card className={`border-2 ${summary && summary.outOfStockCount > 0 ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Out of Stock</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <p className="text-2xl font-bold text-red-600">{summary?.outOfStockCount ?? 0}</p>
                  {summary && summary.outOfStockCount > 0 && (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      <XCircle className="h-4 w-4 text-red-500" />
                    </motion.div>
                  )}
                </div>
              </div>
              <div className="bg-red-100 p-2.5 rounded-xl">
                <PackageX className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Low Stock — WARNING */}
        <Card className={`border-2 ${summary && summary.lowStockCount > 0 ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Low Stock</p>
                <p className="text-2xl font-bold mt-1 text-amber-600">{summary?.lowStockCount ?? 0}</p>
                <p className="text-xs text-amber-600/70">Below reorder level</p>
              </div>
              <div className="bg-amber-100 p-2.5 rounded-xl">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Expiring — CAUTION */}
        <Card className={`border-2 ${summary && (summary.expiringSoonCount + summary.expiredCount) > 0 ? 'border-orange-300 bg-orange-50/40' : 'border-slate-200'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Expiry Alerts</p>
                <p className="text-2xl font-bold mt-1 text-orange-600">{(summary?.expiringSoonCount ?? 0) + (summary?.expiredCount ?? 0)}</p>
                <p className="text-xs text-orange-600/70">{summary?.expiredCount ?? 0} expired, {summary?.expiringSoonCount ?? 0} expiring</p>
              </div>
              <div className="bg-orange-100 p-2.5 rounded-xl">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== Critical Alert Panels ===== */}
      <AnimatePresence>
        {summary && summary.criticalAlerts > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* Out of Stock Alerts */}
            {alerts && alerts.outOfStock.length > 0 && (
              <Collapsible open={expandedAlerts.out_of_stock} onOpenChange={() => toggleAlert('out_of_stock')}>
                <Card className="border-red-200 bg-red-50/30 overflow-hidden">
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="py-3 px-4 cursor-pointer hover:bg-red-50/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="bg-red-100 p-1.5 rounded-lg">
                            <PackageX className="h-4 w-4 text-red-600" />
                          </div>
                          <CardTitle className="text-sm font-semibold text-red-800">
                            Out of Stock — {alerts.outOfStock.length} product{alerts.outOfStock.length !== 1 ? 's' : ''}
                          </CardTitle>
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">Critical</Badge>
                        </div>
                        {expandedAlerts.out_of_stock ? <ChevronUp className="h-4 w-4 text-red-400" /> : <ChevronDown className="h-4 w-4 text-red-400" />}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="px-4 pb-3 pt-0">
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {alerts.outOfStock.map((item) => (
                          <div key={item.productId} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-red-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{item.productName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {item.categoryName ?? 'Uncategorized'} · Reorder at: {item.reorderLevel} {item.unit}
                                </p>
                              </div>
                            </div>
                            <Badge variant="destructive" className="text-[10px] px-1.5 shrink-0">0 {item.unit}</Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* Low Stock Alerts */}
            {alerts && alerts.lowStock.length > 0 && (
              <Collapsible open={expandedAlerts.low_stock} onOpenChange={() => toggleAlert('low_stock')}>
                <Card className="border-amber-200 bg-amber-50/30 overflow-hidden">
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="py-3 px-4 cursor-pointer hover:bg-amber-50/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="bg-amber-100 p-1.5 rounded-lg">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                          </div>
                          <CardTitle className="text-sm font-semibold text-amber-800">
                            Low Stock — {alerts.lowStock.length} product{alerts.lowStock.length !== 1 ? 's' : ''}
                          </CardTitle>
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-[10px] px-1.5 py-0 h-5 text-white">Warning</Badge>
                        </div>
                        {expandedAlerts.low_stock ? <ChevronUp className="h-4 w-4 text-amber-400" /> : <ChevronDown className="h-4 w-4 text-amber-400" />}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="px-4 pb-3 pt-0">
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {alerts.lowStock.map((item) => (
                          <div key={item.productId} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-amber-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <TrendingDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{item.productName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {item.categoryName ?? 'Uncategorized'} · Need {item.shortage} more {item.unit}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs font-mono text-amber-700">{item.totalStock}/{item.reorderLevel}</span>
                              <Badge className="bg-amber-100 text-amber-700 text-[10px] px-1.5">{item.unit}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* Expiring Soon Alerts */}
            {alerts && alerts.expiringSoon.length > 0 && (
              <Collapsible open={expandedAlerts.expiring_soon} onOpenChange={() => toggleAlert('expiring_soon')}>
                <Card className="border-orange-200 bg-orange-50/30 overflow-hidden">
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="py-3 px-4 cursor-pointer hover:bg-orange-50/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="bg-orange-100 p-1.5 rounded-lg">
                            <Clock className="h-4 w-4 text-orange-600" />
                          </div>
                          <CardTitle className="text-sm font-semibold text-orange-800">
                            Expiring Soon — {alerts.expiringSoon.length} batch{alerts.expiringSoon.length !== 1 ? 'es' : ''} within 90 days
                          </CardTitle>
                          <Badge className="bg-orange-500 hover:bg-orange-600 text-[10px] px-1.5 py-0 h-5 text-white">Caution</Badge>
                        </div>
                        {expandedAlerts.expiring_soon ? <ChevronUp className="h-4 w-4 text-orange-400" /> : <ChevronDown className="h-4 w-4 text-orange-400" />}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="px-4 pb-3 pt-0">
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {alerts.expiringSoon.slice(0, 10).map((item) => (
                          <div key={item.batchId} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-orange-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <Clock className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{item.productName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  Batch: {item.batchNumber} · {item.quantity} units
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-muted-foreground">
                                {new Date(item.expiryDate).toLocaleDateString('en-GH')}
                              </span>
                              <Badge
                                className={`text-[10px] px-1.5 ${
                                  item.daysToExpiry < 30
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-orange-100 text-orange-700'
                                }`}
                              >
                                {item.daysToExpiry}d left
                              </Badge>
                            </div>
                          </div>
                        ))}
                        {alerts.expiringSoon.length > 10 && (
                          <p className="text-xs text-center text-muted-foreground py-1">
                            + {alerts.expiringSoon.length - 10} more batches expiring
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* Expired Alerts */}
            {alerts && alerts.expired.length > 0 && (
              <Collapsible open={expandedAlerts.expired} onOpenChange={() => toggleAlert('expired')}>
                <Card className="border-red-300 bg-red-50/30 overflow-hidden">
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="py-3 px-4 cursor-pointer hover:bg-red-50/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="bg-red-100 p-1.5 rounded-lg">
                            <AlertOctagon className="h-4 w-4 text-red-600" />
                          </div>
                          <CardTitle className="text-sm font-semibold text-red-800">
                            Already Expired — {alerts.expired.length} batch{alerts.expired.length !== 1 ? 'es' : ''}
                          </CardTitle>
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">Urgent</Badge>
                        </div>
                        {expandedAlerts.expired ? <ChevronUp className="h-4 w-4 text-red-400" /> : <ChevronDown className="h-4 w-4 text-red-400" />}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="px-4 pb-3 pt-0">
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {alerts.expired.slice(0, 10).map((item) => (
                          <div key={item.batchId} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-red-200">
                            <div className="flex items-center gap-2 min-w-0">
                              <AlertOctagon className="h-3.5 w-3.5 text-red-500 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{item.productName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  Batch: {item.batchNumber} · {item.quantity} units
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-muted-foreground">
                                Exp: {new Date(item.expiryDate).toLocaleDateString('en-GH')}
                              </span>
                              <Badge variant="destructive" className="text-[10px] px-1.5">
                                {item.daysExpired}d ago
                              </Badge>
                            </div>
                          </div>
                        ))}
                        {alerts.expired.length > 10 && (
                          <p className="text-xs text-center text-muted-foreground py-1">
                            + {alerts.expired.length - 10} more expired batches
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Inventory Health Bar ===== */}
      {summary && (
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700">Inventory Health</p>
              <p className="text-sm font-bold text-slate-900">{healthScore}%</p>
            </div>
            <Progress
              value={healthScore}
              className="h-2.5"
            />
            <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
              <span>{summary.itemsInStock} of {summary.totalItems} products stocked</span>
              <span>
                {summary.criticalAlerts === 0 ? (
                  <span className="text-emerald-600 font-medium">All good!</span>
                ) : (
                  <span className="text-red-600 font-medium">{summary.criticalAlerts} alert{summary.criticalAlerts !== 1 ? 's' : ''} need attention</span>
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Filters & Search ===== */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {canManageInventory && (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => navigate('purchases')}
            >
              Add Stock
            </Button>
          )}
          <div className="flex gap-1.5 bg-slate-100 p-1 rounded-lg">
            {filterButtons.map((opt) => {
              const Icon = opt.icon;
              const isActive = filter === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    isActive
                      ? `${opt.activeColor} text-white shadow-sm`
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {opt.label}
                  {opt.count > 0 && (
                    <span className={`ml-0.5 text-[10px] px-1 rounded-full ${
                      isActive ? 'bg-white/20' : 'bg-slate-200 text-slate-500'
                    }`}>
                      {opt.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== Inventory Table ===== */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Total Stock</TableHead>
                  <TableHead className="text-right">Reorder Level</TableHead>
                  <TableHead>Nearest Expiry</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length > 0 ? (
                  filteredProducts.map((product) => {
                    const badges = getProductStatusBadge(product);
                    const stockPercent = product.reorderLevel > 0
                      ? Math.min((product.totalStock / product.reorderLevel) * 100, 100)
                      : 100;
                    const isAlert = product.stockStatus !== 'in_stock' || product.hasExpiredBatches || product.hasExpiringBatches;

                    return (
                      <ProductRow
                        key={product.id}
                        product={product}
                        badges={badges}
                        stockPercent={stockPercent}
                        isAlert={isAlert}
                        getBatchStatus={getBatchStatus}
                      />
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      <div className="flex flex-col items-center gap-2">
                        <Filter className="h-8 w-8 text-slate-300" />
                        <p>No inventory items found</p>
                        <p className="text-xs">Try adjusting your search or filter</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Bottom info bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          Showing {filteredProducts.length} of {products.length} products
        </span>
        <span>
          Last updated: {new Date().toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ===== Sub-components =====
function ProductRow({
  product,
  badges,
  stockPercent,
  isAlert,
  getBatchStatus,
}: {
  product: ProductWithBatches;
  badges: { label: string; variant: 'default' | 'destructive' | 'outline'; className: string }[];
  stockPercent: number;
  isAlert: boolean;
  getBatchStatus: (batch: { expiryDate: string; currentQty: number }) => { label: string; className: string; dotColor: string };
}) {
  const [expanded, setExpanded] = useState(false);

  const rowBgClass = isAlert
    ? product.stockStatus === 'out_of_stock'
      ? 'bg-red-50/40'
      : product.hasExpiredBatches
        ? 'bg-red-50/30'
        : 'bg-amber-50/30'
    : '';

  return (
    <>
      <TableRow
        className={`cursor-pointer hover:bg-muted/50 transition-colors ${rowBgClass}`}
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell>
          {product.batches.length > 0 && (
            expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          <div>
            <p className="font-medium text-sm">{product.name}</p>
            {product.genericName && (
              <p className="text-[11px] text-muted-foreground">{product.genericName}</p>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-[11px]">{product.category?.name ?? '-'}</Badge>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-col items-end gap-0.5">
            <span className={`font-mono text-sm font-semibold ${
              product.totalStock === 0 ? 'text-red-600' :
              product.totalStock <= product.reorderLevel ? 'text-amber-600' :
              'text-slate-900'
            }`}>
              {product.totalStock}
            </span>
            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  product.stockStatus === 'out_of_stock' ? 'bg-red-500' :
                  product.stockStatus === 'low_stock' ? 'bg-amber-500' :
                  'bg-emerald-500'
                }`}
                style={{ width: `${stockPercent}%` }}
              />
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right font-mono text-sm text-muted-foreground">
          {product.reorderLevel} {product.unit}
        </TableCell>
        <TableCell>
          {product.earliestExpiry ? (
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                product.daysToExpiry !== null && product.daysToExpiry < 0 ? 'bg-red-500' :
                product.daysToExpiry !== null && product.daysToExpiry < 30 ? 'bg-red-500' :
                product.daysToExpiry !== null && product.daysToExpiry < 90 ? 'bg-amber-500' :
                'bg-emerald-500'
              }`} />
              <span className="text-xs">
                {new Date(product.earliestExpiry).toLocaleDateString('en-GH')}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {badges.map((b) => (
              <Badge key={b.label} variant={b.variant} className={`text-[10px] px-1.5 py-0 h-5 ${b.className}`}>
                {b.label}
              </Badge>
            ))}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded batch detail */}
      {expanded && (
        <TableRow className={rowBgClass}>
          <TableCell colSpan={7} className="px-8 py-3">
            {product.batches.length > 0 ? (
              <div className="text-sm">
                <p className="font-medium mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Batch Details — {product.name}
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-dotted">
                      <th className="text-left py-1.5 font-medium text-muted-foreground">Batch #</th>
                      <th className="text-right py-1.5 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right py-1.5 font-medium text-muted-foreground">Cost Price</th>
                      <th className="text-right py-1.5 font-medium text-muted-foreground">Selling Price</th>
                      <th className="text-right py-1.5 font-medium text-muted-foreground">Expiry Date</th>
                      <th className="text-center py-1.5 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.batches.map((batch) => {
                      const status = getBatchStatus(batch);
                      const isExpired = new Date(batch.expiryDate) < new Date();
                      return (
                        <tr key={batch.id} className={`border-b border-dotted ${isExpired ? 'bg-red-50/50' : ''}`}>
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
                            <Badge className={`text-[10px] px-1.5 py-0 h-5 ${status.className}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${status.dotColor} mr-1`} />
                              {status.label}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No batches available for this product.</p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
