'use client';

import { useAppStore } from '@/stores/app-store';
import type { Page } from '@/types';
import { LayoutDashboard, ShoppingCart, Package, Warehouse, Menu, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BottomNavItem {
  label: string;
  page: Page;
  icon: React.ElementType;
}

// Mirrors the sidebar's primary destinations so the phone thumb-reach nav stays
// in sync with the same role rules (admin vs sales) — single source (Rule 18).
const adminBottomNav: BottomNavItem[] = [
  { label: 'Dashboard', page: 'admin-dashboard', icon: LayoutDashboard },
  { label: 'POS', page: 'pos', icon: ShoppingCart },
  { label: 'Products', page: 'products', icon: Package },
  { label: 'Inventory', page: 'inventory', icon: Warehouse },
  { label: 'History', page: 'sales-history', icon: Receipt },
];

const salesBottomNav: BottomNavItem[] = [
  { label: 'Dashboard', page: 'sales-dashboard', icon: LayoutDashboard },
  { label: 'POS', page: 'pos', icon: ShoppingCart },
  { label: 'Products', page: 'products', icon: Package },
  { label: 'History', page: 'sales-history', icon: Receipt },
];

/**
 * Fixed mobile bottom navigation bar. Only rendered on small screens (< lg);
 * tapping a destination navigates and the drawer stays shut. The last slot is a
 * hamburger that re-opens the full sidebar drawer for everything else.
 */
export function MobileBottomNav() {
  const { currentUser, currentPage, navigate, setSidebarOpen } = useAppStore();
  const isAdmin = currentUser?.role === 'admin';
  const items = isAdmin ? adminBottomNav : salesBottomNav;

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 py-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.page;
          return (
            <button
              key={item.page}
              onClick={() => navigate(item.page)}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2 min-w-0 transition-colors',
                isActive ? 'text-[var(--accent-primary)]' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className={cn('h-5 w-5', isActive && 'fill-[var(--accent-primary-light)]')} />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2 min-w-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none">Menu</span>
        </button>
      </div>
    </nav>
  );
}