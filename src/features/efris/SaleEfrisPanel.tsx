import { useState } from "react";
import type { Sale } from "@/core/types/models";
import { useToast } from "@/core/components/Toast";
import { fiscaliseSale, retryFailed, submitCreditNote } from "@/features/efris/efrisQueue";
import { format } from "date-fns";

const LABELS = {
  pending: { text: "Waiting to send to URA", pill: "pill-warn" },
  failed: { text: "URA rejected — needs attention", pill: "pill-danger" },
  fiscalised: { text: "Fiscalised with URA", pill: "pill-ok" },
  cancelled: { text: "Not sent (sale cancelled)", pill: "" },
} as const;

/** URA EFRIS status, fiscal numbers and actions for one sale. */
export function SaleEfrisPanel({ sale }: { sale: Sale }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const efris = sale.efris;
  if (!efris) return null;
  const label = LABELS[efris.status];
  const creditNoteDue = sale.status !== "completed" && efris.status === "fiscalised" && !efris.creditNote;

  async function act(work: () => Promise<string>) {
    setBusy(true);
    try {
      toast(await work(), "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "URA request failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  const send = () => act(async () => {
    const outcome = efris.status === "failed"
      ? ((await retryFailed(sale.id)).fiscalised ? "fiscalised" : "not sent")
      : await fiscaliseSale(sale.id);
    return outcome === "fiscalised" ? "Fiscalised with URA." : "Not sent yet — see the message below.";
  });

  const creditNote = () => act(async () => {
    const reference = await submitCreditNote(sale.id, sale.status === "refunded" ? "refunded" : "voided");
    return `Credit note submitted to URA (ref ${reference}).`;
  });

  return (
    <div className="card-flat mt-8" style={{ padding: 14 }}>
      <div className="between">
        <span className="bold">URA EFRIS</span>
        <span className={`pill ${label.pill}`}>{label.text}</span>
      </div>
      {efris.invoiceNo && (
        <>
          <div className="between mt-8 small"><span className="muted">FDN</span><span className="bold">{efris.invoiceNo}</span></div>
          {efris.antifakeCode && (
            <div className="between mt-8 small"><span className="muted">Verification code</span><span>{efris.antifakeCode}</span></div>
          )}
          {efris.fiscalisedAt && (
            <div className="between mt-8 small"><span className="muted">Fiscalised</span><span>{format(efris.fiscalisedAt, "d MMM yyyy, HH:mm")}</span></div>
          )}
        </>
      )}
      {efris.creditNote && (
        <p className="small muted mt-8">
          Credit note submitted {format(efris.creditNote.submittedAt, "d MMM yyyy")} · ref {efris.creditNote.referenceNo}
        </p>
      )}
      {efris.lastError && efris.status !== "fiscalised" && (
        <p className="small mt-8" style={{ color: efris.status === "failed" ? "#fca5a5" : "var(--text-muted)" }}>
          {efris.lastError}{efris.attempts ? ` (tries: ${efris.attempts})` : ""}
        </p>
      )}
      {(efris.status === "pending" || efris.status === "failed") && sale.status === "completed" && (
        <button className="btn btn-ghost btn-block mt-8" disabled={busy} onClick={send}>
          {busy ? "Sending…" : "Send to URA now"}
        </button>
      )}
      {creditNoteDue && (
        <button className="btn btn-accent btn-block mt-8" disabled={busy} onClick={creditNote}>
          {busy ? "Submitting…" : "Submit credit note to URA"}
        </button>
      )}
    </div>
  );
}
