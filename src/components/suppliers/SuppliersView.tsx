'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Phone, Mail, MapPin, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Supplier } from '@/types';

export default function SuppliersView() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', contact: '', email: '', phone: '', address: '' });
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuppliers = async (query: string) => {
    try {
      const res = await fetch(`/api/suppliers?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data.suppliers ?? []);
      }
    } catch { /* silent */ }
  };

  useEffect(() => {
    fetchSuppliers('');
    setLoading(false);
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuppliers(value), 300);
  };

  const handleAddSupplier = async () => {
    if (!addForm.name.trim()) { toast.error('Supplier name is required'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add supplier');
      }
      toast.success('Supplier added successfully');
      setShowAddDialog(false);
      setAddForm({ name: '', contact: '', email: '', phone: '', address: '' });
      fetchSuppliers(search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add supplier');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search suppliers..." value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-10" />
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Supplier
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-48" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : suppliers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {suppliers.map((supplier) => (
            <Card key={supplier.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{supplier.name}</CardTitle>
                  <div className={`h-2.5 w-2.5 rounded-full mt-1.5 ${supplier.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {supplier.contact && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <span>{supplier.contact}</span>
                  </div>
                )}
                {supplier.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>{supplier.email}</span>
                  </div>
                )}
                {supplier.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span>{supplier.phone}</span>
                  </div>
                )}
                {supplier.address && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span className="line-clamp-1">{supplier.address}</span>
                  </div>
                )}
                <div className="pt-2 border-t mt-2">
                  <span className="text-xs text-muted-foreground">Total Orders: </span>
                  <span className="font-medium">{supplier._count?.purchases ?? 0}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          No suppliers found
        </div>
      )}

      {/* Add Supplier Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Supplier</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Supplier Name *</Label>
              <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Company name" />
            </div>
            <div>
              <Label>Contact Person</Label>
              <Input value={addForm.contact} onChange={(e) => setAddForm({ ...addForm, contact: e.target.value })} placeholder="Contact person name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <Input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="email@example.com" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="+233..." />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input value={addForm.address} onChange={(e) => setAddForm({ ...addForm, address: e.target.value })} placeholder="Full address" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleAddSupplier} disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}