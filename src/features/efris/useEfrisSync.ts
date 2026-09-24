import { useEffect } from "react";
import { useEfrisActive } from "@/features/efris/efrisStore";
import { processQueue } from "@/features/efris/efrisQueue";

const EVERY_MS = 3 * 60_000;

/** Keeps uploading pending sales to URA: on launch, when back online, and every few minutes. */
export function useEfrisSync(): void {
  const active = useEfrisActive();

  useEffect(() => {
    if (!active) return;
    const run = () => {
      if (typeof navigator === "undefined" || navigator.onLine !== false) void processQueue();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    run();
    const timer = window.setInterval(run, EVERY_MS);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
}
