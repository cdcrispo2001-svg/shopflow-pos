import qrcode from "qrcode-generator";

/** QR code as an image data URL (used for URA EFRIS verification codes on receipts). */
export function qrDataUrl(text: string, cellSize = 4): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, 2);
}
