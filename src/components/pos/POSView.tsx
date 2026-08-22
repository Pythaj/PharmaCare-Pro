'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CreditCard,
  Smartphone,
  Banknote,
  X,
  Printer,
  CheckCircle,
  Package,
  AlertTriangle,
  TrendingDown,
  ArrowDownCircle,
  PackageX,
  BarChart3,
  Clock,
  ArrowUp,
  ArrowDown,
  CircleDot,
  RefreshCw,
  Layers,
  Droplet,
  Sparkles,
  Syringe,
  Pill,
  UserRoundPlus,
  UserRound,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useSpring } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';
import { usePharmacySettings } from '@/hooks/use-pharmacy-settings';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import type { Product, Batch, Customer, CartItem } from '@/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface ProductWithStock extends Product {
  batches: (Batch & { currentQty: number })[];
  totalStock: number;
  minSellingPrice: number;
  reorderLevel: number;
}

interface StockChange {
  id: string;
  productId: string;
  productName: string;
  oldStock: number;
  newStock: number;
  timestamp: number;
  type: 'sale' | 'restock';
}

interface StockImpactItem {
  productName: string;
  productId: string;
  oldStock: number;
  newStock: number;
  quantitySold: number;
  reorderLevel: number;
  hitZero: boolean;
  hitLow: boolean;
}

// ─────────────────────────────────────────────────────────────
// CountingNumber – animated digital counter / slot-machine number
// ─────────────────────────────────────────────────────────────
function CountingNumber({
  value,
  direction,
  className = '',
  size = 'sm',
}: {
  value: number;
  direction?: 'up' | 'down' | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const motionVal = useMotionValue(value);
  const display = useTransform(motionVal, (v) => Math.round(v));
  const springVal = useSpring(display, { stiffness: 300, damping: 30 });
  const rounded = useTransform(springVal, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(motionVal, value, {
      duration: 0.6,
      ease: 'easeOut',
    });
    return () => controls.stop();
  }, [value, motionVal]);

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
    xl: 'text-4xl',
  };

  const colorClass = direction === 'up'
    ? 'text-emerald-500'
    : direction === 'down'
    ? 'text-red-500'
    : 'text-inherit';

  return (
    <motion.span
      className={`font-bold tabular-nums font-mono tracking-tighter ${sizeClasses[size]} ${colorClass} ${className}`}
      key={`${value}-${direction}`}
      initial={direction ? { scale: 1.35 } : false}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
    >
      <motion.span>{rounded}</motion.span>
    </motion.span>
  );
}

// ─────────────────────────────────────────────────────────────
// StockGauge – circular SVG ring gauge
// ─────────────────────────────────────────────────────────────
function StockGauge({
  stock,
  reorderLevel,
  size = 40,
  strokeWidth = 3,
}: {
  stock: number;
  reorderLevel: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const maxDisplay = Math.max(reorderLevel * 3, 20);
  const pct = stock === 0 ? 0 : Math.min((stock / maxDisplay) * 100, 100);
  const isCritical = stock > 0 && stock <= Math.ceil(reorderLevel * 0.3);
  const isLow = stock > 0 && stock <= reorderLevel;
  const isOut = stock === 0;

  const color = isOut ? '#ef4444' : isCritical ? '#ef4444' : isLow ? '#f59e0b' : '#10b981';
  const bgColor = isOut ? '#fecaca' : isCritical ? '#fecaca' : isLow ? '#fef3c7' : '#d1fae5';

  const animatedOffset = useMotionValue(circumference);
  useEffect(() => {
    animate(animatedOffset, circumference - (pct / 100) * circumference, {
      duration: 0.8,
      ease: 'easeOut',
    });
  }, [pct, circumference, animatedOffset]);

  const strokeDashoffset = useTransform(animatedOffset, (v) => v);

  if (isOut) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bgColor} strokeWidth={strokeWidth} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <X className="text-red-500" style={{ width: size * 0.32, height: size * 0.32 }} strokeWidth={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bgColor} strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset }}
        />
        {isCritical && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth + 1}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ opacity: 0.8 }}
            animate={{ opacity: [0.8, 0, 0.8] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
            style={{ strokeDashoffset: circumference - (pct / 100) * circumference }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-bold tabular-nums font-mono"
          style={{
            fontSize: size * 0.3,
            color: color,
          }}
        >
          {stock}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// StockMovementTicker – animated stock change ticker bar
// ─────────────────────────────────────────────────────────────
function StockMovementTicker({ changes }: { changes: StockChange[] }) {
  if (changes.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-lg bg-slate-50 border border-slate-100 mb-3">
      <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-slate-50 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-slate-50 to-transparent z-10 pointer-events-none" />
      <div className="flex items-center gap-2 px-3 py-1.5 overflow-hidden">
        <div className="flex items-center gap-1 shrink-0">
          <CircleDot className="h-3 w-3 text-emerald-500" />
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Live Stock</span>
        </div>
        <div className="h-3 w-px bg-slate-200 shrink-0" />
        <div className="flex gap-4 overflow-hidden">
          <AnimatePresence mode="popLayout">
            {changes.slice(0, 4).map((change) => (
              <motion.div
                key={change.id}
                initial={{ opacity: 0, x: 60, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -40, scale: 0.8 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="flex items-center gap-1.5 whitespace-nowrap"
              >
                <span className="text-[11px] font-medium text-slate-600 truncate max-w-[120px]">
                  {change.productName}
                </span>
                {change.type === 'restock' ? (
                  <>
                    <ArrowUp className="h-3 w-3 text-emerald-500" />
                    <span className="text-[11px] font-bold text-emerald-600 tabular-nums">
                      +{change.newStock - change.oldStock}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      → {change.newStock}
                    </span>
                    <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-semibold text-emerald-600 border-emerald-200 bg-emerald-50">
                      Restocked
                    </Badge>
                  </>
                ) : (
                  <>
                    <ArrowDown className="h-3 w-3 text-red-500" />
                    <span className="text-[11px] font-bold text-red-500 tabular-nums">
                      -{change.oldStock - change.newStock}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      → {change.newStock}
                    </span>
                  </>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stock Impact Modal – premium stock update display after sale
// ─────────────────────────────────────────────────────────────
function StockImpactModal({
  items,
  onContinue,
}: {
  items: StockImpactItem[];
  onContinue: () => void;
}) {
  const [visibleItems, setVisibleItems] = useState<number>(0);

  useEffect(() => {
    if (visibleItems < items.length) {
      const timer = setTimeout(() => setVisibleItems((v) => v + 1), 200);
      return () => clearTimeout(timer);
    }
  }, [visibleItems, items.length]);

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">Stock Impact Report</DialogTitle>
        <DialogDescription className="sr-only">Inventory has been updated for this sale</DialogDescription>
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <motion.div
              className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center"
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <Package className="h-5 w-5 text-emerald-400" />
            </motion.div>
            <div>
              <h2 className="font-bold text-lg">Stock Impact Report</h2>
              <p className="text-xs text-slate-400">Inventory has been updated for this sale</p>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="px-4 py-4 max-h-[60vh] overflow-y-auto space-y-3">
          {items.map((item, idx) => {
            const maxBar = Math.max(item.oldStock, item.reorderLevel * 3, 10);
            const oldPct = (item.oldStock / maxBar) * 100;
            const newPct = (item.newStock / maxBar) * 100;
            const barColor = item.hitZero ? '#ef4444' : item.hitLow ? '#f59e0b' : '#10b981';

            return (
              <motion.div
                key={item.productId}
                initial={{ opacity: 0, y: 20 }}
                animate={visibleItems > idx ? { opacity: 1, y: 0 } : {}}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className={`relative rounded-xl border-2 p-4 overflow-hidden ${
                  item.hitZero
                    ? 'border-red-200 bg-red-50/50'
                    : item.hitLow
                    ? 'border-amber-200 bg-amber-50/30'
                    : 'border-slate-100 bg-white'
                }`}
              >
                {/* OUT OF STOCK stamp */}
                <AnimatePresence>
                  {item.hitZero && visibleItems > idx && (
                    <motion.div
                      initial={{ rotate: -15, scale: 0, opacity: 0 }}
                      animate={{ rotate: -15, scale: 1, opacity: 1 }}
                      transition={{ delay: 0.4, type: 'spring', stiffness: 400, damping: 15 }}
                      className="absolute top-3 right-3 pointer-events-none"
                    >
                      <div className="border-3 border-red-400 text-red-500 px-3 py-1 rounded-md font-black text-xs uppercase tracking-widest bg-red-50/80"
                        style={{ borderWidth: '3px' }}>
                        OUT OF STOCK
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* LOW STOCK alert */}
                <AnimatePresence>
                  {item.hitLow && !item.hitZero && visibleItems > idx && (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 }}
                      className="absolute top-3 right-3"
                    >
                      <motion.div
                        animate={{ opacity: [1, 0.5, 1] }}
                        transition={{ repeat: Infinity, duration: 1.2 }}
                        className="flex items-center gap-1 text-amber-600 text-[10px] font-bold bg-amber-100 px-2 py-0.5 rounded-full"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        LOW STOCK ALERT
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="pr-28">
                  <p className="font-semibold text-sm text-slate-800 mb-1">{item.productName}</p>
                  <p className="text-xs text-slate-400 mb-3">Sold: {item.quantitySold} unit{item.quantitySold > 1 ? 's' : ''}</p>

                  {/* Animated counter row */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 mb-0.5">Before</p>
                      <span className="text-lg font-bold text-slate-400 tabular-nums font-mono line-through">
                        {item.oldStock}
                      </span>
                    </div>
                    <motion.div
                      initial={{ x: 0 }}
                      animate={{ x: [0, 6, 0] }}
                      transition={{ delay: 0.3, duration: 0.4 }}
                    >
                      <ArrowDown className="h-4 w-4 text-red-400" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 mb-0.5">After</p>
                      <CountingNumber
                        value={item.newStock}
                        direction="down"
                        size="lg"
                        className={
                          item.hitZero
                            ? 'text-red-500'
                            : item.hitLow
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }
                      />
                    </div>
                  </div>

                  {/* Shrinking progress bar */}
                  <div className="relative">
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        initial={{ width: `${oldPct}%`, backgroundColor: '#10b981' }}
                        animate={{
                          width: `${newPct}%`,
                          backgroundColor: barColor,
                        }}
                        transition={{ duration: 0.8, ease: 'easeInOut', delay: 0.2 }}
                      />
                    </div>
                    <div className="absolute -top-0.5 left-0 h-3 w-0.5 bg-slate-300" style={{ left: `${(item.reorderLevel / maxBar) * 100}%` }} />
                  </div>
                  {item.reorderLevel > 0 && (
                    <p className="text-[10px] text-slate-400 mt-1">Reorder level: {item.reorderLevel}</p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 bg-slate-50/50">
          <Button
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            onClick={onContinue}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Continue to Receipt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// PillLogo SVG
// ─────────────────────────────────────────────────────────────
function PillLogo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// ProductIllustration – dynamic graphical icon for products
// ─────────────────────────────────────────────────────────────
function ProductIllustration({ category, name }: { category?: string; name: string }) {
  const cat = (category || '').toLowerCase();
  const title = name.toLowerCase();

  if (cat.includes('tablet') || cat.includes('capsule') || cat.includes('pill') || title.includes('tablet') || title.includes('capsule')) {
    return (
      <svg className="w-9 h-9 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <defs>
          <linearGradient id="pillGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#a7f3d0" />
          </linearGradient>
        </defs>
        <rect x="5" y="9" width="14" height="6" rx="3" transform="rotate(-45 12 12)" fill="url(#pillGrad)" stroke="#10b981" strokeWidth="1.5" />
        <line x1="8.5" y1="15.5" x2="15.5" y2="8.5" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="1.5" />
      </svg>
    );
  }

  if (cat.includes('syrup') || cat.includes('liquid') || cat.includes('suspension') || cat.includes('drop') || title.includes('syrup') || title.includes('liquid') || title.includes('drop')) {
    return (
      <svg className="w-9 h-9 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 3h6v2H9z" fill="#bfdbfe" stroke="#3b82f6" strokeWidth="1.5" />
        <rect x="7" y="6" width="10" height="15" rx="2.5" fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5" />
        <path d="M7 14h10v5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-5z" fill="#3b82f6" fillOpacity="0.35" stroke="none" />
        <path d="M12 9v6M10 12h4" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (cat.includes('injection') || cat.includes('vial') || cat.includes('ampoule') || title.includes('injection') || title.includes('vial')) {
    return (
      <svg className="w-9 h-9 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="2" x2="12" y2="5" stroke="#6366f1" strokeWidth="1.5" />
        <rect x="10" y="5" width="4" height="13" rx="0.5" fill="#e0e7ff" stroke="#4f46e5" strokeWidth="1.5" />
        <rect x="11.5" y="18" width="1" height="3" fill="#4f46e5" />
        <line x1="9" y1="21" x2="15" y2="21" stroke="#4f46e5" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="11" y1="8" x2="13" y2="8" stroke="#4f46e5" strokeWidth="1" />
        <line x1="11" y1="11" x2="13" y2="11" stroke="#4f46e5" strokeWidth="1" />
        <line x1="11" y1="14" x2="13" y2="14" stroke="#4f46e5" strokeWidth="1" />
      </svg>
    );
  }

  if (cat.includes('cream') || cat.includes('ointment') || cat.includes('gel') || title.includes('cream') || title.includes('ointment') || title.includes('gel')) {
    return (
      <svg className="w-9 h-9 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 20h8l-1.5-12h-5L8 20z" fill="#f3e8ff" stroke="#9333ea" strokeWidth="1.5" />
        <rect x="10" y="4" width="4" height="4" rx="1" fill="#c084fc" stroke="#9333ea" strokeWidth="1.5" />
        <path d="M12 11v5M10 13.5h4" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (cat.includes('spray') || cat.includes('inhaler') || title.includes('spray') || title.includes('inhaler')) {
    return (
      <svg className="w-9 h-9 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M7 6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v9a1 1 0 0 0 1 1h2v3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6z" fill="#ffe4e6" stroke="#e11d48" strokeWidth="1.5" />
        <rect x="9" y="3" width="4" height="7" rx="1" fill="#fecdd3" stroke="#e11d48" strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <svg className="w-9 h-9 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="18" height="14" rx="3" fill="#ecfdf5" stroke="#059669" strokeWidth="1.5" />
      <path d="M12 9v6M10 12h4" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// getCategoryIcon – map categories to beautiful Lucide icons
// ─────────────────────────────────────────────────────────────
function getCategoryIcon(catName: string) {
  const name = catName.toLowerCase();
  if (name === 'all') return Layers;
  if (name.includes('tablet') || name.includes('capsule') || name.includes('pill')) return Pill;
  if (name.includes('syrup') || name.includes('liquid') || name.includes('suspension') || name.includes('drop')) return Droplet;
  if (name.includes('injection') || name.includes('vial') || name.includes('ampoule') || name.includes('iv')) return Syringe;
  if (name.includes('cream') || name.includes('ointment') || name.includes('gel') || name.includes('tube')) return Sparkles;
  return Package;
}

// ─────────────────────────────────────────────────────────────
// Main POSView Component
// ─────────────────────────────────────────────────────────────
export default function POSView() {
  const { cart, addToCart, removeFromCart, updateCartQuantity, clearCart, currentUser, selectedCustomerId, setSelectedCustomer } = useAppStore();
  // Configurable VAT rate + receipt branding come from system settings
  const { settings } = usePharmacySettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile_money'>('cash');
  const [showReceipt, setShowReceipt] = useState(false);
  const [completedSale, setCompletedSale] = useState<{
    invoiceNo: string;
    customerName?: string;
    items: { productName: string; quantity: number; unitPrice: number; total: number; productId: string }[];
    subtotal: number;
    tax: number;
    discount: number;
    totalAmount: number;
    paymentMethod: string;
    createdAt: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stockChanges, setStockChanges] = useState<StockChange[]>([]);
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const prevProductsRef = useRef<Map<string, number>>(new Map());
  const prevProductsNameRef = useRef<Map<string, string>>(new Map());

  // Restock glow tracking
  const [restockedIds, setRestockedIds] = useState<Set<string>>(new Set());

  // Stock Impact Modal
  const [stockImpactItems, setStockImpactItems] = useState<StockImpactItem[]>([]);
  const [showStockImpact, setShowStockImpact] = useState(false);
  const [pendingSaleData, setPendingSaleData] = useState<{
    invoiceNo: string;
    customerName?: string;
    items: { productName: string; quantity: number; unitPrice: number; total: number; productId: string }[];
    subtotal: number;
    tax: number;
    discount: number;
    totalAmount: number;
    paymentMethod: string;
    createdAt: string;
  } | null>(null);

  // Auto-refresh interval ref
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Customer selection (restored Walk-In flow) ──
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showWalkInDialog, setShowWalkInDialog] = useState(false);
  const [walkInName, setWalkInName] = useState('Walk-In Customer');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [addingWalkIn, setAddingWalkIn] = useState(false);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers');
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers ?? []);
      }
    } catch { /* silent — customer attach is optional in POS */ }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Quick Walk-In: register a minimal customer and attach to the current sale
  const handleAddWalkIn = async () => {
    if (!walkInName.trim()) {
      toast.error('Please enter a customer name');
      return;
    }
    setAddingWalkIn(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: walkInName.trim(), phone: walkInPhone.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add customer');
      }
      const newCustomer: Customer = await res.json();
      setCustomers((prev) => [...prev, newCustomer]);
      setSelectedCustomer(newCustomer.id);
      setShowWalkInDialog(false);
      setWalkInName('Walk-In Customer');
      setWalkInPhone('');
      toast.success(`${newCustomer.name} added & selected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add customer');
    } finally {
      setAddingWalkIn(false);
    }
  };

  const fetchProducts = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const newProducts: ProductWithStock[] = data.products ?? [];

        // Detect stock changes (for animation)
        const newStockMap = new Map(newProducts.map(p => [p.id, p.totalStock]));
        const changes: StockChange[] = [];
        prevProductsRef.current.forEach((oldStock, pid) => {
          const newStock = newStockMap.get(pid);
          if (newStock !== undefined && oldStock !== newStock) {
            const name = prevProductsNameRef.current.get(pid) || 'Unknown';
            const diff = newStock - oldStock;
            changes.push({
              id: `${pid}-${Date.now()}`,
              productId: pid,
              productName: name,
              oldStock,
              newStock,
              timestamp: Date.now(),
              type: diff > 0 ? 'restock' : 'sale',
            });

            // Track restocked products for green glow
            if (diff > 0) {
              setRestockedIds(prev => {
                const next = new Set(prev);
                next.add(pid);
                setTimeout(() => {
                  setRestockedIds(p => { const n = new Set(p); n.delete(pid); return n; });
                }, 2000);
                return next;
              });
            }
          }
        });
        if (changes.length > 0) {
          setStockChanges(prev => [...prev, ...changes].slice(-20));
          // Auto-clear changes after 5 seconds
          setTimeout(() => {
            setStockChanges(prev => prev.filter(c => Date.now() - c.timestamp < 5000));
          }, 5000);
        }

        prevProductsRef.current = newStockMap;
        const nameMap = new Map(newProducts.map(p => [p.id, p.name]));
        prevProductsNameRef.current = nameMap;
        setProducts(newProducts);
        const cats = [...new Set(newProducts.map((p: Product) => p.category?.name).filter(Boolean))] as string[];
        setCategories(['All', ...cats]);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    async function init() {
      await fetchProducts('');
      setLoading(false);
    }
    init();

    // 30-second auto-refresh
    refreshIntervalRef.current = setInterval(() => {
      fetchProducts(searchQuery);
    }, 30000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchProducts]); // intentionally not including searchQuery to avoid re-creating interval

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchProducts(value);
    }, 300);
  };

  const handleAddToCart = (product: ProductWithStock) => {
    if (product.totalStock === 0) {
      toast.error(`${product.name} is out of stock!`, { icon: <PackageX className="h-4 w-4 text-red-500" /> });
      return;
    }

    const bestBatch = product.batches
      .filter(b => b.quantity > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];
    if (!bestBatch) {
      toast.error('No available stock for this product');
      return;
    }

    // Check if already in cart - if so, check combined quantity
    const existingItem = cart.find(i => i.productId === product.id && i.batchId === bestBatch.id);
    const currentInCart = existingItem?.quantity ?? 0;
    if (currentInCart + 1 > bestBatch.currentQty) {
      toast.warning(`Only ${bestBatch.currentQty} units available in this batch`, {
        icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
      });
      return;
    }

    addToCart({
      productId: product.id,
      productName: product.name,
      batchId: bestBatch.id,
      batchNumber: bestBatch.batchNumber,
      quantity: 1,
      unitPrice: bestBatch.sellingPrice,
      costPrice: bestBatch.costPrice,
      availableQty: bestBatch.currentQty,
      expiryDate: bestBatch.expiryDate,
    });

    // Trigger add-to-cart animation
    setAddedToCart(prev => {
      const next = new Set(prev);
      next.add(product.id);
      setTimeout(() => { setAddedToCart(p => { const n = new Set(p); n.delete(product.id); return n; }); }, 800);
      return next;
    });

    const remaining = product.totalStock - currentInCart - 1;
    if (remaining === 0) {
      toast.warning(`${product.name} is now the last unit!`, { icon: <AlertTriangle className="h-4 w-4 text-amber-500" /> });
    } else if (remaining <= (product.reorderLevel || 10)) {
      toast.info(`${product.name}: ${remaining} remaining after this`, { icon: <Package className="h-4 w-4 text-emerald-500" /> });
    } else {
      toast.success(`${product.name} added to cart`, { duration: 1500 });
    }
  };

  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const taxRatePct = settings.pharmacy.taxRate;
  const tax = subtotal * (taxRatePct / 100);
  const total = subtotal + tax - discount;

  const filteredProducts = activeCategory === 'All'
    ? products
    : products.filter(p => p.category?.name === activeCategory);

  const cartQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    cart.forEach(item => {
      map.set(item.productId, (map.get(item.productId) || 0) + item.quantity);
    });
    return map;
  }, [cart]);

  const handleStockImpactContinue = () => {
    setShowStockImpact(false);
    setStockImpactItems([]);
    if (pendingSaleData) {
      setCompletedSale(pendingSaleData);
      setShowReceipt(true);
      setPendingSaleData(null);
    }
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    setSubmitting(true);
    try {
      // Capture pre-sale stock for impact display
      const preSaleStock = cart.map(item => {
        const product = products.find(p => p.id === item.productId);
        return {
          productName: item.productName,
          productId: item.productId,
          oldStock: product?.totalStock ?? 0,
          newStock: (product?.totalStock ?? 0) - item.quantity,
          quantitySold: item.quantity,
          reorderLevel: product?.reorderLevel ?? 10,
          hitZero: (product?.totalStock ?? 0) - item.quantity === 0,
          hitLow: (product?.totalStock ?? 0) - item.quantity > 0 && (product?.totalStock ?? 0) - item.quantity <= (product?.reorderLevel ?? 10),
        };
      });

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Cashier identity comes from the HttpOnly auth cookie server-side
          customerId: selectedCustomerId,
          items: cart.map(item => ({
            productId: item.productId,
            batchId: item.batchId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice,
          })),
          discount,
          tax,
          paymentMethod,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to complete sale');
      }
      const data = await res.json();

      const saleData = {
        invoiceNo: data.invoiceNo,
        customerName: data.customer?.name,
        items: (data.items ?? []).map((item: any) => ({
          productName: item.product?.name ?? 'Unknown',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          productId: item.productId,
        })),
        subtotal: data.subtotal,
        tax: data.tax,
        discount: data.discount,
        totalAmount: data.totalAmount,
        paymentMethod: data.paymentMethod,
        createdAt: data.createdAt,
      };

      // Refresh products to show updated stock
      await fetchProducts(searchQuery);

      toast.success('Sale completed successfully!');

      // Show Stock Impact Modal BEFORE receipt
      setStockImpactItems(preSaleStock);
      setPendingSaleData(saleData);
      setShowStockImpact(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete sale');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseReceipt = () => {
    completedSale?.items.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      if (product) {
        const newStock = product.totalStock - item.quantity;
        if (newStock === 0) {
          setTimeout(() => {
            toast.error(`${item.productName} is now OUT OF STOCK!`, { duration: 4000 });
          }, 500);
        } else if (newStock <= (product.reorderLevel || 10) && product.totalStock > (product.reorderLevel || 10)) {
          setTimeout(() => {
            toast.warning(`${item.productName} is now LOW STOCK (${newStock} remaining)`, { duration: 4000 });
          }, 500);
        }
      }
    });

    setShowReceipt(false);
    setCompletedSale(null);
    clearCart();
    setDiscount(0);
    setNotes('');
    setPaymentMethod('cash');
  };

  const paymentIcons = {
    cash: Banknote,
    card: CreditCard,
    mobile_money: Smartphone,
  };

  if (loading) {
    return (
      <div className="flex-col lg:flex-row flex h-full gap-4 p-4">
        <div className="flex-1 space-y-4">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="hidden lg:block w-80 border-l p-4 space-y-4">
          <Skeleton className="h-8 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  // ── Customer attach bar (shared by desktop cart panel & mobile sheet) ──
  const customerBlock = (
    <div className="shrink-0 px-3 py-2 border-b border-slate-100/80 bg-white/90">
      {selectedCustomer ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-2.5 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 shrink-0 rounded-full bg-emerald-600 flex items-center justify-center">
              <UserRound className="h-3 w-3 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-600/70 leading-none">Customer</p>
              <p className="text-[12px] font-medium text-slate-800 truncate leading-tight">{selectedCustomer.name}</p>
            </div>
          </div>
          <button
            onClick={() => setSelectedCustomer(null)}
            title="Detach customer"
            className="shrink-0 h-6 w-6 rounded-md text-emerald-500 hover:text-red-500 hover:bg-white transition-colors flex items-center justify-center"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowWalkInDialog(true)}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400 transition-colors"
        >
          <Zap className="h-3 w-3" />
          Quick Walk-In
          <span className="font-normal text-emerald-600/60">— register &amp; attach customer</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="flex-col lg:flex-row flex h-full gap-0 pb-20 lg:pb-0">
      {/* Left Panel - Product Search & Listing */}
      <div className="flex-1 flex flex-col min-w-0 p-3 lg:p-4 lg:pr-2 overflow-hidden">
        {/* Search Bar */}
        <div className="relative mb-2">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search medicines..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10 h-10 lg:h-10 bg-white border-slate-200 focus-visible:ring-emerald-500/20 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); fetchProducts(''); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Stock Movement Ticker */}
        <StockMovementTicker changes={stockChanges} />

        {/* Category Tabs */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-2 hide-scrollbar-mobile -mx-3 px-3 lg:mx-0 lg:px-0 scrollbar-none">
          {categories.map((cat) => {
            const Icon = getCategoryIcon(cat);
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200/50 scale-[1.02]'
                    : 'bg-white border border-slate-100 text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
                onClick={() => setActiveCategory(cat)}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                {cat}
              </button>
            );
          })}
        </div>

        {/* Stock Summary Bar */}
        <div className="flex items-center gap-1.5 mb-3 px-1 overflow-x-auto pb-1.5 hide-scrollbar-mobile scrollbar-none">
          <div className="flex items-center gap-1 bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0">
            <BarChart3 className="h-3 w-3" />
            <span>{filteredProducts.length} items</span>
          </div>
          <div className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0">
            <Package className="h-3 w-3 text-emerald-600" />
            <span>{filteredProducts.filter(p => p.totalStock > (p.reorderLevel || 10)).length} active</span>
          </div>
          <div className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0">
            <AlertTriangle className="h-3 w-3 text-amber-600" />
            <span>{filteredProducts.filter(p => p.totalStock > 0 && p.totalStock <= (p.reorderLevel || 10)).length} low</span>
          </div>
          <div className="flex items-center gap-1 bg-red-50 text-red-700 px-2.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0">
            <PackageX className="h-3 w-3 text-red-500" />
            <span>{filteredProducts.filter(p => p.totalStock === 0).length} out</span>
          </div>
          <div className="ml-auto shrink-0 pl-1">
            <button
              onClick={() => fetchProducts(searchQuery)}
              className="flex items-center justify-center h-5 w-5 rounded-full bg-slate-100 text-slate-400 hover:text-emerald-600 transition-colors"
              title="Refresh stock"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Product Grid - Premium scroll */}
        <div className="flex-1 min-h-0 -mx-1 overflow-y-auto pos-product-scroll pr-1">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 px-1 pb-4">
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product) => {
                const isOutOfStock = product.totalStock === 0;
                const isLowStock = product.totalStock > 0 && product.totalStock <= (product.reorderLevel || 10);
                const isCritical = product.totalStock > 0 && product.totalStock <= Math.ceil((product.reorderLevel || 10) * 0.3);
                const isInCart = cartQtyMap.has(product.id);
                const cartCount = cartQtyMap.get(product.id) || 0;
                const justAdded = addedToCart.has(product.id);
                const stockChange = stockChanges.find(c => c.productId === product.id);
                const effectiveStock = product.totalStock - cartCount;
                const isRestocked = restockedIds.has(product.id);
                const maxDisplay = Math.max((product.reorderLevel || 10) * 3, 20);
                const reservedPct = product.totalStock > 0 ? (cartCount / product.totalStock) * 100 : 0;
                const availablePct = product.totalStock > 0 ? (effectiveStock / product.totalStock) * 100 : 0;

                return (
                  <motion.button
                    key={product.id}
                    onClick={() => !isOutOfStock && handleAddToCart(product)}
                    disabled={isOutOfStock}
                    className={`relative text-left rounded-xl border transition-all overflow-hidden bg-white ${
                      isOutOfStock
                        ? 'border-slate-100 opacity-60 cursor-not-allowed'
                        : isCritical
                        ? 'border-red-200 shadow-sm shadow-red-50/50 hover:border-red-400 hover:shadow-md cursor-pointer'
                        : isLowStock
                        ? 'border-amber-200 shadow-sm shadow-amber-50/50 hover:border-amber-400 hover:shadow-md cursor-pointer'
                        : 'border-slate-200 hover:border-emerald-400 hover:shadow-md cursor-pointer'
                    } ${justAdded ? 'ring-2 ring-emerald-400 ring-offset-1' : ''}`}
                    whileTap={!isOutOfStock ? { scale: 0.97 } : undefined}
                    layout
                  >
                    <div className="p-2 lg:p-3">
                      {/* Restock green glow */}
                      <AnimatePresence>
                        {isRestocked && (
                          <motion.div
                            className="absolute inset-0 rounded-xl border-2 border-emerald-400 pointer-events-none z-20"
                            initial={{ opacity: 1, scale: 1.05 }}
                            animate={{ opacity: 0, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 2, ease: 'easeOut' }}
                            style={{
                              boxShadow: '0 0 20px 4px rgba(16, 185, 129, 0.3), inset 0 0 20px 4px rgba(16, 185, 129, 0.1)',
                            }}
                          />
                        )}
                      </AnimatePresence>

                      {/* Pulse effect on add to cart */}
                      <AnimatePresence>
                        {justAdded && (
                          <motion.div
                            className="absolute inset-0 bg-emerald-100/50 rounded-xl pointer-events-none"
                            initial={{ opacity: 1 }}
                            animate={{ opacity: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8 }}
                          />
                        )}
                      </AnimatePresence>

                      {/* "1 reserved" floating animation */}
                      <AnimatePresence>
                        {justAdded && (
                          <motion.div
                            className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
                            initial={{ opacity: 1, y: 0 }}
                            animate={{ opacity: 0, y: -20 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8 }}
                          >
                            <div className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap">
                              1 reserved
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Stock reduced flash */}
                      <AnimatePresence>
                        {stockChange && stockChange.type === 'sale' && (
                          <motion.div
                            className="absolute top-1 right-1 pointer-events-none z-10"
                            initial={{ opacity: 1, y: 0 }}
                            animate={{ opacity: 0, y: -12 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1.5 }}
                          >
                            <div className="flex items-center gap-0.5 text-red-500 text-[10px] font-bold bg-red-50 px-1.5 py-0.5 rounded-full">
                              <ArrowDownCircle className="h-2.5 w-2.5" />
                              -{stockChange.oldStock - stockChange.newStock}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Product Visual Container (AliExpress style) */}
                      <div className="h-16 lg:h-20 bg-slate-50/70 flex items-center justify-center relative overflow-hidden rounded-lg mb-2 border border-slate-100/80">
                        <ProductIllustration category={product.category?.name} name={product.name} />

                        {/* Cart quantity overlay badge */}
                        {isInCart && (
                          <div className="absolute top-1 left-1 bg-emerald-600 text-white text-[9px] font-black h-4.5 min-w-4.5 px-1 rounded-full flex items-center justify-center shadow-sm">
                            {cartCount}
                          </div>
                        )}

                        {/* Stock Gauge absolute overlay */}
                        <div className="absolute top-1 right-1">
                          <StockGauge
                            stock={product.totalStock}
                            reorderLevel={product.reorderLevel || 10}
                            size={22}
                            strokeWidth={2}
                          />
                        </div>

                        {/* Out / Critical / Low stock tag overlay on bottom-left */}
                        {isOutOfStock ? (
                          <span className="absolute bottom-1 left-1 bg-red-150 text-red-700 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider leading-none">
                            Out
                          </span>
                        ) : isCritical ? (
                          <span className="absolute bottom-1 left-1 bg-red-50 text-red-600 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider leading-none animate-pulse">
                            Critical
                          </span>
                        ) : isLowStock ? (
                          <span className="absolute bottom-1 left-1 bg-amber-50 text-amber-600 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none">
                            Low
                          </span>
                        ) : null}
                      </div>

                      {/* Product Name */}
                      <h4 className="font-semibold text-xs lg:text-sm leading-tight line-clamp-2 text-slate-800 h-8 mb-0.5">
                        {product.name}
                      </h4>

                      {/* Category */}
                      <p className="text-[10px] text-slate-400 mb-1 truncate">
                        {product.category?.name ?? 'Uncategorized'}
                      </p>

                      {/* Price & Unit */}
                      <div className="flex items-baseline gap-0.5 mb-1">
                        <span className="text-xs lg:text-sm font-bold text-slate-900 leading-none">
                          {formatGHS(product.minSellingPrice)}
                        </span>
                        <span className="text-[8px] lg:text-[9px] text-slate-400 leading-none">/{product.unit || 'unit'}</span>
                      </div>

                      {/* Available stock */}
                      <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                        <span>Stock:</span>
                        <CountingNumber
                          value={effectiveStock}
                          direction={
                            stockChange && stockChange.type === 'restock' ? 'up' :
                            stockChange && stockChange.type === 'sale' ? 'down' : null
                          }
                          size="sm"
                          className={`text-xs font-bold tabular-nums font-mono ${
                            effectiveStock <= 0
                              ? 'text-red-500'
                              : effectiveStock <= (product.reorderLevel || 10)
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                          }`}
                        />
                        {effectiveStock > 0 && (
                          <span className="text-[8px] text-slate-400">/ {product.totalStock}</span>
                        )}
                      </div>

                      {/* Mini bar progress */}
                      {!isOutOfStock && (
                        <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden flex">
                          <motion.div
                            className="h-full bg-emerald-500 rounded-l-full"
                            initial={false}
                            animate={{ width: `${availablePct}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                          />
                          <motion.div
                            className="h-full bg-amber-300"
                            initial={false}
                            animate={{ width: `${reservedPct}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                          />
                        </div>
                      )}
                    </div>
                  </motion.button>
                );
              })
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-400">
                <Search className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No products found</p>
                <p className="text-xs mt-1">Try a different search term or category</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Cart FAB - Mobile Only */}
      <AnimatePresence>
        {isMobile && cart.length > 0 && (
          <motion.button
            initial={{ scale: 0, y: 80, x: "-50%" }}
            animate={{ scale: 1, y: 0, x: "-50%" }}
            exit={{ scale: 0, y: 80, x: "-50%" }}
            whileTap={{ scale: 0.93 }}
            onClick={() => setCartOpen(true)}
            className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 h-14 pl-4 pr-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-2xl shadow-emerald-700/30 lg:hidden backdrop-blur-sm"
            style={{ boxShadow: '0 8px 32px rgba(5, 150, 105, 0.35), 0 2px 8px rgba(5, 150, 105, 0.2)' }}
          >
            <div className="relative">
              <ShoppingCart className="h-5 w-5" />
              <motion.span
                key={cart.reduce((s, i) => s + i.quantity, 0)}
                initial={{ scale: 1.5 }}
                animate={{ scale: 1 }}
                className="absolute -top-2 -right-2 h-4 min-w-4 px-1 rounded-full bg-white text-emerald-700 text-[9px] font-bold flex items-center justify-center shadow"
              >
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </motion.span>
            </div>
            <span className="font-bold text-sm tracking-tight">View Cart</span>
            <div className="h-5 w-px bg-white/20" />
            <span className="font-black text-sm tabular-nums">{formatGHS(total)}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Mobile Cart Sheet */}
      <Sheet open={cartOpen && isMobile} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="h-[80vh] p-0 rounded-t-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Cart</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col h-full">
            {/* Cart header */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <ShoppingCart className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-800">Cart</h3>
                  <p className="text-[10px] text-slate-400">{cart.length > 0 ? `${cart.length} product${cart.length !== 1 ? 's' : ''} · ${formatGHS(subtotal)}` : 'Empty'}</p>
                </div>
              </div>
              {cart.length > 0 && (
                <button onClick={clearCart} className="text-xs font-medium text-red-400 hover:text-red-600">Clear all</button>
              )}
            </div>
            {customerBlock}
            {/* Cart items scrollable */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {cart.length > 0 ? (
                <div className="space-y-1.5">
                  {cart.map((item) => {
                    const product = products.find(p => p.id === item.productId);
                    const reorderLevel = product?.reorderLevel || 10;
                    const stockAfterSale = (product?.totalStock || 0) - item.quantity;
                    return (
                      <div key={`${item.productId}-${item.batchId}`} className="py-2.5 px-3 rounded-xl border border-slate-100 bg-slate-50/50">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-slate-800 truncate">{item.productName}</p>
                            <p className="text-xs text-slate-400 tabular-nums">{formatGHS(item.unitPrice)} × {item.quantity}</p>
                          </div>
                          <span className="font-bold text-sm text-slate-800 tabular-nums shrink-0">{formatGHS(item.unitPrice * item.quantity)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <p className={`text-[10px] font-semibold ${stockAfterSale <= 0 ? 'text-red-500' : stockAfterSale <= reorderLevel ? 'text-amber-600' : 'text-slate-300'}`}>
                            {stockAfterSale > 0 ? `${stockAfterSale} left` : 'Last unit!'}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              onClick={() => removeFromCart(item.productId, item.batchId)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            <div className="flex items-center bg-white rounded-lg border border-slate-200">
                              <button
                                className="h-8 w-8 rounded-l-lg flex items-center justify-center text-slate-500 hover:bg-slate-50"
                                onClick={() => updateCartQuantity(item.productId, item.batchId, item.quantity - 1)}
                                disabled={item.quantity <= 1}
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-8 text-center text-sm font-bold tabular-nums text-slate-700">{item.quantity}</span>
                              <button
                                className={`h-8 w-8 rounded-r-lg flex items-center justify-center ${item.quantity >= item.availableQty ? 'text-slate-200 cursor-not-allowed' : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-600'}`}
                                onClick={() => { if (item.quantity < item.availableQty) updateCartQuantity(item.productId, item.batchId, item.quantity + 1); }}
                                disabled={item.quantity >= item.availableQty}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-slate-300">
                  <ShoppingCart className="h-10 w-10 mb-2 opacity-50" />
                  <p className="text-sm font-medium text-slate-400">No items yet</p>
                </div>
              )}
            </div>
            {/* Payment section */}
            <div className="shrink-0 border-t border-slate-100 bg-white px-4 pt-3 pb-6 space-y-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5 space-y-1">
                <div className="flex justify-between text-xs"><span className="text-slate-400">Subtotal</span><span className="font-medium font-mono">{formatGHS(subtotal)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400">VAT ({taxRatePct}%)</span><span className="font-mono text-slate-500">{formatGHS(tax)}</span></div>
                <div className="flex items-center justify-between text-xs"><span className="text-slate-400">Discount</span>
                  <Input type="number" value={discount || ''} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="w-20 h-6 text-xs text-right bg-white border-slate-200 px-1.5 rounded-md" placeholder="0.00" />
                </div>
                <div className="h-px bg-slate-200 my-1" />
                <div className="flex justify-between items-baseline"><span className="font-bold text-sm text-slate-700">Total</span><span className="font-black text-lg text-emerald-600 font-mono">{formatGHS(total)}</span></div>
              </div>
              <div className="flex gap-2">
                {(['cash', 'card', 'mobile_money'] as const).map((method) => {
                  const Icon = paymentIcons[method];
                  const label = method === 'mobile_money' ? 'MoMo' : method.charAt(0).toUpperCase() + method.slice(1);
                  return (
                    <button key={method} onClick={() => setPaymentMethod(method)}
                      className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-semibold transition-all ${paymentMethod === method ? 'bg-emerald-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-400'}`}>
                      <Icon className="h-4 w-4" />{label}
                    </button>
                  );
                })}
              </div>
              <Button className="w-full h-12 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold text-sm shadow-lg rounded-xl"
                onClick={() => { setCartOpen(false); setTimeout(handleCompleteSale, 300); }}
                disabled={cart.length === 0 || submitting}>
                {submitting ? 'Processing...' : `Complete Sale — ${formatGHS(total)}`}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Right Panel - Cart & Payment (desktop) */}
      <div className="hidden lg:flex w-[340px] border-l border-slate-100 bg-white flex-col shrink-0 overflow-hidden">

        {/* ─── Cart Header — pinned ─── */}
        <div className="shrink-0 px-3.5 py-2.5 border-b border-slate-100/80 bg-white/90 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-200/50">
                  <ShoppingCart className="h-4 w-4 text-white" />
                </div>
                {cart.length > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow-sm"
                  >
                    {cart.reduce((s, i) => s + i.quantity, 0)}
                  </motion.span>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-[13px] text-slate-800 leading-tight">Cart</h3>
                <p className="text-[10px] text-slate-400 leading-tight">
                  {cart.length > 0
                    ? `${cart.length} product${cart.length !== 1 ? 's' : ''} · ${formatGHS(subtotal)}`
                    : 'Empty'}
                </p>
              </div>
            </div>
            {cart.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="h-7 px-2.5 rounded-lg text-[10px] font-medium text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                onClick={clearCart}
              >
                Clear all
              </motion.button>
            )}
          </div>
        </div>

        {/* ─── Cart Items — premium scroll, NEVER pushes payment ─── */}
        {customerBlock}
        <div className="flex-1 min-h-0 overflow-y-auto cart-items-scroll relative">
          {/* Top fade when scrolled */}
          <div className="sticky top-0 z-10 h-3 bg-gradient-to-b from-white via-white/80 to-transparent pointer-events-none" />
          <div className="px-3 pb-2">
            <AnimatePresence mode="popLayout">
            {cart.length > 0 ? (
              <div className="space-y-1.5">
                {cart.map((item) => {
                  const product = products.find(p => p.id === item.productId);
                  const reorderLevel = product?.reorderLevel || 10;
                  const stockAfterSale = (product?.totalStock || 0) - item.quantity;

                  return (
                    <motion.div
                      key={`${item.productId}-${item.batchId}`}
                      initial={{ opacity: 0, x: 12, scale: 0.98 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -12, scale: 0.95, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                      className="py-2 px-2.5 rounded-xl border border-slate-100/80 bg-slate-50/50 hover:bg-white hover:border-slate-200 hover:shadow-sm transition-all duration-200 group"
                      layout
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[12px] text-slate-800 truncate leading-tight">{item.productName}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{formatGHS(item.unitPrice)} × {item.quantity}</p>
                        </div>
                        <span className="font-bold text-[12px] text-slate-800 tabular-nums shrink-0 pt-px">
                          {formatGHS(item.unitPrice * item.quantity)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <p className={`text-[9px] font-semibold tracking-wide uppercase ${
                          stockAfterSale <= 0 ? 'text-red-500' :
                          stockAfterSale <= reorderLevel ? 'text-amber-600' :
                          'text-slate-300'
                        }`}>
                          {stockAfterSale > 0 ? `${stockAfterSale} left` : 'Last unit!'}
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            className="h-8 w-8 rounded-md flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                            onClick={() => removeFromCart(item.productId, item.batchId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div className="flex items-center bg-white rounded-lg border border-slate-200 shadow-sm">
                            <button
                              className="h-8 w-8 rounded-l-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                              onClick={() => updateCartQuantity(item.productId, item.batchId, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-8 text-center text-xs font-bold tabular-nums text-slate-700">{item.quantity}</span>
                            <button
                              className={`h-8 w-8 rounded-r-lg flex items-center justify-center transition-colors ${
                                item.quantity >= item.availableQty
                                  ? 'text-slate-200 cursor-not-allowed'
                                  : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'
                              }`}
                              onClick={() => {
                                if (item.quantity < item.availableQty) {
                                  updateCartQuantity(item.productId, item.batchId, item.quantity + 1);
                                }
                              }}
                              disabled={item.quantity >= item.availableQty}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                <div className="h-14 w-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                  <ShoppingCart className="h-7 w-7 text-slate-200" />
                </div>
                <p className="text-xs font-semibold text-slate-300">No items yet</p>
                <p className="text-[10px] text-slate-200 mt-0.5">Tap a product to begin</p>
              </div>
            )}
            </AnimatePresence>
          </div>
        </div>

        {/* ─── Payment Section — ALWAYS pinned at bottom, never scrolls ─── */}
        <div className="shrink-0 relative">
          {/* Subtle shadow above payment to indicate scrollable content above */}
          {cart.length > 2 && (
            <div className="absolute -top-3 left-0 right-0 h-3 bg-gradient-to-t from-slate-100/60 to-transparent pointer-events-none z-10" />
          )}
          <div className="border-t border-slate-100 bg-gradient-to-t from-white via-slate-50/30 to-white px-3 pt-2.5 pb-3 space-y-2">
            {/* Price Summary — compact card */}
            <div className="rounded-xl border border-slate-100 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-3 py-2 space-y-0.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Subtotal</span>
                <span className="text-slate-600 font-medium font-mono tabular-nums">{formatGHS(subtotal)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">VAT ({taxRatePct}%)</span>
                <span className="text-slate-500 font-mono tabular-nums">{formatGHS(tax)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Discount</span>
                <Input
                  type="number"
                  value={discount || ''}
                  onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                  className="w-20 h-5 text-[10px] text-right bg-slate-50/80 border-slate-200 px-1.5 rounded-md focus-visible:ring-emerald-500/20"
                  placeholder="0.00"
                />
              </div>
              <div className="h-px bg-slate-100 my-1" />
              <div className="flex justify-between items-baseline">
                <span className="font-bold text-[12px] text-slate-700 uppercase tracking-wide">Total</span>
                <span className="font-black text-[17px] text-emerald-600 font-mono tabular-nums leading-none">{formatGHS(total)}</span>
              </div>
            </div>

            {/* Payment Method — pill selector */}
            <div className="flex gap-1">
              {(['cash', 'card', 'mobile_money'] as const).map((method) => {
                const Icon = paymentIcons[method];
                const label = method === 'mobile_money' ? 'MoMo' : method.charAt(0).toUpperCase() + method.slice(1);
                const isActive = paymentMethod === method;
                return (
                  <motion.button
                    key={method}
                    whileTap={{ scale: 0.95 }}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl text-[10px] font-semibold transition-all duration-200 ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                        : 'bg-white border border-slate-200 text-slate-400 hover:border-emerald-200 hover:text-emerald-600 hover:shadow-sm'
                    }`}
                    onClick={() => setPaymentMethod(method)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </motion.button>
                );
              })}
            </div>

            {/* Complete Sale — premium CTA */}
            <Button
              className="w-full h-10 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-bold text-[13px] shadow-lg shadow-emerald-500/25 transition-all hover:shadow-xl hover:shadow-emerald-500/30 active:scale-[0.98] rounded-xl"
              onClick={handleCompleteSale}
              disabled={cart.length === 0 || submitting}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <motion.div
                    className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                  />
                  Processing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Complete Sale — {formatGHS(total)}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Stock Impact Modal (shown BEFORE receipt) */}
      <AnimatePresence>
        {showStockImpact && stockImpactItems.length > 0 && (
          <StockImpactModal
            items={stockImpactItems}
            onContinue={handleStockImpactContinue}
          />
        )}
      </AnimatePresence>

      {/* Quick Walk-In Dialog */}
      <Dialog open={showWalkInDialog} onOpenChange={setShowWalkInDialog}>
        <DialogContent className="sm:max-w-sm p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="flex items-center gap-2 text-base text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                <UserRoundPlus className="h-4 w-4 text-emerald-600" />
              </span>
              Quick Walk-In
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Register a customer in seconds — only a name is needed. The customer is attached to this sale automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-5 space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="walkin-name" className="text-xs font-medium text-slate-600">Name *</Label>
              <Input
                id="walkin-name"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                placeholder="Customer name"
                disabled={addingWalkIn}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="walkin-phone" className="text-xs font-medium text-slate-600">Phone (optional)</Label>
              <Input
                id="walkin-phone"
                type="tel"
                value={walkInPhone}
                onChange={(e) => setWalkInPhone(e.target.value)}
                placeholder="e.g. 024 000 0000"
                disabled={addingWalkIn}
              />
            </div>
            <p className="text-[10px] text-slate-400">
              Full details can be added later from the Customers page.
            </p>
          </div>
          <DialogFooter className="flex-row gap-2 px-5 pb-4 border-t border-slate-100 pt-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setShowWalkInDialog(false)}
              disabled={addingWalkIn}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleAddWalkIn}
              disabled={addingWalkIn || !walkInName.trim()}
            >
              {addingWalkIn ? 'Adding...' : 'Add & Select'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Modal */}
      <Dialog open={showReceipt} onOpenChange={(open) => { if (!open) handleCloseReceipt(); }}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Sale Completed - Receipt</DialogTitle>
          <DialogDescription className="sr-only">Sale receipt and transaction details</DialogDescription>
          {completedSale && (
            <div>
              {/* Professional Receipt */}
              <div
                id="receipt-print"
                className="bg-white text-slate-900 overflow-hidden"
              >
                {/* Receipt Header - Pharmacy Branding */}
                <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 py-3 text-white text-center relative overflow-hidden">
                  <div className="absolute inset-0 opacity-10 pointer-events-none" style={{backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '16px 16px'}} />
                  <div className="relative">
                    <div className="flex items-center justify-center gap-1.5 mb-0.5">
                      <PillLogo className="h-4 w-4 text-emerald-200" />
                      <h3 className="text-base font-bold tracking-wide">{settings.pharmacy.name}</h3>
                      <PillLogo className="h-4 w-4 text-emerald-200" />
                    </div>
                    <p className="text-emerald-100 text-[10px]">{settings.pharmacy.address}</p>
                    <p className="text-emerald-100 text-[10px]">Tel: {settings.pharmacy.phone}</p>
                  </div>
                </div>

                {/* Success badge */}
                <div className="flex items-center justify-center -mt-4 relative z-10">
                  <div className="h-8 w-8 rounded-full bg-emerald-100 border-2 border-white shadow flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                  </div>
                </div>

                {/* Receipt Body */}
                <div className="px-4 py-3 space-y-2.5">
                  {/* Transaction Details */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                    <div className="flex justify-between col-span-2">
                      <span className="text-slate-400 font-medium uppercase text-[9px] tracking-wider">Invoice</span>
                      <span className="font-bold text-slate-800 font-mono">{completedSale.invoiceNo}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[9px] uppercase tracking-wider">Date</span>
                      <p className="font-medium text-slate-700 text-[11px]">{new Date(completedSale.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[9px] uppercase tracking-wider">Time</span>
                      <p className="font-medium text-slate-700 text-[11px]">{new Date(completedSale.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[9px] uppercase tracking-wider">Cashier</span>
                      <p className="font-medium text-slate-700 text-[11px]">{currentUser?.name ?? '-'}</p>
                    </div>
                    {completedSale.customerName && (
                      <div>
                        <span className="text-slate-400 text-[9px] uppercase tracking-wider">Customer</span>
                        <p className="font-medium text-slate-700 text-[11px]">{completedSale.customerName}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 text-[9px] uppercase tracking-wider">Payment</span>
                      <p className="font-medium text-slate-700 capitalize text-[11px]">{completedSale.paymentMethod.replace('_', ' ')}</p>
                    </div>
                  </div>

                  {/* Dashed separator */}
                  <div className="border-t border-dashed border-slate-200" />

                  {/* Items Table */}
                  <div>
                    <div className="grid grid-cols-12 gap-1.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-200">
                      <span className="col-span-5">Item</span>
                      <span className="col-span-2 text-center">Qty</span>
                      <span className="col-span-2 text-right">Price</span>
                      <span className="col-span-3 text-right">Total</span>
                    </div>
                    <div className="divide-y divide-dotted divide-slate-200">
                      {completedSale.items.map((item, i) => (
                        <div key={i} className="grid grid-cols-12 gap-1.5 py-1.5 text-[11px]">
                          <span className="col-span-5 text-slate-700 font-medium truncate">{item.productName}</span>
                          <span className="col-span-2 text-center text-slate-600 font-mono">{item.quantity}</span>
                          <span className="col-span-2 text-right text-slate-500 font-mono">{formatGHS(item.unitPrice)}</span>
                          <span className="col-span-3 text-right text-slate-800 font-bold font-mono">{formatGHS(item.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dashed separator */}
                  <div className="border-t border-dashed border-slate-200" />

                  {/* Totals */}
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between text-slate-500">
                      <span>Subtotal</span>
                      <span className="font-mono">{formatGHS(completedSale.subtotal)}</span>
                    </div>
                    {settings.receipt.showTax && (
                      <div className="flex justify-between text-slate-500">
                        <span>VAT ({taxRatePct}%)</span>
                        <span className="font-mono">{formatGHS(completedSale.tax)}</span>
                      </div>
                    )}
                    {settings.receipt.showDiscount && completedSale.discount > 0 && (
                      <div className="flex justify-between text-red-500">
                        <span>Discount</span>
                        <span className="font-mono">-{formatGHS(completedSale.discount)}</span>
                      </div>
                    )}

                    {/* Total box */}
                    <div className="bg-emerald-50 rounded-lg px-3 py-2 mt-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-xs text-emerald-800 uppercase tracking-wider">Total</span>
                        <span className="font-black text-lg text-emerald-700 font-mono">{formatGHS(completedSale.totalAmount)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Dashed separator */}
                  <div className="border-t border-dashed border-slate-200" />

                  {/* Footer */}
                  <div className="text-center space-y-0.5">
                    {settings.receipt.footerText && (
                      <p className="text-[10px] text-slate-400 font-medium">{settings.receipt.footerText}</p>
                    )}
                    <p className="text-[9px] text-slate-300">{settings.pharmacy.tagline}</p>
                    <div className="flex items-center justify-center gap-1 pt-1">
                      {Array.from({ length: 28 }).map((_, i) => (
                        <div key={i} className="w-[1.5px] h-3 bg-slate-300 rounded-full" style={{ opacity: i % 3 === 0 ? 1 : 0.4 }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* Action buttons */}
              <div className="flex gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                <Button variant="outline" size="sm" className="flex-1 h-9" onClick={handleCloseReceipt}>
                  Close
                </Button>
                <Button size="sm" className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5 mr-1" />
                  Print
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}