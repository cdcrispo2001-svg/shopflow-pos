import { useMemo } from "react";
import type { ShopSettings } from "@/core/types/models";
import { Sheet } from "@/core/components/Sheet";
import { useToast } from "@/core/components/Toast";
import { ProductImage } from "@/core/components/ProductImage";
import { useEfrisActive } from "@/features/efris/efrisStore";
import { useCart } from "@/store/cartStore";
import { computeTotals } from "@/core/utils/totals";
import { formatMoney } from "@/core/utils/format";
import { IconTrash, IconCart } from "@/core/components/icons";

interface Props {
  open: boolean;
  onClose: () => void;
  shop: ShopSettings;
  onPay: () => void;
}

export function CartSheet({ open, onClose, shop, onPay }: Props) {
  const { toast } = useToast();
  const efrisActive = useEfrisActive();
  const {
    lines, discount, customerName, customerPhone, customerTin, increment, decrement, removeLine,
    setDiscount, setCustomerName, setCustomerPhone, setCustomerTin, clear,
  } = useCart();

  const totals = useMemo(() => computeTotals(lines, discount, shop), [lines, discount, shop]);

  return (
    <Sheet open={open} onClose={onClose} title={`Cart · ${totals.itemCount} item(s)`}>
      {lines.length === 0 ? (
        <div className="empty"><IconCart /><p>Your cart is empty.</p></div>
      ) : (
        <>
          {lines.map((l) => (
            <div key={l.product.id} className="list-item">
              <ProductImage product={l.product} size={40} />
              <div className="grow col">
                <span className="bold">{l.product.name}</span>
                <span className="small muted">
                  {formatMoney(l.product.price, shop.currencySymbol)} ea ·{" "}
                  {formatMoney(l.product.price * l.qty, shop.currencySymbol)}
                </span>
              </div>
              <div className="qty-stepper">
                <button onClick={() => decrement(l.product.id)}>−</button>
                <span className="qty">{l.qty}</span>
                <button onClick={() => {
                  if (!increment(l.product.id)) toast(`Only ${l.product.stock ?? l.qty} ${l.product.name} in stock.`, "error");
                }}>+</button>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => removeLine(l.product.id)} aria-label="Remove">
                <IconTrash width={16} height={16} />
              </button>
            </div>
          ))}

          <div className="field mt-16">
            <label>Discount ({shop.currencySymbol})</label>
            <input className="input" type="number" inputMode="decimal" value={discount || ""}
              onChange={(e) => setDiscount(Number(e.target.value || 0))} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Customer (optional)</label>
              <input className="input" value={customerName} placeholder="Name"
                onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input className="input" type="tel" inputMode="tel" value={customerPhone} placeholder="07…"
                onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
          </div>
          {efrisActive && (
            <div className="field">
              <label>Buyer TIN (business customers, for a URA e-invoice in their name)</label>
              <input className="input" inputMode="numeric" maxLength={10} value={customerTin} placeholder="Optional · 10 digits"
                onChange={(e) => setCustomerTin(e.target.value)} />
            </div>
          )}

          <div className="card-flat" style={{ padding: 14 }}>
            <div className="between"><span className="muted">Subtotal</span><span>{formatMoney(totals.subtotal, shop.currencySymbol)}</span></div>
            {totals.taxTotal > 0 && <div className="between mt-8"><span className="muted">Tax</span><span>{formatMoney(totals.taxTotal, shop.currencySymbol)}</span></div>}
            {totals.discount > 0 && <div className="between mt-8"><span className="muted">Discount</span><span>−{formatMoney(totals.discount, shop.currencySymbol)}</span></div>}
            <div className="between mt-8" style={{ fontSize: 20 }}>
              <span className="bold">Total</span>
              <span className="bold" style={{ color: "var(--primary)" }}>{formatMoney(totals.total, shop.currencySymbol)}</span>
            </div>
          </div>

          <button className="btn btn-primary btn-block btn-lg mt-16" onClick={onPay}>
            Charge {formatMoney(totals.total, shop.currencySymbol)}
          </button>
          <button className="btn btn-ghost btn-block mt-8" onClick={() => { clear(); onClose(); }}>
            Clear cart
          </button>
        </>
      )}
    </Sheet>
  );
}
