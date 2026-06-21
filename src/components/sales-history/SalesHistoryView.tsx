'use client';

import { useState, useEffect } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
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
import type { Sale, SaleItem, User } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

export default function SalesHistoryView() {
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
                    </TableRow>
                  ))
                ) : sales.length > 0 ? (
                  sales.map((sale) => {
                    const isExpanded = expandedRow === sale.id;
                    return (
                      <>
                        <TableRow key={sale.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleExpandRow(sale.id)}>
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
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${sale.id}-items`}>
                            <TableCell colSpan={10} className="bg-muted/30 px-8 py-3">
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
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                      No sales found
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