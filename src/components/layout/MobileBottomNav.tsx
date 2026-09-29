'use client';

import { useAppStore } from '@/stores/app-store';
import { getBottomNavItems } from '@/lib/nav';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Fixed mobile bottom navigation bar. Only rendered on small screens (< lg);
 * tapping a destination navigates and the drawer stays shut. The last slot is a
 * hamburger that re-opens the full sidebar drawer for everything else.
 *
 * The items themselves come from `@/lib/nav` — the same labels, icons and pages
 * the sidebar uses — so the phone and the drawer can never offer the same screen
 * under two different names, and an admin-only page cannot be typed into this
 * bar for cashiers by accident. This file is layout only.
 */
export function MobileBottomNav() {
  const { currentUser, currentPage, navigate, setSidebarOpen } = useAppStore();
  const items = getBottomNavItems(currentUser?.role);

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