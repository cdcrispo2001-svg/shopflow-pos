import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import type { Sale } from "@/core/types/models";
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
  const [scanOpen, setScanOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const totals = useMemo(() => computeTotals(lines, discount, settings), [lines, discount, settings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = products.filter((p) => p.active);
    if (!q) return active;
    return active.filter(
      (p) => p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q) || p.barcode?.includes(q),
    );
  }, [products, query]);

  async function onScan(code: string) {
    const p = await productRepo.findByBarcode(code);
    if (p) {
      addProduct(p);
      toast(`Added ${p.name}`, "success");
    } else {
      toast(`No product with barcode ${code}. Add it in Products.`, "error");
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

        {products.length === 0 ? (
          <div className="empty">
            <IconBox />
            <p>No products yet. Add products first, then sell.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty"><IconSearch /><p>No products match “{query}”.</p></div>
        ) : (
          <div className="prod-grid">
            {filtered.map((p) => (
              <button key={p.id} className="prod-tile" onClick={() => addProduct(p)} disabled={p.stock <= 0}>
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
        onComplete={(sale) => { setPayOpen(false); setReceipt(sale); toast("Sale completed!", "success"); }} />

      <ReceiptSheet sale={receipt} shop={settings} open={!!receipt}
        onClose={() => setReceipt(null)} onNewSale={() => setReceipt(null)} />
    </>
  );
}
