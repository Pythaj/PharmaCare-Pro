import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Page, User, CartItem, Branch } from '@/types';
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
  /**
   * True while the signed-in account is still on its temporary password.
   * Server-enforced (every business API answers 403 until setup is done); this
   * flag only decides which screen to render, and is re-derived from the server
   * on every app load so it can never be stale or forged via localStorage.
   */
  requiresPasswordSetup: boolean;
  /**
   * Which branch's data the UI is currently showing. Distinct from
   * `currentUser.branchId`, which is where a salesperson is *employed*: an admin
   * has no home branch but can be looking at one. `null` for an admin means the
   * consolidated all-branches view.
   */
  activeBranch: Branch | null;
  
  // Navigation
  currentPage: Page;
  sidebarOpen: boolean;
  
  // POS Cart
  cart: CartItem[];
  selectedCustomerId: string | null;
  // Date the POS should pre-fill (used by the register's "backfill sales" deep-link)
  posPresetDate: string | null;
  
  // UI State
  searchQuery: string;
  showProfileDialog: boolean;
  accentTheme: AccentTheme;
  
  // Actions
  setAppName: (name: string) => void;
  setAppTagline: (tagline: string) => void;
  login: (user: User) => void;
  setCurrentUser: (user: User) => void;
  setRequiresPasswordSetup: (required: boolean) => void;
  setActiveBranch: (branch: Branch | null) => void;
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
  setPosPresetDate: (date: string | null) => void;
  
  // Search
  setSearchQuery: (query: string) => void;
  setShowProfileDialog: (open: boolean) => void;
  setAccentTheme: (theme: AccentTheme) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  // App Branding
  appName: 'PharmaCare Pro',
  appTagline: 'Premium Pharmacy Management System',
  
  // Auth
  currentUser: null,
  isAuthenticated: false,
  loginTime: 0,
  requiresPasswordSetup: false,
  activeBranch: null,
  
  // Navigation
  currentPage: 'login',
  sidebarOpen: true,
  
  // POS Cart
  cart: [],
  selectedCustomerId: null,
  posPresetDate: null,
  
  // UI State
  searchQuery: '',
  showProfileDialog: false,
  accentTheme: 'emerald' as AccentTheme,
  
  // Actions
  login: (user) => set({
    currentUser: user,
    isAuthenticated: true,
    loginTime: Date.now(),
    requiresPasswordSetup: Boolean(user.mustChangePassword),
    currentPage: user.role === 'admin' ? 'admin-dashboard' : 'sales-dashboard',
  }),

  setCurrentUser: (user) => set({
    currentUser: user,
  }),

  setRequiresPasswordSetup: (required) => set({ requiresPasswordSetup: required }),

  setActiveBranch: (branch) => set({ activeBranch: branch }),

  logout: async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
    } catch {
      // Ignore network errors during logout
    }
    set({
      currentUser: null,
      isAuthenticated: false,
      loginTime: 0,
      requiresPasswordSetup: false,
      activeBranch: null,

      currentPage: 'login',
      cart: [],
      selectedCustomerId: null,
      searchQuery: '',
      showProfileDialog: false,
    });
  },
  
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
  
  clearCart: () => set({ cart: [] }),
  setSelectedCustomer: (id) => set({ selectedCustomerId: id }),
  setPosPresetDate: (date) => set({ posPresetDate: date }),
  
  // Search
  setSearchQuery: (query) => set({ searchQuery: query }),
  setShowProfileDialog: (open) => set({ showProfileDialog: open }),
  setAccentTheme: (theme) => set({ accentTheme: theme }),
  setAppName: (name) => set({ appName: name }),
  setAppTagline: (tagline) => set({ appTagline: tagline }),
}),
    {
      name: 'pharmacare-auth',
      partialize: (state) => ({
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
        loginTime: state.loginTime,
        currentPage: state.currentPage,
        sidebarOpen: state.sidebarOpen,
        accentTheme: state.accentTheme,
        appName: state.appName,
        appTagline: state.appTagline,
        // activeBranch is deliberately NOT persisted: the signed session cookie
        // is the authority on which branch is selected, and a value restored
        // from localStorage could disagree with it.
      }),
    },
  ),
);
