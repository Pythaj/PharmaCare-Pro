'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  MapPin,
  Phone,
  Plus,
  Pencil,
  Power,
  Loader2,
  Users,
  Package,
  Receipt,
} from 'lucide-react';
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Branch } from '@/types';

type BranchForm = {
  name: string;
  code: string;
  address: string;
  phone: string;
};

const EMPTY_FORM: BranchForm = { name: '', code: '', address: '', phone: '' };

/**
 * Branch management — the owner's screen for the shape of the business.
 *
 * A branch is created once and then referenced by every sale, stock batch and
 * till record, so this screen is deliberately conservative: there is no delete
 * (only deactivate), and the API refuses to deactivate a branch that still has
 * staff or stock. That guard is the reason a shop cannot end up with money in a
 * branch nobody is running.
 */
export default function BranchesView() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch('/api/branches');
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Could not load branches');
      }
    } catch {
      toast.error('Could not load branches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowDialog(true);
  };

  const openEdit = (branch: Branch) => {
    setEditing(branch);
    setForm({
      name: branch.name,
      code: branch.code,
      address: branch.address ?? '',
      phone: branch.phone ?? '',
    });
    setShowDialog(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('Branch name is required');
      return;
    }
    if (!/^[A-Za-z0-9]{2,10}$/.test(form.code.trim())) {
      toast.error('Code must be 2-10 letters or numbers (e.g. MAIN, ACCRA)');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(editing ? `/api/branches/${editing.id}` : '/api/branches', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || 'Could not save the branch');
        return;
      }

      toast.success(editing ? 'Branch updated' : 'Branch created');
      setShowDialog(false);
      fetchBranches();
    } catch {
      toast.error('Could not save the branch');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (branch: Branch) => {
    try {
      const res = await fetch(`/api/branches/${branch.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !branch.active }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || 'Could not update the branch');
        return;
      }

      toast.success(branch.active ? 'Branch deactivated' : 'Branch reactivated');
      fetchBranches();
    } catch {
      toast.error('Could not update the branch');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Branches</h1>
          <p className="mt-1 text-sm text-slate-500">
            Each branch keeps its own stock, sales and daily register. Your product
            catalogue stays shared across all of them.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add branch
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : branches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Building2 className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No branches yet</p>
              <p className="max-w-sm text-sm text-slate-500">
                Add the shop&apos;s locations, then assign each salesperson to the
                branch they work at.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-center">Staff</TableHead>
                  <TableHead className="text-center">Batches</TableHead>
                  <TableHead className="text-center">Sales</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-slate-400" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{branch.name}</p>
                          {branch.address && (
                            <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                              <MapPin className="h-3 w-3" />
                              {branch.address}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {branch.code}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {branch.phone ? (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {branch.phone}
                        </span>
                      ) : (
                        <span className="text-slate-400">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3 text-slate-400" />
                        {branch.staffCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Package className="h-3 w-3 text-slate-400" />
                        {branch.batchCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Receipt className="h-3 w-3 text-slate-400" />
                        {branch.saleCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          branch.active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }
                      >
                        {branch.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(branch)}
                          aria-label={`Edit ${branch.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleActive(branch)}
                          aria-label={
                            branch.active
                              ? `Deactivate ${branch.name}`
                              : `Reactivate ${branch.name}`
                          }
                          title={
                            branch.active
                              ? 'Deactivate — staff and stock must be moved first'
                              : 'Reactivate this branch'
                          }
                        >
                          <Power
                            className={
                              branch.active ? 'h-4 w-4 text-amber-600' : 'h-4 w-4 text-emerald-600'
                            }
                          />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit branch' : 'Add branch'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the details customers and staff see for this location.'
                : 'The code appears on every invoice from this branch, so it must be unique.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="branch-name">Branch name</Label>
              <Input
                id="branch-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Main Branch — Adenta"
                maxLength={120}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch-code">Invoice code</Label>
              <Input
                id="branch-code"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
                }
                placeholder="e.g. MAIN"
                maxLength={10}
                className="font-mono"
              />
              <p className="text-xs text-slate-500">
                2-10 letters or numbers. Receipts will read{' '}
                <span className="font-mono">{form.code || 'MAIN'}-INV-20260101-0001</span>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch-address">Address</Label>
              <Input
                id="branch-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Street, community, city"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch-phone">Phone</Label>
              <Input
                id="branch-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+233..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
