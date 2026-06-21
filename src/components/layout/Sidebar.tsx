'use client';

import { useAppStore } from '@/stores/app-store';
import type { Page, UserRole } from '@/types';
import {
  Pill,
  LayoutDashboard,
  ShoppingCart,
  Package,
  Warehouse,
  Users,
  Truck,
  Building2,
  Receipt,
  RotateCcw,
  BarChart3,
  UserCog,
  FileText,
  Settings,
  ChevronLeft,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  page: Page;
  icon: React.ElementType;
  roles: UserRole[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'MAIN',
    items: [
      { label: 'Dashboard', page: 'admin-dashboard', icon: LayoutDashboard, roles: ['admin'] },
      { label: 'Dashboard', page: 'sales-dashboard', icon: LayoutDashboard, roles: ['sales'] },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'POS', page: 'pos', icon: ShoppingCart, roles: ['admin', 'sales'] },
      { label: 'Products', page: 'products', icon: Package, roles: ['admin', 'sales'] },
      { label: 'Inventory', page: 'inventory', icon: Warehouse, roles: ['admin', 'sales'] },
      { label: 'Customers', page: 'customers', icon: Users, roles: ['admin', 'sales'] },
    ],
  },
  {
    title: 'PROCUREMENT',
    items: [
      { label: 'Purchases', page: 'purchases', icon: Truck, roles: ['admin', 'sales'] },
      { label: 'Suppliers', page: 'suppliers', icon: Building2, roles: ['admin'] },
    ],
  },
  {
    title: 'SALES',
    items: [
      { label: 'Sales History', page: 'sales-history', icon: Receipt, roles: ['admin', 'sales'] },
      { label: 'Returns', page: 'returns', icon: RotateCcw, roles: ['admin'] },
    ],
  },
  {
    title: 'REPORTS',
    items: [
      { label: 'Reports', page: 'reports', icon: BarChart3, roles: ['admin'] },
    ],
  },
  {
    title: 'ADMIN',
    items: [
      { label: 'Users', page: 'users', icon: UserCog, roles: ['admin'] },
      { label: 'Audit Logs', page: 'audit-logs', icon: FileText, roles: ['admin'] },
      { label: 'Settings', page: 'settings', icon: Settings, roles: ['admin'] },
    ],
  },
];

const pageNameMap: Record<Page, string> = {
  'login': 'Login',
  'admin-dashboard': 'Dashboard',
  'sales-dashboard': 'Dashboard',
  'pos': 'POS',
  'products': 'Products',
  'inventory': 'Inventory',
  'customers': 'Customers',
  'suppliers': 'Suppliers',
  'purchases': 'Purchases',
  'sales-history': 'Sales History',
  'returns': 'Returns',
  'reports': 'Reports',
  'users': 'Users',
  'audit-logs': 'Audit Logs',
  'settings': 'Settings',
};

export function getPageName(page: Page): string {
  return pageNameMap[page] || page;
}

export function Sidebar() {
  const { currentUser, currentPage, sidebarOpen, navigate, toggleSidebar, setSidebarOpen } = useAppStore();
  const userRole = currentUser?.role || 'sales';

  const visibleSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(userRole)),
  })).filter((section) => section.items.length > 0);

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500">
          <Pill className="h-5 w-5 text-white" />
        </div>
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden whitespace-nowrap"
            >
              <h1 className="text-base font-bold text-white">PharmaCare Pro</h1>
              <p className="text-[10px] text-slate-400">Pharmacy Management</p>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Collapse button - desktop only */}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto hidden h-7 w-7 text-slate-400 hover:bg-slate-800 hover:text-white lg:flex"
          onClick={toggleSidebar}
        >
          <motion.div animate={{ rotate: sidebarOpen ? 0 : 180 }} transition={{ duration: 0.3 }}>
            <ChevronLeft className="h-4 w-4" />
          </motion.div>
        </Button>
        {/* Close button - mobile only */}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Separator className="bg-slate-800" />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <TooltipProvider delayDuration={0}>
          <nav className="space-y-6">
            {visibleSections.map((section) => (
              <div key={section.title}>
                <AnimatePresence>
                  {sidebarOpen && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                    >
                      {section.title}
                    </motion.p>
                  )}
                </AnimatePresence>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = currentPage === item.page;
                    const Icon = item.icon;

                    const button = (
                      <button
                        key={item.page}
                        onClick={() => navigate(item.page)}
                        className={cn(
                          'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                          isActive
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4.5 w-4.5 shrink-0 transition-colors',
                            isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'
                          )}
                        />
                        <AnimatePresence>
                          {sidebarOpen && (
                            <motion.span
                              initial={{ opacity: 0, width: 0 }}
                              animate={{ opacity: 1, width: 'auto' }}
                              exit={{ opacity: 0, width: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden whitespace-nowrap"
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </AnimatePresence>
                        {isActive && sidebarOpen && (
                          <motion.div
                            layoutId="sidebar-active-indicator"
                            className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400"
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          />
                        )}
                      </button>
                    );

                    if (!sidebarOpen) {
                      return (
                        <Tooltip key={item.page}>
                          <TooltipTrigger asChild>{button}</TooltipTrigger>
                          <TooltipContent side="right" className="bg-slate-800 text-white border-slate-700">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return button;
                  })}
                </div>
              </div>
            ))}
          </nav>
        </TooltipProvider>
      </ScrollArea>

      <Separator className="bg-slate-800" />

      {/* User info */}
      <div className="p-3">
        <div className={cn(
          'flex items-center gap-3 rounded-lg bg-slate-800/50 px-3 py-2.5',
          !sidebarOpen && 'justify-center px-0'
        )}>
          <Avatar className="h-8 w-8 border border-emerald-500/30">
            <AvatarFallback className="bg-emerald-500/20 text-xs font-semibold text-emerald-400">
              {currentUser?.name?.split(' ').map(n => n[0]).join('') || 'U'}
            </AvatarFallback>
          </Avatar>
          <AnimatePresence>
            {sidebarOpen && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2 }}
                className="min-w-0 overflow-hidden"
              >
                <p className="truncate text-sm font-medium text-white">
                  {currentUser?.name || 'User'}
                </p>
                <Badge
                  variant="secondary"
                  className={cn(
                    'mt-0.5 text-[10px] font-medium px-1.5 py-0 h-4',
                    currentUser?.role === 'admin'
                      ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                      : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                  )}
                >
                  {currentUser?.role === 'admin' ? 'Administrator' : 'Sales Person'}
                </Badge>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] lg:hidden"
            >
              <div className="h-full bg-slate-950">
                {sidebarContent}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: sidebarOpen ? 260 : 68 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="hidden h-screen shrink-0 lg:block"
      >
        <div className="h-full bg-slate-950 border-r border-slate-800/50">
          {sidebarContent}
        </div>
      </motion.aside>
    </>
  );
}