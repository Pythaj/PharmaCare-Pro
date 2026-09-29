'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Loader2,
  Plus,
  Send,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import { money } from '@/lib/currency';
import type { Branch, StockTransfer, TransferStatus } from '@/types';

/** Shape of a row from GET /api/batches, narrowed to what the picker needs. */
type PickableBatch = {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate?: string | null;
  product: { id: string; name: string; unit: string };
};

type DraftLine = { batchId: string; quantity: string };

const STATUS_STYLES: Record<TransferStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

const STATUS_FILTERS: { value: 'all' | TransferStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * Inter-branch stock transfers.
 *
 * The whole screen is built around one rule the API enforces: no stock moves
 * until a transfer is completed. Raising one, approving one, rejecting one and
 * cancelling one all leave both shelves exactly as they were. This view is
 * therefore free to be talky and slow — nothing here is destructive until the
 * person completing a transfer says the goods physically arrived.
 *
 * Action buttons are hidden based on the same rules the server checks, but the
 * server remains the authority: a stale tab cannot complete a transfer that was
 * cancelled in another tab, it just gets a 400 back.
 */
export default function StockTransfersView() {
  const activeBranch = useAppStore((s) => s.activeBranch);

  // Stock value is money, so it follows the shop's configured currency rather
  // than a hardcoded symbol. `@/lib/currency` owns the formatting — including
  // the fallback for a bad code in settings, which must not blank the table —
  // so this view and every other money display agree on the result.
  const formatMoney = useMemo(() => (value: number) => money(value), []);

  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | TransferStatus>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [detail, setDetail] = useState<StockTransfer | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Create-dialog state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [batches, setBatches] = useState<PickableBatch[]>([]);
  const [toBranchId, setToBranchId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ batchId: '', quantity: '' }]);
  const [notes, setNotes] = useState('');

  const fetchTransfers = useCallback(async () => {
    try {
      const res = await fetch('/api/stock-transfers');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Could not load transfers');
        return;
      }
      const data = await res.json();
      setTransfers(data.transfers ?? []);
    } catch {
      toast.error('Could not load transfers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  // A transfer is raised *from* a branch, so the all-branches view has no
  // shelf to send from. Refuse clearly rather than letting the API 400.
  const canRaise = Boolean(activeBranch);

  const destinations = useMemo(
    () => branches.filter((b) => b.active && b.id !== activeBranch?.id),
    [branches, activeBranch]
  );

  const openCreate = async () => {
    setToBranchId('');
    setLines([{ batchId: '', quantity: '' }]);
    setNotes('');
    setShowCreate(true);

    try {
      const [branchRes, batchRes] = await Promise.all([
        fetch('/api/branches'),
        fetch('/api/batches'),
      ]);
      if (branchRes.ok) {
        const data = await branchRes.json();
        setBranches(data.branches ?? []);
      }
      if (batchRes.ok) {
        const rows = await batchRes.json();
        // Only stock that is physically on a shelf can be sent. A batch at
        // zero is not "in stock somewhere", it is just history.
        setBatches((Array.isArray(rows) ? rows : []).filter((b: PickableBatch) => b.quantity > 0));
      }
    } catch {
      toast.error('Could not load branches and stock');
    }
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { batchId: '', quantity: '' }]);
  const removeLine = (index: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const submit = async () => {
    if (!toBranchId) {
      toast.error('Choose the branch receiving this stock');
      return;
    }

    const items = lines
      .filter((l) => l.batchId && Number(l.quantity) > 0)
      .map((l) => ({ batchId: l.batchId, quantity: Number(l.quantity) }));

    if (items.length === 0) {
      toast.error('Add at least one item with a quantity');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/stock-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toBranchId, notes: notes.trim() || undefined, items }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || 'Could not raise the transfer');
        return;
      }

      toast.success(`Transfer ${data.transfer.reference} raised — no stock has moved yet`);
      setShowCreate(false);
      fetchTransfers();
    } catch {
      toast.error('Could not raise the transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (transfer: StockTransfer, action: string, label: string) => {
    setBusyId(transfer.id);
    try {
      const res = await fetch(`/api/stock-transfers/${transfer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || `Could not ${label.toLowerCase()} this transfer`);
        return;
      }

      toast.success(label);
      // Keep the open dialog in step with the server rather than guessing.
      if (detail?.id === transfer.id && data.transfer) setDetail(data.transfer);
      fetchTransfers();
    } catch {
      toast.error(`Could not ${label.toLowerCase()} this transfer`);
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(
    () => (statusFilter === 'all' ? transfers : transfers.filter((t) => t.status === statusFilter)),
    [transfers, statusFilter]
  );

  // Mirror of the server's action rules, used only to decide what to draw.
  const isOutbound = (t: StockTransfer) => activeBranch?.id === t.fromBranchId;
  const isInbound = (t: StockTransfer) => activeBranch?.id === t.toBranchId;

  /**
   * `table` rows are narrow, so they get icon-only buttons with screen-reader
   * labels. The detail dialog has room, so it gets the words spelled out.
   */
  const renderActions = (t: StockTransfer, variant: 'table' | 'dialog' = 'table') => {
    const actions: { key: string; label: string; icon: typeof Check; run: () => void }[] = [];

    if (t.status === 'pending' && isOutbound(t)) {
      actions.push({
        key: 'approve',
        label: 'Approve',
        icon: Check,
        run: () => act(t, 'approve', 'Transfer approved'),
      });
      actions.push({
        key: 'cancel',
        label: 'Cancel',
        icon: X,
        run: () => act(t, 'cancel', 'Transfer cancelled'),
      });
    }
    if (t.status === 'pending' && isInbound(t)) {
      actions.push({
        key: 'reject',
        label: 'Reject',
        icon: X,
        run: () => act(t, 'reject', 'Transfer rejected'),
      });
    }
    if ((t.status === 'pending' || t.status === 'approved') && isInbound(t)) {
      actions.push({
        key: 'complete',
        label: 'Complete',
        icon: Truck,
        run: () => act(t, 'complete', 'Goods received — stock moved'),
      });
    }

    if (actions.length === 0) return null;

    const compact = variant === 'table';

    return (
      <div className={compact ? 'flex justify-end gap-1' : 'flex gap-2'}>
        {actions.map((a) => (
          <Button
            key={a.key}
            variant={a.key === 'complete' ? 'default' : 'outline'}
            size={compact ? 'sm' : 'default'}
            onClick={a.run}
            disabled={busyId === t.id}
            title={compact ? a.label : undefined}
            aria-label={compact ? a.label : undefined}
          >
            {busyId === t.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <a.icon className="h-3.5 w-3.5" />
            )}
            {compact ? <span className="sr-only">{a.label}</span> : a.label}
          </Button>
        ))}
      </div>
    );
  };

  const lineTotal = (t: StockTransfer) =>
    t.lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Stock Transfers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Move stock between branches. Nothing leaves a shelf until a transfer is
            completed, and the receiving branch confirms the goods arrived.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!canRaise}>
          <Plus className="mr-2 h-4 w-4" />
          New transfer
        </Button>
      </div>

      {!canRaise && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-800">
            You are on the all-branches view, so there is no shelf to send from. Pick a
            branch in the header to raise a transfer.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={statusFilter === f.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Truck className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No transfers here</p>
              <p className="max-w-sm text-sm text-slate-500">
                When one branch needs to top up another, raise the transfer here and the
                receiving branch confirms delivery.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Raised</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-mono text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                        onClick={() => setDetail(t)}
                      >
                        {t.reference}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <span className="truncate">{t.fromBranch.code}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{t.toBranch.code}</span>
                        {isInbound(t) && !isOutbound(t) && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            inbound
                          </Badge>
                        )}
                        {isOutbound(t) && !isInbound(t) && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            outbound
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm text-slate-600">
                      {t.lines.length}
                    </TableCell>
                    <TableCell className="text-right text-sm text-slate-600">
                      {formatMoney(lineTotal(t))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_STYLES[t.status]}>
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {t.createdBy?.name ?? '—'}
                      <span className="block text-xs text-slate-400">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>{renderActions(t)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---------- Detail ---------- */}
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{detail.reference}</DialogTitle>
                <DialogDescription>
                  {detail.fromBranch.name} &rarr; {detail.toBranch.name} &middot;{' '}
                  <Badge variant="secondary" className={STATUS_STYLES[detail.status]}>
                    {detail.status}
                  </Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-sm text-slate-900">{l.product.name}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">
                          {l.sourceBatch.batchNumber}
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-700">
                          {l.quantity} {l.product.unit}
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-700">
                          {formatMoney(l.unitCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {detail.lines.some((l) => l.destBatch) && (
                  <p className="text-xs text-slate-500">
                    Received into{' '}
                    {detail.lines
                      .map((l) => l.destBatch?.batchNumber)
                      .filter(Boolean)
                      .join(', ')}{' '}
                    at {detail.toBranch.name}.
                  </p>
                )}

                {detail.notes && (
                  <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                    {detail.notes}
                  </p>
                )}

                <div className="space-y-1 text-xs text-slate-500">
                  <p>Raised by {detail.createdBy?.name ?? '—'}</p>
                  {detail.approvedBy && (
                    <p>
                      {detail.status === 'rejected' ? 'Rejected' : 'Approved'} by{' '}
                      {detail.approvedBy.name}
                      {detail.approvedAt
                        ? ` on ${new Date(detail.approvedAt).toLocaleString()}`
                        : ''}
                    </p>
                  )}
                  {detail.completedAt && (
                    <p>Completed on {new Date(detail.completedAt).toLocaleString()}</p>
                  )}
                </div>
              </div>

              <DialogFooter>
                {renderActions(detail, 'dialog')}
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- Create ---------- */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New stock transfer</DialogTitle>
            <DialogDescription>
              Sending from {activeBranch?.name}. Raising this does not move any stock —
              {destinations.length
                ? ` the transfer moves goods when ${destinations[0].name} confirms they arrived.`
                : ' stock moves only when the transfer is completed.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-to">Send to</Label>
              <Select value={toBranchId} onValueChange={setToBranchId}>
                <SelectTrigger id="transfer-to">
                  <SelectValue placeholder="Choose the receiving branch" />
                </SelectTrigger>
                <SelectContent>
                  {destinations.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {destinations.length === 0 && (
                <p className="text-xs text-slate-500">
                  No other active branch to send to. Add a second branch first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Items</Label>
              <div className="space-y-2">
                {lines.map((line, i) => {
                  const batch = batches.find((b) => b.id === line.batchId);
                  return (
                    <div key={i} className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        {i === 0 && <p className="text-xs text-slate-500">Batch</p>}
                        <Select
                          value={line.batchId}
                          onValueChange={(v) => updateLine(i, { batchId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a batch" />
                          </SelectTrigger>
                          <SelectContent>
                            {batches.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.product.name} &middot; {b.batchNumber} ({b.quantity}{' '}
                                {b.product.unit})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-28 space-y-1">
                        {i === 0 && <p className="text-xs text-slate-500">Quantity</p>}
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(i, { quantity: e.target.value })}
                          placeholder={batch ? `${batch.quantity}` : '0'}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(i)}
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add another batch
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transfer-notes">Note (optional)</Label>
              <Textarea
                id="transfer-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. van leaving Adenta at 2pm"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Raise transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
