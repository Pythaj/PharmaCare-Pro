'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Search, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/use-permissions';
import type { Customer } from '@/types';

interface CustomerWithPurchases extends Customer {
  totalPurchases?: number;
  sales?: { invoiceNo: string; totalAmount: number; createdAt: string }[];
}

export default function CustomersView() {
  const { canManageProducts, isAdmin } = usePermissions();
  const [customers, setCustomers] = useState<CustomerWithPurchases[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<{ invoiceNo: string; totalAmount: number; createdAt: string }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit state
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithPurchases | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [editing, setEditing] = useState(false);

  // Delete state
  const [deletingCustomer, setDeletingCustomer] = useState<CustomerWithPurchases | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCustomers = async (query: string) => {
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers ?? []);
      }
    } catch { /* silent */ }
  };

  useEffect(() => {
    fetchCustomers('');
    setLoading(false);
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCustomers(value), 300);
  };

  const handleExpandRow = async (customerId: string) => {
    if (expandedRow === customerId) { setExpandedRow(null); return; }
    setExpandedRow(customerId);
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`);
      if (res.ok) {
        const data = await res.json();
        setPurchaseHistory(data.sales ?? []);
      }
    } catch { /* silent */ }
    setLoadingHistory(false);
  };

  const handleAddCustomer = async () => {
    if (!addForm.name.trim()) { toast.error('Customer name is required'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add customer');
      }
      toast.success('Customer added successfully');
      setShowAddDialog(false);
      setAddForm({ name: '', email: '', phone: '', address: '' });
      fetchCustomers(search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add customer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditCustomer = (customer: CustomerWithPurchases) => {
    setEditingCustomer(customer);
    setEditForm({ name: customer.name, email: customer.email ?? '', phone: customer.phone ?? '', address: customer.address ?? '' });
  };

  const handleSaveEdit = async () => {
    if (!editingCustomer) return;
    if (!editForm.name.trim()) { toast.error('Customer name is required'); return; }
    setEditing(true);
    try {
      const res = await fetch(`/api/customers/${editingCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update customer');
      }
      toast.success('Customer updated successfully');
      setEditingCustomer(null);
      fetchCustomers(search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update customer');
    } finally {
      setEditing(false);
    }
  };

  const handleDeleteCustomer = (customer: CustomerWithPurchases) => {
    setDeletingCustomer(customer);
  };

  const handleConfirmDelete = async () => {
    if (!deletingCustomer) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/customers/${deletingCustomer.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete customer');
      }
      toast.success('Customer deleted successfully');
      setDeletingCustomer(null);
      if (expandedRow === deletingCustomer.id) setExpandedRow(null);
      fetchCustomers(search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete customer');
    } finally {
      setDeleting(false);
    }
  };

  function formatGHS(value: number): string {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customers..." value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-10" />
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Customer
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Total Purchases</TableHead>
                  {isAdmin && <TableHead className="w-24">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      {isAdmin && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                    </TableRow>
                  ))
                ) : customers.length > 0 ? (
                  customers.map((customer) => {
                    const isExpanded = expandedRow === customer.id;
                    return (
                      <CustomerRow
                        key={customer.id}
                        customer={customer}
                        isExpanded={isExpanded}
                        expandedRow={expandedRow}
                        purchaseHistory={purchaseHistory}
                        loadingHistory={loadingHistory}
                        formatGHS={formatGHS}
                        onExpand={handleExpandRow}
                        onEdit={handleEditCustomer}
                        onDelete={handleDeleteCustomer}
                        showActions={isAdmin}
                      />
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground py-12">
                      No customers found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Customer Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Customer name" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="+233 24 123 4567" />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={addForm.address} onChange={(e) => setAddForm({ ...addForm, address: e.target.value })} placeholder="Street address" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleAddCustomer} disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog - admin only */}
      {isAdmin && (
      <Dialog open={!!editingCustomer} onOpenChange={(open) => { if (!open) setEditingCustomer(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Customer name" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="+233 24 123 4567" />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="Street address" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCustomer(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSaveEdit} disabled={editing}>
              {editing ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Delete Customer AlertDialog - admin only */}
      {isAdmin && (
      <AlertDialog open={!!deletingCustomer} onOpenChange={(open) => { if (!open) setDeletingCustomer(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deletingCustomer?.name}? This action cannot be undone.
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
      )}
    </div>
  );
}

// Extracted row component to avoid React fragment key warnings
function CustomerRow({
  customer,
  isExpanded,
  expandedRow,
  purchaseHistory,
  loadingHistory,
  formatGHS,
  onExpand,
  onEdit,
  onDelete,
  showActions,
}: {
  customer: CustomerWithPurchases;
  isExpanded: boolean;
  expandedRow: string | null;
  purchaseHistory: { invoiceNo: string; totalAmount: number; createdAt: string }[];
  loadingHistory: boolean;
  formatGHS: (v: number) => string;
  onExpand: (id: string) => void;
  onEdit: (c: CustomerWithPurchases) => void;
  onDelete: (c: CustomerWithPurchases) => void;
  showActions: boolean;
}) {
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => onExpand(customer.id)}>
        <TableCell>
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-medium">{customer.name}</TableCell>
        <TableCell>{customer.email ?? '-'}</TableCell>
        <TableCell>{customer.phone ?? '-'}</TableCell>
        <TableCell className="max-w-[200px] truncate">{customer.address ?? '-'}</TableCell>
        <TableCell className="text-right font-medium">{formatGHS(customer.totalPurchases ?? 0)}</TableCell>
        {showActions && (
        <TableCell>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              onClick={(e) => { e.stopPropagation(); onEdit(customer); }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={(e) => { e.stopPropagation(); onDelete(customer); }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
        )}
      </TableRow>
      {isExpanded && (
        <TableRow key={`${customer.id}-history`}>
          <TableCell colSpan={showActions ? 7 : 6} className="bg-muted/30 px-8 py-3">
            {loadingHistory ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : purchaseHistory.length > 0 ? (
              <div>
                <p className="text-sm font-medium mb-2">Purchase History for {customer.name}</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 font-medium">Invoice#</th>
                      <th className="text-right py-1.5 font-medium">Amount</th>
                      <th className="text-right py-1.5 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseHistory.map((sale, i) => (
                      <tr key={i} className="border-b border-dotted">
                        <td className="py-1.5 font-mono">{sale.invoiceNo}</td>
                        <td className="text-right">{formatGHS(sale.totalAmount)}</td>
                        <td className="text-right">{new Date(sale.createdAt).toLocaleDateString('en-GH')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No purchase history</p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
