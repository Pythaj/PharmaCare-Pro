'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Package,
  DollarSign,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Product, Batch, Category } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface ProductWithBatches extends Product {
  batches: (Batch & { currentQty: number })[];
  totalStock: number;
  inventoryValue: number;
}

type FilterType = 'all' | 'low_stock' | 'expiring_soon' | 'out_of_stock';

export default function InventoryView() {
  const [products, setProducts] = useState<ProductWithBatches[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProducts = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(query)}&includeBatches=true`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/products?search=&includeBatches=true');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setProducts(data.products ?? []);
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

  const getBatchStatus = (batch: Batch & { currentQty: number }) => {
    const now = new Date();
    const expiry = new Date(batch.expiryDate);
    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return { label: 'Expired', className: 'bg-red-100 text-red-700' };
    if (diffDays < 90) return { label: 'Expiring Soon', className: 'bg-amber-100 text-amber-700' };
    return { label: 'Good', className: 'bg-emerald-100 text-emerald-700' };
  };

  const filtered = products.filter((p) => {
    if (filter === 'low_stock') return p.totalStock > 0 && p.totalStock <= p.reorderLevel;
    if (filter === 'expiring_soon') return p.batches.some(b => {
      const diff = (new Date(b.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff < 90;
    });
    if (filter === 'out_of_stock') return p.totalStock === 0;
    return true;
  });

  const totalItems = products.length;
  const totalValue = products.reduce((sum, p) => sum + p.inventoryValue, 0);
  const lowStockItems = products.filter(p => p.totalStock > 0 && p.totalStock <= p.reorderLevel).length;
  const expiringItems = products.filter(p => p.batches.some(b => {
    const diff = (new Date(b.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff < 90;
  })).length;

  const summaryCards = [
    { label: 'Total Items', value: totalItems.toLocaleString(), icon: Package, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Total Value', value: formatGHS(totalValue), icon: DollarSign, color: 'text-teal-600', bg: 'bg-teal-50' },
    { label: 'Low Stock', value: lowStockItems.toString(), icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Expiring Soon', value: expiringItems.toString(), icon: Clock, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  const filterOptions: { label: string; value: FilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Low Stock', value: 'low_stock' },
    { label: 'Expiring Soon', value: 'expiring_soon' },
    { label: 'Out of Stock', value: 'out_of_stock' },
  ];

  return (
    <div className="space-y-4 p-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`${card.bg} p-2 rounded-lg`}>
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                    <p className="font-bold text-lg">{card.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search inventory..." value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-2">
          {filterOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={filter === opt.value ? 'default' : 'outline'}
              size="sm"
              className={filter === opt.value ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
              onClick={() => setFilter(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Inventory Table */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Batch#</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost Price</TableHead>
                  <TableHead className="text-right">Selling Price</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : filtered.length > 0 ? (
                  filtered.flatMap((product) =>
                    product.batches.length > 0
                      ? product.batches.map((batch) => {
                          const status = getBatchStatus(batch);
                          const isExpired = new Date(batch.expiryDate) < new Date();
                          return (
                            <TableRow key={batch.id} className={isExpired ? 'bg-red-50/50' : ''}>
                              <TableCell className="font-medium">{product.name}</TableCell>
                              <TableCell><Badge variant="outline">{product.category?.name ?? '-'}</Badge></TableCell>
                              <TableCell className="font-mono text-xs">{batch.batchNumber}</TableCell>
                              <TableCell className="text-right font-mono">{batch.currentQty}</TableCell>
                              <TableCell className="text-right">{formatGHS(batch.costPrice)}</TableCell>
                              <TableCell className="text-right">{formatGHS(batch.sellingPrice)}</TableCell>
                              <TableCell className="text-xs">{new Date(batch.expiryDate).toLocaleDateString('en-GH')}</TableCell>
                              <TableCell>
                                <Badge className={`${status.className} hover:${status.className}`}>{status.label}</Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      : [
                          <TableRow key={product.id}>
                            <TableCell className="font-medium">{product.name}</TableCell>
                            <TableCell><Badge variant="outline">{product.category?.name ?? '-'}</Badge></TableCell>
                            <TableCell className="text-muted-foreground">-</TableCell>
                            <TableCell className="text-right font-mono">0</TableCell>
                            <TableCell className="text-right">-</TableCell>
                            <TableCell className="text-right">-</TableCell>
                            <TableCell className="text-muted-foreground">-</TableCell>
                            <TableCell>
                              <Badge variant="destructive">No Stock</Badge>
                            </TableCell>
                          </TableRow>,
                        ]
                  )
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      No inventory items found
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