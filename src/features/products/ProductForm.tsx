import { useState } from "react";
import type { Product } from "@/core/types/models";
import { productRepo, type ProductInput } from "@/features/products/productRepo";
import { useToast } from "@/core/components/Toast";
import { Sheet } from "@/core/components/Sheet";
import { BarcodeScanner } from "@/core/components/BarcodeScanner";
import { IconScan, IconTrash } from "@/core/components/icons";

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
  const [form, setForm] = useState<ProductInput>(empty(defaultTaxRate));
  const [scan, setScan] = useState(false);
  const [initFor, setInitFor] = useState<string | null>(null);

  // sync form when the sheet opens for a new target (edit vs create)
  const key = editing?.id ?? `new:${prefillBarcode ?? ""}`;
  if (open && initFor !== key) {
    setInitFor(key);
    setForm(
      editing
        ? { ...editing }
        : empty(defaultTaxRate, prefillBarcode ?? ""),
    );
  }

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const num = (v: string) => (v === "" ? 0 : Number(v));

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

    const res = editing
      ? await productRepo.update(editing.id, form)
      : await productRepo.create(form);

    if (res.ok) {
      toast(editing ? "Product updated." : "Product added.", "success");
      onClose();
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
      onClose();
    } else toast(res.error.message, "error");
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Edit product" : "Add product"}>
      {scan ? (
        <BarcodeScanner
          onClose={() => setScan(false)}
          onDetected={(code) => {
            set("barcode", code);
            setScan(false);
            toast("Barcode captured.", "success");
          }}
        />
      ) : (
        <>
          <div className="field">
            <label>Product name *</label>
            <input className="input" value={form.name} placeholder="e.g. Sugar 1kg"
              onChange={(e) => set("name", e.target.value)} autoFocus />
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
