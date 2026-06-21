'use client';

import { useAppStore } from '@/stores/app-store';
import { getPageName } from './Sidebar';
import { cn } from '@/lib/utils';
import {
  Search,
  Bell,
  Menu,
  LogOut,
  User as UserIcon,
  Shield,
  Clock,
  Mail,
  Phone,
  TrendingUp,
  Calendar,
  Star,
  Award,
  ShoppingCart,
  Receipt,
  Timer,
  ChevronRight,
  Activity,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import { toast } from 'sonner';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

// Premium profile dialog for sales person
function ProfileDialog() {
  const { currentUser, showProfileDialog, setShowProfileDialog, loginTime, logout, navigate } = useAppStore();
  const [stats, setStats] = useState<{ totalSales: number; todaySales: number; txCount: number; weekSales: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0);

  // Live session timer
  useEffect(() => {
    if (!showProfileDialog || !loginTime) return;
    const tick = () => setSessionElapsed(Date.now() - loginTime);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [showProfileDialog, loginTime]);

  // Load stats
  useEffect(() => {
    if (!showProfileDialog || !currentUser) return;
    setLoading(true);
    async function loadStats() {
      try {
        const res = await fetch('/api/sales?userId=' + currentUser.id);
        if (res.ok) {
          const data = await res.json();
          const sales = data.sales ?? [];
          const totalSales = sales.reduce((sum: number, s: { totalAmount: number }) => sum + s.totalAmount, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          const todaySales = sales
            .filter((s: { createdAt: string }) => new Date(s.createdAt) >= today)
            .reduce((sum: number, s: { totalAmount: number }) => sum + s.totalAmount, 0);
          const weekSales = sales
            .filter((s: { createdAt: string }) => new Date(s.createdAt) >= weekAgo)
            .reduce((sum: number, s: { totalAmount: number }) => sum + s.totalAmount, 0);
          setStats({ totalSales, todaySales, txCount: sales.length, weekSales });
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    loadStats();
  }, [showProfileDialog, currentUser]);

  const handleLogout = useCallback(() => {
    setShowProfileDialog(false);
    setTimeout(() => {
      logout();
      toast.success('Logged out successfully');
    }, 200);
  }, [setShowProfileDialog, logout]);

  const handleQuickAction = useCallback((page: 'pos' | 'sales-history') => {
    setShowProfileDialog(false);
    setTimeout(() => navigate(page), 150);
  }, [setShowProfileDialog, navigate]);

  if (!currentUser) return null;

  const initials = currentUser.name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U';
  const isAdmin = currentUser.role === 'admin';
  const isActive = sessionElapsed > 0;

  return (
    <Dialog open={showProfileDialog} onOpenChange={setShowProfileDialog}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0">
        {/* Premium gradient header */}
        <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 px-6 pb-8 pt-8">
          {/* Subtle pattern overlay */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
          <DialogHeader>
            <DialogTitle className="text-white/90 text-sm font-medium">My Profile</DialogTitle>
          </DialogHeader>

          {/* User info */}
          <div className="flex items-center gap-4 mt-4">
            <div className="relative">
              <Avatar className="h-16 w-16 border-2 border-white/30 shadow-xl ring-4 ring-white/10">
                <AvatarFallback className="bg-white/20 text-xl font-bold text-white backdrop-blur-sm">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {/* Online indicator */}
              <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-emerald-500 bg-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-white truncate">{currentUser.name}</h3>
              <p className="text-sm text-white/70 truncate">{currentUser.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge
                  variant="secondary"
                  className={
                    'text-[10px] font-semibold px-2.5 py-0.5 h-5 bg-white/20 text-white border border-white/20'
                  }
                >
                  {isAdmin ? '★ Administrator' : '◆ Staff Member'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Session timer pill */}
          {isActive && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 backdrop-blur-sm border border-white/10">
              <Activity className="h-3.5 w-3.5 text-green-300" />
              <span className="text-xs font-medium text-white/90">Session active</span>
              <Separator orientation="vertical" className="h-3 bg-white/30" />
              <div className="flex items-center gap-1">
                <Timer className="h-3 w-3 text-white/70" />
                <span className="text-xs font-mono text-white/90 tabular-nums">{formatDuration(sessionElapsed)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="max-h-[65vh] overflow-y-auto">
          <div className="p-5 space-y-4">
            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleQuickAction('pos')}
                className="flex items-center gap-2.5 rounded-xl bg-emerald-50 p-3 text-left transition-all hover:bg-emerald-100 hover:shadow-sm active:scale-[0.98] border border-emerald-100/80"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 shadow-sm">
                  <ShoppingCart className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-900">New Sale</p>
                  <p className="text-[10px] text-emerald-600/70">Start POS</p>
                </div>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-emerald-400" />
              </button>
              <button
                onClick={() => handleQuickAction('sales-history')}
                className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-3 text-left transition-all hover:bg-slate-100 hover:shadow-sm active:scale-[0.98] border border-slate-100/80"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-600 shadow-sm">
                  <Receipt className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">Sales History</p>
                  <p className="text-[10px] text-slate-500">View records</p>
                </div>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400" />
              </button>
            </div>

            {/* Contact details */}
            <Card className="border-slate-100 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Contact Information</h4>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                      <Mail className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                    <span className="text-slate-700 truncate">{currentUser.email}</span>
                  </div>
                  {currentUser.phone && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                        <Phone className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                      <span className="text-slate-700">{currentUser.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                      <Shield className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                    <span className={cn('font-medium', currentUser.active ? 'text-emerald-700' : 'text-red-600')}>
                      {currentUser.active ? '● Active Account' : '○ Inactive Account'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                      <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                    <span className="text-slate-700">
                      Joined {new Date(currentUser.createdAt).toLocaleDateString('en-GH', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Performance stats */}
            <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-teal-50/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500">
                    <TrendingUp className="h-3.5 w-3.5 text-white" />
                  </div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Your Performance</h4>
                </div>
                {loading ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="h-16 rounded-lg bg-white/60 animate-pulse" />
                    ))}
                  </div>
                ) : stats ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-lg bg-white/80 p-3 text-center border border-emerald-100/50 shadow-sm">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Star className="h-3 w-3 text-amber-500" />
                        <span className="text-[10px] font-medium text-slate-500">Transactions</span>
                      </div>
                      <p className="text-lg font-bold text-slate-800">{stats.txCount}</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-3 text-center border border-emerald-100/50 shadow-sm">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <TrendingUp className="h-3 w-3 text-emerald-500" />
                        <span className="text-[10px] font-medium text-slate-500">All Time</span>
                      </div>
                      <p className="text-base font-bold text-slate-800">{formatGHS(stats.totalSales)}</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-3 text-center border border-emerald-100/50 shadow-sm">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Clock className="h-3 w-3 text-blue-500" />
                        <span className="text-[10px] font-medium text-slate-500">This Week</span>
                      </div>
                      <p className="text-base font-bold text-slate-800">{formatGHS(stats.weekSales)}</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-3 text-center border border-emerald-100/50 shadow-sm">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Award className="h-3 w-3 text-emerald-500" />
                        <span className="text-[10px] font-medium text-slate-500">Today</span>
                      </div>
                      <p className="text-base font-bold text-slate-800">{formatGHS(stats.todaySales)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                      <TrendingUp className="h-5 w-5 text-emerald-500" />
                    </div>
                    <p className="text-sm text-slate-500">No sales data available yet.</p>
                    <button
                      onClick={() => handleQuickAction('pos')}
                      className="mt-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 underline underline-offset-2"
                    >
                      Start your first sale →
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Sticky footer with logout */}
        <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2.5 text-red-600 hover:text-red-700 hover:bg-red-50 h-10 rounded-lg font-medium"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Header() {
  const { currentUser, currentPage, sidebarOpen, setSidebarOpen, searchQuery, setSearchQuery, logout, navigate, setShowProfileDialog } = useAppStore();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [alertCount, setAlertCount] = useState(0);

  const isAdmin = currentUser?.role === 'admin';

  function handleSearchAction() {
    if (searchQuery.trim()) {
      navigate('pos');
      toast('Searching products...');
    } else {
      navigate('products');
    }
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleSearchAction();
    }
  }

  function handleProfileClick() {
    if (isAdmin) {
      navigate('settings');
    } else {
      setShowProfileDialog(true);
    }
  }

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const res = await fetch('/api/dashboard/stats');
        if (res.ok) {
          const data = await res.json();
          const count = (data.lowStockCount ?? 0) + (data.expiringCount ?? 0);
          setAlertCount(count);
        }
      } catch { /* silent */ }
    }
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      );
      setCurrentDate(
        now.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 md:px-6">
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">PharmaCare Pro</span>
          <span className="text-slate-300">/</span>
          <span className="font-medium text-slate-900">{getPageName(currentPage)}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search */}
        <div className="hidden w-full max-w-sm items-center gap-2 md:flex">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 cursor-pointer" onClick={handleSearchAction} />
            <Input
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="h-9 w-full pl-9 border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500"
            />
          </div>
        </div>

        {/* Date/time */}
        <div className="hidden items-center gap-2 text-sm text-slate-500 lg:flex">
          <span>{currentDate}</span>
          <Separator orientation="vertical" className="h-4 bg-slate-200" />
          <span className="font-medium text-slate-700">{currentTime}</span>
        </div>

        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          onClick={() => navigate(isAdmin ? 'inventory' : 'sales-dashboard')}
        >
          <Bell className="h-4.5 w-4.5" />
          {alertCount > 0 && (
            <Badge className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white border-2 border-white">
              {alertCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative flex h-9 items-center gap-2 rounded-full pl-1.5 pr-3 hover:bg-slate-100">
              <Avatar className="h-7 w-7 border border-emerald-500/30">
                <AvatarFallback className="bg-emerald-500/15 text-xs font-semibold text-emerald-600">
                  {currentUser?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium text-slate-700 md:inline-block">
                {currentUser?.name || 'User'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-slate-900">{currentUser?.name}</p>
                <p className="text-xs text-slate-500">{currentUser?.email}</p>
                {isAdmin && (
                <Badge
                  variant="secondary"
                  className="mt-1 w-fit text-[10px] font-medium px-1.5 py-0 h-4 bg-amber-100 text-amber-700"
                >
                  Administrator
                </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleProfileClick}
              className="text-slate-600 focus:text-slate-900 focus:bg-slate-50 cursor-pointer"
            >
              <UserIcon className="mr-2 h-4 w-4" />
              {isAdmin ? 'Settings' : 'My Profile'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="text-red-600 focus:text-red-700 focus:bg-red-50 cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Profile dialog for non-admin users */}
      {!isAdmin && <ProfileDialog />}
    </>
  );
}
