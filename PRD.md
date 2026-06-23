# Product Requirements Document (PRD)
# PharmaCare Pro — Pharmacy Management System

**Version:** 1.0.0
**Date:** June 2026
**Status:** Production
**Platform:** Web Application (Desktop & Tablet)

---

## 1. Product Overview

### 1.1 Vision
PharmaCare Pro is a modern, comprehensive pharmacy management system designed for retail pharmacies in Ghana and West Africa. It digitizes the entire pharmacy workflow — from point-of-sale and inventory tracking to sales analytics and staff management — replacing manual processes with an efficient, reliable, and user-friendly digital solution.

### 1.2 Target Users
- **Pharmacy Owners / Administrators** — Manage the entire operation: products, inventory, staff, finances, and business settings.
- **Pharmacists / Sales Persons** — Process customer transactions at the point of sale, search products, and view their sales history.
- **Pharmacy Staff** — Manage inventory, handle returns, and generate reports.

### 1.3 Core Value Proposition
- Fast, intuitive point-of-sale that reduces transaction time
- Accurate inventory tracking at the batch level (critical for medicines with expiry dates)
- Real-time business intelligence through dashboards and reports
- Multi-user access with role-based security
- Offline-capable SQLite database (no internet required for core operations)
- Zero licensing cost — fully self-hosted

---

## 2. Functional Requirements

### 2.1 Authentication & Authorization

| ID | Requirement | Priority |
|---|---|---|
| AUTH-001 | Users must log in with email and password | Must |
| AUTH-002 | Two user roles: Administrator and Sales Person | Must |
| AUTH-003 | Session state persists in Zustand store; page reload requires re-login | Must |
| AUTH-004 | Admin users can access all modules; Sales users are restricted | Must |
| AUTH-005 | User can log out via header dropdown menu | Must |
| AUTH-006 | Failed login shows error toast notification | Must |

**Admin-only pages:** Dashboard (admin), Products, Inventory, Returns, Reports, Users, Audit Logs, Settings
**Shared pages:** POS, Sales History (filtered by user for sales role)

### 2.2 Dashboard

| ID | Requirement | Priority |
|---|---|---|
| DASH-001 | Display KPI cards: today's sales, weekly revenue, monthly revenue, total profit, inventory value, products in stock, low stock count, expiring count | Must |
| DASH-002 | Show revenue trend chart (7-day or 30-day view) | Must |
| DASH-003 | Display recent sales feed (latest 5 transactions) | Must |
| DASH-004 | Stock alerts section: low stock items and expiring products | Must |
| DASH-005 | Sales dashboard variant for Sales Person role showing personal metrics | Must |
| DASH-006 | Real-time data — no page refresh needed to see updated figures | Should |

### 2.3 Point of Sale (POS)

| ID | Requirement | Priority |
|---|---|---|
| POS-001 | Display product grid with name, category, price, and stock quantity | Must |
| POS-002 | Search products by name with debounced input (300ms) | Must |
| POS-003 | Category filter tabs (dynamically generated from product data) | Must |
| POS-004 | Click product card to add to cart with default quantity of 1 | Must |
| POS-005 | Cart shows item name, unit price, quantity controls (+/-), line total, and remove button | Must |
| POS-006 | Prevent adding more than available stock quantity | Must |
| POS-007 | Calculate subtotal, 12.5% VAT (configurable), discount (manual input), and total | Must |
| POS-008 | Support three payment methods: Cash, Card, Mobile Money | Must |
| POS-009 | On sale completion: create sale record, deduct stock from specific batch (FIFO by expiry), generate invoice number, show receipt | Must |
| POS-010 | Receipt shows: pharmacy name, address, phone, invoice number, date/time, items with prices, subtotal, tax, discount, total, payment method, cashier name | Must |
| POS-011 | Print receipt via browser print function | Must |
| POS-012 | Search existing customers and assign to sale | Must |
| POS-013 | Quick Walk-In customer registration from POS (name + optional phone) | Must |
| POS-014 | Optional notes field on each sale | Should |
| POS-015 | Stock impact modal before completing sale showing quantity changes per batch | Should |
| POS-016 | Toast notifications for add-to-cart, sale completion, and errors | Must |

### 2.4 Product Management

| ID | Requirement | Priority |
|---|---|---|
| PROD-001 | View all products in a data table with search and category filter | Must |
| PROD-002 | Create new product with: name, generic name, category, unit, description, reorder level, cost price, selling price | Must |
| PROD-003 | Edit existing product details | Must |
| PROD-004 | Deactivate (soft delete) products instead of hard delete if they have sale records | Must |
| PROD-005 | Add and manage batches per product: batch number, quantity, cost price, selling price, expiry date | Must |
| PROD-006 | Category management (CRUD) | Must |
| PROD-007 | Stock impact warning when editing a product's price that has active batches | Should |

### 2.5 Inventory Management

| ID | Requirement | Priority |
|---|---|---|
| INV-001 | View all batches across all products with stock levels and expiry dates | Must |
| INV-002 | Filter inventory by stock status: all, in stock, low stock, out of stock, expiring soon | Must |
| INV-003 | Adjust stock quantities with reason (received, damaged, expired, adjustment) | Must |
| INV-004 | All stock adjustments logged in audit trail | Must |
| INV-005 | Visual indicators for stock status (green = good, yellow = low, red = out/expired) | Must |

### 2.6 Sales History

| ID | Requirement | Priority |
|---|---|---|
| SALE-001 | View all sales in a data table with sortable columns | Must |
| SALE-002 | Filter by date range, payment method, and cashier | Must |
| SALE-003 | Sales persons see only their own sales; admins see all | Must |
| SALE-004 | Click sale row to view detailed receipt with line items | Must |
| SALE-005 | Display invoice number, customer name, total amount, payment method, time, and cashier | Must |

### 2.7 Returns

| ID | Requirement | Priority |
|---|---|---|
| RET-001 | Process product returns by selecting a sale and specifying return reason | Must |
| RET-002 | Automatically restore stock to the original batch | Must |
| RET-003 | Calculate and record refund amount | Must |
| RET-004 | Track return status (approved, pending, rejected) | Must |
| RET-005 | Admin-only access | Must |

### 2.8 Reports

| ID | Requirement | Priority |
|---|---|---|
| RPT-001 | Revenue report with daily/weekly/monthly breakdown | Must |
| RPT-002 | Top-selling products report | Must |
| RPT-003 | Sales by payment method breakdown | Must |
| RPT-004 | Profit analysis report | Should |
| RPT-005 | Date range filter for all reports | Must |
| RPT-006 | Admin-only access | Must |

### 2.9 User Management

| ID | Requirement | Priority |
|---|---|---|
| USR-001 | List all users with name, email, role, status, and last login | Must |
| USR-002 | Create new user (admin or sales role) | Must |
| USR-003 | Edit user details and toggle active/inactive status | Must |
| USR-004 | Prevent deletion of users who have sale records (soft delete instead) | Must |
| USR-005 | Admin-only access | Must |

### 2.10 Audit Logs

| ID | Requirement | Priority |
|---|---|---|
| AUD-001 | Automatically log all create, update, and delete operations | Must |
| AUD-002 | Record: user, action, entity type, entity ID, details, timestamp | Must |
| AUD-003 | View audit logs in a filterable, paginated table | Must |
| AUD-004 | Admin-only access | Must |

### 2.11 Settings

| ID | Requirement | Priority |
|---|---|---|
| SET-001 | Configure pharmacy business information: name, address, phone, email, license number | Must |
| SET-002 | App name updates reflect immediately across sidebar, login page, and document title | Must |
| SET-003 | Configure tax rate (default 12.5%) | Must |
| SET-004 | Set business hours and closed days | Should |
| SET-005 | Customize receipt footer message | Should |
| SET-006 | Theme color picker with 6 accent themes | Must |
| SET-007 | Theme persists across sessions | Must |
| SET-008 | Export sales data | Should |
| SET-009 | Clear all sales data with confirmation | Must |
| SET-010 | Settings persist to database with localStorage fallback | Must |

### 2.12 Daily Sales Records

| ID | Requirement | Priority |
|---|---|---|
| DSR-001 | Open daily sales register | Should |
| DSR-002 | Close daily sales register with summary (revenue, profit, transactions, items sold, payment method breakdown) | Should |
| DSR-003 | View historical daily records | Should |

---

## 3. Non-Functional Requirements

### 3.1 Performance
| ID | Requirement | Target |
|---|---|---|
| NFR-001 | Page load time | < 3 seconds on first visit |
| NFR-002 | POS product search | < 500ms response time |
| NFR-003 | Sale completion | < 2 seconds end-to-end |
| NFR-004 | Lazy loading | All feature views loaded on demand via React.lazy |

### 3.2 Security
| ID | Requirement |
|---|---|
| NFR-005 | Passwords stored with bcrypt hashing |
| NFR-006 | Role-based page access enforced client-side (admin-only pages) |
| NFR-007 | API routes validate user session before processing |
| NFR-008 | No sensitive data exposed in client-side code |

### 3.3 Usability
| ID | Requirement |
|---|---|
| NFR-009 | Responsive design — desktop and tablet optimized |
| NFR-010 | Sidebar collapses to icons on smaller screens |
| NFR-011 | All destructive actions require confirmation dialogs |
| NFR-012 | Toast notifications for all user actions (success, error, info) |
| NFR-013 | Keyboard accessible — all interactive elements focusable and operable |
| NFR-014 | Loading skeletons for async data |

### 3.4 Reliability
| ID | Requirement |
|---|---|
| NFR-015 | SQLite database — no external database server dependency |
| NFR-016 | Optimistic concurrency for stock operations |
| NFR-017 | Proper error handling on all API calls with user-friendly messages |

### 3.5 Maintainability
| ID | Requirement |
|---|---|
| NFR-018 | TypeScript strict mode throughout |
| NFR-019 | Single Zustand store for client state |
| NFR-020 | API-first architecture with clear route separation |
| NFR-021 | Shared types in central types/ directory |
| NFR-022 | Prisma ORM for type-safe database access |

---

## 4. Data Model

### 4.1 Entity Relationships

```
User (1) ──→ (N) Sale
User (1) ──→ (N) Purchase
User (1) ──→ (N) AuditLog

Category (1) ──→ (N) Product

Product (1) ──→ (N) Batch
Product (1) ──→ (N) SaleItem

Batch (1) ──→ (N) SaleItem
Batch (N) ──→ (1) Purchase

Customer (1) ──→ (N) Sale

Supplier (1) ──→ (N) Purchase

Sale (1) ──→ (N) SaleItem
Sale (1) ──→ (N) Return
```

### 4.2 Currency
All monetary values are stored as `Float` and displayed in **Ghanaian Cedi (GHS)** using `Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' })`.

### 4.3 Invoice Number Format
- Admin sales: `INV-YYYYMMDD-XXXX` (4-digit sequential counter per day)
- Sales person sales: `SL-YYYYMMDD-XXXX`

---

## 5. User Interface Design

### 5.1 Layout
- **Sidebar** (left, collapsible): Dark themed with accent color highlights, role-based navigation sections
- **Header** (top): Page name, search, live clock, notification bell, user dropdown
- **Main content** (center): Scrollable content area with page transitions via Framer Motion

### 5.2 Theme System
- 6 accent themes: Emerald (default), Blue, Violet, Rose, Amber, Teal
- CSS custom properties (`--accent-primary`, `--accent-primary-hover`, etc.)
- ThemeInitializer component syncs Zustand ↔ localStorage ↔ CSS variables
- Theme selection in Settings with color swatch previews

### 5.3 Design System
- shadcn/ui component library (48 components, New York variant)
- Lucide React icons
- Tailwind CSS 4 utility classes
- Consistent spacing: `p-4`/`p-6` for cards, `gap-4`/`gap-6` for layouts
- Max height with scroll overflow for long lists: `max-h-96 overflow-y-auto`

---

## 6. Technology Stack

| Component | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.x |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| UI Components | shadcn/ui | Latest |
| Database | SQLite | — |
| ORM | Prisma | 6.x |
| Client State | Zustand | Latest |
| Server State | TanStack Query | Latest |
| Animations | Framer Motion | Latest |
| Icons | Lucide React | Latest |
| Notifications | Sonner | Latest |
| Charts | Recharts | Latest |
| Forms | React Hook Form + Zod | Latest |
| Runtime | Bun | Latest |

---

## 7. Deployment

### 7.1 Development
```bash
bun install
bun run db:push
bun run dev
```

### 7.2 Production
```bash
bun run build
bun run start
```

The app uses Next.js standalone output for optimized production builds. SQLite database file is stored at `db/custom.db`.

---

## 8. Future Enhancements (Out of Scope for v1.0)

- Multi-branch / multi-store support
- SMS/WhatsApp notifications for low stock
- Customer loyalty program and purchase history
- Supplier order automation (auto-generate purchase orders below reorder level)
- Prescription management and drug interaction checking
- Mobile-responsive POS for phone screens
- Cloud database option (PostgreSQL/MySQL) for multi-device sync
- Barcode/QR code scanning for products
- Electronic receipt (email/SMS) delivery
- Backup and restore functionality
- Multi-language support (local languages)
- Advanced reporting with PDF/Excel export