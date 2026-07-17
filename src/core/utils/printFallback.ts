import type { Sale, ShopSettings } from "@/core/types/models";
import { renderReceiptText } from "@/core/utils/escpos";

// Browser-print fallback for devices without Web Bluetooth (e.g. iOS) or when
// no thermal printer is paired. Opens a print dialog with a monospaced,
// receipt-width layout that prints cleanly to A4/A5 or a USB receipt printer.

export function printReceiptInBrowser(sale: Sale, shop: ShopSettings) {
  const text = renderReceiptText(sale, shop);
  const win = window.open("", "_blank", "width=380,height=600");
  if (!win) return;
  win.opener = null;
  const doc = win.document;
  doc.title = sale.receiptNo;
  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  const style = doc.createElement("style");
  style.textContent = `
    @page { margin: 6mm; }
    body { font-family: 'Courier New', monospace; font-size: 12px; white-space: pre; line-height: 1.35; color: #000; }
  `;
  const receipt = doc.createElement("pre");
  receipt.style.whiteSpace = "pre-wrap";
  receipt.textContent = text;
  doc.head.replaceChildren(meta, style);
  doc.body.replaceChildren(receipt);
  win.focus();
  setTimeout(() => {
    win.print();
  }, 250);
}
