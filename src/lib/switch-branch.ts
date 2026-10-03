/**
 * Switching the operating branch, from the client.
 *
 * WHY THIS IS A SHARED HELPER
 *
 * The branch is a SIGNED claim on the session cookie, not a piece of view state.
 * `POST /api/auth/branch` re-issues the cookie, and every panel on screen is
 * showing the previous branch's stock, takings and alerts — so the page has to be
 * reloaded rather than patched in place, or one screen ends up holding two
 * branches' numbers at once.
 *
 * That was written out twice: once in the header switcher, and again by any
 * second control that "selects a branch". Two copies of a re-issue-and-reload is
 * two chances to ship one that forgets the reload. So the branch selection is
 * defined once here and every control calls it.
 *
 * The reload is the point, not a side effect: a control that looks like it picks
 * a branch but leaves stock writes pointed at the previous branch is exactly the
 * "I selected Airport and the stock went to Main" bug this exists to prevent.
 */

import { ALL_BRANCHES } from '@/lib/branches';

export interface BranchSwitchResult {
  ok: boolean;
  error?: string;
  branchName?: string | null;
}

/**
 * Switches the operating branch and reloads the app so nothing on screen keeps
 * the old branch's figures.
 *
 * @param branchId A branch id, or `ALL_BRANCHES` ("all") for the consolidated view.
 * @returns `ok: false` with the server's message when the switch was refused. On
 *   success the page is reloading, so the caller only needs to surface errors.
 */
export async function switchActiveBranch(branchId: string): Promise<BranchSwitchResult> {
  try {
    const res = await fetch('/api/auth/branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { ok: false, error: data.error || 'Could not switch branch' };
    }

    if (typeof window !== 'undefined') {
      // Reload rather than patch: every panel is showing the previous branch's
      // stock, takings and alerts, and the server re-reads the new signed cookie
      // on the next request. `location.replace` rather than `reload` so the branch
      // switch is not a step the browser's back button has to undo.
      window.location.replace(window.location.href);
    }

    return { ok: true, branchName: data.activeBranch?.name ?? null };
  } catch {
    return { ok: false, error: 'Could not switch branch' };
  }
}