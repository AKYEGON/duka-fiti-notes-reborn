import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSupabaseSales } from '../hooks/useSupabaseSales';
import { useSupabaseProducts } from '../hooks/useSupabaseProducts';
import { useSupabaseCustomers } from '../hooks/useSupabaseCustomers';
import { useOfflineSales } from '../hooks/useOfflineSales';
import { useOfflineManager } from '../hooks/useOfflineManager';
import { formatCurrency } from '../utils/currency';
import { Product, Customer } from '../types';
import { CartItem } from '../types/cart';
import { ShoppingCart, Package, UserPlus, Search, X, Minus, Plus, Wifi, WifiOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile, useIsTablet } from '@/hooks/use-mobile';
import AddCustomerModal from './sales/AddCustomerModal';
import AddDebtModal from './sales/AddDebtModal';

import { Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

type PaymentMethod = 'cash' | 'mpesa' | 'debt';

const ModernSalesPage = () => {
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [activePanel, setActivePanel] = useState<'search' | 'cart'>('search');
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const { user } = useAuth();
  const { toast } = useToast();

  const { sales, loading: salesLoading } = useSupabaseSales();
  const { products, loading: productsLoading } = useSupabaseProducts();
  const { customers, loading: customersLoading, updateCustomer } = useSupabaseCustomers();
  const { createOfflineSale, isCreating: isCreatingOfflineSale } = useOfflineSales();
  const { isOnline, pendingOperations } = useOfflineManager();

  const isLoading = salesLoading || productsLoading || customersLoading;

  useEffect(() => {
    const productsChannel = supabase
      .channel('products-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        // Products updated
      })
      .subscribe();

    const customersChannel = supabase
      .channel('customers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, (payload) => {
        // Customers updated
      })
      .subscribe();

    return () => {
      supabase.removeChannel(productsChannel);
      supabase.removeChannel(customersChannel);
    };
  }, []);

  const total = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.sellingPrice * item.quantity, 0);
  }, [cart]);

  const filteredProducts = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return products.filter(product =>
      product.name.toLowerCase().includes(term) ||
      product.category.toLowerCase().includes(term)
    );
  }, [products, searchTerm]);

  const addToCart = (product: Product) => {
    // Only show confirmation for products with exactly 0 stock, not unspecified/negative stock
    if (product.currentStock === 0) {
      const shouldAdd = window.confirm('This product is out of stock. Do you want to add it anyway?');
      if (!shouldAdd) return;
    }

    const existingItem = cart.find(item => item.id === product.id);
    if (existingItem) {
      const updatedCart = cart.map(item =>
        item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
      );
      setCart(updatedCart);
    } else {
      const cartItem: CartItem = { ...product, quantity: 1 };
      setCart([...cart, cartItem]);
    }
  };

  const removeFromCart = (productId: string) => {
    const updatedCart = cart.filter(item => item.id !== productId);
    setCart(updatedCart);
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }

    const updatedCart = cart.map(item =>
      item.id === productId ? { ...item, quantity: newQuantity } : item
    );
    setCart(updatedCart);
  };

  const clearCart = () => {
    setCart([]);
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast({
        title: "Error",
        description: "Your cart is empty.",
        variant: "destructive",
      });
      return;
    }

    // Check if payment method is debt/credit and customer is required
    if (paymentMethod === 'debt' && !selectedCustomerId) {
      toast({
        title: "Customer Required",
        description: "Please select a customer for credit sales.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to complete a sale.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessingCheckout(true);
    
    try {
      const customerId = selectedCustomerId === '' ? null : selectedCustomerId;
      const customer = customers.find(c => c.id === customerId);

      if (isOnline) {
        // Online sales - direct to Supabase
        await processOnlineSale(customerId, customer);
      } else {
        // Offline sales - store locally and queue for sync
        await processOfflineSale(customerId, customer);
      }

      // Success - clear cart and switch to search panel
      toast({
        title: "Success!",
        description: `Sale completed ${isOnline ? 'online' : 'offline'}! Total: ${formatCurrency(total)}`,
      });
      
      clearCart();
      setSelectedCustomerId(null);
      setActivePanel('search');

    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to complete sale: ${error?.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setIsProcessingCheckout(false);
    }
  };

  const processOnlineSale = async (customerId: string | null, customer: Customer | null) => {
    
    // Prepare sales data for batch insert
    const salesData = cart.map(item => ({
      user_id: user.id,
      product_id: item.id,
      product_name: item.name,
      quantity: item.quantity,
      selling_price: item.sellingPrice,
      cost_price: item.costPrice,
      profit: (item.sellingPrice - item.costPrice) * item.quantity,
      total_amount: item.sellingPrice * item.quantity,
      customer_id: customerId,
      customer_name: customer ? customer.name : null,
      payment_method: paymentMethod,
      payment_details: {
        cashAmount: paymentMethod === 'cash' ? total : 0,
        mpesaAmount: paymentMethod === 'mpesa' ? total : 0,
        debtAmount: paymentMethod === 'debt' ? total : 0,
      },
      timestamp: new Date().toISOString(),
    }));

    // Insert sales records
    const { error: saleError } = await supabase
      .from('sales')
      .insert(salesData);

    if (saleError) {
      throw new Error('Failed to record sales.');
    }

    // Update customer debt if this is a credit sale
    if (paymentMethod === 'debt' && customer) {
      const debtAmount = total;
      const updatedDebt = customer.outstandingDebt + debtAmount;
      const updatedPurchases = customer.totalPurchases + total;
      
      await updateCustomer(customer.id, {
        outstandingDebt: updatedDebt,
        totalPurchases: updatedPurchases,
        lastPurchaseDate: new Date().toISOString(),
      });
    } else if (customer && paymentMethod !== 'debt') {
      // Update total purchases for non-debt sales
      const updatedPurchases = customer.totalPurchases + total;
      
      await updateCustomer(customer.id, {
        totalPurchases: updatedPurchases,
        lastPurchaseDate: new Date().toISOString(),
      });
    }

    // Update stock for each item
    for (const item of cart) {
      if (item.currentStock > 0) {
        const newStock = Math.max(0, item.currentStock - item.quantity);
        const { error: productError } = await supabase
          .from('products')
          .update({ current_stock: newStock })
          .eq('id', item.id);

        if (productError) {
          // Don't throw error here - sale should still complete
        }
      }
    }
  };

  const processOfflineSale = async (customerId: string | null, customer: Customer | null) => {
    
    // Create offline sales for each cart item
    for (const item of cart) {
      const saleData = {
        user_id: user.id,
        product_id: item.id,
        product_name: item.name,
        quantity: item.quantity,
        selling_price: item.sellingPrice,
        cost_price: item.costPrice,
        profit: (item.sellingPrice - item.costPrice) * item.quantity,
        total_amount: item.sellingPrice * item.quantity,
        customer_id: customerId,
        customer_name: customer ? customer.name : null,
        payment_method: paymentMethod,
        payment_details: {
          cashAmount: paymentMethod === 'cash' ? item.sellingPrice * item.quantity : 0,
          mpesaAmount: paymentMethod === 'mpesa' ? item.sellingPrice * item.quantity : 0,
          debtAmount: paymentMethod === 'debt' ? item.sellingPrice * item.quantity : 0,
        },
        timestamp: new Date().toISOString(),
      };

      await createOfflineSale(saleData);
    }
  };

  const getStockDisplayText = (stock: number) => {
    if (stock < 0) return 'Unspecified';
    if (stock === 0) return 'Out of Stock';
    return stock.toString();
  };

  const getStockColorClass = (stock: number, lowStockThreshold: number = 10) => {
    if (stock < 0) return 'text-gray-500 dark:text-gray-400'; // Unspecified
    if (stock === 0) return 'text-orange-500 dark:text-orange-400'; // Out of stock
    if (stock <= lowStockThreshold) return 'text-yellow-500 dark:text-yellow-400'; // Low stock
    return 'text-purple-500 dark:text-purple-400'; // Normal stock
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  // Mobile two-panel layout
  if (isMobile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 relative overflow-hidden">
        {/* Header */}
        <div className="p-3 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 border-2 border-purple-400 rounded-xl bg-transparent flex items-center justify-center hover:border-purple-500 transition-colors">
                <ShoppingCart className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <h1 className="font-mono font-black uppercase tracking-widest text-gray-900 dark:text-white text-lg">
                SALES POINT
              </h1>
              {/* Connection Status */}
              <div className={`
                flex items-center gap-2 px-2 py-1 rounded-full border-2
                ${isOnline 
                  ? 'border-green-400 bg-green-50 dark:bg-green-900/20' 
                  : 'border-orange-400 bg-orange-50 dark:bg-orange-900/20'
                }
              `}>
                {isOnline ? (
                  <Wifi className="w-3 h-3 text-green-600 dark:text-green-400" />
                ) : (
                  <WifiOff className="w-3 h-3 text-orange-600 dark:text-orange-400" />
                )}
                <span className={`
                  font-mono font-bold uppercase text-xs
                  ${isOnline 
                    ? 'text-green-700 dark:text-green-300' 
                    : 'text-orange-700 dark:text-orange-300'
                  }
                `}>
                  {isOnline ? 'ON' : 'OFF'}
                </span>
                {!isOnline && pendingOperations > 0 && (
                  <span className="bg-orange-600 text-white text-xs px-1 py-0.5 rounded-full font-bold">
                    {pendingOperations}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 font-mono text-xs">
              <Clock className="w-4 h-4" />
              <span className="font-bold">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Panel A: Search & Quick-Select */}
        <div className={`
          absolute inset-0 top-20 bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 
          transition-transform duration-200 ease-in-out overflow-y-auto
          ${activePanel === 'search' ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="p-3 space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-purple-500 w-5 h-5" />
              <input
                type="text"
                placeholder="SEARCH PRODUCTS..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-4 border-2 border-purple-300 dark:border-purple-600 rounded-xl bg-transparent font-mono font-bold text-gray-900 dark:text-white placeholder-purple-400 focus:outline-none focus:border-purple-500 focus:ring-0 transition-colors uppercase tracking-wide text-sm"
              />
            </div>

            {/* Product Grid */}
            <div className="grid grid-cols-2 gap-4 pb-20">
              {/* Add Debt Button - Always visible on mobile */}
              <div
                onClick={() => {
                  setShowAddDebt(true);
                }}
                className="
                  border-2 border-red-400 dark:border-red-500 rounded-xl bg-red-50 dark:bg-red-900/20 
                  cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl 
                  hover:border-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 group p-4
                "
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-mono font-black uppercase tracking-wide text-red-700 dark:text-red-300 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors text-xs">
                        RECORD DEBT
                      </h3>
                      <p className="text-red-600 dark:text-red-400 uppercase font-mono font-bold text-xs">
                        CASH LENDING
                      </p>
                    </div>
                    <div className="w-8 h-8 border-2 border-red-400 dark:border-red-500 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:border-red-500 transition-colors">
                      <UserPlus className="w-4 h-4 text-red-600 dark:text-red-400" />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono font-black text-red-700 dark:text-red-300 text-sm">
                        Cash Lending
                      </p>
                      <p className="font-mono font-bold uppercase text-xs text-red-600 dark:text-red-400">
                        Record Debt
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className={`
                    border-2 border-purple-300 dark:border-purple-600 rounded-xl bg-white/50 dark:bg-gray-800/50 
                    cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl 
                    hover:border-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 group p-4
                    ${product.currentStock === 0 ? 'border-orange-300 bg-orange-50/50 dark:bg-orange-900/20' : ''}
                    ${product.currentStock < 0 ? 'border-gray-300 bg-gray-50/50 dark:bg-gray-800/30' : ''}
                  `}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-mono font-black uppercase tracking-wide text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors text-xs">
                          {product.name}
                        </h3>
                        <p className="text-purple-600 dark:text-purple-400 uppercase font-mono font-bold text-xs">
                          {product.category}
                        </p>
                      </div>
                      <div className="w-8 h-8 border-2 border-purple-300 dark:border-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:border-purple-500 transition-colors">
                        <Package className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono font-black text-gray-900 dark:text-white text-sm">
                          {formatCurrency(product.sellingPrice)}
                        </p>
                        <p className={`font-mono font-bold uppercase text-xs ${getStockColorClass(product.currentStock, product.lowStockThreshold)}`}>
                          Stock: {getStockDisplayText(product.currentStock)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel B: Cart & Checkout */}
        <div className={`
          absolute inset-0 top-20 bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 
          transition-transform duration-200 ease-in-out overflow-y-auto
          ${activePanel === 'cart' ? 'translate-x-0' : 'translate-x-full'}
        `}>
          <div className="p-3 space-y-4 pb-20">
            {/* Cart Header */}
            <div className="flex items-center justify-between">
              <h2 className="font-mono font-black uppercase tracking-wider text-gray-900 dark:text-white text-sm">
                CART ({cart.length})
              </h2>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="border-2 border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl font-mono font-black uppercase tracking-wide transition-colors px-3 py-2 text-xs"
                >
                  CLEAR
                </button>
              )}
            </div>

            {/* Cart Items */}
            <div className="space-y-3">
              {cart.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 border-2 border-gray-300 dark:border-gray-600 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <ShoppingCart className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 font-mono font-bold uppercase text-sm">Cart Empty</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="border-2 border-purple-200 dark:border-purple-700 rounded-xl p-3 bg-white/50 dark:bg-gray-800/50">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-mono font-bold uppercase text-gray-900 dark:text-white text-sm">
                        {item.name}
                      </h4>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="text-red-500 hover:text-red-700 transition-colors p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-7 h-7 border-2 border-purple-300 rounded-lg flex items-center justify-center hover:bg-purple-100 dark:hover:bg-purple-900/20 transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-black text-sm min-w-[20px] text-center">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-7 h-7 border-2 border-purple-300 rounded-lg flex items-center justify-center hover:bg-purple-100 dark:hover:bg-purple-900/20 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="font-mono font-black text-gray-900 dark:text-white text-sm">
                        {formatCurrency(item.sellingPrice * item.quantity)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Customer Selection */}
            {cart.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <select
                    value={selectedCustomerId || ''}
                    onChange={(e) => setSelectedCustomerId(e.target.value || null)}
                    className="flex-1 p-3 border-2 border-purple-300 dark:border-purple-600 rounded-xl bg-background text-foreground font-mono font-bold focus:outline-none focus:border-purple-500 transition-colors uppercase"
                  >
                    <option value="">WALK-IN CUSTOMER</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name.toUpperCase()} - {customer.phone}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowAddCustomer(true)}
                    className="border-2 border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl font-mono font-black uppercase tracking-wide transition-colors flex items-center gap-2 px-3 py-3 text-xs"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                </div>

                {/* Payment Method Selection */}
                <div className="space-y-3">
                  <h3 className="font-mono font-black uppercase tracking-wider text-gray-900 dark:text-white text-sm">
                    PAYMENT METHOD
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {(['cash', 'mpesa', 'debt'] as PaymentMethod[]).map((method) => (
                      <button
                        key={method}
                        onClick={() => setPaymentMethod(method)}
                        className={`
                          p-3 rounded-xl font-mono font-black uppercase text-xs transition-all
                          ${paymentMethod === method
                            ? 'border-2 border-purple-500 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                            : 'border-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400'
                          }
                        `}
                      >
                        {method === 'mpesa' ? 'M-PESA' : method === 'debt' ? 'CREDIT' : method.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  
                  {/* Warning for credit sales without customer */}
                  {paymentMethod === 'debt' && !selectedCustomerId && (
                    <div className="p-3 bg-orange-100 dark:bg-orange-900/20 border-2 border-orange-300 dark:border-orange-600 rounded-xl">
                      <p className="text-orange-700 dark:text-orange-400 font-mono font-bold text-xs uppercase">
                        ⚠️ Customer required for credit sales
                      </p>
                    </div>
                  )}
                </div>

                {/* Total and Checkout */}
                <div className="space-y-4 pt-4 border-t-2 border-purple-200 dark:border-purple-700">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black uppercase tracking-wider text-gray-900 dark:text-white">
                      TOTAL:
                    </span>
                    <span className="font-mono font-black text-xl text-purple-600 dark:text-purple-400">
                      {formatCurrency(total)}
                    </span>
                  </div>
                  
                  <button
                    onClick={handleCheckout}
                    disabled={isProcessingCheckout || isCreatingOfflineSale || (paymentMethod === 'debt' && !selectedCustomerId)}
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-mono font-black uppercase tracking-wider rounded-xl transition-all duration-300 hover:from-purple-700 hover:to-blue-700 hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 py-4 text-sm"
                  >
                    {isProcessingCheckout || isCreatingOfflineSale ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        PROCESSING...
                      </>
                    ) : (
                      <>
                        {isOnline ? (
                          <Wifi className="w-4 h-4" />
                        ) : (
                          <WifiOff className="w-4 h-4" />
                        )}
                        COMPLETE SALE {!isOnline && '(OFFLINE)'}
                      </>
                    )}
                  </button>
                  
                  {!isOnline && (
                    <p className="text-center text-xs text-orange-600 dark:text-orange-400 font-mono">
                      ⚠️ OFFLINE MODE - Sale will sync when connection is restored
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Floating Toggle Button */}
        <button
          onClick={() => setActivePanel(activePanel === 'search' ? 'cart' : 'search')}
          className={`
            fixed top-1/2 -translate-y-1/2 w-14 h-14 bg-green-600 text-white rounded-full shadow-lg 
            z-50 transition-all duration-200 ease-in-out hover:bg-green-700 active:scale-95
            flex items-center justify-center
            ${activePanel === 'search' ? 'right-4' : 'left-4'}
          `}
          aria-label={activePanel === 'search' ? 'Go to Cart' : 'Go to Search'}
        >
          {activePanel === 'search' ? (
            <ShoppingCart className="w-6 h-6" />
          ) : (
            <Search className="w-6 h-6" />
          )}
        </button>

        {/* Add Customer Modal */}
        {showAddCustomer && (
          <AddCustomerModal
            open={showAddCustomer}
            onOpenChange={setShowAddCustomer}
            onCustomerAdded={(customer) => {
              setSelectedCustomerId(customer.id);
              setShowAddCustomer(false);
            }}
          />
        )}

        {/* Add Debt Modal - CRITICAL: Added for mobile view */}
        <AddDebtModal
          isOpen={showAddDebt}
          onClose={() => setShowAddDebt(false)}
        />
      </div>
    );
  }

  // Desktop/Tablet layout (unchanged)
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      {/* Header with Connection Status */}
      <div className={`
        space-y-6 max-w-7xl mx-auto
        ${isTablet ? 'p-4' : 'p-6'}
      `}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-purple-400 rounded-xl bg-transparent flex items-center justify-center hover:border-purple-500 transition-colors">
              <ShoppingCart className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <h1 className={`
              font-mono font-black uppercase tracking-widest text-gray-900 dark:text-white
              ${isTablet ? 'text-xl' : 'text-2xl'}
            `}>
              SALES POINT
            </h1>
            {/* Connection Status */}
            <div className={`
              flex items-center gap-2 px-3 py-1 rounded-full border-2
              ${isOnline 
                ? 'border-green-400 bg-green-50 dark:bg-green-900/20' 
                : 'border-orange-400 bg-orange-50 dark:bg-orange-900/20'
              }
            `}>
              {isOnline ? (
                <Wifi className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              )}
              <span className={`
                font-mono font-bold uppercase text-xs
                ${isOnline 
                  ? 'text-green-700 dark:text-green-300' 
                  : 'text-orange-700 dark:text-orange-300'
                }
              `}>
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
              {!isOnline && pendingOperations > 0 && (
                <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                  {pendingOperations}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 font-mono text-sm">
            <Clock className="w-4 h-4" />
            <span className="font-bold">TOTAL: {formatCurrency(total)}</span>
          </div>
        </div>

        {/* Search Bar - Blocky Style */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-purple-500 w-5 h-5" />
          <input
            type="text"
            placeholder="SEARCH PRODUCTS..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-4 border-2 border-purple-300 dark:border-purple-600 rounded-xl bg-transparent font-mono font-bold text-gray-900 dark:text-white placeholder-purple-400 focus:outline-none focus:border-purple-500 focus:ring-0 transition-colors uppercase tracking-wide text-base"
          />
        </div>


        {/* Product Grid and Cart Layout */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          {/* Product Grid */}
          <div className="lg:col-span-2">
            <div className={`
              grid gap-4
              ${isTablet ? 'grid-cols-3' : 'grid-cols-2 xl:grid-cols-3'}
            `}>
              {/* Add Debt Card */}
              <div
                onClick={() => setShowAddDebt(true)}
                className="border-2 border-red-400 rounded-xl bg-red-50 dark:bg-red-900/20 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:border-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 group p-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-mono font-black uppercase tracking-wide text-red-600 dark:text-red-400 group-hover:text-red-700 dark:group-hover:text-red-300 transition-colors text-sm">
                        ADD DEBT
                      </h3>
                      <p className="text-red-500 dark:text-red-400 uppercase font-mono font-bold text-sm">
                        CREDIT SALE
                      </p>
                    </div>
                    <div className="w-8 h-8 border-2 border-red-400 dark:border-red-500 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:border-red-500 dark:group-hover:border-red-400 transition-colors bg-red-100 dark:bg-red-800/50">
                      <span className="text-red-600 dark:text-red-400 font-black text-lg">₹</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono font-black text-red-600 dark:text-red-400 text-base">
                        RECORD DEBT
                      </p>
                      <p className="font-mono font-bold uppercase text-sm text-red-500 dark:text-red-400">
                        CUSTOMER CREDIT
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className={`
                    border-2 border-purple-300 dark:border-purple-600 rounded-xl bg-white/50 dark:bg-gray-800/50 
                    cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl 
                    hover:border-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 group p-4
                    ${product.currentStock === 0 ? 'border-orange-300 bg-orange-50/50 dark:bg-orange-900/20' : ''}
                    ${product.currentStock < 0 ? 'border-gray-300 bg-gray-50/50 dark:bg-gray-800/30' : ''}
                  `}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-mono font-black uppercase tracking-wide text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors text-sm">
                          {product.name}
                        </h3>
                        <p className="text-purple-600 dark:text-purple-400 uppercase font-mono font-bold text-sm">
                          {product.category}
                        </p>
                      </div>
                      <div className="w-8 h-8 border-2 border-purple-300 dark:border-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:border-purple-500 transition-colors">
                        <Package className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono font-black text-gray-900 dark:text-white text-base">
                          {formatCurrency(product.sellingPrice)}
                        </p>
                        <p className={`font-mono font-bold uppercase text-sm ${getStockColorClass(product.currentStock, product.lowStockThreshold)}`}>
                          Stock: {getStockDisplayText(product.currentStock)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cart Section - Blocky Style */}
          <div className="space-y-6">
            {/* Cart Header */}
            <div className="flex items-center justify-between">
              <h2 className="font-mono font-black uppercase tracking-wider text-gray-900 dark:text-white text-base">
                CART ({cart.length})
              </h2>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="border-2 border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl font-mono font-black uppercase tracking-wide transition-colors px-4 py-2 text-sm"
                >
                  CLEAR
                </button>
              )}
            </div>

            {/* Cart Items */}
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 border-2 border-gray-300 dark:border-gray-600 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <ShoppingCart className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 font-mono font-bold uppercase text-sm">Cart Empty</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="border-2 border-purple-200 dark:border-purple-700 rounded-xl p-3 bg-white/50 dark:bg-gray-800/50">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-mono font-bold uppercase text-gray-900 dark:text-white text-base">
                        {item.name}
                      </h4>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="text-red-500 hover:text-red-700 transition-colors p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-7 h-7 border-2 border-purple-300 rounded-lg flex items-center justify-center hover:bg-purple-100 dark:hover:bg-purple-900/20 transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-black text-sm min-w-[20px] text-center">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-7 h-7 border-2 border-purple-300 rounded-lg flex items-center justify-center hover:bg-purple-100 dark:hover:bg-purple-900/20 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="font-mono font-black text-gray-900 dark:text-white text-sm">
                        {formatCurrency(item.sellingPrice * item.quantity)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Customer Selection */}
            {cart.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <select
                    value={selectedCustomerId || ''}
                    onChange={(e) => setSelectedCustomerId(e.target.value || null)}
                    className="flex-1 p-3 border-2 border-purple-300 dark:border-purple-600 rounded-xl bg-background text-foreground font-mono font-bold focus:outline-none focus:border-purple-500 transition-colors uppercase"
                  >
                    <option value="">WALK-IN CUSTOMER</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name.toUpperCase()} - {customer.phone}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowAddCustomer(true)}
                    className="border-2 border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl font-mono font-black uppercase tracking-wide transition-colors flex items-center gap-2 px-4 py-3 text-sm"
                  >
                    <UserPlus className="w-4 h-4" />
                    ADD
                  </button>
                </div>

                {/* Payment Method Selection */}
                <div className="space-y-3">
                  <h3 className="font-mono font-black uppercase tracking-wider text-gray-900 dark:text-white text-sm">
                    PAYMENT METHOD
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {(['cash', 'mpesa', 'debt'] as PaymentMethod[]).map((method) => (
                      <button
                        key={method}
                        onClick={() => setPaymentMethod(method)}
                        className={`
                          p-3 rounded-xl font-mono font-black uppercase text-xs transition-all
                          ${paymentMethod === method
                            ? 'border-2 border-purple-500 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                            : 'border-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400'
                          }
                        `}
                      >
                        {method === 'mpesa' ? 'M-PESA' : method === 'debt' ? 'CREDIT' : method.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  
                  {/* Warning for credit sales without customer */}
                  {paymentMethod === 'debt' && !selectedCustomerId && (
                    <div className="p-3 bg-orange-100 dark:bg-orange-900/20 border-2 border-orange-300 dark:border-orange-600 rounded-xl">
                      <p className="text-orange-700 dark:text-orange-400 font-mono font-bold text-xs uppercase">
                        ⚠️ Customer required for credit sales
                      </p>
                    </div>
                  )}
                </div>

                {/* Total and Checkout */}
                <div className="space-y-4 pt-4 border-t-2 border-purple-200 dark:border-purple-700">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black uppercase tracking-wider text-gray-900 dark:text-white">
                      TOTAL:
                    </span>
                    <span className="font-mono font-black text-xl text-purple-600 dark:text-purple-400">
                      {formatCurrency(total)}
                    </span>
                  </div>
                  
                  <button
                    onClick={handleCheckout}
                    disabled={isProcessingCheckout || isCreatingOfflineSale || (paymentMethod === 'debt' && !selectedCustomerId)}
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-mono font-black uppercase tracking-wider rounded-xl transition-all duration-300 hover:from-purple-700 hover:to-blue-700 hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 py-4 text-base"
                  >
                    {isProcessingCheckout || isCreatingOfflineSale ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        PROCESSING...
                      </>
                    ) : (
                      <>
                        {isOnline ? (
                          <Wifi className="w-4 h-4" />
                        ) : (
                          <WifiOff className="w-4 h-4" />
                        )}
                        COMPLETE SALE {!isOnline && '(OFFLINE)'}
                      </>
                    )}
                  </button>
                  
                  {!isOnline && (
                    <p className="text-center text-xs text-orange-600 dark:text-orange-400 font-mono">
                      ⚠️ OFFLINE MODE - Sale will sync when connection is restored
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <AddCustomerModal
          open={showAddCustomer}
          onOpenChange={setShowAddCustomer}
          onCustomerAdded={(customer) => {
            setSelectedCustomerId(customer.id);
            setShowAddCustomer(false);
          }}
        />
      )}

      {/* Add Debt Modal */}
      <AddDebtModal
        isOpen={showAddDebt}
        onClose={() => setShowAddDebt(false)}
      />
    </div>
  );
};

export default ModernSalesPage;
