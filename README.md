# PharmaCare Pro — Pharmacy Management System

A comprehensive, production-ready pharmacy management system built with modern web technologies. Designed for retail pharmacies in Ghana and across West Africa, it handles point-of-sale operations, inventory management, sales tracking, reporting, and multi-user administration.

---

## Features

### Point of Sale (POS)
- Real-time product search with category filtering
- Cart management with quantity controls and per-item batch tracking
- Multiple payment methods: Cash, Card, Mobile Money (MoMo)
- Automatic tax calculation (12.5% VAT) and manual discounts
- Quick Walk-In customer registration directly from the POS
- Professional receipt generation with print support
- Automatic stock deduction on sale completion with batch-level tracking (FIFO by expiry)

### Inventory Management
- Full product catalog with categories, generic names, and units
- Multi-batch inventory tracking per product (batch number, cost price, selling price, expiry date)
- Automatic low-stock and expiry alerts on the dashboard
- Batch-level stock adjustments with audit logging
- Reorder level configuration per product

### Sales & Returns
- Complete sales history with filtering by date, payment method, and cashier
- Detailed sale view with line items, customer info, and profit tracking
- Return processing with reason tracking and automatic stock restoration
- Profit calculation per sale (selling price minus cost price)

### Dashboard & Analytics
- Real-time KPI cards: today's sales, weekly/monthly revenue, total profit, stock value
- Revenue trend charts (daily, weekly, monthly)
- Top-selling products and category breakdowns
- Recent sales feed with quick-view details
- Stock alerts (low stock, expiring soon, out of stock)
- Sales role gets a focused dashboard with personal performance metrics

### User Management & Security
- Role-based access control: **Administrator** and **Sales Person**
- Admin-only pages: Inventory, Returns, Reports, Users, Audit Logs, Settings
- Sales pages: POS, Products (view), Sales History (own sales)
- Full audit log tracking all significant actions (create, update, delete)
- Session-based authentication with secure password handling

### Settings & Customization
- Pharmacy business information (name, address, phone, email, license number)
- Tax rate configuration (default 12.5% VAT)
- Business hours and closed days management
- Receipt customization (footer message)
- Theme color picker with 6 accent themes (Emerald, Blue, Violet, Rose, Amber, Teal)
- Theme persists across sessions via localStorage
- Data management: export sales data and clear all sales (with confirmation)

### Multi-Theme Design
- 6 professionally designed accent color themes
- Consistent emerald-green default theme throughout
- CSS custom properties for seamless theme switching
- Dark sidebar with accent color highlights

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 |
| UI Library | shadcn/ui (48 components, New York style) |
| Icons | Lucide React |
| Database | SQLite via Prisma ORM 6 |
| Client State | Zustand |
| Server State | TanStack Query |
| Animations | Framer Motion |
| Forms | React Hook Form + Zod |
| Notifications | Sonner (toast) |
| Charts | Recharts |
| Drag & Drop | dnd-kit |

---

## Project Structure

```
src/
├── app/
│   ├── api/                    # API route handlers
│   │   ├── auth/               # Authentication (login)
│   │   ├── batches/            # Batch CRUD
│   │   ├── categories/         # Category CRUD
│   │   ├── customers/          # Customer CRUD
│   │   ├── daily-sales/        # Daily sales records
│   │   ├── dashboard/          # Dashboard stats & charts
│   │   ├── inventory/          # Stock adjustments
│   │   ├── products/           # Product CRUD + search
│   │   ├── purchases/          # Purchase orders
│   │   ├── reports/            # Report data
│   │   ├── returns/            # Return processing
│   │   ├── sales/              # Sale CRUD + history
│   │   ├── settings/           # System settings
│   │   ├── suppliers/          # Supplier CRUD
│   │   └── users/              # User management
│   ├── globals.css             # Global styles + theme variables
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # SPA entry (routing via Zustand)
├── components/
│   ├── admin/                  # Admin feature views
│   │   ├── AdminDashboard.tsx  # Admin dashboard with KPIs
│   │   ├── ReturnsView.tsx     # Returns management
│   │   ├── ReportsView.tsx     # Analytics & reports
│   │   ├── SettingsView.tsx    # System settings
│   │   ├── UsersView.tsx       # User management
│   │   └── AuditLogsView.tsx   # Audit log viewer
│   ├── auth/
│   │   └── LoginPage.tsx       # Login page with demo credentials
│   ├── customers/
│   │   └── CustomersView.tsx   # Customer management
│   ├── dashboard/
│   │   └── SalesDashboard.tsx  # Sales-person dashboard
│   ├── inventory/
│   │   ├── InventoryView.tsx   # Stock management
│   │   └── ProductsView.tsx    # Product catalog CRUD
│   ├── layout/
│   │   ├── Sidebar.tsx         # Collapsible sidebar navigation
│   │   └── Header.tsx          # Top header with search, clock, user menu
│   ├── pos/
│   │   └── POSView.tsx         # Point of sale interface
│   ├── purchases/
│   │   └── PurchasesView.tsx   # Purchase order management
│   ├── reports/
│   │   └── ReportsView.tsx     # Report generation
│   ├── sales-history/
│   │   └── SalesHistoryView.tsx # Sales history with filters
│   ├── suppliers/
│   │   └── SuppliersView.tsx   # Supplier management
│   ├── pages/                  # Lazy-load wrappers (re-exports)
│   ├── ui/                     # shadcn/ui components (48 files)
│   └── ThemeInitializer.tsx    # Theme sync (localStorage → CSS vars)
├── hooks/
│   └── use-accent-theme.ts     # Theme hook with swatches
├── lib/
│   ├── db.ts                   # Prisma client singleton
│   └── utils.ts                # Utility functions (cn, etc.)
├── stores/
│   └── app-store.ts            # Zustand store (auth, nav, cart, theme)
└── types/
    └── index.ts                # TypeScript interfaces & types
```

---

## Database Schema

12 models powered by Prisma ORM on SQLite:

| Model | Description |
|---|---|
| `User` | Staff accounts with roles (admin/sales) |
| `Category` | Product categories (e.g., Antibiotics, Pain Relief) |
| `Supplier` | Medicine suppliers |
| `Product` | Product catalog with pricing and reorder levels |
| `Batch` | Per-product batch tracking (number, cost, selling price, expiry) |
| `Purchase` | Purchase orders from suppliers |
| `Customer` | Customer records |
| `Sale` | Completed sales with invoice numbers |
| `SaleItem` | Individual line items within a sale |
| `Return` | Product return records with refund amounts |
| `AuditLog` | Action audit trail |
| `DailySalesRecord` | Daily register open/close tracking |
| `SystemSetting` | Key-value system configuration |

---

## Getting Started

### Prerequisites
- Node.js 18+ or Bun
- npm, yarn, or bun

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd pharmacy-management

# Install dependencies
bun install

# Set up the database
bun run db:push

# Start development server
bun run dev
```

The app will be available at `http://localhost:3000`.

### Demo Credentials

| Role | Email | Password |
|---|---|---|
| Administrator | admin@pharmacy.com | admin123 |
| Sales Person | cashier@pharmacy.com | sales123 |

---

## Available Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start development server (port 3000) |
| `bun run build` | Production build with standalone output |
| `bun run start` | Run production build |
| `bun run lint` | Run ESLint |
| `bun run db:push` | Push schema changes to database |
| `bun run db:generate` | Regenerate Prisma client |
| `bun run db:migrate` | Run database migrations |
| `bun run db:reset` | Reset database (destructive) |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth` | User authentication |
| GET | `/api/dashboard/stats` | Dashboard KPI statistics |
| GET | `/api/dashboard/charts` | Revenue trend chart data |
| GET | `/api/dashboard/recent` | Recent sales feed |
| GET/POST | `/api/products` | List/create products |
| GET/PUT/DELETE | `/api/products/[id]` | Product CRUD |
| GET/POST | `/api/batches` | List/create batches |
| GET/PUT/DELETE | `/api/batches/[id]` | Batch CRUD |
| GET/POST | `/api/categories` | List/create categories |
| GET/PUT/DELETE | `/api/categories/[id]` | Category CRUD |
| GET/POST | `/api/sales` | List/create sales |
| GET/PUT/DELETE | `/api/sales/[id]` | Sale details |
| GET/POST | `/api/returns` | List/create returns |
| GET/POST | `/api/customers` | List/create customers |
| GET/PUT/DELETE | `/api/customers/[id]` | Customer CRUD |
| GET/POST | `/api/suppliers` | List/create suppliers |
| GET/PUT/DELETE | `/api/suppliers/[id]` | Supplier CRUD |
| GET/POST | `/api/purchases` | List/create purchases |
| GET/PUT/DELETE | `/api/purchases/[id] | Purchase CRUD |
| GET/POST | `/api/users` | List/create users |
| GET/PUT/DELETE | `/api/users/[id]` | User CRUD |
| GET | `/api/audit-logs` | Audit log history |
| GET/PUT | `/api/settings` | System settings |
| GET | `/api/reports` | Report data |
| GET/POST | `/api/inventory` | Stock adjustments |
| GET/POST | `/api/daily-sales` | Daily sales records |

---

## User Roles

### Administrator
- Full access to all modules
- Dashboard with company-wide KPIs
- Product and inventory management
- User account management
- Sales history (all users)
- Returns processing
- Reports and analytics
- Audit log access
- System settings configuration

### Sales Person
- Focused dashboard with personal metrics
- POS for processing sales
- Product catalog (view only)
- Sales history (own sales only)
- Customer search and Walk-In registration

---

## Currency

The system uses **Ghanaian Cedi (GHS)** as its default currency, formatted using `Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' })`.

---

## License

Private — All rights reserved.#   D e p l o y   t r i g g e r   2 0 2 6 - 0 8 - 2 1   2 2 : 2 9 : 1 1  
    
    
 