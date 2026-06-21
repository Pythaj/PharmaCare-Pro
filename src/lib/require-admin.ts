import { db } from '@/lib/db'

/**
 * Verify that the requesting user has admin privileges.
 * Expects `userId` to be present in the request body.
 * Returns { success: true } or { success: false, error: string, status: number }.
 */
export async function requireAdmin(body: Record<string, unknown>) {
  const userId = body.userId as string | undefined

  if (!userId) {
    return { success: false, error: 'Authentication required', status: 401 }
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, active: true },
    })

    if (!user) {
      return { success: false, error: 'User not found', status: 401 }
    }

    if (!user.active) {
      return { success: false, error: 'Account is inactive', status: 403 }
    }

    if (user.role !== 'admin') {
      return { success: false, error: 'Access denied. Administrator privileges required for this action.', status: 403 }
    }

    return { success: true }
  } catch {
    return { success: false, error: 'Authentication check failed', status: 500 }
  }
}
