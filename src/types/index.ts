// ===== Navigation Types =====
export type Page =
  | 'login'
  | 'admin-dashboard'
  | 'sales-dashboard'
  | 'pos'
  | 'products'
  | 'inventory'
  | 'sales-history'
  | 'customers'
  | 'returns'
  | 'reports'
  | 'branch-performance'
  | 'users'
  | 'audit-logs'
  | 'branches'
  | 'transfers'
  | 'settings';

/** Pages restricted to admin role only */
export const ADMIN_ONLY_PAGES: Page[] = [
  'admin-dashboard', 'returns', 'reports',
  // Every branch side by side. Deliberately NOT reachable by switching the
  // active branch: the value of this page is the comparison, and a
  // branch-scoped version of it would answer a question nobody asked.
  'branch-performance',
  'users', 'audit-logs', 'settings', 'inventory',
  // Creating a branch is an owner-level decision: it decides where money is
  // attributed for the rest of the business's life.
  'branches',
  // Stock transfers move real inventory and cost between branches. Visible to
  // admins only because a cashier must not be able to hand another branch's
  // shelves to a competitor.
  'transfers',
];

/**
 * Deliberately NOT in `ADMIN_ONLY_PAGES`: the customer book is shared by both
 * roles.
 *
 * A `Customer` row has no `branchId` — one person who shops at two branches is
 * one customer, not two — and the API reflects that: GET and POST require only
 * `requireAuth`, because a cashier must be able to register a walk-in at the
 * till. Only PATCH and DELETE are `requireAdmin`, since rewriting or erasing
 * another branch's customer history is an owner's decision. `CustomersView`
 * mirrors that split exactly (the Add button is ungated; edit and delete are
 * admin-only).
 */

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
  /**
   * The threshold this branch actually compares stock against, which is the
   * branch's own override when one exists and the chain-wide `reorderLevel`
   * otherwise. `reorderLevel` above stays the chain-wide value because the edit
   * form round-trips it — answering that field with the effective value would let
   * saving a branch override publish it as a global change.
   */
  effectiveReorderLevel?: number;
  reorderLevelIsBranchOverride?: boolean;
  /** Default price for a batch received here without an explicit price. */
  effectiveSellingPrice?: number;
  effectiveCostPrice?: number;
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
  /** What the customer actually got back for this line. */
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
  /** 'all' for an admin, 'own' for a cashier - the money figures are scoped. */
  scope: 'all' | 'own';
  /** GROSS takings for each window: what the tills collected, before returns. */
  todaySales: number;
  weeklySales: number;
  monthlySales: number;
  /** GROSS across all time. See the `*NetSales` fields for what was kept. */
  totalRevenue: number;
  /** GROSS margin all-time, kept beside its net counterpart for the same reason. */
  totalProfit: number;
  grossProfit: number;
  /** Margin handed back on approved returns: qty x (unitPrice - costPrice). */
  refundedProfit: number;
  /** GROSS profit minus the margin given back. The figure to headline. */
  netProfit: number;
  /**
   * NET = gross minus approved refunds. These are the figures to headline; the
   * gross ones stay visible beside them because "we sold 400 and gave 50 back"
   * is a true and useful sentence, and a branch whose returns are climbing must
   * not be able to hide behind a gross total.
   */
  todayNetSales: number;
  weeklyNetSales: number;
  monthlyNetSales: number;
  netRevenue: number;
  /** Approved refunds in each window, and all time. */
  todayRefunds: number;
  weeklyRefunds: number;
  monthlyRefunds: number;
  totalRefunds: number;
  todayRefundCount: number;
  weeklyRefundCount: number;
  monthlyRefundCount: number;
  totalRefundCount: number;
  /** The branch these figures were computed for; null on "All branches". */
  branchId: string | null;
  branch: Branch | null;
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
  /** The one shop whose till this register is. There is no branchless register. */
  branchId?: string;
  /** Needed to label the day: a register card that does not say which branch it
   *  belongs to is unusable the moment the owner has more than one. */
  branch?: Branch;
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
