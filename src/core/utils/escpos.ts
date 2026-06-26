import type { Sale, ShopSettings } from "@/core/types/models";
import { formatMoney } from "@/core/utils/format";

// Minimal ESC/POS receipt builder. Produces the raw byte stream that thermal
// printers understand (used by the Web Bluetooth printer). Also exposes a
// plain-text renderer reused by the on-screen receipt + browser fallback.

const ESC = 0x1b;
const GS = 0x1d;

class EscPosBuilder {
  private chunks: number[] = [];

  raw(...bytes: number[]) {
    this.chunks.push(...bytes);
    return this;
  }

  init() {
    return this.raw(ESC, 0x40);
  }

  align(mode: "left" | "center" | "right") {
    const m = mode === "center" ? 1 : mode === "right" ? 2 : 0;
    return this.raw(ESC, 0x61, m);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Double height/width for shop name + total. */
  size(big: boolean) {
    return this.raw(GS, 0x21, big ? 0x11 : 0x00);
  }

  text(s: string) {
    for (const ch of s) this.chunks.push(ch.charCodeAt(0) & 0xff);
    return this;
  }

  line(s = "") {
    return this.text(s).raw(0x0a);
  }

  feed(n = 1) {
    return this.raw(ESC, 0x64, n);
  }

  cut() {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  build(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

function divider(width: number): string {
  return "-".repeat(width);
}

/** Lays out "name ........ value" within a fixed character width. */
function row(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length);
  if (left.length + right.length >= width) {
    return `${left.slice(0, width - right.length - 1)} ${right}`;
  }
  return left + " ".repeat(space) + right;
}

/** Human-readable plain-text receipt (on-screen preview + browser print). */
export function renderReceiptText(sale: Sale, shop: ShopSettings): string {
  const w = shop.receiptWidth;
  const sym = shop.currencySymbol;
  const out: string[] = [];
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((w - s.length) / 2));
    return " ".repeat(pad) + s;
  };

  out.push(center(shop.name.toUpperCase()));
  if (shop.tagline) out.push(center(shop.tagline));
  if (shop.address) out.push(center(shop.address));
  if (shop.phone) out.push(center(`Tel: ${shop.phone}`));
  out.push(divider(w));
  out.push(row(`Receipt: ${sale.receiptNo}`, "", w));
  out.push(new Date(sale.createdAt).toLocaleString());
  if (sale.customerName) out.push(`Customer: ${sale.customerName}`);
  out.push(divider(w));

  for (const it of sale.items) {
    out.push(it.name);
    out.push(
      row(
        `  ${it.qty} x ${formatMoney(it.price, sym)}`,
        formatMoney(it.lineTotal, sym),
        w,
      ),
    );
  }

  out.push(divider(w));
  out.push(row("Subtotal", formatMoney(sale.subtotal, sym), w));
  if (sale.taxTotal > 0) out.push(row("Tax", formatMoney(sale.taxTotal, sym), w));
  if (sale.discount > 0)
    out.push(row("Discount", `-${formatMoney(sale.discount, sym)}`, w));
  out.push(row("TOTAL", formatMoney(sale.total, sym), w));
  out.push(divider(w));
  out.push(row("Paid", formatMoney(sale.amountPaid, sym), w));
  out.push(row("Change", formatMoney(sale.change, sym), w));
  out.push(row("Method", sale.paymentMethod.replace("_", " "), w));
  out.push(divider(w));
  if (shop.receiptFooter) out.push(center(shop.receiptFooter));
  out.push(`Served by: ${sale.cashier || shop.cashierName}`);
  return out.join("\n");
}

/** ESC/POS byte stream for Bluetooth thermal printers. */
export function buildReceiptBytes(sale: Sale, shop: ShopSettings): Uint8Array {
  const w = shop.receiptWidth;
  const sym = shop.currencySymbol;
  const b = new EscPosBuilder().init();

  b.align("center").bold(true).size(true).line(shop.name.toUpperCase()).size(false);
  if (shop.tagline) b.line(shop.tagline);
  b.bold(false);
  if (shop.address) b.line(shop.address);
  if (shop.phone) b.line(`Tel: ${shop.phone}`);
  b.align("left").line(divider(w));
  b.line(`Receipt: ${sale.receiptNo}`);
  b.line(new Date(sale.createdAt).toLocaleString());
  if (sale.customerName) b.line(`Customer: ${sale.customerName}`);
  b.line(divider(w));

  for (const it of sale.items) {
    b.line(it.name);
    b.line(
      row(`  ${it.qty} x ${formatMoney(it.price, sym)}`, formatMoney(it.lineTotal, sym), w),
    );
  }

  b.line(divider(w));
  b.line(row("Subtotal", formatMoney(sale.subtotal, sym), w));
  if (sale.taxTotal > 0) b.line(row("Tax", formatMoney(sale.taxTotal, sym), w));
  if (sale.discount > 0)
    b.line(row("Discount", `-${formatMoney(sale.discount, sym)}`, w));
  b.bold(true).size(true).line(row("TOTAL", formatMoney(sale.total, sym), w)).size(false).bold(false);
  b.line(divider(w));
  b.line(row("Paid", formatMoney(sale.amountPaid, sym), w));
  b.line(row("Change", formatMoney(sale.change, sym), w));
  b.line(row("Method", sale.paymentMethod.replace("_", " "), w));
  b.line(divider(w));
  b.align("center");
  if (shop.receiptFooter) b.line(shop.receiptFooter);
  b.line(`Served by: ${sale.cashier || shop.cashierName}`);
  b.feed(3).cut();
  return b.build();
}
