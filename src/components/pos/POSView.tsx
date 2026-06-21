'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'lucide-react';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import type { Product, Batch, Customer, CartItem } from '@/types';

function formatGHS(value: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
}

interface ProductWithStock extends Product {
  batches: (Batch & { currentQty: number })[];
  totalStock: number;
  minSellingPrice: number;
}

export default function POSView() {
  const { cart, addToCart, removeFromCart, updateCartQuantity, clearCart, currentUser, selectedCustomerId, setSelectedCustomer } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile_money'>('cash');
  const [showReceipt, setShowReceipt] = useState(false);
  const [completedSale, setCompletedSale] = useState<{
    invoiceNo: string;
    customerName?: string;
    items: { productName: string; quantity: number; unitPrice: number; total: number }[];
    subtotal: number;
    tax: number;
    discount: number;
    totalAmount: number;
    paymentMethod: string;
    createdAt: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProducts = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products ?? []);
        const cats = [...new Set((data.products ?? []).map((p: Product) => p.category?.name).filter(Boolean))] as string[];
        setCategories(['All', ...cats]);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    async function init() {
      await fetchProducts('');
      try {
        const res = await fetch('/api/customers');
        if (res.ok) {
          const data = await res.json();
          setCustomers(data.customers ?? []);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    init();
  }, [fetchProducts]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchProducts(value);
    }, 300);
  };

  const handleAddToCart = (product: ProductWithStock) => {
    const bestBatch = product.batches
      .filter(b => b.quantity > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];
    if (!bestBatch) {
      toast.error('No available stock for this product');
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
    toast.success(`${product.name} added to cart`);
  };

  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const tax = subtotal * 0.125; // 12.5% VAT
  const total = subtotal + tax - discount;

  const filteredProducts = activeCategory === 'All'
    ? products
    : products.filter(p => p.category?.name === activeCategory);

  const handleCompleteSale = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser?.id,
          customerId: selectedCustomerId,
          items: cart.map(item => ({
            productId: item.productId,
            batchId: item.batchId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice,
          })),
          discount,
          paymentMethod,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to complete sale');
      }
      const data = await res.json();
      setCompletedSale({
        invoiceNo: data.invoiceNo,
        customerName: data.customer?.name,
        items: (data.items ?? []).map((item: any) => ({
          productName: item.product?.name ?? 'Unknown',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
        subtotal: data.subtotal,
        tax: data.tax,
        discount: data.discount,
        totalAmount: data.totalAmount,
        paymentMethod: data.paymentMethod,
        createdAt: data.createdAt,
      });
      setShowReceipt(true);
      toast.success('Sale completed successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete sale');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseReceipt = () => {
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

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  if (loading) {
    return (
      <div className="flex h-full gap-4 p-4">
        <div className="flex-1 space-y-4">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </div>
        <div className="w-96 border-l p-4 space-y-4">
          <Skeleton className="h-8 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-4 p-4">
      {/* Left Panel - Product Search & Listing */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products by name..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'default' : 'outline'}
              size="sm"
              className={activeCategory === cat ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>

        {/* Product Grid */}
        <ScrollArea className="flex-1">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleAddToCart(product)}
                  className="text-left p-4 rounded-xl border hover:border-emerald-400 hover:shadow-md transition-all bg-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-sm leading-tight line-clamp-2">{product.name}</h4>
                    <Pill className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{product.category?.name ?? 'Uncategorized'}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="font-bold text-emerald-600">{formatGHS(product.minSellingPrice)}</span>
                    <Badge variant={product.totalStock > 0 ? 'default' : 'destructive'} className={
                      product.totalStock > 0 ? 'bg-emerald-100 text-emerald-700' : ''
                    }>
                      {product.totalStock}
                    </Badge>
                  </div>
                </button>
              ))
            ) : (
              <div className="col-span-full text-center text-muted-foreground py-12">
                No products found
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right Panel - Cart & Checkout */}
      <div className="w-96 border-l bg-card flex flex-col shrink-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Cart ({cart.length} items)
          </CardTitle>
        </CardHeader>

        {/* Cart Items */}
        <ScrollArea className="flex-1 px-4">
          {cart.length > 0 ? (
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={`${item.productId}-${item.batchId}`} className="p-3 rounded-lg border">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">{formatGHS(item.unitPrice)} each</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-400 hover:text-red-600"
                      onClick={() => removeFromCart(item.productId, item.batchId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateCartQuantity(item.productId, item.batchId, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center font-medium text-sm">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateCartQuantity(item.productId, item.batchId, item.quantity + 1)}
                        disabled={item.quantity >= item.availableQty}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <span className="font-bold text-sm">{formatGHS(item.unitPrice * item.quantity)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-12">
              <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Cart is empty</p>
              <p className="text-xs">Click a product to add it</p>
            </div>
          )}
        </ScrollArea>

        {/* Cart Summary & Checkout */}
        <div className="border-t p-4 space-y-3">
          {/* Customer Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search customer (optional)"
              className="pl-8 h-8 text-xs"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
            {customerSearch && !selectedCustomerId && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto z-50">
                {customers
                  .filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone?.includes(customerSearch))
                  .slice(0, 5)
                  .map(c => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                      onClick={() => { setSelectedCustomer(c.id); setCustomerSearch(c.name); }}
                    >
                      {c.name} - {c.phone ?? c.email ?? '-'}
                    </button>
                  ))
                }
              </div>
            )}
            {selectedCustomer && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-emerald-600">{selectedCustomer.name}</span>
                <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
            )}
          </div>

          {/* Notes */}
          <Input
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-8 text-xs"
          />

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatGHS(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax (12.5%)</span>
              <span>{formatGHS(tax)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Discount</span>
              <Input
                type="number"
                value={discount || ''}
                onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                className="w-24 h-7 text-xs text-right"
                placeholder="0.00"
              />
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span className="text-emerald-600">{formatGHS(total)}</span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="flex gap-2">
            {(['cash', 'card', 'mobile_money'] as const).map((method) => {
              const Icon = paymentIcons[method];
              const label = method === 'mobile_money' ? 'Mobile Money' : method.charAt(0).toUpperCase() + method.slice(1);
              return (
                <Button
                  key={method}
                  variant={paymentMethod === method ? 'default' : 'outline'}
                  size="sm"
                  className={paymentMethod === method ? 'bg-emerald-600 hover:bg-emerald-700 flex-1' : 'flex-1'}
                  onClick={() => setPaymentMethod(method)}
                >
                  <Icon className="h-4 w-4 mr-1" />
                  {label}
                </Button>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={clearCart}
              disabled={cart.length === 0}
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleCompleteSale}
              disabled={cart.length === 0 || submitting}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              {submitting ? 'Processing...' : 'Complete Sale'}
            </Button>
          </div>
        </div>
      </div>

      {/* Receipt Modal */}
      <Dialog open={showReceipt} onOpenChange={(open) => { if (!open) handleCloseReceipt(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sale Completed</DialogTitle>
          </DialogHeader>
          {completedSale && (
            <div className="bg-white text-black p-6 font-mono text-xs" id="receipt-print">
              <div className="text-center mb-4">
                <h3 className="text-lg font-bold">GreenLife Pharmacy</h3>
                <p>123 Health Street, Accra</p>
                <p>Tel: +233 30 123 4567</p>
                <Separator className="my-2" />
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Invoice:</span>
                  <span className="font-bold">{completedSale.invoiceNo}</span>
                </div>
                <div className="flex justify-between">
                  <span>Date:</span>
                  <span>{new Date(completedSale.createdAt).toLocaleString('en-GH')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cashier:</span>
                  <span>{currentUser?.name ?? '-'}</span>
                </div>
                {completedSale.customerName && (
                  <div className="flex justify-between">
                    <span>Customer:</span>
                    <span>{completedSale.customerName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Payment:</span>
                  <span>{completedSale.paymentMethod}</span>
                </div>
              </div>
              <Separator className="my-3" />
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1">Item</th>
                    <th className="text-center py-1">Qty</th>
                    <th className="text-right py-1">Price</th>
                    <th className="text-right py-1">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {completedSale.items.map((item, i) => (
                    <tr key={i} className="border-b border-dotted">
                      <td className="py-1">{item.productName}</td>
                      <td className="text-center py-1">{item.quantity}</td>
                      <td className="text-right py-1">{formatGHS(item.unitPrice)}</td>
                      <td className="text-right py-1">{formatGHS(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Separator className="my-3" />
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatGHS(completedSale.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax:</span>
                  <span>{formatGHS(completedSale.tax)}</span>
                </div>
                {completedSale.discount > 0 && (
                  <div className="flex justify-between">
                    <span>Discount:</span>
                    <span>-{formatGHS(completedSale.discount)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-bold text-sm">
                  <span>TOTAL:</span>
                  <span>{formatGHS(completedSale.totalAmount)}</span>
                </div>
              </div>
              <div className="text-center mt-6 text-xs">
                <p>Thank you for your purchase!</p>
                <p>GreenLife Pharmacy - Your Health, Our Priority</p>
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={handleCloseReceipt}>
              Close
            </Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" />
              Print Receipt
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Pill({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>
    </svg>
  );
}