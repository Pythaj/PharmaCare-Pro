'use client';

import { lazy, Suspense, useMemo, useEffect, useSyncExternalStore } from 'react';
import { useAppStore } from '@/stores/app-store';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import LoginPage from '@/components/auth/LoginPage';
import InstallPrompt, { InstallFAB } from '@/components/InstallPrompt';
import { ThemeInitializer } from '@/components/ThemeInitializer';
import { Skeleton } from '@/components/ui/skeleton';
import type { Page } from '@/types';
import { ADMIN_ONLY_PAGES } from '@/types';

/** Loads app settings (branding) from API on mount, falls back to localStorage */
function useLoadAppSettings() {
  const appName = useAppStore((s) => s.appName);
  const setAppName = useAppStore((s) => s.setAppName);
  const setAppTagline = useAppStore((s) => s.setAppTagline);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          const name = data.pharmacy?.appName?.trim();
          const tagline = data.pharmacy?.tagline?.trim();
          if (name) setAppName(name);
          if (tagline) setAppTagline(tagline);
          if (name) localStorage.setItem('pharmacare_app_name', name);
          if (tagline) localStorage.setItem('pharmacare_app_tagline', tagline);
          return;
        }
      } catch { /* fallback below */ }
      const savedName = localStorage.getItem('pharmacare_app_name');
      const savedTagline = localStorage.getItem('pharmacare_app_tagline');
      if (savedName?.trim()) setAppName(savedName.trim());
      if (savedTagline?.trim()) setAppTagline(savedTagline.trim());
    })();
  }, [setAppName, setAppTagline]);

  useEffect(() => {
    document.title = `${appName} - Pharmacy Management System`;
  }, [appName]);
}

// Track viewport width reactively without lint errors
function useIsDesktop() {
  return useSyncExternalStore(
    (callback) => {
      const mq = window.matchMedia('(min-width: 1024px)');
      mq.addEventListener('change', callback);
      return () => mq.removeEventListener('change', callback);
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => true // SSR fallback: treat as desktop
  );
}

// Lazy loaded page components
const AdminDashboard = lazy(() => import('@/components/pages/AdminDashboard'));
const SalesDashboard = lazy(() => import('@/components/pages/SalesDashboard'));
const POSView = lazy(() => import('@/components/pages/POSView'));
const ProductsView = lazy(() => import('@/components/pages/ProductsView'));
const InventoryView = lazy(() => import('@/components/pages/InventoryView'));

const SalesHistoryView = lazy(() => import('@/components/pages/SalesHistoryView'));
const ReturnsView = lazy(() => import('@/components/pages/ReturnsView'));
const ReportsView = lazy(() => import('@/components/pages/ReportsView'));
const UsersView = lazy(() => import('@/components/pages/UsersView'));
const AuditLogsView = lazy(() => import('@/components/pages/AuditLogsView'));
const SettingsView = lazy(() => import('@/components/pages/SettingsView'));

function PageLoader() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

// Pages that are admin-only (shared with app-store navigate guard)
const adminOnlyPages = ADMIN_ONLY_PAGES;

const pageComponents: Record<Exclude<Page, 'login'>, React.LazyExoticComponent<() => React.JSX.Element>> = {
  'admin-dashboard': AdminDashboard,
  'sales-dashboard': SalesDashboard,
  'pos': POSView,
  'products': ProductsView,
  'inventory': InventoryView,

  'sales-history': SalesHistoryView,
  'returns': ReturnsView,
  'reports': ReportsView,
  'users': UsersView,
  'audit-logs': AuditLogsView,
  'settings': SettingsView,
};

export default function Home() {
  useLoadAppSettings();
  const { currentPage, isAuthenticated, sidebarOpen, currentUser } = useAppStore();
  const isDesktop = useIsDesktop();
  const navigate = useAppStore((s) => s.navigate);

  // Role-based page access guard
  const resolvedPage = (() => {
    if (currentUser?.role !== 'admin' && adminOnlyPages.includes(currentPage)) {
      // Redirect sales users to their dashboard if they try to access admin pages
      return 'sales-dashboard' as Page;
    }
    if (currentUser?.role === 'admin' && currentPage === 'sales-dashboard') {
      return 'admin-dashboard' as Page;
    }
    return currentPage;
  })();

  useEffect(() => {
    if (resolvedPage !== currentPage) {
      navigate(resolvedPage);
    }
  }, [resolvedPage, currentPage, navigate]);

  const ActivePage = useMemo(() => {
    if (resolvedPage === 'login') return null;
    return pageComponents[resolvedPage] || null;
  }, [resolvedPage]);

  // Theme initialization (renders nothing, applies CSS vars)
  // Must be rendered always, even on login page

  // Login page
  if (!isAuthenticated || currentPage === 'login') {
    return <>
      <ThemeInitializer />
      <LoginPage />
      <InstallPrompt />
      <InstallFAB />
    </>;
  }

  // Sidebar width: only apply margin on desktop where sidebar is fixed
  const sidebarWidth = isDesktop ? (sidebarOpen ? 260 : 68) : 0;

  // Pages that manage their own full-height layout (no page-level scroll)
  const selfScrollingPages: Page[] = ['pos'];
  const isSelfScrolling = selfScrollingPages.includes(resolvedPage);

  // App layout
  return (
    <div className="h-screen overflow-hidden bg-slate-50/80 flex">
      <ThemeInitializer />
      <Sidebar />
      <div
        className="flex flex-col min-w-0 h-full flex-1 transition-[margin-left] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ marginLeft: sidebarWidth }}
      >
        <Header />
        <main className="flex-1 overflow-hidden">
          <div className={isSelfScrolling ? 'h-full' : 'h-full overflow-y-auto scroll-smooth'}>
            <Suspense fallback={<PageLoader />}>
              {ActivePage && <ActivePage key={currentPage} />}
            </Suspense>
          </div>
        </main>
      </div>
      <InstallPrompt />
      <InstallFAB />
    </div>
  );
}
