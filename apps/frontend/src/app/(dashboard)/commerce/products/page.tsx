'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, Plus, X, Loader2, Ban, ImagePlus, Save } from 'lucide-react';
import { commerceProductsApi, mediaApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  priceMajorUnits: number;
  currency: string;
  isActive: boolean;
  imageUrl: string | null;
  stockQuantity: number | null;
  minOrderQuantity: number | null;
  createdAt: string;
}

function apiErr(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

function Field({ label, value, onChange, type = 'text', placeholder, textarea }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; textarea?: boolean;
}) {
  const cls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {textarea ? (
        <textarea value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} rows={3} className={cls} />
      ) : (
        <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={cls} />
      )}
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

function ProductImage({ product, size = 'card' }: { product: { imageUrl: string | null; name: string }; size?: 'card' | 'detail' }) {
  const cls = size === 'card' ? 'w-full h-36' : 'w-full h-52';
  if (product.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.imageUrl} alt={product.name} className={cn(cls, 'object-cover bg-gray-50')} />;
  }
  return (
    <div className={cn(cls, 'bg-gray-50 flex items-center justify-center')}>
      <Package className="w-10 h-10 text-gray-300" />
    </div>
  );
}

function ImageUploadButton({ onUploaded, uploading, setUploading }: {
  onUploaded: (url: string) => void; uploading: boolean; setUploading: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await mediaApi.upload(file);
      const url = (res.data as { fileUrl?: string }).fileUrl;
      if (!url) throw new Error('Upload did not return a file URL');
      onUploaded(url);
      toast.success('Image uploaded');
    } catch (e) {
      toast.error(apiErr(e, 'Image upload failed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={e => void pick(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
        {uploading ? 'Uploading...' : 'Upload image'}
      </button>
    </>
  );
}

const BLANK_NEW_PRODUCT = { name: '', description: '', sku: '', priceMajorUnits: '', currency: 'GHS', stockQuantity: '', minOrderQuantity: '', imageUrl: '' };

export default function CommerceProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingNew, setUploadingNew] = useState(false);
  const [newProduct, setNewProduct] = useState({ ...BLANK_NEW_PRODUCT });

  const [selected, setSelected] = useState<Product | null>(null);
  const [edit, setEdit] = useState({ name: '', description: '', priceMajorUnits: '', stockQuantity: '', minOrderQuantity: '', imageUrl: '' });
  const [saving, setSaving] = useState(false);
  const [uploadingEdit, setUploadingEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await commerceProductsApi.list();
      setProducts(res.data as Product[]);
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load products'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openProduct = (p: Product) => {
    setSelected(p);
    setEdit({
      name: p.name,
      description: p.description ?? '',
      priceMajorUnits: String(p.priceMajorUnits),
      stockQuantity: p.stockQuantity === null ? '' : String(p.stockQuantity),
      minOrderQuantity: p.minOrderQuantity === null ? '' : String(p.minOrderQuantity),
      imageUrl: p.imageUrl ?? '',
    });
  };

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
        imageUrl: newProduct.imageUrl || undefined,
        stockQuantity: newProduct.stockQuantity.trim() === '' ? undefined : parseInt(newProduct.stockQuantity, 10),
        minOrderQuantity: newProduct.minOrderQuantity.trim() === '' ? undefined : parseInt(newProduct.minOrderQuantity, 10),
      });
      toast.success(`"${newProduct.name}" added`);
      setShowCreate(false);
      setNewProduct({ ...BLANK_NEW_PRODUCT });
      await load();
    } catch (e) {
      toast.error(apiErr(e, 'Failed to create product'));
    } finally {
      setCreating(false);
    }
  };

  const saveEdits = async () => {
    if (!selected) return;
    if (!edit.name.trim() || edit.priceMajorUnits.trim() === '') {
      toast.error('Name and price are required');
      return;
    }
    setSaving(true);
    try {
      await commerceProductsApi.update(selected.id, {
        name: edit.name.trim(),
        description: edit.description.trim() || null,
        priceMajorUnits: parseFloat(edit.priceMajorUnits) || 0,
        stockQuantity: edit.stockQuantity.trim() === '' ? null : parseInt(edit.stockQuantity, 10),
        minOrderQuantity: edit.minOrderQuantity.trim() === '' ? null : parseInt(edit.minOrderQuantity, 10),
        imageUrl: edit.imageUrl || null,
      });
      toast.success('Product updated');
      setSelected(null);
      await load();
    } catch (e) {
      toast.error(apiErr(e, 'Failed to update product'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (product: Product) => {
    try {
      await commerceProductsApi.update(product.id, { isActive: !product.isActive });
      toast.success(product.isActive ? 'Product deactivated' : 'Product activated');
      setSelected(null);
      await load();
    } catch (e) {
      toast.error(apiErr(e, 'Failed to update product'));
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
        <div className="max-w-5xl mx-auto">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 h-56 animate-pulse" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No products yet — click &quot;Add Product&quot; to create your first one.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map(p => (
                <button
                  key={p.id}
                  onClick={() => openProduct(p)}
                  className={cn(
                    'bg-white rounded-xl border border-gray-100 overflow-hidden text-left hover:shadow-md hover:border-gray-200 transition-all',
                    !p.isActive && 'opacity-60',
                  )}
                >
                  <ProductImage product={p} />
                  <div className="p-3">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-gray-900 text-sm truncate">{p.name}</h3>
                      {!p.isActive && <Ban size={12} className="text-gray-400 shrink-0" />}
                    </div>
                    {p.sku && <div className="text-[11px] text-gray-400 mt-0.5">SKU: {p.sku}</div>}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm font-semibold text-gray-800">{p.currency} {p.priceMajorUnits}</span>
                      <StockBadge stockQuantity={p.stockQuantity} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Product detail / edit modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <ProductImage product={{ ...selected, imageUrl: edit.imageUrl || null }} size="detail" />
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">{selected.name}</h3>
                <StockBadge stockQuantity={selected.stockQuantity} />
                {!selected.isActive && (
                  <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Inactive</span>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between">
                <ImageUploadButton
                  uploading={uploadingEdit}
                  setUploading={setUploadingEdit}
                  onUploaded={url => setEdit(s => ({ ...s, imageUrl: url }))}
                />
                {edit.imageUrl && (
                  <button onClick={() => setEdit(s => ({ ...s, imageUrl: '' }))} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                    Remove image
                  </button>
                )}
              </div>
              <Field label="Name" value={edit.name} onChange={v => setEdit(s => ({ ...s, name: v }))} />
              <Field label="Description" value={edit.description} onChange={v => setEdit(s => ({ ...s, description: v }))} textarea />
              <div className="grid grid-cols-2 gap-4">
                <Field label={`Price (${selected.currency})`} value={edit.priceMajorUnits} onChange={v => setEdit(s => ({ ...s, priceMajorUnits: v }))} type="number" />
                <Field label="Stock qty (blank = unlimited)" value={edit.stockQuantity} onChange={v => setEdit(s => ({ ...s, stockQuantity: v }))} type="number" placeholder="Unlimited" />
              </div>
              <Field label="Min order qty (blank = no minimum)" value={edit.minOrderQuantity} onChange={v => setEdit(s => ({ ...s, minOrderQuantity: v }))} type="number" placeholder="No minimum" />
              {selected.sku && <div className="text-xs text-gray-400">SKU: {selected.sku} · created {new Date(selected.createdAt).toLocaleDateString()}</div>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
              <button
                onClick={() => toggleActive(selected)}
                className={cn(
                  'px-3 py-1.5 text-xs border rounded-lg transition-colors font-medium',
                  selected.isActive
                    ? 'text-red-600 border-red-200 hover:bg-red-50'
                    : 'text-green-600 border-green-200 hover:bg-green-50',
                )}
              >
                {selected.isActive ? 'Deactivate' : 'Activate'}
              </button>
              <div className="flex gap-3">
                <button onClick={() => setSelected(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={saveEdits}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-5 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add product modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-semibold text-gray-900">Add Product</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              {newProduct.imageUrl ? (
                <ProductImage product={{ imageUrl: newProduct.imageUrl, name: newProduct.name || 'New product' }} size="detail" />
              ) : null}
              <ImageUploadButton
                uploading={uploadingNew}
                setUploading={setUploadingNew}
                onUploaded={url => setNewProduct(p => ({ ...p, imageUrl: url }))}
              />
              <Field label="Name" value={newProduct.name} onChange={v => setNewProduct(p => ({ ...p, name: v }))} />
              <Field label="Description (optional)" value={newProduct.description} onChange={v => setNewProduct(p => ({ ...p, description: v }))} textarea />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Price" value={newProduct.priceMajorUnits} onChange={v => setNewProduct(p => ({ ...p, priceMajorUnits: v }))} type="number" />
                <Field label="Currency" value={newProduct.currency} onChange={v => setNewProduct(p => ({ ...p, currency: v.toUpperCase() }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="SKU (optional)" value={newProduct.sku} onChange={v => setNewProduct(p => ({ ...p, sku: v }))} />
                <Field label="Stock qty (blank = unlimited)" value={newProduct.stockQuantity} onChange={v => setNewProduct(p => ({ ...p, stockQuantity: v }))} type="number" placeholder="Unlimited" />
              </div>
              <Field label="Min order qty (blank = no minimum)" value={newProduct.minOrderQuantity} onChange={v => setNewProduct(p => ({ ...p, minOrderQuantity: v }))} type="number" placeholder="No minimum" />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 shrink-0">
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
