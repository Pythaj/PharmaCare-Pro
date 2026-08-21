'use client';

import { useAppStore } from '@/stores/app-store';
import { useCallback } from 'react';

/**
 * Role-based permission hooks for the Pharmacy Management System.
 *
 * Permissions matrix:
 * ──────────────────────── Admin │ Sales
 * Products (CRUD)              ✅    ❌ (read-only)
 * Inventory management         ✅    ❌ (read-only)
 * Procurement / Purchases       ✅    ❌ (read-only)
 * Customers                     ✅    ✅ (full access for walk-ins)
 * POS / Sales                   ✅    ✅
 * Sales History                 ✅    ✅
 * Settings                      ✅    ❌
 */
export function usePermissions() {
  const currentUser = useAppStore((s) => s.currentUser);
  const isAdmin = currentUser?.role === 'admin';

  const canManageProducts = isAdmin;
  const canManageInventory = isAdmin;
  const canManagePurchases = isAdmin;
  const canManageCustomers = true; // Both roles can manage customers (walk-ins)
  const canManageSales = true;     // Both roles can process sales
  const canManageSettings = isAdmin;

  /** Check if a specific write permission is granted */
  const canWrite = useCallback(
    (resource: 'products' | 'inventory' | 'sales' | 'settings') => {
      switch (resource) {
        case 'products':
        case 'inventory':
        case 'settings':
          return isAdmin;
        case 'sales':
          return true;
        default:
          return false;
      }
    },
    [isAdmin]
  );

  return {
    isAdmin,
    canManageProducts,
    canManageInventory,
    canManagePurchases,
    canManageCustomers,
    canManageSales,
    canManageSettings,
    canWrite,
  };
}
