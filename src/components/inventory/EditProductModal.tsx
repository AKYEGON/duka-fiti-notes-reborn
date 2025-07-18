
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Product } from '../../types';
import { useToast } from '../../hooks/use-toast';
import { useIsMobile, useIsTablet } from '../../hooks/use-mobile';
import { PRODUCT_CATEGORIES, isCustomCategory, validateCustomCategory } from '../../constants/categories';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, productData: Partial<Product>) => Promise<void>;
  product: Product | null;
}


const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, onSave, product }) => {
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    costPrice: '',
    sellingPrice: '',
    lowStockThreshold: '',
    currentStock: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  const { toast } = useToast();

  const isUnspecifiedStock = product?.currentStock === -1;

  useEffect(() => {
    if (product && isOpen) {
      const isCustom = !PRODUCT_CATEGORIES.includes(product.category as any);
      setFormData({
        name: product.name,
        category: isCustom ? 'Other / Custom' : product.category,
        costPrice: product.costPrice.toString(),
        sellingPrice: product.sellingPrice.toString(),
        lowStockThreshold: product.lowStockThreshold?.toString() || '10',
        currentStock: product.currentStock.toString()
      });
      setCustomCategory(isCustom ? product.category : '');
      setShowCustomInput(isCustom);
      setErrors({});
    }
  }, [product, isOpen]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) newErrors.name = 'Product name is required';
    
    if (!isUnspecifiedStock && (!formData.costPrice || parseFloat(formData.costPrice) <= 0)) {
      newErrors.costPrice = 'Valid buying price is required';
    }
    
    if (!formData.sellingPrice || parseFloat(formData.sellingPrice) <= 0) {
      newErrors.sellingPrice = 'Valid selling price is required';
    }
    
    if (!isUnspecifiedStock && (!formData.lowStockThreshold || parseInt(formData.lowStockThreshold) < 0)) {
      newErrors.lowStockThreshold = 'Valid threshold is required';
    }
    
    if (!formData.category) newErrors.category = 'Category is required';
    
    if (isCustomCategory(formData.category) && !validateCustomCategory(customCategory)) {
      newErrors.category = 'Custom category is required and must be 50 characters or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!product || !validateForm()) return;

    setLoading(true);

    try {
      const updatedProduct = {
        name: formData.name.trim(),
        category: isCustomCategory(formData.category) ? customCategory : formData.category,
        costPrice: isUnspecifiedStock ? 0 : parseFloat(formData.costPrice),
        sellingPrice: parseFloat(formData.sellingPrice),
        currentStock: isUnspecifiedStock ? -1 : parseInt(formData.currentStock),
        lowStockThreshold: isUnspecifiedStock ? 0 : parseInt(formData.lowStockThreshold)
      };

      await onSave(product.id, updatedProduct);
      
      toast({
        title: "Success",
        description: "Product updated successfully",
      });

      onClose();
    } catch (error) {
      console.error('Failed to update product:', error);
      toast({
        title: "Error",
        description: "Failed to update product. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setErrors({});
    setCustomCategory('');
    setShowCustomInput(false);
    onClose();
  };

  const handleCategoryChange = (value: string) => {
    setFormData(prev => ({ ...prev, category: value }));
    if (isCustomCategory(value)) {
      setShowCustomInput(true);
    } else {
      setShowCustomInput(false);
      setCustomCategory('');
    }
  };

  const isFormValid = formData.name && formData.sellingPrice && formData.category;

  if (!product) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className={`
        max-w-[95vw] sm:max-w-[600px] max-h-[95vh] border-0 p-0 bg-white dark:bg-gray-900 shadow-2xl rounded-xl overflow-hidden flex flex-col
      `}>
        
        {/* Modern Header */}
        <div className="border-b-4 border-blue-600 bg-white dark:bg-gray-900 p-6 text-center flex-shrink-0">
          <DialogTitle className="font-mono text-xl font-black uppercase tracking-widest text-gray-900 dark:text-white">
            EDIT PRODUCT
          </DialogTitle>
          <p className="font-mono text-sm text-gray-600 dark:text-gray-400 mt-2 uppercase tracking-wider">
            Update product information
          </p>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-6">
          <div className="space-y-6">
            
            {/* Product Name */}
            <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl p-4 bg-transparent">
              <Label htmlFor="name" className="font-mono text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-3 block">
                Product Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className={`h-12 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-transparent font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 ${
                  errors.name ? 'border-red-500' : ''
                }`}
                placeholder="Enter product name"
                disabled={loading}
              />
              {errors.name && <p className="text-red-500 text-sm mt-2 font-mono">{errors.name}</p>}
            </div>

            {/* Product Code (Read-only) */}
            <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl p-4 bg-transparent">
              <Label htmlFor="code" className="font-mono text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-3 block">
                Product Code
              </Label>
              <Input
                id="code"
                value={product.id.slice(0, 8).toUpperCase()}
                className="h-12 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 font-mono opacity-75 cursor-not-allowed"
                disabled
                readOnly
              />
            </div>

            {/* Pricing Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Buying Price */}
              <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl p-4 bg-transparent">
                <Label htmlFor="costPrice" className="font-mono text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-3 block">
                  Buying Price (KES) *
                </Label>
                {isUnspecifiedStock && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-mono">Disabled for unspecified-quantity items</p>
                )}
                <div className="relative">
                  <span className={`absolute left-3 top-1/2 transform -translate-y-1/2 ${
                    isUnspecifiedStock ? 'text-gray-400' : 'text-gray-500 dark:text-gray-400'
                  } text-sm font-mono`}>
                    KES
                  </span>
                  <Input
                    id="costPrice"
                    type="number"
                    step="0.01"
                    value={isUnspecifiedStock ? '' : formData.costPrice}
                    onChange={(e) => setFormData(prev => ({ ...prev, costPrice: e.target.value }))}
                    className={`h-12 text-base pl-14 border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-transparent font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 ${
                      errors.costPrice ? 'border-red-500' : ''
                    } ${isUnspecifiedStock ? 'opacity-50 cursor-not-allowed' : ''}`}
                    placeholder={isUnspecifiedStock ? "Disabled" : "0.00"}
                    disabled={isUnspecifiedStock || loading}
                  />
                </div>
                {errors.costPrice && <p className="text-red-500 text-sm mt-2 font-mono">{errors.costPrice}</p>}
              </div>

              {/* Selling Price */}
              <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl p-4 bg-transparent">
                <Label htmlFor="sellingPrice" className="font-mono text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-3 block">
                  Selling Price (KES) *
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm font-mono">
                    KES
                  </span>
                  <Input
                    id="sellingPrice"
                    type="number"
                    step="0.01"
                    value={formData.sellingPrice}
                    onChange={(e) => setFormData(prev => ({ ...prev, sellingPrice: e.target.value }))}
                    className={`h-12 text-base pl-14 border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-transparent font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 ${
                      errors.sellingPrice ? 'border-red-500' : ''
                    }`}
                    placeholder="0.00"
                    disabled={loading}
                  />
                </div>
                {errors.sellingPrice && <p className="text-red-500 text-sm mt-2 font-mono">{errors.sellingPrice}</p>}
              </div>
            </div>

            {/* Stock Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Current Stock */}
              <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl p-4 bg-transparent">
                <Label htmlFor="currentStock" className="font-mono text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-3 block">
                  Current Stock
                </Label>
                {isUnspecifiedStock && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-mono">Disabled for unspecified-quantity items</p>
                )}
                <Input
                  id="currentStock"
                  type="number"
                  value={isUnspecifiedStock ? '' : formData.currentStock}
                  onChange={(e) => setFormData(prev => ({ ...prev, currentStock: e.target.value }))}
                  className={`h-12 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-transparent font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 ${
                    isUnspecifiedStock ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  placeholder={isUnspecifiedStock ? "Unspecified quantity" : "0"}
                  disabled={isUnspecifiedStock || loading}
                />
              </div>

              {/* Low-Stock Threshold */}
              <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl p-4 bg-transparent">
                <Label htmlFor="lowStockThreshold" className="font-mono text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-3 block">
                  Low-Stock Threshold *
                </Label>
                {isUnspecifiedStock && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-mono">Disabled for unspecified-quantity items</p>
                )}
                <Input
                  id="lowStockThreshold"
                  type="number"
                  value={isUnspecifiedStock ? '' : formData.lowStockThreshold}
                  onChange={(e) => setFormData(prev => ({ ...prev, lowStockThreshold: e.target.value }))}
                  className={`h-12 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-transparent font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 ${
                    errors.lowStockThreshold ? 'border-red-500' : ''
                  } ${isUnspecifiedStock ? 'opacity-50 cursor-not-allowed' : ''}`}
                  placeholder={isUnspecifiedStock ? "Disabled" : "10"}
                  disabled={isUnspecifiedStock || loading}
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 font-mono">Alert when qty ≤ this value</p>
                {errors.lowStockThreshold && <p className="text-red-500 text-sm mt-2 font-mono">{errors.lowStockThreshold}</p>}
              </div>
            </div>

            {/* Category */}
            <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl p-4 bg-transparent">
              <Label htmlFor="category" className="font-mono text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-3 block">
                Category *
              </Label>
              <Select 
                value={formData.category} 
                onValueChange={handleCategoryChange}
                disabled={loading}
              >
                <SelectTrigger className={`h-12 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-transparent font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 ${
                  errors.category ? 'border-red-500' : ''
                }`}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900">
                  {PRODUCT_CATEGORIES.map(category => (
                    <SelectItem key={category} value={category} className="font-mono">
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showCustomInput && (
                <div className="mt-3">
                  <Input
                    placeholder="Enter custom category"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="h-12 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-transparent font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500"
                    maxLength={50}
                    disabled={loading}
                  />
                </div>
              )}
              {errors.category && <p className="text-red-500 text-sm mt-2 font-mono">{errors.category}</p>}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-6">
              <Button
                onClick={handleSave}
                disabled={!isFormValid || loading}
                className="w-full h-12 text-base font-mono font-bold uppercase tracking-wide bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'SAVING...' : 'SAVE CHANGES'}
              </Button>
              <Button
                type="button"
                onClick={handleClose}
                className="w-full h-12 text-base font-mono font-bold uppercase tracking-wide bg-transparent border-2 border-gray-600 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-all duration-200"
                disabled={loading}
              >
                CANCEL
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditProductModal;
