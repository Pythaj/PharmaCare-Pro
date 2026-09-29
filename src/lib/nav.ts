import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Warehouse,
  Receipt,
  RotateCcw,
  Users,
  BarChart3,
  GitCompare,
  UserCog,
  Building2,
  Truck,
  FileText,
  Settings,
} from 'lucide-react';
import { ADMIN_ONLY_PAGES } from '@/types';
import type { Page, UserRole } from '@/types';

/**
 * The single answer to "who can see what".
 *
 * ## Why this module exists
 *
 * The same role rules used to be restated in four places — the `navigate` guard
 * in the store, the render-time guard in `page.tsx`, the sidebar's two hardcoded
 * section arrays, and the mobile bottom bar's two more. They were written by
 * hand and drifted. A cashier-only page added to one list and not the other is
 * either invisible or (worse) reachable by a direct `navigate()` call, and
 * `CustomersView` shipped in exactly that state: a full page, registered in the
 * router, with no entry in any menu.
 *
 * So the *decision* lives here and the *presentation* imports it:
 *
 *   canAccessPage / resolvePageForRole  — guards, used by the store and the router
 *   getNavSections                     — sidebar sections
 *   getBottomNavItems                  — mobile thumb-reach bar
 *   getPageName                        — titles in the header and sidebar
 *
 * Adding a page means editing `Page` in `types`, the router map, and — for it to
 * be *reachable* — the section list here. The dev assertion at the bottom of this
 * file fails loudly if one of those is forgotten, which is the only way this
 * class of bug can be caught without a human opening every menu.
 */

export interface NavItem {
  label: string;
  page: Page;
  icon: React.ElementType;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Where each role lands on sign-in, and where an off-limits page bounces it. */
export const DEFAULT_PAGE_BY_ROLE: Record<UserRole, Page> = {
  admin: 'admin-dashboard',
  sales: 'sales-dashboard',
};

/**
 * `ADMIN_ONLY_PAGES` as a Set. The list is the data of record (it lives in
 * `types` next to `Page`); this is the lookup every consumer shares. A Set
 * rather than `Array.includes` so a router that checks on every render is not
 * walking an array to answer a yes/no question.
 */
const ADMIN_ONLY_PAGE_SET: ReadonlySet<Page> = new Set(ADMIN_ONLY_PAGES);

/** Is this an admin-only page, regardless of who is asking? */
export function isAdminPage(page: Page): boolean {
  return ADMIN_ONLY_PAGE_SET.has(page);
}

/**
 * May `role` open `page`?
 *
 * An absent/unknown role is treated as the least-privileged one. That is the
 * safe default for a guard: during the first paint, before `/api/auth` has
 * confirmed the session, `currentUser` is whatever localStorage claimed. Treating
 * that gap as "admin" would flash an admin-only page at a cashier before
 * bouncing them.
 */
export function canAccessPage(role: UserRole | undefined, page: Page): boolean {
  return role === 'admin' || !isAdminPage(page);
}

/**
 * The page `role` should actually be on when it asked for `page`.
 *
 * Used by both the store's `navigate` and the router's render-time guard, so
 * there is one answer rather than two that can disagree. It is idempotent —
 * `resolve(resolve(page))` always equals `resolve(page)` — which is what stops
 * the router's "current page is not allowed, navigate elsewhere" effect from
 * ping-ponging against the store.
 *
 * Note the asymmetry: a sales user aiming at an admin page is *moved* to their
 * dashboard rather than having the click ignored. Both end up in the same place,
 * but silently swallowing the click leaves the UI unchanged and looks broken.
 */
export function resolvePageForRole(role: UserRole | undefined, page: Page): Page {
  if (!canAccessPage(role, page)) return DEFAULT_PAGE_BY_ROLE.sales;
  // Admins get the consolidated dashboard; the sales dashboard is scoped to a
  // single branch and would hide the rest of the business from an owner.
  if (role === 'admin' && page === 'sales-dashboard') return DEFAULT_PAGE_BY_ROLE.admin;
  return page;
}

/** Admin sidebar — every section. */
const ADMIN_NAV_SECTIONS: NavSection[] = [
  {
    title: 'OVERVIEW',
    items: [
      { label: 'Dashboard', page: 'admin-dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'POS', page: 'pos', icon: ShoppingCart },
      { label: 'Products', page: 'products', icon: Package },
      { label: 'Inventory', page: 'inventory', icon: Warehouse },
    ],
  },
  {
    title: 'SALES',
    items: [
      { label: 'Sales History', page: 'sales-history', icon: Receipt },
      { label: 'Customers', page: 'customers', icon: Users },
      { label: 'Returns', page: 'returns', icon: RotateCcw },
    ],
  },
  {
    title: 'ANALYTICS',
    items: [
      { label: 'Reports', page: 'reports', icon: BarChart3 },
      { label: 'Branch Performance', page: 'branch-performance', icon: GitCompare },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [
      { label: 'Users', page: 'users', icon: UserCog },
      { label: 'Branches', page: 'branches', icon: Building2 },
      { label: 'Stock Transfers', page: 'transfers', icon: Truck },
      { label: 'Audit Logs', page: 'audit-logs', icon: FileText },
      { label: 'Settings', page: 'settings', icon: Settings },
    ],
  },
];

/**
 * Sales sidebar — no admin awareness at all.
 *
 * Every page here must be reachable by `sales` (`canAccessPage`), otherwise it
 * would render a link that the very next click refuses to open.
 */
const SALES_NAV_SECTIONS: NavSection[] = [
  {
    title: 'MAIN',
    items: [
      { label: 'Dashboard', page: 'sales-dashboard', icon: LayoutDashboard },
      { label: 'POS', page: 'pos', icon: ShoppingCart },
    ],
  },
  {
    title: 'RECORDS',
    items: [
      { label: 'Products', page: 'products', icon: Package },
      { label: 'Sales History', page: 'sales-history', icon: Receipt },
      { label: 'Customers', page: 'customers', icon: Users },
    ],
  },
];

const NAV_SECTIONS_BY_ROLE: Record<UserRole, NavSection[]> = {
  admin: ADMIN_NAV_SECTIONS,
  sales: SALES_NAV_SECTIONS,
};

/** Sidebar sections for a role. Unauthenticated users get the sales menu. */
export function getNavSections(role: UserRole | undefined): NavSection[] {
  return NAV_SECTIONS_BY_ROLE[role === 'admin' ? 'admin' : 'sales'];
}

/**
 * The mobile bottom bar, in thumb order, filtered by access.
 *
 * It is derived from the same page/icon/label source as the sidebar instead of
 * being retyped. The two menus being separate was tolerable until a page's label
 * or icon changed in one and not the other — the phone and the drawer would then
 * offer the same screen under two different names.
 *
 * `canAccessPage` is applied as a filter rather than being trusted: a future edit
 * that puts an admin page in this order is dropped for cashiers instead of
 * rendering a link into a redirect.
 */
const BOTTOM_NAV_ORDER: Page[] = [
  'admin-dashboard',
  'sales-dashboard',
  'pos',
  'products',
  'inventory',
  'sales-history',
];

export function getBottomNavItems(role: UserRole | undefined): NavItem[] {
  const sections = getNavSections(role);
  const lookup = new Map<Page, NavItem>();
  for (const section of sections) {
    for (const item of section.items) lookup.set(item.page, item);
  }

  return BOTTOM_NAV_ORDER.filter((page) => canAccessPage(role, page))
    .map((page) => lookup.get(page))
    .filter((item): item is NavItem => item !== undefined);
}

/**
 * Human-readable page name, used for the header title and the sidebar's active
 * rail label. Exhaustive over `Page` by construction, so adding a page without a
 * name is a compile error rather than a raw `'audit-logs'` string in the header.
 */
const PAGE_NAMES: Record<Page, string> = {
  'login': 'Login',
  'admin-dashboard': 'Dashboard',
  'sales-dashboard': 'Dashboard',
  'pos': 'POS',
  'products': 'Products',
  'inventory': 'Inventory',
  'sales-history': 'Sales History',
  'customers': 'Customers',
  'returns': 'Returns',
  'reports': 'Reports',
  'branch-performance': 'Branch Performance',
  'users': 'Users',
  'branches': 'Branches',
  'transfers': 'Stock Transfers',
  'audit-logs': 'Audit Logs',
  'settings': 'Settings',
};

export function getPageName(page: Page): string {
  return PAGE_NAMES[page];
}

/**
 * Pages deliberately kept out of every menu.
 *
 * `login` is reached by signing out, not by navigating. Nothing else belongs
 * here: a page omitted from every menu is unreachable, and if that is deliberate
 * it belongs in this list with a reason, so the omission is visible.
 */
const NOT_IN_NAV: readonly Page[] = ['login'];

/**
 * Dev-only consistency check, run once at import.
 *
 * Catches the `CustomersView` bug at load instead of at code review. Two ways a
 * hand-written menu goes wrong:
 *
 *  1. A dead link — a page listed in a role's menu that `canAccessPage` refuses.
 *     Tapping it navigates and the guard immediately bounces back, which reads
 *     to a user as a broken app rather than a missing permission.
 *  2. An orphan — a page in `Page` and in the router that no menu links to, so it
 *     exists but cannot be reached. That is exactly how `CustomersView` shipped.
 *
 * The full page list is taken from `PAGE_NAMES` keys, which is exhaustive over
 * `Page` by construction, so adding a page to `types` immediately puts it in
 * scope here and a missing menu entry is reported.
 */
if (process.env.NODE_ENV !== 'production') {
  const reachable = new Set<Page>();
  const deadLinks: string[] = [];

  for (const role of ['admin', 'sales'] as const) {
    for (const section of NAV_SECTIONS_BY_ROLE[role]) {
      for (const item of section.items) {
        reachable.add(item.page);
        if (!canAccessPage(role, item.page)) {
          deadLinks.push(`${item.page} (${role} menu)`);
        }
      }
    }
  }
  for (const page of NOT_IN_NAV) reachable.add(page);

  const orphans = (Object.keys(PAGE_NAMES) as Page[]).filter((page) => !reachable.has(page));

  if (deadLinks.length > 0) {
    console.warn(
      `[nav] Menu entries that the role cannot open — the link will bounce: ${deadLinks.join(', ')}`
    );
  }
  if (orphans.length > 0) {
    console.warn(
      `[nav] Pages no menu links to — reachable only by direct navigation: ${orphans.join(', ')}`
    );
  }
}
