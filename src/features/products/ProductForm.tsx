import { useState } from "react";
import type { Product } from "@/core/types/models";
import { productRepo, type ProductInput } from "@/features/products/productRepo";
import { useToast } from "@/core/components/Toast";
import { Sheet } from "@/core/components/Sheet";
import { BarcodeScanner } from "@/core/components/BarcodeScanner";
import { ProductImage } from "@/core/components/ProductImage";
import { IMAGE_NONE, catalogImage, matchProductImage } from "@/core/catalog/productImages";
import { ImagePicker } from "@/features/products/ImagePicker";
import { EfrisProductFields } from "@/features/efris/EfrisProductFields";
import { useEfrisActive } from "@/features/efris/efrisStore";
import { IconScan, IconTrash, IconImage } from "@/core/components/icons";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Product | null;
  defaultTaxRate: number;
  prefillBarcode?: string;
}

const empty = (taxRate: number, barcode = ""): ProductInput => ({
  name: "",
  barcode,
  category: "",
  price: 0,
  cost: 0,
  stock: 0,
  lowStockAt: 5,
  taxRate,
  active: true,
});

export function ProductForm({ open, onClose, editing, defaultTaxRate, prefillBarcode }: Props) {
  const { toast } = useToast();
  const efrisActive = useEfrisActive();
  const [form, setForm] = useState<ProductInput>(empty(defaultTaxRate));
  const [scan, setScan] = useState(false);
  const [picking, setPicking] = useState(false);
  // Until the user picks a picture, it follows the product name as they type.
  const [imageChosen, setImageChosen] = useState(false);
  const [initFor, setInitFor] = useState<string | null>(null);

  // sync form when the sheet opens for a new target (edit vs create)
  const key = editing?.id ?? `new:${prefillBarcode ?? ""}`;
  if (open && initFor !== key) {
    setInitFor(key);
    setForm(editing ? { ...editing } : empty(defaultTaxRate, prefillBarcode ?? ""));
    setImageChosen(!!editing && (editing.imageKey !== undefined || editing.photo !== undefined));
    setScan(false);
    setPicking(false);
  }

  function close() {
    setInitFor(null);
    onClose();
  }

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const num = (v: string) => (v === "" ? 0 : Number(v));

  const autoImage = imageChosen ? undefined : matchProductImage(form.name, form.category);
  const imageKey = imageChosen ? form.imageKey : autoImage?.key;
  const preview = { name: form.name || "?", category: form.category, photo: form.photo, imageKey: imageKey ?? IMAGE_NONE };
  const imageCaption = form.photo
    ? "Your photo"
    : !imageChosen
      ? autoImage ? `Matched from the name: ${autoImage.label}` : "Type a name and a picture is picked for you"
      : imageKey === IMAGE_NONE ? "No picture" : catalogImage(imageKey)?.label ?? "Picture";

  async function save() {
    if (!form.name.trim()) return toast("Product name is required.", "error");
    if (!Number.isFinite(form.price) || form.price <= 0) {
      return toast("Selling price must be a finite number greater than 0.", "error");
    }
    if (!Number.isFinite(form.cost) || form.cost < 0) {
      return toast("Cost price must be a finite nonnegative number.", "error");
    }
    if (!Number.isSafeInteger(form.stock) || form.stock < 0) {
      return toast("Stock must be a nonnegative whole number.", "error");
    }
    if (!Number.isSafeInteger(form.lowStockAt) || form.lowStockAt < 0) {
      return toast("Low-stock threshold must be a nonnegative whole number.", "error");
    }
    if (!Number.isFinite(form.taxRate) || form.taxRate < 0 || form.taxRate > 100) {
      return toast("Tax rate must be between 0 and 100.", "error");
    }

    const input: ProductInput = { ...form, imageKey };
    const res = editing
      ? await productRepo.update(editing.id, input)
      : await productRepo.create(input);

    if (res.ok) {
      toast(editing ? "Product updated." : "Product added.", "success");
      close();
    } else {
      toast(res.error.message, "error");
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirm(`Delete "${editing.name}"? This cannot be undone.`)) return;
    const res = await productRepo.remove(editing.id);
    if (res.ok) {
      toast("Product deleted.", "success");
      close();
    } else toast(res.error.message, "error");
  }

  const title = picking ? "Choose a picture" : editing ? "Edit product" : "Add product";

  return (
    <Sheet open={open} onClose={close} title={title}>
      {scan ? (
        <BarcodeScanner
          onClose={() => setScan(false)}
          onDetected={(code) => {
            set("barcode", code);
            setScan(false);
            toast("Barcode captured.", "success");
          }}
        />
      ) : picking ? (
        <ImagePicker
          name={form.name}
          category={form.category}
          selectedKey={imageKey}
          onClose={() => setPicking(false)}
          onPick={(pickedKey) => {
            setForm((f) => ({ ...f, imageKey: pickedKey, photo: undefined }));
            setImageChosen(true);
            setPicking(false);
          }}
          onPhoto={(photo) => {
            setForm((f) => ({ ...f, imageKey, photo }));
            setImageChosen(true);
            setPicking(false);
          }}
        />
      ) : (
        <>
          <div className="image-field">
            <button type="button" className="image-field-preview" onClick={() => setPicking(true)} aria-label="Change picture">
              <ProductImage product={preview} size={76} />
            </button>
            <div className="col grow">
              <span className="small muted">{imageCaption}</span>
              <div className="row gap-8 mt-8 wrap">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
                  <IconImage /> {form.photo || imageChosen ? "Change picture" : "Choose picture"}
                </button>
                {form.photo && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("photo", undefined)}>
                    Remove photo
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Product name *</label>
            <input className="input" value={form.name} placeholder="e.g. Sugar 1kg"
              onChange={(e) => set("name", e.target.value)} autoFocus={!editing} />
          </div>

          <div className="field">
            <label>Barcode / SKU</label>
            <div className="row">
              <input className="input grow" value={form.barcode ?? ""} placeholder="Scan or type"
                onChange={(e) => set("barcode", e.target.value)} />
              <button className="btn btn-ghost btn-icon" onClick={() => setScan(true)} aria-label="Scan barcode">
                <IconScan />
              </button>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Selling price *</label>
              <input className="input" type="number" inputMode="decimal" value={form.price || ""}
                onChange={(e) => set("price", num(e.target.value))} />
            </div>
            <div className="field">
              <label>Cost price</label>
              <input className="input" type="number" inputMode="decimal" value={form.cost || ""}
                onChange={(e) => set("cost", num(e.target.value))} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Stock qty</label>
              <input className="input" type="number" inputMode="numeric" value={form.stock || ""}
                onChange={(e) => set("stock", num(e.target.value))} />
            </div>
            <div className="field">
              <label>Low-stock alert at</label>
              <input className="input" type="number" inputMode="numeric" value={form.lowStockAt || ""}
                onChange={(e) => set("lowStockAt", num(e.target.value))} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Category</label>
              <input className="input" value={form.category ?? ""} placeholder="e.g. Groceries"
                onChange={(e) => set("category", e.target.value)} />
            </div>
            <div className="field">
              <label>Tax rate %</label>
              <input className="input" type="number" inputMode="decimal" value={form.taxRate || ""}
                onChange={(e) => set("taxRate", num(e.target.value))} />
            </div>
          </div>

          {efrisActive && (
            <EfrisProductFields
              value={form.efris}
              barcode={form.barcode}
              taxRate={form.taxRate}
              onChange={(efris) => set("efris", efris)}
            />
          )}

          <div className="switch-row" style={{ paddingTop: 0 }}>
            <div className="col">
              <span>Active</span>
              <span className="small muted">Inactive products are hidden from checkout</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
              <span className="track" />
            </label>
          </div>

          <button className="btn btn-primary btn-block btn-lg mt-8" onClick={save}>
            {editing ? "Save changes" : "Add product"}
          </button>
          {editing && (
            <button className="btn btn-danger btn-block mt-8" onClick={remove}>
              <IconTrash /> Delete product
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}
