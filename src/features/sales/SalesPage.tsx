import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import type { Sale, SalePayment } from "@/core/types/models";
import { Topbar } from "@/core/components/AppShell";
import { Sheet } from "@/core/components/Sheet";
import { ReceiptSheet } from "@/features/billing/ReceiptSheet";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "@/core/components/Toast";
import { saleRepo } from "@/features/sales/saleRepo";
import { outstandingCredit, paymentMethodLabel } from "@/features/sales/reports";
import { useEfrisActive } from "@/features/efris/efrisStore";
import { submitCreditNote } from "@/features/efris/efrisQueue";
import { SaleEfrisPanel } from "@/features/efris/SaleEfrisPanel";
import { formatMoney } from "@/core/utils/format";
import { downloadCsvReport } from "@/core/utils/backup";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import {
  IconSearch, IconReceipt, IconBackup, IconPrint, IconTrash, IconWallet, IconCheck,
} from "@/core/components/icons";

type View = "all" | "credit" | "efris";

const REPAY_METHODS: SalePayment["method"][] = ["cash", "mobile_money", "card"];

function dayLabel(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, d MMM yyyy");
}

const owes = (s: Sale) => s.status === "completed" && (s.balanceDue ?? 0) > 0;

/** Sales that still need something from URA: upload, fixing, or a credit note. */
const needsUra = (s: Sale) =>
  s.status === "completed"
    ? s.efris?.status === "pending" || s.efris?.status === "failed"
    : s.efris?.status === "fiscalised" && !s.efris.creditNote;

const URA_PILL: Record<string, [string, string]> = {
  pending: ["URA …", "pill-warn"],
  failed: ["URA ✕", "pill-danger"],
  fiscalised: ["URA ✓", "pill-ok"],
};

export function SalesPage() {
  const settings = useSettings();
  const sym = settings.currencySymbol;
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const efrisActive = useEfrisActive();
  const requested = params.get("view");
  const view: View = requested === "credit" ? "credit" : requested === "efris" && efrisActive ? "efris" : "all";
  const sales = useLiveQuery(() => db.sales.orderBy("createdAt").reverse().toArray(), [], []);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayMethod, setRepayMethod] = useState<SalePayment["method"]>("cash");
  const [busy, setBusy] = useState(false);

  // Derived from the live query so repayments/voids show immediately.
  const selected = useMemo(() => sales.find((s) => s.id === selectedId) ?? null, [sales, selectedId]);
  const credit = useMemo(() => outstandingCredit(sales), [sales]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Owed and URA views list the oldest first — those need attention soonest.
    const base = view === "credit" ? sales.filter(owes).reverse()
      : view === "efris" ? sales.filter(needsUra).reverse()
        : sales;
    if (!q) return base;
    return base.filter(
      (s) => s.receiptNo.toLowerCase().includes(q) ||
        s.customerName?.toLowerCase().includes(q) ||
        s.customerPhone?.includes(q) ||
        s.items.some((i) => i.name.toLowerCase().includes(q)),
    );
  }, [sales, query, view]);

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

  function setView(next: View) {
    setParams(next === "all" ? {} : { view: next }, { replace: true });
  }

  const uraCount = useMemo(() => (efrisActive ? sales.filter(needsUra).length : 0), [sales, efrisActive]);

  function open(sale: Sale) {
    setSelectedId(sale.id);
    setRepayAmount("");
    setRepayMethod("cash");
  }

  async function cancelSale(sale: Sale, mode: "voided" | "refunded") {
    const verb = mode === "voided" ? "Void" : "Refund";
    const fiscalised = sale.efris?.status === "fiscalised" && !sale.efris.creditNote;
    const note = fiscalised ? " A credit note will be submitted to URA first (needs internet)." : "";
    if (!confirm(`${verb} receipt ${sale.receiptNo}? Stock will be returned to inventory.${note}`)) return;
    if (fiscalised) {
      try {
        const reference = await submitCreditNote(sale.id, mode);
        toast(`URA credit note submitted (ref ${reference}).`, "success");
      } catch (error) {
        return toast(`Not ${mode}: ${error instanceof Error ? error.message : "URA credit note failed."}`, "error");
      }
    }
    const res = await saleRepo.voidSale(sale.id, mode);
    if (res.ok) {
      toast(`Sale ${mode}, stock restored.`, "success");
      setSelectedId(null);
    } else toast(res.error.message, "error");
  }

  async function recordRepayment(sale: Sale) {
    const amount = Number(repayAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast("Enter the amount received.", "error");
    setBusy(true);
    const res = await saleRepo.recordPayment(sale.id, amount, repayMethod);
    setBusy(false);
    if (res.ok) {
      setRepayAmount("");
      const left = res.value.balanceDue ?? 0;
      toast(left > 0 ? `Payment recorded. ${formatMoney(left, sym)} still owed.` : "Paid in full.", "success");
    } else toast(res.error.message, "error");
  }

  const selectedBalance = selected?.balanceDue ?? 0;

  return (
    <>
      <Topbar
        title="Sales"
        subtitle={view === "credit"
          ? `${formatMoney(credit.amount, sym)} owed by ${credit.customers} customer(s)`
          : `${sales.length} receipt(s)`}
        right={
          <button className="btn btn-ghost btn-icon" aria-label="Export CSV"
            onClick={async () => {
              const r = await downloadCsvReport(sym);
              toast(r.ok ? "Sales CSV downloaded." : r.error.message, r.ok ? "success" : "error");
            }}>
            <IconBackup />
          </button>
        }
      />
      <div className="page">
        <div className="row gap-8" style={{ marginBottom: 12 }}>
          <button className={`btn btn-sm grow ${view === "all" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setView("all")}>All receipts</button>
          <button className={`btn btn-sm grow ${view === "credit" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setView("credit")}>
            Owed{credit.receipts > 0 ? ` (${credit.receipts})` : ""}
          </button>
          {efrisActive && (
            <button className={`btn btn-sm grow ${view === "efris" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setView("efris")}>
              URA{uraCount > 0 ? ` (${uraCount})` : ""}
            </button>
          )}
        </div>

        <div className="search-bar">
          <IconSearch />
          <input className="input" placeholder="Search receipt, customer, phone or item"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            {view === "credit" ? <IconWallet /> : <IconReceipt />}
            <p>
              {query ? "No matching sales."
                : view === "credit" ? "Nobody owes you money. Credit sales will appear here."
                  : view === "efris" ? "Every sale has reached URA."
                    : "No sales recorded yet."}
            </p>
          </div>
        ) : view === "credit" ? (
          filtered.map((s) => (
            <button key={s.id} className="list-item full" style={{ textAlign: "left" }} onClick={() => open(s)}>
              <div className="thumb" style={{ background: "rgba(245,158,11,0.16)", color: "#fcd34d" }}>
                <IconWallet width={18} height={18} />
              </div>
              <div className="grow col">
                <span className="bold">{s.customerName || "Unnamed customer"}</span>
                <span className="small muted">
                  {s.receiptNo} · {formatDistanceToNowStrict(s.createdAt, { addSuffix: true })}
                  {s.customerPhone ? ` · ${s.customerPhone}` : ""}
                </span>
              </div>
              <div className="col right">
                <span className="bold" style={{ color: "var(--accent)" }}>{formatMoney(s.balanceDue ?? 0, sym)}</span>
                <span className="small dim">of {formatMoney(s.total, sym)}</span>
              </div>
            </button>
          ))
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="between section-title">
                <span>{g.label}</span>
                <span style={{ color: "var(--primary)" }}>{formatMoney(g.total, sym)}</span>
              </div>
              {g.sales.map((s) => (
                <button key={s.id} className="list-item full" style={{ textAlign: "left" }} onClick={() => open(s)}>
                  <div className="thumb"><IconReceipt width={18} height={18} /></div>
                  <div className="grow col">
                    <span className="bold">{s.receiptNo}{s.customerName ? ` · ${s.customerName}` : ""}</span>
                    <span className="small muted">
                      {format(s.createdAt, "HH:mm")} · {s.items.length} item(s) · {paymentMethodLabel(s.paymentMethod)}
                    </span>
                  </div>
                  <div className="col right">
                    <span className="bold">{formatMoney(s.total, sym)}</span>
                    {s.status !== "completed" && <span className="pill pill-danger">{s.status}</span>}
                    {owes(s) && <span className="pill pill-warn">owes {formatMoney(s.balanceDue ?? 0, sym)}</span>}
                    {s.efris && URA_PILL[s.efris.status] && (
                      <span className={`pill ${URA_PILL[s.efris.status][1]}`}>{URA_PILL[s.efris.status][0]}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Sale detail sheet */}
      <Sheet open={!!selected} onClose={() => setSelectedId(null)} title={selected?.receiptNo}>
        {selected && (
          <>
            <p className="small muted">
              {format(selected.createdAt, "EEE, d MMM yyyy 'at' HH:mm")}
              {selected.customerName ? ` · ${selected.customerName}` : ""}
              {selected.customerPhone ? ` · ${selected.customerPhone}` : ""}
            </p>
            {selected.status !== "completed" && (
              <span className="pill pill-danger mt-8">{selected.status.toUpperCase()}</span>
            )}
            <div className="mt-16">
              {selected.items.map((it, i) => (
                <div key={i} className="between" style={{ padding: "6px 0" }}>
                  <span>{it.qty} × {it.name}</span>
                  <span>{formatMoney(it.lineTotal, sym)}</span>
                </div>
              ))}
            </div>
            <div className="card-flat mt-8" style={{ padding: 14 }}>
              <div className="between"><span className="muted">Subtotal</span><span>{formatMoney(selected.subtotal, sym)}</span></div>
              {selected.taxTotal > 0 && <div className="between mt-8"><span className="muted">Tax</span><span>{formatMoney(selected.taxTotal, sym)}</span></div>}
              {selected.discount > 0 && <div className="between mt-8"><span className="muted">Discount</span><span>−{formatMoney(selected.discount, sym)}</span></div>}
              <div className="between mt-8 bold" style={{ fontSize: 18 }}>
                <span>Total</span><span style={{ color: "var(--primary)" }}>{formatMoney(selected.total, sym)}</span>
              </div>
              <div className="between mt-8 small muted">
                <span>Paid by</span><span>{paymentMethodLabel(selected.paymentMethod)}</span>
              </div>
              <div className="between mt-8 small muted"><span>Profit</span><span>{formatMoney(selected.profit, sym)}</span></div>
            </div>

            {selected.paymentMethod === "credit" && selected.balanceDue !== undefined && (
              <div className="card-flat mt-8" style={{ padding: 14 }}>
                <div className="between"><span className="muted">Paid so far</span><span>{formatMoney(selected.amountPaid, sym)}</span></div>
                <div className="between mt-8 bold">
                  <span>Balance due</span>
                  <span style={{ color: selectedBalance > 0 ? "var(--accent)" : "var(--success)" }}>
                    {selectedBalance > 0 ? formatMoney(selectedBalance, sym) : "Paid in full"}
                  </span>
                </div>
                {(selected.payments ?? []).map((p) => (
                  <div key={p.id} className="between mt-8 small muted">
                    <span>{format(p.createdAt, "d MMM yyyy, HH:mm")} · {paymentMethodLabel(p.method)}</span>
                    <span>+{formatMoney(p.amount, sym)}</span>
                  </div>
                ))}

                {owes(selected) && (
                  <>
                    <div className="field mt-16">
                      <label>Record a payment</label>
                      <div className="row">
                        <input className="input grow" type="number" inputMode="decimal" value={repayAmount}
                          placeholder={String(selectedBalance)} onChange={(e) => setRepayAmount(e.target.value)} />
                        <button className="btn btn-ghost btn-sm" onClick={() => setRepayAmount(String(selectedBalance))}>
                          Full
                        </button>
                      </div>
                    </div>
                    <div className="row gap-8">
                      {REPAY_METHODS.map((m) => (
                        <button key={m} className={`btn btn-sm grow ${repayMethod === m ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => setRepayMethod(m)}>{paymentMethodLabel(m)}</button>
                      ))}
                    </div>
                    <button className="btn btn-accent btn-block mt-8" disabled={busy} onClick={() => recordRepayment(selected)}>
                      <IconCheck /> {busy ? "Saving…" : "Record payment"}
                    </button>
                  </>
                )}
              </div>
            )}

            <SaleEfrisPanel sale={selected} />

            <button className="btn btn-primary btn-block mt-16" onClick={() => setShowReceipt(true)}>
              <IconPrint /> View / print receipt
            </button>
            {selected.status === "completed" && (
              <div className="row gap-8 mt-8">
                <button className="btn btn-ghost grow" onClick={() => cancelSale(selected, "refunded")}>
                  Refund
                </button>
                <button className="btn btn-danger grow" onClick={() => cancelSale(selected, "voided")}>
                  <IconTrash /> Void
                </button>
              </div>
            )}
          </>
        )}
      </Sheet>

      <ReceiptSheet sale={selected} shop={settings} open={showReceipt && !!selected} onClose={() => setShowReceipt(false)} />
    </>
  );
}
