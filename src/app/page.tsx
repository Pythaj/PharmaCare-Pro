'use client';

import { lazy, Suspense, useMemo } from 'react';
import { useAppStore } from '@/stores/app-store';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import LoginPage from '@/components/auth/LoginPage';
import { Skeleton } from '@/components/ui/skeleton';
import type { Page } from '@/types';

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
  const { currentPage, isAuthenticated } = useAppStore();

  const ActivePage = useMemo(() => {
    if (currentPage === 'login') return null;
    return pageComponents[currentPage] || null;
  }, [currentPage]);

  // Login page
  if (!isAuthenticated || currentPage === 'login') {
    return <LoginPage />;
  }

  // App layout
  return (
    <div className="min-h-screen bg-slate-50/80">
      <div className="flex">
        <Sidebar />
        <div className="flex flex-1 flex-col min-h-screen">
          <Header />
          <main className="flex-1 overflow-y-auto">
            <Suspense fallback={<PageLoader />}>
              {ActivePage && <ActivePage key={currentPage} />}
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}
