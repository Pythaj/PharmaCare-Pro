'use client';

import { useAppStore } from '@/stores/app-store';
import { getPageName } from './Sidebar';
import { cn } from '@/lib/utils';
import { Search, Bell, Menu, LogOut, User as UserIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { useEffect, useState } from 'react';

export function Header() {
  const { currentUser, currentPage, sidebarOpen, setSidebarOpen, searchQuery, setSearchQuery, logout, navigate } = useAppStore();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [alertCount, setAlertCount] = useState(0);

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
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
          <DropdownMenuItem className="text-slate-600 focus:text-slate-900 focus:bg-slate-50 cursor-pointer">
            <UserIcon className="mr-2 h-4 w-4" />
            Profile
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
  );
}

