'use client';

import { useAppStore } from '@/stores/app-store';
import type { Page } from '@/types';
import {
  Pill,
  LayoutDashboard,
  ShoppingCart,
  Package,
  Warehouse,
  Receipt,
  RotateCcw,
  BarChart3,
  UserCog,
  FileText,
  Settings,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { InstallFAB, detectPlatform, isInstallReady, triggerInstall } from '@/components/InstallPrompt';
import type { Platform } from '@/components/InstallPrompt';

interface NavItem {
  label: string;
  page: Page;
  icon: React.ElementType;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Admin navigation — full access to every section
const adminNavSections: NavSection[] = [
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
      { label: 'Returns', page: 'returns', icon: RotateCcw },
    ],
  },
  {
    title: 'ANALYTICS',
    items: [
      { label: 'Reports', page: 'reports', icon: BarChart3 },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [
      { label: 'Users', page: 'users', icon: UserCog },
      { label: 'Audit Logs', page: 'audit-logs', icon: FileText },
      { label: 'Settings', page: 'settings', icon: Settings },
    ],
  },
];

// Sales navigation — clean, minimal, zero admin awareness
const salesNavSections: NavSection[] = [
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

// ─── Collapsed Section Dot ───
function CollapsedSectionDot() {
  return (
    <div className="flex justify-center py-2">
      <div className="w-1 h-1 rounded-full bg-slate-700" />
    </div>
  );
}

export function Sidebar() {
  const { currentUser, currentPage, sidebarOpen, navigate, toggleSidebar, setSidebarOpen, setShowProfileDialog, appName } = useAppStore();
  const userRole = currentUser?.role || 'sales';
  const isAdmin = userRole === 'admin';
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const isStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );

  function handleUserSectionClick() {
    if (isAdmin) {
      navigate('settings');
      if (window.innerWidth < 1024) setSidebarOpen(false);
    } else {
      setShowProfileDialog(true);
      if (window.innerWidth < 1024) setSidebarOpen(false);
    }
  }

  function handleNavClick(page: Page) {
    navigate(page);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }

  const visibleSections = isAdmin ? adminNavSections : salesNavSections;

  // Shared sidebar width animation config
  const WIDTH_OPEN = 256;
  const WIDTH_COLLAPSED = 64;
  const springConfig = { type: 'spring' as const, stiffness: 350, damping: 32, mass: 0.8 };

  const sidebarContent = (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Logo Header — click app icon to toggle ─── */}
      <div
        className={cn(
          'flex items-center cursor-pointer select-none group relative',
          sidebarOpen ? 'h-16 gap-3 px-4' : 'h-16 justify-center px-2'
        )}
        onClick={toggleSidebar}
      >
        {/* App icon — the primary toggle trigger */}
        <motion.div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl relative z-10"
          style={{ backgroundColor: 'var(--accent-primary)' }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <Pill className="h-5 w-5 text-white" />
          {/* Hover glow ring */}
          <motion.div
            className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{ boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.12), 0 0 20px rgba(16, 185, 129, 0.08)' }}
          />
        </motion.div>

        {/* Text — only visible when expanded */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden whitespace-nowrap flex-1 min-w-0"
            >
              <h1 className="text-[15px] font-bold text-white tracking-tight">{appName}</h1>
              <p className="text-[10px] text-slate-500 font-medium">Pharmacy Management</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapse/Expand chevron — desktop only, right edge */}
        <motion.div
          className="hidden lg:flex items-center justify-center h-6 w-6 rounded-md text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-all duration-200 shrink-0"
          whileTap={{ scale: 0.85 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {sidebarOpen ? (
              <motion.div
                key="collapse"
                initial={{ opacity: 0, x: 4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronLeft className="h-4 w-4" />
              </motion.div>
            ) : (
              <motion.div
                key="expand"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 4 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronRight className="h-4 w-4" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Close button — mobile only */}
        <button
          className="ml-auto lg:hidden flex items-center justify-center h-7 w-7 rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Subtle separator */}
      <div className="mx-3 h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent" />

      {/* ─── Navigation ─── */}
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="h-full">
          <TooltipProvider delayDuration={150}>
            <nav className={cn('py-2', sidebarOpen ? 'px-3 space-y-1' : 'px-2 space-y-0.5')}>
              {visibleSections.map((section, sIdx) => (
                <div key={section.title}>
                  {/* Section title — expanded: full label, collapsed: tiny dot */}
                  {sidebarOpen ? (
                    <AnimatePresence>
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="mb-1.5 px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600"
                      >
                        {section.title}
                      </motion.p>
                    </AnimatePresence>
                  ) : (
                    sIdx > 0 && <CollapsedSectionDot />
                  )}

                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const isActive = currentPage === item.page;
                      const Icon = item.icon;

                      const button = (
                        <button
                          key={item.page}
                          onClick={() => handleNavClick(item.page)}
                          className={cn(
                            'group/nav relative flex w-full items-center rounded-lg text-sm font-medium transition-all duration-200',
                            sidebarOpen
                              ? 'gap-3 px-3 py-2'
                              : 'justify-center px-0 py-2.5',
                            isActive
                              ? 'text-[var(--accent-primary-fg-dark)]'
                              : 'text-slate-400 hover:text-white'
                          )}
                          style={isActive ? { backgroundColor: 'var(--accent-primary-muted)' } : undefined}
                        >
                          {/* Hover background for non-active items (collapsed) */}
                          {!isActive && !sidebarOpen && (
                            <div className="absolute inset-0 rounded-lg bg-white/0 group-hover/nav:bg-white/5 transition-colors duration-200" />
                          )}
                          <Icon
                            className={cn(
                              'shrink-0 transition-all duration-200 relative z-10',
                              sidebarOpen ? 'h-[18px] w-[18px]' : 'h-5 w-5',
                              isActive
                                ? 'text-[var(--accent-primary-fg-dark)]'
                                : 'text-slate-500 group-hover/nav:text-slate-300'
                            )}
                          />
                          <AnimatePresence>
                            {sidebarOpen && (
                              <motion.span
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -6 }}
                                transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                                className="overflow-hidden whitespace-nowrap relative z-10"
                              >
                                {item.label}
                              </motion.span>
                            )}
                          </AnimatePresence>
                          {/* Active dot indicator — expanded only */}
                          {isActive && sidebarOpen && (
                            <motion.div
                              layoutId="sidebar-active-dot"
                              className="ml-auto h-1.5 w-1.5 rounded-full shrink-0 relative z-10"
                              style={{ backgroundColor: 'var(--accent-primary-dot)' }}
                              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            />
                          )}
                          {/* Active left border — collapsed only */}
                          {isActive && !sidebarOpen && (
                            <motion.div
                              layoutId="sidebar-collapsed-active-bar"
                              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                              style={{ backgroundColor: 'var(--accent-primary)' }}
                              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            />
                          )}
                        </button>
                      );

                      if (!sidebarOpen) {
                        return (
                          <Tooltip key={item.page}>
                            <TooltipTrigger asChild>{button}</TooltipTrigger>
                            <TooltipContent
                              side="right"
                              sideOffset={12}
                              className="bg-slate-900 text-white border-slate-700/50 text-xs font-medium px-3 py-1.5 rounded-lg shadow-xl"
                            >
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
      </div>

      {/* Bottom separator */}
      <div className="mx-3 h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent" />

      {/* ─── Install App Button ─── */}
      {!isStandalone && (
        <div className="shrink-0 px-3 pt-2">
          {sidebarOpen ? (
            <button
              onClick={() => setShowInstallPrompt(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20">
                <Download className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <span className="text-xs font-medium text-emerald-400">Download App</span>
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowInstallPrompt(true)}
                  className="flex w-full items-center justify-center rounded-lg py-2 transition-all duration-200 hover:bg-emerald-500/10"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20">
                    <Download className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={12}
                className="bg-slate-900 text-white border-slate-700/50 text-xs font-medium px-3 py-1.5 rounded-lg shadow-xl"
              >
                Download App
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* ─── User Info — always pinned at bottom ─── */}
      <div className="shrink-0 p-3">
        <TooltipProvider delayDuration={150}>
          {(!sidebarOpen) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleUserSectionClick}
                  className="flex w-full items-center justify-center rounded-lg py-2 transition-all duration-200 hover:bg-white/5"
                >
                  <Avatar className="h-8 w-8" style={{ borderColor: 'var(--accent-primary-border)' }}>
                    <AvatarFallback className="text-xs font-semibold" style={{ backgroundColor: 'var(--accent-primary-muted)', color: 'var(--accent-primary-fg-dark)' }}>
                      {currentUser?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={12}
                className="bg-slate-900 text-white border-slate-700/50 text-xs font-medium px-3 py-1.5 rounded-lg shadow-xl"
              >
                {currentUser?.name || 'User'} {isAdmin ? '(Admin)' : ''}
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={handleUserSectionClick}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200 bg-white/[0.03] hover:bg-white/[0.06]"
            >
              <Avatar className="h-8 w-8 shrink-0" style={{ borderColor: 'var(--accent-primary-border)' }}>
                <AvatarFallback className="text-xs font-semibold" style={{ backgroundColor: 'var(--accent-primary-muted)', color: 'var(--accent-primary-fg-dark)' }}>
                  {currentUser?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium text-white">
                  {currentUser?.name || 'User'}
                </p>
                {isAdmin && (
                  <Badge
                    variant="secondary"
                    className="mt-0.5 text-[10px] font-medium px-1.5 py-0 h-4 bg-amber-500/15 text-amber-400 border-amber-500/20"
                  >
                    Administrator
                  </Badge>
                )}
              </div>
              {isAdmin && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[10px] text-slate-600 shrink-0"
                >
                  Settings →
                </motion.span>
              )}
            </button>
          )}
        </TooltipProvider>
      </div>
    </div>
  );

  return (
    <>
      {/* Install prompt overlay */}
      <AnimatePresence>
        {showInstallPrompt && (
          <InstallOverlay
            appName={appName}
            onClose={() => setShowInstallPrompt(false)}
          />
        )}
      </AnimatePresence>

      {/* Mobile overlay + drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] lg:hidden"
            >
              <div className="h-full bg-slate-950 rounded-r-2xl shadow-2xl">
                {sidebarContent}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <div className="hidden lg:block fixed inset-y-0 left-0 z-40">
        <motion.div
          animate={{ width: sidebarOpen ? WIDTH_OPEN : WIDTH_COLLAPSED }}
          transition={springConfig}
          className="h-full bg-slate-950 relative"
        >
          {/* Right edge glow when collapsed */}
          <AnimatePresence>
            {!sidebarOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-slate-700/40 to-transparent"
              />
            )}
          </AnimatePresence>
          {sidebarContent}
        </motion.div>
      </div>
    </>
  );
}

/* ──────────────────────────────── */
/*  Install Overlay (desktop-aware) */
/* ──────────────────────────────── */

function InstallOverlay({ appName, onClose }: { appName: string; onClose: () => void }) {
  const platform = detectPlatform();
  const installReady = isInstallReady();
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const isDesktop = platform === 'desktop';
  const isIOS = platform === 'ios';
  const isAndroid = platform === 'android';

  const handleInstall = async () => {
    setInstalling(true);
    const success = await triggerInstall();
    setInstalling(false);
    if (success) {
      setJustInstalled(true);
      setTimeout(() => onClose(), 2000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="text-center mb-4">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600">
            <Download className="h-7 w-7 text-white" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Download App</h3>
          <p className="mt-1 text-sm text-slate-500">
            {isDesktop
              ? 'Install PharmaCare Pro on your PC for quick access'
              : `Add ${appName} to your home screen for the best experience`}
          </p>
        </div>

        {justInstalled ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <Download className="h-7 w-7 text-emerald-600" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Installed!</p>
            <p className="text-xs text-slate-500 text-center">Launch PharmaCare Pro from your desktop or start menu.</p>
          </div>
        ) : isIOS ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 mb-4">
            <p>Tap the Share button in Safari, then select <strong>"Add to Home Screen"</strong>.</p>
          </div>
        ) : installReady ? (
          <div className="space-y-3 mb-4">
            <button
              onClick={handleInstall}
              disabled={installing}
              className="w-full h-11 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
            >
              {installing ? (
                <>
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  {isDesktop ? 'Install on PC' : 'Install App'}
                </>
              )}
            </button>
            {isDesktop && (
              <p className="text-xs text-slate-400 text-center">
                Opens as a standalone window. Works offline.
              </p>
            )}
          </div>
        ) : isDesktop ? (
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 mb-4">
            <p className="font-medium mb-1">Install on PC</p>
            <p>Open Chrome menu <strong>(⋮)</strong> → <strong>Cast, Save, and Share</strong> → <strong>Install PharmaCare Pro…</strong></p>
          </div>
        ) : isAndroid ? (
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 mb-4">
            <p>Open Chrome menu <strong>(⋮)</strong> → <strong>Add to Home Screen</strong>.</p>
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 mb-4">
            <p>Use your browser's <strong>Add to Home Screen</strong> option.</p>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full h-11 rounded-xl bg-slate-100 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors"
        >
          {justInstalled ? 'Done' : 'Close'}
        </button>
      </motion.div>
    </motion.div>
  );
}