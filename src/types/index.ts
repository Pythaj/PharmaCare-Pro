// ===== Navigation Types =====
export type Page =
  | 'login'
  | 'admin-dashboard'
  | 'sales-dashboard'
  | 'pos'
  | 'products'
  | 'inventory'
  | 'sales-history'
  | 'returns'
  | 'reports'
  | 'users'
  | 'audit-logs'
  | 'branches'
  | 'transfers'
  | 'settings';

/** Pages restricted to admin role only */
export const ADMIN_ONLY_PAGES: Page[] = [
  'admin-dashboard', 'returns', 'reports',
  'users', 'audit-logs', 'settings', 'inventory',
  // Creating a branch is an owner-level decision: it decides where money is
  // attributed for the rest of the business's life.
  'branches',
  // Stock transfers move real inventory and cost between branches. Visible to
  // admins only because a cashier must not be able to hand another branch's
  // shelves to a competitor.
  'transfers',
];

export type UserRole = 'admin' | 'sales';

// ===== Database Models =====
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  active: boolean;
  mustChangePassword?: boolean;
  /**
   * Home branch. `null` means "every branch" and is only valid for an admin —
   * the owner. A salesperson always has one.
   */
  branchId?: string | null;
  /** Present when the API includes branch details. */
  branch?: Branch | null;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  name: string;
  /** Short code used in invoice numbers, e.g. "MAIN". */
  code: string;
  address?: string | null;
  phone?: string | null;
  active: boolean;
  createdAt?: string;
  staffCount?: number;
  batchCount?: number;
  saleCount?: number;
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
  defaultCostPrice: number;
  defaultSellingPrice: number;
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
  /** Shop the sale was rung up at. */
  branchId?: string;
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
  branch?: Branch;
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
  /** Units already claimed by approved/pending returns of this sale. */
  returnedQuantity?: number;
  /** Units still returnable: quantity - returnedQuantity. */
  returnableQuantity?: number;
  product?: Product;
  batch?: Batch;
}

export interface ReturnItem {
  id: string;
  returnId: string;
  saleItemId: string;
  quantity: number;
  /** What the customer actually got back for this line, after discount/tax. */
  refundAmount: number;
  saleItem?: {
    unitPrice: number;
    product?: { id: string; name: string };
  };
}

export interface Return {
  id: string;
  saleId: string;
  /** Null once the operator's account has been removed. */
  userId?: string | null;
  reason: string;
  totalRefund: number;
  status: string;
  createdAt: string;
  sale?: Sale;
  user?: User;
  items?: ReturnItem[];
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
  /** 'all' for an admin, 'own' for a cashier — the money figures are scoped. */
  scope: 'all' | 'own';
  todaySales: number;
  weeklySales: number;
  monthlySales: number;
  totalRevenue: number;
  totalProfit: number;
  totalInventoryValue: number;
  productsInStock: number;
  lowStockCount: number;
  /** Batches inside the warning window, expired ones excluded. */
  expiringCount: number;
  /** Batches already past their expiry date. */
  expiredCount: number;
  todayTransactions: number;
  productsSoldToday: number;
  stockReceivedToday: number;
}

// ===== Cart Item =====
export interface CartItem {
  productId: string;
  productName: string;
  // batchId === '' marks a backorder line: the drug is sold while out of
  // stock, so no batch is reserved/deducted.
  batchId: string;
  batchNumber: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  availableQty: number;
  expiryDate: string;
  isBackorder?: boolean;
}

// ===== Daily Sales Record =====
export interface DailySalesRecord {
  id: string;
  date: string;
  status: 'open' | 'closed';
  openedBy?: string;
  closedBy?: string;
  openedAt: string;
  closedAt?: string;
  totalRevenue: number;
  totalProfit: number;
  totalDiscount: number;
  totalTransactions: number;
  totalItemsSold: number;
  cashTotal: number;
  cardTotal: number;
  mobileMoneyTotal: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  opener?: User;
  closer?: User;
}

export interface DailySalesDetail extends DailySalesRecord {
  sales: Sale[];
}

// ===== Stock Transfers =====

/**
 * A transfer is a request to move goods from one branch's shelf to another's.
 * It is deliberately NOT a relocation: the source batch is debited and a
 * separate destination batch is credited, so every sale that already referenced
 * the source batch keeps pointing at the branch that actually held it.
 */
export type TransferStatus = 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled';

export interface StockTransferLine {
  id: string;
  productId: string;
  sourceBatchId: string;
  /** Null until completion — the receiving batch is created as goods arrive. */
  destBatchId?: string | null;
  quantity: number;
  /** Cost is snapshotted at raise time so later price edits cannot restate it. */
  unitCost: number;
  product: { id: string; name: string; unit: string };
  sourceBatch: { id: string; batchNumber: string; expiryDate?: string | null };
  destBatch?: { id: string; batchNumber: string; quantity: number } | null;
}

export interface StockTransfer {
  id: string;
  reference: string;
  fromBranchId: string;
  toBranchId: string;
  status: TransferStatus;
  notes?: string | null;
  createdById?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  fromBranch: { id: string; name: string; code: string };
  toBranch: { id: string; name: string; code: string };
  createdBy?: { id: string; name: string } | null;
  approvedBy?: { id: string; name: string } | null;
  lines: StockTransferLine[];
}

// ===== Chart Data =====
export interface ChartDataPoint {
  name: string;
  value: number;
  value2?: number;
}
