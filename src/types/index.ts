// ===== Navigation Types =====
export type Page =
  | 'login'
  | 'admin-dashboard'
  | 'sales-dashboard'
  | 'pos'
  | 'products'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'purchases'
  | 'sales-history'
  | 'returns'
  | 'reports'
  | 'users'
  | 'audit-logs'
  | 'settings';

export type UserRole = 'admin' | 'sales';

// ===== Database Models =====
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  _count?: { products: number };
}

export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  address?: string;
  active: boolean;
  createdAt: string;
  _count?: { purchases: number };
}

export interface Product {
  id: string;
  name: string;
  genericName?: string;
  categoryId?: string;
  description?: string;
  unit: string;
  reorderLevel: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  category?: Category;
  _count?: { batches: number; saleItems: number };
}

export interface Batch {
  id: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  expiryDate: string;
  purchaseId?: string;
  createdAt: string;
  updatedAt: string;
  product?: Product;
}

export interface Purchase {
  id: string;
  invoiceNo: string;
  supplierId?: string;
  userId: string;
  totalAmount: number;
  notes?: string;
  createdAt: string;
  supplier?: Supplier;
  user?: User;
  batches?: Batch[];
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  active: boolean;
  createdAt: string;
  _count?: { sales: number };
}

export interface Sale {
  id: string;
  invoiceNo: string;
  customerId?: string;
  userId: string;
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  profit: number;
  paymentMethod: string;
  status: string;
  notes?: string;
  createdAt: string;
  customer?: Customer;
  user?: User;
  items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  batchId?: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  total: number;
  expiryDate?: string;
  product?: Product;
  batch?: Batch;
}

export interface Return {
  id: string;
  saleId: string;
  userId: string;
  reason: string;
  totalRefund: number;
  status: string;
  createdAt: string;
  sale?: Sale;
}

export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  ipAddress?: string;
  createdAt: string;
  user?: User;
}

// ===== Dashboard Stats =====
export interface DashboardStats {
  todaySales: number;
  weeklySales: number;
  monthlySales: number;
  totalRevenue: number;
  totalProfit: number;
  totalInventoryValue: number;
  productsInStock: number;
  lowStockCount: number;
  expiringCount: number;
  todayTransactions: number;
  productsSoldToday: number;
  stockReceivedToday: number;
}

// ===== Cart Item =====
export interface CartItem {
  productId: string;
  productName: string;
  batchId: string;
  batchNumber: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  availableQty: number;
  expiryDate: string;
}

// ===== Chart Data =====
export interface ChartDataPoint {
  name: string;
  value: number;
  value2?: number;
}
