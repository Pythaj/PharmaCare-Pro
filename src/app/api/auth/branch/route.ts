import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { generateToken } from '@/lib/auth';
import { setAuthCookie } from '@/lib/auth-cookie';
import { logAudit, getClientIp } from '@/lib/audit';
import { ALL_BRANCHES } from '@/lib/branches';

/**
 * POST /api/auth/branch — switch the active branch.
 *
 * Admin only, by design. A salesperson is pinned to their home branch, so
 * offering them a switcher would be a privilege-escalation surface no matter
 * how well the client hides the control — hence the server-side refusal here
 * rather than a disabled dropdown.
 *
 * `branchId: "all"` selects the consolidated company view. The switch re-issues
 * the session cookie because the branch is a signed claim; the alternative
 * (a separate mutable row) would need its own invalidation logic and would be
 * one forgotten cache away from serving the wrong branch's money.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const user = auth.user!;

  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only an administrator can switch branches' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const requested = body?.branchId;

    if (typeof requested !== 'string' || !requested) {
      return NextResponse.json({ error: 'branchId is required' }, { status: 400 });
    }

    // "All branches" is a legitimate admin-only view.
    if (requested === ALL_BRANCHES) {
      return issue(request, user, null);
    }

    const branch = await db.branch.findUnique({
      where: { id: requested },
      select: { id: true, name: true, code: true, active: true },
    });

    // Do not distinguish "no such branch" from "inactive" — both simply cannot
    // be selected, and confirming existence would let an admin probe ids.
    if (!branch || !branch.active) {
      return NextResponse.json(
        { error: 'That branch is not available' },
        { status: 404 }
      );
    }

    return issue(request, user, branch);
  } catch (error) {
    console.error('Branch switch error:', error);
    return NextResponse.json({ error: 'Failed to switch branch' }, { status: 500 });
  }
}

async function issue(
  request: NextRequest,
  user: { userId: string; email: string; role: string },
  branch: { id: string; name: string; code: string } | null
) {
  const token = generateToken({
    userId: user.userId,
    email: user.email,
    role: user.role,
    branchId: branch?.id ?? null,
  });

  const response = NextResponse.json({
    success: true,
    activeBranch: branch,
    scope: branch ? 'branch' : 'all',
  });
  setAuthCookie(response, token);

  // Recorded because "which shop was the owner looking at when this happened"
  // is the first question asked when a figure looks wrong.
  await logAudit({
    userId: user.userId,
    branchId: branch?.id ?? null,
    action: 'UPDATE',
    entity: 'Branch',
    entityId: branch?.id ?? null,
    details: branch
      ? `Switched active branch to "${branch.name}"`
      : 'Switched to the all-branches view',
    ipAddress: getClientIp(request),
  });

  return response;
}
