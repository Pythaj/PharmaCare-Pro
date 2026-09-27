'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, ChevronsUpDown, Globe2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import type { Branch } from '@/types';

const ALL_BRANCHES = 'all';

/**
 * Shows which branch the user is operating in, and lets an admin switch.
 *
 * Two rules are enforced here and, more importantly, on the server:
 *  - A salesperson sees their branch as a static label. There is deliberately
 *    no dropdown for them: a visible-but-useless control invites "let me just
 *    try", and the server would refuse anyway.
 *  - Switching re-issues the session cookie, so the whole page reloads. Every
 *    figure on screen (revenue, stock, alerts) belongs to the old branch, and a
 *    partial update would leave a mix of two shops' numbers on one page — the
 *    single most misleading thing this system could do.
 */
export function BranchSwitcher() {
  const currentUser = useAppStore((s) => s.currentUser);
  const activeBranch = useAppStore((s) => s.activeBranch);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'admin';
  const activeBranchId = activeBranch?.id ?? null;

  useEffect(() => {
    // Only admins enumerate branches; a cashier's branch name rides along on
    // their own user record.
    if (!isAdmin) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/branches');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setBranches(data.branches ?? []);
      } catch {
        // A failed lookup must not break the header; the switcher simply stays
        // on the current branch.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const activeBranchOptions = branches.filter((b) => b.active);

  const switchTo = useCallback(
    async (branchId: string) => {
      setSwitching(branchId);
      try {
        const res = await fetch('/api/auth/branch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchId }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          toast.error(data.error || 'Could not switch branch');
          return;
        }

        toast.success(
          data.activeBranch
            ? `Switched to ${data.activeBranch.name}`
            : 'Now viewing all branches'
        );

        // Reload rather than patch in place: every panel on screen is showing
        // the previous branch's stock, takings and alerts, and a partial update
        // would leave one page holding two branches' numbers. The server
        // re-reads the new signed cookie on the next request.
        if (typeof window !== 'undefined') window.location.reload();
      } catch {
        toast.error('Could not switch branch');
      } finally {
        setSwitching(null);
        setOpen(false);
      }
    },
    []
  );

  if (!currentUser) return null;

  // Salesperson: a quiet, non-interactive label of where they work.
  if (!isAdmin) {
    return (
      <Badge
        variant="outline"
        className="hidden shrink-0 gap-1.5 border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 md:inline-flex"
        title="The branch you are assigned to"
      >
        <Building2 className="h-3 w-3" />
        {activeBranch?.name ?? currentUser.branch?.name ?? 'Your branch'}
      </Badge>
    );
  }

  const isAll = activeBranchId === null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={switching !== null}
          className="h-9 shrink-0 gap-2 rounded-full border-slate-200 bg-white pl-3 pr-2.5 text-slate-700 shadow-sm hover:bg-slate-50"
        >
          {switching !== null ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
          ) : isAll ? (
            <Globe2 className="h-4 w-4 text-slate-500" />
          ) : (
            <Building2 className="h-4 w-4 text-slate-500" />
          )}
          <span className="max-w-[9rem] truncate text-sm font-medium">
            {isAll ? 'All branches' : activeBranch?.name ?? 'Current branch'}
          </span>          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
          View data for
        </DropdownMenuLabel>

        <DropdownMenuItem
          onClick={() => switchTo(ALL_BRANCHES)}
          className="cursor-pointer"
        >
          <Globe2 className="mr-2 h-4 w-4 text-slate-400" />
          <span className="flex-1">All branches</span>
          {isAll && <Check className="h-4 w-4 text-emerald-600" />}
        </DropdownMenuItem>

        {activeBranchOptions.length > 0 && <DropdownMenuSeparator />}

        {activeBranchOptions.map((branch) => (
          <DropdownMenuItem
            key={branch.id}
            onClick={() => switchTo(branch.id)}
            className="cursor-pointer"
          >
            <Building2 className="mr-2 h-4 w-4 text-slate-400" />
            <span className="flex-1 truncate">
              {branch.name}
              <span className="ml-1.5 text-xs text-slate-400">{branch.code}</span>
            </span>
            {branch.id === activeBranchId && <Check className="h-4 w-4 text-emerald-600" />}
          </DropdownMenuItem>
        ))}

        {activeBranchOptions.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-slate-500">
            No active branches yet.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
