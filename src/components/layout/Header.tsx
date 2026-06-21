'use client';

import { useAppStore } from '@/stores/app-store';
import { getPageName } from './Sidebar';
import { cn } from '@/lib/utils';
import { Search, Bell, Menu, LogOut, User as UserIcon, Shield, Clock, Mail, Phone } from 'lucide-react';
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
import { useEffect, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { User } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

// Premium profile dialog for sales person
function ProfileDialog({ user, open, onOpenChange }: { user: User | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [stats, setStats] = useState<{ totalSales: number; todaySales: number; txCount: number } | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    async function loadStats() {
      try {
        const res = await fetch('/api/sales?userId=' + user.id);
        if (res.ok) {
          const data = await res.json();
          const sales = data.sales ?? [];
          const totalSales = sales.reduce((sum: number, s: { totalAmount: number }) => sum + s.totalAmount, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todaySales = sales
            .filter((s: { createdAt: string }) => new Date(s.createdAt) >= today)
            .reduce((sum: number, s: { totalAmount: number }) => sum + s.totalAmount, 0);
          setStats({ totalSales, todaySales, txCount: sales.length });
        }
      } catch { /* silent */ }
    }
    loadStats();
  }, [open, user]);

  if (!user) return null;

  const initials = user.name?.split(' ').map(n => n[0]).join('') || 'U';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>My Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Profile header card */}
          <div className="flex items-center gap-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 p-4 border border-emerald-500/20">
            <Avatar className="h-16 w-16 border-2 border-emerald-500/30 shadow-lg">
              <AvatarFallback className="bg-emerald-500/20 text-xl font-bold text-emerald-600">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-slate-900 truncate">{user.name}</h3>
              <p className="text-sm text-slate-500">{user.email}</p>
              <Badge
                variant="secondary"
                className={cn(
                  'mt-1.5 text-[10px] font-medium px-2 py-0.5 h-5',
                  user.role === 'admin'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
                )}
              >
                {user.role === 'admin' ? 'Administrator' : 'Sales Person'}
              </Badge>
            </div>
          </div>

          {/* Contact details */}
          <Card className="border-slate-200">
            <CardContent className="p-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contact Information</h4>
              <div className="space-y-2.5">
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                    <Mail className="h-3.5 w-3.5 text-slate-500" />
                  </div>
                  <span className="text-slate-700">{user.email}</span>
                </div>
                {user.phone && (
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                      <Phone className="h-3.5 w-3.5 text-slate-500" />
                    </div>
                    <span className="text-slate-700">{user.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                    <Shield className="h-3.5 w-3.5 text-slate-500" />
                  </div>
                  <span className="text-slate-700">{user.active ? 'Active Account' : 'Inactive Account'}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                  </div>
                  <span className="text-slate-700">Joined {new Date(user.createdAt).toLocaleDateString('en-GH', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick stats */}
          {stats && (
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardContent className="p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-3">Your Performance</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-700">{stats.txCount}</p>
                    <p className="text-[10px] text-emerald-600 font-medium">Total Sales</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-700">{formatGHS(stats.todaySales)}</p>
                    <p className="text-[10px] text-emerald-600 font-medium">Today</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-700">{formatGHS(stats.totalSales)}</p>
                    <p className="text-[10px] text-emerald-600 font-medium">All Time</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Header() {
  const { currentUser, currentPage, sidebarOpen, setSidebarOpen, searchQuery, setSearchQuery, logout, navigate } = useAppStore();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [alertCount, setAlertCount] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

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
      setProfileOpen(true);
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
          onClick={() => navigate('inventory')}
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
                <Badge
                  variant="secondary"
                  className={cn(
                    'mt-1 w-fit text-[10px] font-medium px-1.5 py-0 h-4',
                    currentUser?.role === 'admin'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  )}
                >
                  {currentUser?.role === 'admin' ? 'Administrator' : 'Sales Person'}
                </Badge>
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
      {!isAdmin && <ProfileDialog user={currentUser} open={profileOpen} onOpenChange={setProfileOpen} />}
    </>
  );
}
