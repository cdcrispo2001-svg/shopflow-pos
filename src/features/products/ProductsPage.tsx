import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import type { Product } from "@/core/types/models";
import { Topbar } from "@/core/components/AppShell";
import { ProductForm } from "@/features/products/ProductForm";
import { Sheet } from "@/core/components/Sheet";
import { BarcodeScanner } from "@/core/components/BarcodeScanner";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "@/core/components/Toast";
import { formatMoney } from "@/core/utils/format";
import { productRepo } from "@/features/products/productRepo";
import { seedSampleProducts } from "@/core/db/seed";
import {
  IconPlus, IconSearch, IconScan, IconBox, IconAlert, IconEdit,
} from "@/core/components/icons";

export function ProductsPage() {
  const settings = useSettings();
  const { toast } = useToast();
  const products = useLiveQuery(() => db.products.orderBy("name").toArray(), [], []);

  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [prefill, setPrefill] = useState<string | undefined>();
  const [scanOpen, setScanOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.barcode?.includes(q),
    );
  }, [products, query]);

  const lowStock = products.filter((p) => p.stock <= p.lowStockAt).length;

  function openNew(barcode?: string) {
    setEditing(null);
    setPrefill(barcode);
    setFormOpen(true);
  }

  async function onScan(code: string) {
    setScanOpen(false);
    const existing = await productRepo.findByBarcode(code);
    if (existing) {
      setEditing(existing);
      setFormOpen(true);
      toast(`Found "${existing.name}".`, "info");
    } else {
      openNew(code);
      toast("New barcode — fill in the details.", "info");
    }
  }

  return (
    <>
      <Topbar
        title="Products"
        subtitle={`${products.length} items${lowStock ? ` · ${lowStock} low` : ""}`}
        right={
          <button className="btn btn-ghost btn-icon" onClick={() => setScanOpen(true)} aria-label="Scan to find or add">
            <IconScan />
          </button>
        }
      />
      <div className="page">
        <div className="search-bar">
          <IconSearch />
          <input className="input" placeholder="Search name, category or barcode"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {lowStock > 0 && (
          <div className="pill pill-warn mt-8" style={{ marginBottom: 12 }}>
            <IconAlert width={13} height={13} /> {lowStock} product(s) at or below low-stock level
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="empty">
            <IconBox />
            <p>{query ? "No products match your search." : "No products yet."}</p>
            {!query && (
              <div className="col gap-8 mt-16" style={{ alignItems: "center" }}>
                <button className="btn btn-primary" onClick={() => openNew()}><IconPlus /> Add your first product</button>
                <button className="btn btn-ghost btn-sm" onClick={async () => {
                  const n = await seedSampleProducts();
                  toast(`Loaded ${n} sample products.`, "success");
                }}>Load sample products</button>
              </div>
            )}
          </div>
        ) : (
          filtered.map((p) => (
            <button key={p.id} className="list-item full" style={{ textAlign: "left" }}
              onClick={() => { setEditing(p); setPrefill(undefined); setFormOpen(true); }}>
              <div className="thumb">{p.name.slice(0, 2).toUpperCase()}</div>
              <div className="grow col">
                <span className="bold">{p.name}</span>
                <span className="small muted">
                  {formatMoney(p.price, settings.currencySymbol)}
                  {p.category ? ` · ${p.category}` : ""}
                </span>
              </div>
              <div className="col right">
                <span className={`pill ${p.stock <= 0 ? "pill-danger" : p.stock <= p.lowStockAt ? "pill-warn" : "pill-ok"}`}>
                  {p.stock} in stock
                </span>
                <IconEdit width={15} height={15} className="dim" style={{ marginTop: 6, marginLeft: "auto" }} />
              </div>
            </button>
          ))
        )}
      </div>

      <button className="fab" onClick={() => openNew()} aria-label="Add product"><IconPlus /></button>

      <ProductForm
        open={formOpen}
        editing={editing}
        prefillBarcode={prefill}
        defaultTaxRate={settings.defaultTaxRate}
        onClose={() => setFormOpen(false)}
      />

      <Sheet open={scanOpen} onClose={() => setScanOpen(false)} title="Scan product">
        {scanOpen && <BarcodeScanner onDetected={onScan} onClose={() => setScanOpen(false)} />}
      </Sheet>
    </>
  );
}
