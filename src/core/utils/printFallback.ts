import type { Sale, ShopSettings } from "@/core/types/models";
import { renderReceiptText } from "@/core/utils/escpos";

// Browser-print fallback for devices without Web Bluetooth (e.g. iOS) or when
// no thermal printer is paired. Opens a print dialog with a monospaced,
// receipt-width layout that prints cleanly to A4/A5 or a USB receipt printer.

export function printReceiptInBrowser(sale: Sale, shop: ShopSettings) {
  const text = renderReceiptText(sale, shop);
  const win = window.open("", "_blank", "width=380,height=600");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>${sale.receiptNo}</title>
    <meta charset="utf-8" />
    <style>
      @page { margin: 6mm; }
      body { font-family: 'Courier New', monospace; font-size: 12px; white-space: pre; line-height: 1.35; color: #000; }
    </style></head><body>${escapeHtml(text)}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 250);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
