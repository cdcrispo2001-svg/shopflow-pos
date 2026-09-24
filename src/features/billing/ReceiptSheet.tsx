import { useState } from "react";
import type { Sale, ShopSettings } from "@/core/types/models";
import { Sheet } from "@/core/components/Sheet";
import { useToast } from "@/core/components/Toast";
import { renderReceiptText, buildReceiptBytes } from "@/core/utils/escpos";
import { printReceiptInBrowser } from "@/core/utils/printFallback";
import {
  bluetoothSupported, connectedPrinterName, printBytes,
} from "@/core/utils/bluetoothPrinter";
import { shareText } from "@/core/utils/platform";
import { qrDataUrl } from "@/core/utils/qr";
import { IconPrint, IconBluetooth, IconCheck, IconShare } from "@/core/components/icons";

interface Props {
  sale: Sale | null;
  shop: ShopSettings;
  open: boolean;
  onClose: () => void;
  onNewSale?: () => void;
}

export function ReceiptSheet({ sale, shop, open, onClose, onNewSale }: Props) {
  const { toast } = useToast();
  const [printing, setPrinting] = useState(false);
  if (!sale) return null;

  async function printBluetooth() {
    if (!sale) return;
    if (!bluetoothSupported()) {
      toast("Bluetooth printing needs Chrome on Android/desktop. Using browser print.", "info");
      printReceiptInBrowser(sale, shop);
      return;
    }
    setPrinting(true);
    const res = await printBytes(buildReceiptBytes(sale, shop));
    setPrinting(false);
    if (res.ok) toast("Receipt sent to printer.", "success");
    else toast(res.error.message, "error");
  }

  async function share() {
    if (!sale) return;
    const text = renderReceiptText(sale, shop);
    try {
      if (await shareText(`Receipt ${sale.receiptNo}`, text)) return;
      await navigator.clipboard.writeText(text);
      toast("Receipt copied — paste it into WhatsApp or SMS.", "success");
    } catch (error) {
      // Closing the share sheet without choosing an app is not an error.
      if (error instanceof Error && error.name === "AbortError") return;
      toast("Could not share the receipt on this device.", "error");
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Receipt">
      <div className="receipt">{renderReceiptText(sale, shop)}</div>
      {sale.efris?.qrCode && (
        <div className="receipt-qr">
          <img src={qrDataUrl(sale.efris.qrCode)} alt="URA verification QR code" />
        </div>
      )}
      {sale.efris?.status === "pending" && (
        <p className="small muted center mt-8">Sending to URA… the fiscal number appears here when URA answers.</p>
      )}
      {sale.efris?.status === "failed" && (
        <p className="small center mt-8" style={{ color: "#fca5a5" }}>URA rejected this sale: {sale.efris.lastError}</p>
      )}

      <div className="row gap-8 mt-16">
        <button className="btn btn-primary grow" onClick={printBluetooth} disabled={printing}>
          <IconBluetooth /> {printing ? "Printing…" : connectedPrinterName() ? "Print (BT)" : "Bluetooth print"}
        </button>
        <button className="btn btn-ghost grow" onClick={() => printReceiptInBrowser(sale, shop)}>
          <IconPrint /> Browser print
        </button>
      </div>

      <button className="btn btn-ghost btn-block mt-8" onClick={share}>
        <IconShare /> Share receipt (WhatsApp, SMS…)
      </button>

      {onNewSale && (
        <button className="btn btn-accent btn-block btn-lg mt-16" onClick={onNewSale}>
          <IconCheck /> Done — new sale
        </button>
      )}
    </Sheet>
  );
}
