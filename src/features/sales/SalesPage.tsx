import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import type { Sale } from "@/core/types/models";
import { Topbar } from "@/core/components/AppShell";
import { Sheet } from "@/core/components/Sheet";
import { ReceiptSheet } from "@/features/billing/ReceiptSheet";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "@/core/components/Toast";
import { saleRepo } from "@/features/sales/saleRepo";
import { formatMoney } from "@/core/utils/format";
import { downloadCsvReport } from "@/core/utils/backup";
import { format, isToday, isYesterday } from "date-fns";
import {
  IconSearch, IconReceipt, IconBackup, IconPrint, IconTrash,
} from "@/core/components/icons";

function dayLabel(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, d MMM yyyy");
}

export function SalesPage() {
  const settings = useSettings();
  const { toast } = useToast();
  const sales = useLiveQuery(() => db.sales.orderBy("createdAt").reverse().toArray(), [], []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Sale | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter(
      (s) => s.receiptNo.toLowerCase().includes(q) ||
        s.customerName?.toLowerCase().includes(q) ||
        s.items.some((i) => i.name.toLowerCase().includes(q)),
    );
  }, [sales, query]);

  // group by day
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; total: number; sales: Sale[] }>();
    for (const s of filtered) {
      const key = new Date(s.createdAt).toDateString();
      const g = map.get(key) ?? { label: dayLabel(s.createdAt), total: 0, sales: [] };
      if (s.status === "completed") g.total += s.total;
      g.sales.push(s);
      map.set(key, g);
    }
    return [...map.values()];
  }, [filtered]);

  async function voidSale(sale: Sale) {
    if (!confirm(`Void receipt ${sale.receiptNo}? Stock will be returned to inventory.`)) return;
    const res = await saleRepo.voidSale(sale.id, "voided");
    if (res.ok) {
      toast("Sale voided, stock restored.", "success");
      setSelected(null);
    } else toast(res.error.message, "error");
  }

  return (
    <>
      <Topbar
        title="Sales"
        subtitle={`${sales.length} receipt(s)`}
        right={
          <button className="btn btn-ghost btn-icon" aria-label="Export CSV"
            onClick={async () => {
              const r = await downloadCsvReport(settings.currencySymbol);
              toast(r.ok ? "Sales CSV downloaded." : r.error.message, r.ok ? "success" : "error");
            }}>
            <IconBackup />
          </button>
        }
      />
      <div className="page">
        <div className="search-bar">
          <IconSearch />
          <input className="input" placeholder="Search receipt, customer or item"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {filtered.length === 0 ? (
          <div className="empty"><IconReceipt /><p>{query ? "No matching sales." : "No sales recorded yet."}</p></div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="between section-title">
                <span>{g.label}</span>
                <span style={{ color: "var(--primary)" }}>{formatMoney(g.total, settings.currencySymbol)}</span>
              </div>
              {g.sales.map((s) => (
                <button key={s.id} className="list-item full" style={{ textAlign: "left" }}
                  onClick={() => setSelected(s)}>
                  <div className="thumb"><IconReceipt width={18} height={18} /></div>
                  <div className="grow col">
                    <span className="bold">{s.receiptNo}</span>
                    <span className="small muted">
                      {format(s.createdAt, "HH:mm")} · {s.items.length} item(s) · {s.paymentMethod.replace("_", " ")}
                    </span>
                  </div>
                  <div className="col right">
                    <span className="bold">{formatMoney(s.total, settings.currencySymbol)}</span>
                    {s.status !== "completed" && <span className="pill pill-danger">{s.status}</span>}
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Sale detail sheet */}
      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected?.receiptNo}>
        {selected && (
          <>
            <p className="small muted">{format(selected.createdAt, "EEE, d MMM yyyy 'at' HH:mm")}</p>
            {selected.status !== "completed" && (
              <span className="pill pill-danger mt-8">{selected.status.toUpperCase()}</span>
            )}
            <div className="mt-16">
              {selected.items.map((it, i) => (
                <div key={i} className="between" style={{ padding: "6px 0" }}>
                  <span>{it.qty} × {it.name}</span>
                  <span>{formatMoney(it.lineTotal, settings.currencySymbol)}</span>
                </div>
              ))}
            </div>
            <div className="card-flat mt-8" style={{ padding: 14 }}>
              <div className="between"><span className="muted">Subtotal</span><span>{formatMoney(selected.subtotal, settings.currencySymbol)}</span></div>
              {selected.taxTotal > 0 && <div className="between mt-8"><span className="muted">Tax</span><span>{formatMoney(selected.taxTotal, settings.currencySymbol)}</span></div>}
              {selected.discount > 0 && <div className="between mt-8"><span className="muted">Discount</span><span>−{formatMoney(selected.discount, settings.currencySymbol)}</span></div>}
              <div className="between mt-8 bold" style={{ fontSize: 18 }}>
                <span>Total</span><span style={{ color: "var(--primary)" }}>{formatMoney(selected.total, settings.currencySymbol)}</span>
              </div>
              <div className="between mt-8 small muted"><span>Profit</span><span>{formatMoney(selected.profit, settings.currencySymbol)}</span></div>
            </div>

            <button className="btn btn-primary btn-block mt-16" onClick={() => setShowReceipt(true)}>
              <IconPrint /> View / print receipt
            </button>
            {selected.status === "completed" && (
              <button className="btn btn-danger btn-block mt-8" onClick={() => voidSale(selected)}>
                <IconTrash /> Void sale & restore stock
              </button>
            )}
          </>
        )}
      </Sheet>

      <ReceiptSheet sale={selected} shop={settings} open={showReceipt} onClose={() => setShowReceipt(false)} />
    </>
  );
}
