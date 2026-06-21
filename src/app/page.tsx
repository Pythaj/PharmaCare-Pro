'use client';

import { lazy, Suspense, useMemo, useEffect, useSyncExternalStore } from 'react';
import { useAppStore } from '@/stores/app-store';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import LoginPage from '@/components/auth/LoginPage';
import { Skeleton } from '@/components/ui/skeleton';
import type { Page } from '@/types';

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
const CustomersView = lazy(() => import('@/components/pages/CustomersView'));
const SuppliersView = lazy(() => import('@/components/pages/SuppliersView'));
const PurchasesView = lazy(() => import('@/components/pages/PurchasesView'));
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

// Pages that are admin-only
const adminOnlyPages: Page[] = ['admin-dashboard', 'suppliers', 'returns', 'reports', 'users', 'audit-logs', 'settings', 'inventory', 'purchases'];

const pageComponents: Record<Exclude<Page, 'login'>, React.LazyExoticComponent<() => React.JSX.Element>> = {
  'admin-dashboard': AdminDashboard,
  'sales-dashboard': SalesDashboard,
  'pos': POSView,
  'products': ProductsView,
  'inventory': InventoryView,
  'customers': CustomersView,
  'suppliers': SuppliersView,
  'purchases': PurchasesView,
  'sales-history': SalesHistoryView,
  'returns': ReturnsView,
  'reports': ReportsView,
  'users': UsersView,
  'audit-logs': AuditLogsView,
  'settings': SettingsView,
};

export default function Home() {
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

  // Login page
  if (!isAuthenticated || currentPage === 'login') {
    return <LoginPage />;
  }

  // Sidebar width: only apply margin on desktop where sidebar is fixed
  const sidebarWidth = isDesktop ? (sidebarOpen ? 260 : 68) : 0;

  // App layout
  return (
    <div className="h-screen overflow-hidden bg-slate-50/80">
      <Sidebar />
      <div
        className="flex flex-1 flex-col min-w-0 h-full transition-[margin-left] duration-300 ease-in-out"
        style={{ marginLeft: sidebarWidth }}
      >
        <Header />
        <main className="flex-1 overflow-y-auto scroll-smooth">
          <Suspense fallback={<PageLoader />}>
            {ActivePage && <ActivePage key={currentPage} />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
