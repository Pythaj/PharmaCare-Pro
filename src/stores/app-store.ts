import { create } from 'zustand';
import type { Page, User, CartItem } from '@/types';
import { ADMIN_ONLY_PAGES } from '@/types';

export type AccentTheme = 'emerald' | 'blue' | 'violet' | 'rose' | 'amber' | 'teal';

interface AppState {
  // App Branding
  appName: string;
  appTagline: string;
  
  // Auth
  currentUser: User | null;
  isAuthenticated: boolean;
  loginTime: number;
  
  // Navigation
  currentPage: Page;
  sidebarOpen: boolean;
  
  // POS Cart
  cart: CartItem[];
  selectedCustomerId: string | null;
  
  // UI State
  searchQuery: string;
  showProfileDialog: boolean;
  accentTheme: AccentTheme;
  
  // Actions
  setAppName: (name: string) => void;
  setAppTagline: (tagline: string) => void;
  login: (user: User) => void;
  logout: () => void;
  navigate: (page: Page) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  
  // Cart actions
  addToCart: (item: CartItem) => void;
  removeFromCart: (productId: string, batchId: string) => void;
  updateCartQuantity: (productId: string, batchId: string, quantity: number) => void;
  clearCart: () => void;
  setSelectedCustomer: (id: string | null) => void;
  
  // Search
  setSearchQuery: (query: string) => void;
  setShowProfileDialog: (open: boolean) => void;
  setAccentTheme: (theme: AccentTheme) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // App Branding
  appName: 'PharmaCare Pro',
  appTagline: 'Premium Pharmacy Management System',
  
  // Auth
  currentUser: null,
  isAuthenticated: false,
  loginTime: 0,
  
  // Navigation
  currentPage: 'login',
  sidebarOpen: true,
  
  // POS Cart
  cart: [],
  selectedCustomerId: null,
  
  // UI State
  searchQuery: '',
  showProfileDialog: false,
  accentTheme: 'emerald' as AccentTheme,
  
  // Actions
  login: (user) => set({
    currentUser: user,
    isAuthenticated: true,
    loginTime: Date.now(),
    currentPage: user.role === 'admin' ? 'admin-dashboard' : 'sales-dashboard',
  }),
  
  logout: () => set({
    currentUser: null,
    isAuthenticated: false,
    loginTime: 0,
    currentPage: 'login',
    cart: [],
    selectedCustomerId: null,
    searchQuery: '',
    showProfileDialog: false,
  }),
  
  navigate: (page) => set((state) => {
    // Prevent sales users from navigating to admin-only pages
    const adminOnly = ADMIN_ONLY_PAGES;
    if (state.currentUser?.role !== 'admin' && adminOnly.includes(page)) {
      return {}; // No-op: don't navigate to admin pages
    }
    // Redirect admin from sales-dashboard to admin-dashboard
    if (state.currentUser?.role === 'admin' && page === 'sales-dashboard') {
      return { currentPage: 'admin-dashboard' };
    }
    return { currentPage: page };
  }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  
  // Cart
  addToCart: (item) => set((state) => {
    const existing = state.cart.find(
      (c) => c.productId === item.productId && c.batchId === item.batchId
    );
    if (existing) {
      return {
        cart: state.cart.map((c) =>
          c.productId === item.productId && c.batchId === item.batchId
            ? { ...c, quantity: Math.min(c.quantity + item.quantity, c.availableQty) }
            : c
        ),
      };
    }
    return { cart: [...state.cart, item] };
  }),
  
  removeFromCart: (productId, batchId) => set((state) => ({
    cart: state.cart.filter(
      (c) => !(c.productId === productId && c.batchId === batchId)
    ),
  })),
  
  updateCartQuantity: (productId, batchId, quantity) => set((state) => ({
    cart: state.cart.map((c) =>
      c.productId === productId && c.batchId === batchId
        ? { ...c, quantity: Math.max(1, Math.min(quantity, c.availableQty)) }
        : c
    ),
  })),
  
  clearCart: () => set({ cart: [], selectedCustomerId: null }),
  setSelectedCustomer: (id) => set({ selectedCustomerId: id }),
  
  // Search
  setSearchQuery: (query) => set({ searchQuery: query }),
  setShowProfileDialog: (open) => set({ showProfileDialog: open }),
  setAccentTheme: (theme) => set({ accentTheme: theme }),
  setAppName: (name) => set({ appName: name }),
  setAppTagline: (tagline) => set({ appTagline: tagline }),
}));
