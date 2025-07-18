
export interface Customer {
  id: string;
  name: string;
  phone: string;
  createdDate: string;
  email?: string;
  address?: string;
  totalPurchases: number;
  outstandingDebt: number;
  creditLimit: number;
  lastPurchaseDate: string | null;
  riskRating: 'low' | 'medium' | 'high';
}

export interface Transaction {
  id: string;
  customerId: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  notes: string;
  date: string;
  paid: boolean;
  paidDate: string | null;
}

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
  costPrice: number;
  profit: number;
  timestamp: string;
  synced: boolean;
  customerId?: string;
  customerName?: string;
  paymentMethod: 'cash' | 'mpesa' | 'debt' | 'partial';
  paymentDetails: {
    cashAmount: number;
    mpesaAmount: number;
    debtAmount: number;
    mpesaReference?: string;
    tillNumber?: string;
  };
  total: number;
}

export interface Product {
  id: string;
  name: string;
  sku?: string;
  category: string;
  costPrice: number;
  sellingPrice: number;
  currentStock: number;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
}
