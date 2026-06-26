import { useMemo, useState } from "react";
import type { PaymentMethod, Sale, ShopSettings } from "@/core/types/models";
import { Sheet } from "@/core/components/Sheet";
import { useToast } from "@/core/components/Toast";
import { useCart } from "@/store/cartStore";
import { computeTotals, cartLineToSaleItem } from "@/core/utils/totals";
import { saleRepo } from "@/features/sales/saleRepo";
import { formatMoney } from "@/core/utils/format";
import { IconWallet, IconCheck } from "@/core/components/icons";

interface Props {
  open: boolean;
  onClose: () => void;
  shop: ShopSettings;
  onComplete: (sale: Sale) => void;
}

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "mobile_money", label: "Mobile Money" },
  { id: "card", label: "Card" },
  { id: "credit", label: "Credit" },
];

export function PaymentSheet({ open, onClose, shop, onComplete }: Props) {
  const { toast } = useToast();
  const { lines, discount, customerName, customerPhone, clear } = useCart();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [saving, setSaving] = useState(false);

  const totals = useMemo(
    () => computeTotals(lines, discount, shop),
    [lines, discount, shop],
  );

  const paid = method === "cash" ? Number(tendered || 0) : totals.total;
  const change = method === "cash" ? Math.max(0, paid - totals.total) : 0;
  const quickCash = useMemo(() => {
    const t = totals.total;
    const round = (n: number) => Math.ceil(t / n) * n;
    return Array.from(new Set([t, round(1000), round(5000), round(10000)])).filter((n) => n >= t).slice(0, 4);
  }, [totals.total]);

  async function complete() {
    if (lines.length === 0) return;
    if (method === "cash" && paid < totals.total) {
      return toast("Amount paid is less than the total.", "error");
    }
    setSaving(true);
    const res = await saleRepo.record({
      items: lines.map(cartLineToSaleItem),
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      costTotal: totals.costTotal,
      profit: totals.profit,
      paymentMethod: method,
      amountPaid: method === "cash" ? paid : totals.total,
      change,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      cashier: shop.cashierName,
    });
    setSaving(false);
    if (res.ok) {
      clear();
      setTendered("");
      onComplete(res.value);
    } else {
      toast(res.error.message, "error");
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Payment">
      <div className="stat accent" style={{ textAlign: "center" }}>
        <div className="label" style={{ justifyContent: "center" }}>Amount due</div>
        <div className="value" style={{ fontSize: 30 }}>{formatMoney(totals.total, shop.currencySymbol)}</div>
        <div className="sub">{totals.itemCount} item(s){totals.taxTotal > 0 ? ` · incl. ${formatMoney(totals.taxTotal, shop.currencySymbol)} tax` : ""}</div>
      </div>

      <div className="section-title">Payment method</div>
      <div className="prod-grid">
        {METHODS.map((m) => (
          <button key={m.id} className={`btn ${method === m.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setMethod(m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      {method === "cash" && (
        <>
          <div className="field mt-16">
            <label>Cash received</label>
            <input className="input" type="number" inputMode="decimal" value={tendered}
              placeholder={String(totals.total)} onChange={(e) => setTendered(e.target.value)} autoFocus />
          </div>
          <div className="row wrap gap-8">
            {quickCash.map((n) => (
              <button key={n} className="btn btn-ghost btn-sm" onClick={() => setTendered(String(n))}>
                {formatMoney(n, shop.currencySymbol)}
              </button>
            ))}
          </div>
          <div className="between mt-16">
            <span className="muted">Change</span>
            <span className="bold" style={{ fontSize: 20 }}>{formatMoney(change, shop.currencySymbol)}</span>
          </div>
        </>
      )}

      <button className="btn btn-primary btn-block btn-lg mt-24" onClick={complete} disabled={saving || lines.length === 0}>
        <IconCheck /> {saving ? "Saving…" : `Complete sale · ${formatMoney(totals.total, shop.currencySymbol)}`}
      </button>
      <button className="btn btn-ghost btn-block mt-8" onClick={onClose}>
        <IconWallet /> Back to cart
      </button>
    </Sheet>
  );
}
