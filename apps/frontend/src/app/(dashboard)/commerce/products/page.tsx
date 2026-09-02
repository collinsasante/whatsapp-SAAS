'use client';

import { useCallback, useEffect, useState } from 'react';
import { Package, Plus, X, Loader2, Ban } from 'lucide-react';
import { commerceProductsApi } from '@/lib/api';
import toast from 'react-hot-toast';

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  priceMajorUnits: number;
  currency: string;
  isActive: boolean;
  stockQuantity: number | null;
  createdAt: string;
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
    </div>
  );
}

function StockBadge({ stockQuantity }: { stockQuantity: number | null }) {
  if (stockQuantity === null) {
    return <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">Unlimited</span>;
  }
  if (stockQuantity === 0) {
    return <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">Out of stock</span>;
  }
  return <span className="text-[11px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">{stockQuantity} in stock</span>;
}

const BLANK_NEW_PRODUCT = { name: '', description: '', sku: '', priceMajorUnits: '', currency: 'GHS', stockQuantity: '' };

export default function CommerceProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProduct, setNewProduct] = useState({ ...BLANK_NEW_PRODUCT });

  const load = useCallback(async () => {
    try {
      const res = await commerceProductsApi.list();
      setProducts(res.data as Product[]);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createProduct = async () => {
    if (!newProduct.name.trim() || !newProduct.priceMajorUnits.trim()) {
      toast.error('Name and price are required');
      return;
    }
    setCreating(true);
    try {
      await commerceProductsApi.create({
        name: newProduct.name.trim(),
        description: newProduct.description.trim() || undefined,
        sku: newProduct.sku.trim() || undefined,
        priceMajorUnits: parseFloat(newProduct.priceMajorUnits) || 0,
        currency: newProduct.currency.trim() || 'GHS',
        stockQuantity: newProduct.stockQuantity.trim() === '' ? undefined : parseInt(newProduct.stockQuantity, 10),
      });
      toast.success(`"${newProduct.name}" added`);
      setShowCreate(false);
      setNewProduct({ ...BLANK_NEW_PRODUCT });
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create product');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (product: Product) => {
    try {
      await commerceProductsApi.update(product.id, { isActive: !product.isActive });
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to update product');
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
              <Package size={18} className="text-teal-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Products</h1>
              <p className="text-xs text-gray-500">Your Managed Commerce catalogue — what the AI can sell</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-3">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 h-20 animate-pulse" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No products yet — click &quot;Add Product&quot; to create your first one.
            </div>
          ) : (
            products.map(p => (
              <div key={p.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                    {!p.isActive && (
                      <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <Ban size={10} /> Inactive
                      </span>
                    )}
                  </div>
                  {p.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{p.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm font-medium text-gray-700">{p.currency} {p.priceMajorUnits}</span>
                    <StockBadge stockQuantity={p.stockQuantity} />
                  </div>
                </div>
                <button
                  onClick={() => toggleActive(p)}
                  className="shrink-0 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  {p.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Add Product</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <Field label="Name" value={newProduct.name} onChange={v => setNewProduct(p => ({ ...p, name: v }))} />
              <Field label="Description (optional)" value={newProduct.description} onChange={v => setNewProduct(p => ({ ...p, description: v }))} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Price" value={newProduct.priceMajorUnits} onChange={v => setNewProduct(p => ({ ...p, priceMajorUnits: v }))} type="number" />
                <Field label="Currency" value={newProduct.currency} onChange={v => setNewProduct(p => ({ ...p, currency: v.toUpperCase() }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="SKU (optional)" value={newProduct.sku} onChange={v => setNewProduct(p => ({ ...p, sku: v }))} />
                <Field
                  label="Stock qty (blank = unlimited)"
                  value={newProduct.stockQuantity}
                  onChange={v => setNewProduct(p => ({ ...p, stockQuantity: v }))}
                  type="number"
                  placeholder="Unlimited"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={createProduct}
                disabled={creating}
                className="flex items-center gap-1.5 px-5 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add Product
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
