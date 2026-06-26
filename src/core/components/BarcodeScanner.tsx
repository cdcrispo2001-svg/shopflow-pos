import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { IconClose } from "@/core/components/icons";

interface Props {
  onDetected: (code: string) => void;
  onClose: () => void;
}

/** Live camera barcode/QR scanner (mobile_scanner analogue) using ZXing. */
export function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | null = null;
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (!result) return;
        const code = result.getText();
        const now = Date.now();
        // debounce repeated reads of the same barcode
        if (code === lastRef.current.code && now - lastRef.current.at < 1500) return;
        lastRef.current = { code, at: now };
        if (navigator.vibrate) navigator.vibrate(60);
        onDetected(code);
      })
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch((e) => {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access, or enter the barcode manually."
            : "Could not start the camera. You can type the barcode instead.",
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onDetected]);

  return (
    <div>
      {error ? (
        <div className="empty">{error}</div>
      ) : (
        <div className="scanner-wrap">
          <video ref={videoRef} muted playsInline />
          <div className="scanner-frame" />
        </div>
      )}
      <p className="small muted center mt-8">Point the camera at a product barcode or QR code.</p>
      <button className="btn btn-ghost btn-block mt-16" onClick={onClose}>
        <IconClose /> Close scanner
      </button>
    </div>
  );
}
