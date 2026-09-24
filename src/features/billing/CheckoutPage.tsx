import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import type { Product } from "@/core/types/models";
import { ProductImage } from "@/core/components/ProductImage";
import { Topbar } from "@/core/components/AppShell";
import { Sheet } from "@/core/components/Sheet";
import { BarcodeScanner } from "@/core/components/BarcodeScanner";
import { CartSheet } from "@/features/billing/CartSheet";
import { PaymentSheet } from "@/features/billing/PaymentSheet";
import { ReceiptSheet } from "@/features/billing/ReceiptSheet";
import { useCart } from "@/store/cartStore";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "@/core/components/Toast";
import { computeTotals } from "@/core/utils/totals";
import { productRepo } from "@/features/products/productRepo";
import { formatMoney } from "@/core/utils/format";
import { IconSearch, IconScan, IconCart, IconBox } from "@/core/components/icons";

export function CheckoutPage() {
  const settings = useSettings();
  const { toast } = useToast();
  const products = useLiveQuery(() => db.products.orderBy("name").toArray(), [], []);
  const lines = useCart((s) => s.lines);
  const discount = useCart((s) => s.discount);
  const addProduct = useCart((s) => s.addProduct);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  // Read live so the URA fiscal number shows as soon as it arrives.
  const receipt = useLiveQuery(() => (receiptId ? db.sales.get(receiptId) : undefined), [receiptId]) ?? null;

  const totals = useMemo(() => computeTotals(lines, discount, settings), [lines, discount, settings]);

  const categories = useMemo(() => {
    const names = products.filter((p) => p.active && p.category?.trim()).map((p) => p.category!.trim());
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = products.filter(
      (p) => p.active && (!category || p.category?.trim() === category),
    );
    if (!q) return active;
    return active.filter(
      (p) => p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q) || p.barcode?.includes(q),
    );
  }, [products, query, category]);

  function add(p: Product): boolean {
    if (addProduct(p)) return true;
    toast(`Only ${p.stock} ${p.name} in stock.`, "error");
    return false;
  }

  async function onScan(code: string) {
    const p = await productRepo.findByBarcode(code);
    if (!p) {
      toast(`No product with barcode ${code}. Add it in Products.`, "error");
    } else if (!p.active) {
      toast(`${p.name} is inactive.`, "error");
    } else if (p.stock <= 0) {
      toast(`${p.name} is out of stock.`, "error");
    } else if (add(p)) {
      toast(`Added ${p.name}`, "success");
    }
  }

  return (
    <>
      <Topbar
        title="Checkout"
        subtitle={settings.name}
        right={
          <button className="btn btn-ghost btn-icon" onClick={() => setScanOpen(true)} aria-label="Scan barcode">
            <IconScan />
          </button>
        }
      />
      <div className="page">
        <div className="search-bar">
          <IconSearch />
          <input className="input" placeholder="Search products to add"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {categories.length > 1 && (
          <div className="chip-row">
            <button className={`btn btn-sm ${category === null ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setCategory(null)}>All</button>
            {categories.map((c) => (
              <button key={c} className={`btn btn-sm ${category === c ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setCategory(category === c ? null : c)}>{c}</button>
            ))}
          </div>
        )}

        {products.length === 0 ? (
          <div className="empty">
            <IconBox />
            <p>No products yet. Add products first, then sell.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty"><IconSearch /><p>{query ? `No products match “${query}”.` : "No products in this category."}</p></div>
        ) : (
          <div className="prod-grid">
            {filtered.map((p) => (
              <button key={p.id} className="prod-tile" onClick={() => add(p)} disabled={p.stock <= 0}>
                <ProductImage product={p} size={48} />
                <span className="name">{p.name}</span>
                <span className="price">{formatMoney(p.price, settings.currencySymbol)}</span>
                <span className="stockline">
                  {p.stock <= 0 ? "Out of stock" : `${p.stock} in stock`}
                  {p.category ? ` · ${p.category}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <div className="cart-bar">
          <button className="btn btn-primary btn-block btn-lg" onClick={() => setCartOpen(true)}>
            <IconCart /> View cart · {totals.itemCount} item(s) · {formatMoney(totals.total, settings.currencySymbol)}
          </button>
        </div>
      )}

      <Sheet open={scanOpen} onClose={() => setScanOpen(false)} title="Scan to add">
        {scanOpen && <BarcodeScanner onDetected={onScan} onClose={() => setScanOpen(false)} />}
      </Sheet>

      <CartSheet open={cartOpen} onClose={() => setCartOpen(false)} shop={settings}
        onPay={() => { setCartOpen(false); setPayOpen(true); }} />

      <PaymentSheet open={payOpen} onClose={() => setPayOpen(false)} shop={settings}
        onComplete={(sale) => { setPayOpen(false); setReceiptId(sale.id); toast("Sale completed!", "success"); }} />

      <ReceiptSheet sale={receipt} shop={settings} open={!!receiptId}
        onClose={() => setReceiptId(null)} onNewSale={() => setReceiptId(null)} />
    </>
  );
}
