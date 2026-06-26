import { useState } from "react";
import type { Sale, ShopSettings } from "@/core/types/models";
import { Sheet } from "@/core/components/Sheet";
import { useToast } from "@/core/components/Toast";
import { renderReceiptText, buildReceiptBytes } from "@/core/utils/escpos";
import { printReceiptInBrowser } from "@/core/utils/printFallback";
import {
  bluetoothSupported, connectedPrinterName, printBytes,
} from "@/core/utils/bluetoothPrinter";
import { IconPrint, IconBluetooth, IconCheck } from "@/core/components/icons";

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

  return (
    <Sheet open={open} onClose={onClose} title="Receipt">
      <div className="receipt">{renderReceiptText(sale, shop)}</div>

      <div className="row gap-8 mt-16">
        <button className="btn btn-primary grow" onClick={printBluetooth} disabled={printing}>
          <IconBluetooth /> {printing ? "Printing…" : connectedPrinterName() ? "Print (BT)" : "Bluetooth print"}
        </button>
        <button className="btn btn-ghost grow" onClick={() => printReceiptInBrowser(sale, shop)}>
          <IconPrint /> Browser print
        </button>
      </div>

      {onNewSale && (
        <button className="btn btn-accent btn-block btn-lg mt-16" onClick={onNewSale}>
          <IconCheck /> Done — new sale
        </button>
      )}
    </Sheet>
  );
}
