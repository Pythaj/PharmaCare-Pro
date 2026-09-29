'use client';

/**
 * Branch data reset panel — admin-only, lives in Settings → Data & Security.
 *
 * Lets an owner put ONE branch back to a clean slate (quantities to zero so the
 * shelves can be re-counted) without deleting a single drug from the catalogue.
 * See lib/branch-reset for the rules and for what this can never touch.
 *
 * The design is deliberately cautious because the failure this feature exists to
 * prevent is the one it could otherwise cause:
 *
 *  1. No scope is pre-ticked. The admin chooses.
 *  2. The live counts come from the server (`GET`) and are re-measured inside
 *     the write transaction, so the numbers in the confirmation are the numbers
 *     that get acted on.
 *  3. A typed phrase is required — even for the non-destructive stock scope.
 *  4. The branch is fixed by the session. The panel shows which shop it is about
 *     to touch, in the button itself, so the wrong branch is visible before the
 *     click and not after it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/app-store';
import { notifyCatalogueChanged } from '@/lib/catalogue-events';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  Eraser,
  FileText,
  Info,
  Loader2,
  Package,
  RefreshCcw,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ResetScope } from '@/lib/branch-reset';

interface ScopeInfo {
  scope: ResetScope;
  label: string;
  description: string;
  destructive: boolean;
}

interface Preview {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  impact: {
    stock: { batches: number; units: number };
    sales: { sales: number; items: number; returns: number };
    registers: { records: number };
    purchases: { purchases: number };
  };
  drugsKept: number;
  batchesKept: number;
  scopes: ScopeInfo[];
  confirmPhrase: string;
}

const SCOPE_ICONS: Record<ResetScope, React.ReactNode> = {
  stock: <Boxes className="h-4 w-4" />,
  sales: <ShoppingCart className="h-4 w-4" />,
  registers: <FileText className="h-4 w-4" />,
  purchases: <Package className="h-4 w-4" />,
};

/** Exactly what a given scope will report as changed, for the confirmation. */
function impactLine(scope: ResetScope, impact: Preview['impact']): string {
  switch (scope) {
    case 'stock':
      return `${impact.stock.units.toLocaleString()} unit${impact.stock.units === 1 ? '' : 's'} set to 0 across ${impact.stock.batches.toLocaleString()} batch${impact.stock.batches === 1 ? '' : 'es'}`;
    case 'sales':
      return `${impact.sales.sales.toLocaleString()} sale${impact.sales.sales === 1 ? '' : 's'}, ${impact.sales.items.toLocaleString()} line${impact.sales.items === 1 ? '' : 's'}${impact.sales.returns > 0 ? `, ${impact.sales.returns.toLocaleString()} return${impact.sales.returns === 1 ? '' : 's'}` : ''} deleted`;
    case 'registers':
      return `${impact.registers.records.toLocaleString()} day register${impact.registers.records === 1 ? '' : 's'} deleted`;
    case 'purchases':
      return `${impact.purchases.purchases.toLocaleString()} purchase record${impact.purchases.purchases === 1 ? '' : 's'} deleted`;
  }
}

export default function BranchResetPanel() {
  const activeBranch = useAppStore((s) => s.activeBranch);
  const currentUser = useAppStore((s) => s.currentUser);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ResetScope[]>([]);
  const [phrase, setPhrase] = useState('');
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ details: string; branchName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'admin';
  const branchId = activeBranch?.id ?? null;

  // Refetched whenever the selected branch changes, so the counts on screen
  // always describe the shop actually in the switcher. A stale count next to a
  // destructive button is worse than no count.
  const loadPreview = useCallback(async () => {
    if (!branchId || !isAdmin) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/settings/branch-reset');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreview(null);
        setError(data.error || 'Could not load the reset preview');
        return;
      }
      setPreview(data as Preview);
    } catch {
      setPreview(null);
      setError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [branchId, isAdmin]);

  useEffect(() => {
    void loadPreview();
    // Selected scopes and the typed phrase are deliberately NOT carried over a
    // branch change: a tick mark approved for Branch A must never be sitting
    // there ready to apply to Branch B.
    setSelected([]);
    setPhrase('');
  }, [loadPreview]);

  if (!isAdmin) return null;

  const toggle = (scope: ResetScope) => {
    setSelected((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const phraseNeeded = preview?.confirmPhrase ?? 'RESET';
  const canSubmit = selected.length > 0 && phrase.trim().toUpperCase() === phraseNeeded;
  const hasDestructive = selected.some((s) => s !== 'stock');

  const runReset = async () => {
    if (!branchId || !canSubmit) return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/branch-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          scopes: selected,
          confirm: phrase.trim().toUpperCase(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'The reset could not be completed');
        return;
      }
      setResult({ details: data.details, branchName: data.branchName });
      setSelected([]);
      setPhrase('');
      toast.success(`${data.branchName} reset`);
      // The catalogue, prices and batch list are untouched, but every screen
      // showing quantities or the day's takings is now stale.
      notifyCatalogueChanged();
      await loadPreview();
    } catch {
      setError('Could not reach the server');
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card className="overflow-hidden border-amber-200">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <Eraser className="h-4.5 w-4.5 text-amber-700" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              Start a Branch Anew
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">
                Admin only
              </span>
            </CardTitle>
            <CardDescription className="mt-1">
              Clear this branch&rsquo;s numbers so you can walk the shelves and start again. Your
              drug catalogue is never touched.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* No branch selected: the tool has nothing to act on, and saying so
            is better than showing counts for every shop. */}
        {!branchId ? (
          <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
            <span>
              Choose a branch in the switcher at the top of the screen. This tool always works on
              exactly one shop, so it is unavailable while viewing all branches.
            </span>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading this branch&rsquo;s data&hellip;
          </div>
        ) : error && !preview ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : preview ? (
          <>
            {/* What is safe, stated up front and unconditionally. */}
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              <div className="text-sm text-emerald-900">
                <span className="font-semibold">
                  {preview.drugsKept.toLocaleString()} drug
                  {preview.drugsKept === 1 ? '' : 's'} stay in the catalogue.
                </span>{' '}
                {preview.batchesKept.toLocaleString()} batch
                {preview.batchesKept === 1 ? '' : 'es'} keep their prices, batch numbers and
                expiry dates. No option here can delete a drug.
              </div>
            </div>

            <div className="space-y-2">
              {preview.scopes.map((s) => {
                const checked = selected.includes(s.scope);
                return (
                  <label
                    key={s.scope}
                    className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      checked
                        ? s.destructive
                          ? 'border-red-300 bg-red-50/60'
                          : 'border-emerald-300 bg-emerald-50/60'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(s.scope)}
                      className="mt-0.5"
                      aria-label={s.label}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-400">{SCOPE_ICONS[s.scope]}</span>
                        <span className="text-sm font-semibold text-slate-800">{s.label}</span>
                        {s.destructive ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-700 border border-red-200 rounded-full px-1.5 py-0.5">
                            Deletes records
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5">
                            Safe
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                      <p className="text-xs text-slate-500 font-mono mt-1">
                        Right now: {impactLine(s.scope, preview.impact)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* The stock/sales interaction, surfaced instead of left as a trap. */}
            {selected.includes('stock') && !selected.includes('sales') && preview.impact.sales.sales > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <span>
                  This branch has {preview.impact.sales.sales.toLocaleString()} recorded sale
                  {preview.impact.sales.sales === 1 ? '' : 's'} that will still appear in reports and
                  the branch comparison. That is usually what you want for a new period — tick
                  &ldquo;Sales &amp; returns&rdquo; as well if you want a genuinely empty history.
                </span>
              </div>
            )}

            {result && (
              <div className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <span className="font-semibold">{result.branchName} is clear.</span>{' '}
                  <span className="text-emerald-800">{result.details}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {selected.length > 0 && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <Label htmlFor="branch-reset-confirm" className="text-sm font-medium">
                  Type <span className="font-mono font-bold text-slate-800">{phraseNeeded}</span> to
                  confirm
                </Label>
                <Input
                  id="branch-reset-confirm"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={phraseNeeded}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  This will change{' '}
                  <span className="font-semibold text-slate-700">{preview.branchName}</span> only.
                  {hasDestructive
                    ? ' Records will be permanently deleted — this cannot be undone.'
                    : ' Quantities can be re-entered at any time.'}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    onClick={runReset}
                    disabled={!canSubmit || resetting}
                    className={
                      hasDestructive
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-amber-600 hover:bg-amber-700 text-white'
                    }
                  >
                    {resetting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : hasDestructive ? (
                      <Trash2 className="h-4 w-4 mr-2" />
                    ) : (
                      <Eraser className="h-4 w-4 mr-2" />
                    )}
                    {resetting
                      ? 'Clearing...'
                      : `Clear ${preview.branchName}${selected.length > 1 ? ` (${selected.length} items)` : ''}`}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected([]);
                      setPhrase('');
                      setError(null);
                    }}
                    disabled={resetting}
                  >
                    <Ban className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button variant="ghost" size="sm" onClick={() => void loadPreview()} disabled={loading || resetting}>
                {loading ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-2" />}
                Refresh counts
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
