'use client';
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { commerceProductsApi, mediaApi } from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import SidePanel from '@/components/ui/SidePanel';
import StatusBadge from '@/components/ui/StatusBadge';
import { Field, inputClasses } from '@/components/ui/fields';
import { formatDate, formatMoney, STOCK_LABEL, stockState } from '@/lib/commerce/format';
import type { Product } from '@/lib/commerce/types';

interface Draft { name: string; description: string; sku: string; price: string; currency: string; stock: string; minOrder: string; imageUrl: string }

const BLANK: Draft = { name: '', description: '', sku: '', price: '', currency: 'GHS', stock: '', minOrder: '', imageUrl: '' };

function toDraft(p: Product): Draft {
  return {
    name: p.name, description: p.description ?? '', sku: p.sku ?? '', price: String(p.priceMajorUnits), currency: p.currency,
    stock: p.stockQuantity == null ? '' : String(p.stockQuantity), minOrder: p.minOrderQuantity == null ? '' : String(p.minOrderQuantity), imageUrl: p.imageUrl ?? '',
  };
}

type Errors = Partial<Record<keyof Draft, string>>;

function validate(d: Draft): Errors {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = 'Enter a product name.';
  const price = Number(d.price);
  if (d.price.trim() === '' || !Number.isFinite(price) || price < 0) errors.price = 'Enter a price of 0 or more.';
  if (d.stock.trim() !== '' && !/^\d+$/.test(d.stock.trim())) errors.stock = 'Use a whole number of 0 or more, or leave it empty to not track stock.';
  if (d.minOrder.trim() !== '' && !/^[1-9]\d*$/.test(d.minOrder.trim())) errors.minOrder = 'Use a whole number of 1 or more, or leave it empty.';
  if (!/^[A-Za-z]{3}$/.test(d.currency.trim())) errors.currency = 'Use a 3-letter currency code, such as GHS.';
  return errors;
}

function Thumb({ product, className }: { product: Pick<Product, 'imageUrl' | 'name'>; className: string }) {
  if (product.imageUrl) {
    // Remote storage URLs are not configured for next/image, so a plain img is used and sized by the caller.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.imageUrl} alt="" className={`${className} object-cover bg-gray-100`} loading="lazy" />;
  }
  return <div aria-hidden="true" className={`${className} bg-gray-100 text-gray-400 flex items-center justify-center`}><Package size={18} /></div>;
}
export { Thumb as ProductThumb };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5 break-words">{children}</dd>
    </div>
  );
}

/** View, edit or create one product. `product` null with `creating` true is the empty creation form. */
export default function ProductPanel({ open, product, creating, defaultCurrency, canEdit, onClose, onSaved }: {
  open: boolean;
  product: Product | null;
  creating: boolean;
  defaultCurrency: string;
  canEdit: boolean;
  onClose: () => void;
  /** Called after a successful save or status change so the list is reloaded from the server. */
  onSaved: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formMode = creating || editing;

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setErrors({});
    setDraft(creating ? { ...BLANK, currency: defaultCurrency } : product ? toDraft(product) : BLANK);
  }, [open, creating, product, defaultCurrency]);

  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await mediaApi.upload(file);
      setDraft((d) => ({ ...d, imageUrl: (res.data as { fileUrl: string }).fileUrl }));
    } catch (e) {
      toast.error(getApiError(e, 'The image could not be uploaded.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      if (creating) {
        await commerceProductsApi.create({
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
          sku: draft.sku.trim() || undefined,
          priceMajorUnits: Number(draft.price),
          currency: draft.currency.trim().toUpperCase(),
          imageUrl: draft.imageUrl || undefined,
          stockQuantity: draft.stock.trim() === '' ? undefined : parseInt(draft.stock, 10),
          minOrderQuantity: draft.minOrder.trim() === '' ? undefined : parseInt(draft.minOrder, 10),
        });
        toast.success(`${draft.name.trim()} was added.`);
      } else if (product) {
        await commerceProductsApi.update(product.id, {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          priceMajorUnits: Number(draft.price),
          stockQuantity: draft.stock.trim() === '' ? null : parseInt(draft.stock, 10),
          minOrderQuantity: draft.minOrder.trim() === '' ? null : parseInt(draft.minOrder, 10),
          imageUrl: draft.imageUrl || null,
        });
        toast.success('Product saved.');
      }
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(getApiError(e, 'The product could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!product) return;
    setSaving(true);
    try {
      await commerceProductsApi.update(product.id, { isActive: !product.isActive });
      toast.success(product.isActive ? `${product.name} was deactivated.` : `${product.name} is active again.`);
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(getApiError(e, 'The product could not be updated.'));
    } finally {
      setSaving(false);
    }
  };

  const footer = formMode ? (
    <>
      <Button variant="secondary" onClick={creating ? onClose : () => { setEditing(false); setErrors({}); if (product) setDraft(toDraft(product)); }} disabled={saving}>Cancel</Button>
      <Button onClick={save} disabled={saving || uploading}>{saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{creating ? 'Add product' : 'Save changes'}</Button>
    </>
  ) : canEdit && product ? (
    <>
      <Button variant={product.isActive ? 'secondary' : 'primary'} onClick={toggleActive} disabled={saving}>{product.isActive ? 'Deactivate' : 'Activate'}</Button>
      <Button onClick={() => setEditing(true)}>Edit</Button>
    </>
  ) : null;

  return (
    <SidePanel
      open={open} onClose={onClose} footer={footer}
      title={creating ? 'Add a product' : product?.name ?? 'Product'}
      description={creating ? 'It appears in your catalogue and can be offered to customers right away.' : product ? (product.sku ? `SKU ${product.sku}` : 'No SKU') : undefined}
    >
      {formMode ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <Field label="Name" error={errors.name}>{(p) => <input {...p} value={draft.name} onChange={(e) => set('name')(e.target.value)} className={inputClasses} autoComplete="off" />}</Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Price" error={errors.price} className="col-span-2">{(p) => <input {...p} value={draft.price} onChange={(e) => set('price')(e.target.value)} inputMode="decimal" className={inputClasses} />}</Field>
            <Field label="Currency" error={errors.currency} hint={creating ? undefined : 'Fixed once created.'}>{(p) => <input {...p} value={draft.currency} onChange={(e) => set('currency')(e.target.value)} maxLength={3} disabled={!creating} className={inputClasses} />}</Field>
          </div>
          <Field label="SKU" hint={creating ? 'Optional. Your own code for this product.' : 'The SKU cannot be changed after the product is created.'}>
            {(p) => <input {...p} value={draft.sku} onChange={(e) => set('sku')(e.target.value)} disabled={!creating} className={inputClasses} autoComplete="off" />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="In stock" error={errors.stock} hint="Leave empty to not track stock.">{(p) => <input {...p} value={draft.stock} onChange={(e) => set('stock')(e.target.value)} inputMode="numeric" className={inputClasses} />}</Field>
            <Field label="Smallest order" error={errors.minOrder} hint="Smaller orders need approval.">{(p) => <input {...p} value={draft.minOrder} onChange={(e) => set('minOrder')(e.target.value)} inputMode="numeric" className={inputClasses} />}</Field>
          </div>
          <Field label="Description">{(p) => <textarea {...p} value={draft.description} onChange={(e) => set('description')(e.target.value)} rows={3} className={inputClasses} />}</Field>
          <div>
            <p className="block text-sm font-medium text-gray-700 mb-1">Photo</p>
            <div className="flex items-center gap-3">
              <Thumb product={{ imageUrl: draft.imageUrl || null, name: draft.name }} className="h-16 w-16 rounded-lg shrink-0" />
              <input ref={fileRef} type="file" accept="image/*" className="sr-only" id="product-photo" onChange={(e) => void upload(e.target.files?.[0])} />
              <label htmlFor="product-photo" className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-within:outline focus-within:outline-2 focus-within:outline-teal-600">
                {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
                {uploading ? 'Uploading' : draft.imageUrl ? 'Replace photo' : 'Upload photo'}
              </label>
              {draft.imageUrl && <Button variant="ghost" size="sm" onClick={() => set('imageUrl')('')}>Remove</Button>}
            </div>
          </div>
        </form>
      ) : product ? (
        <div className="space-y-5">
          <Thumb product={product} className="h-48 w-full rounded-lg" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Detail label="Price">{formatMoney(product.priceMajorUnits, product.currency)}</Detail>
            <Detail label="Status"><StatusBadge tone={product.isActive ? 'success' : 'neutral'}>{product.isActive ? 'Active' : 'Inactive'}</StatusBadge></Detail>
            <Detail label="Stock">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {product.stockQuantity == null ? 'Not tracked' : `${product.stockQuantity.toLocaleString()} left`}
                <StatusBadge tone={STOCK_LABEL[stockState(product)].tone}>{STOCK_LABEL[stockState(product)].label}</StatusBadge>
              </span>
            </Detail>
            <Detail label="Smallest order">{product.minOrderQuantity == null ? 'No minimum' : `${product.minOrderQuantity} (smaller orders need approval)`}</Detail>
            <Detail label="Added">{formatDate(product.createdAt)}</Detail>
            <Detail label="Currency">{product.currency}</Detail>
          </dl>
          <div>
            <h3 className="text-xs text-gray-500">Description</h3>
            <p className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap break-words">{product.description || 'No description added.'}</p>
          </div>
          {!product.isActive && <p className="text-sm text-gray-600 rounded-lg bg-gray-50 border border-gray-200 p-3">This product is inactive. Customers are not offered it, and past orders keep their details.</p>}
        </div>
      ) : null}
    </SidePanel>
  );
}
