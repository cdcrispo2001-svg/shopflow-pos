import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import { useToast } from "@/core/components/Toast";
import { useEfrisActive, useEfrisConfig } from "@/features/efris/efrisStore";
import { efrisSummary, processQueue } from "@/features/efris/efrisQueue";
import { IconAlert } from "@/core/components/icons";

/** Dashboard warning when sales are waiting for URA, were rejected, or need credit notes. */
export function EfrisStatusBanner() {
  const active = useEfrisActive();
  const config = useEfrisConfig();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const sales = useLiveQuery(() => (active ? db.sales.toArray() : []), [active], []);
  if (!active) return null;

  const summary = efrisSummary(sales, config.offlineDays);
  if (!summary.pending && !summary.failed && !summary.creditNotesDue) return null;

  const days = Math.floor(summary.ageDays);
  const parts = [
    summary.pending ? `${summary.pending} waiting` : "",
    summary.failed ? `${summary.failed} rejected` : "",
    summary.creditNotesDue ? `${summary.creditNotesDue} credit note(s) due` : "",
  ].filter(Boolean);
  const urgent = summary.overLimit || summary.failed > 0;
  const detail = summary.overLimit
    ? `Offline limit of ${config.offlineDays} days reached — new sales are blocked until these reach URA.`
    : summary.nearLimit
      ? `Oldest is ${days} day(s) old; URA allows ${config.offlineDays}. Connect to the internet soon.`
      : summary.oldestAt ? `Oldest is ${days ? `${days} day(s)` : "less than a day"} old.` : "";

  async function sendNow() {
    setSending(true);
    const result = await processQueue();
    setSending(false);
    if (result.error) toast(result.error, "error");
    else toast(`${result.fiscalised} sale(s) fiscalised with URA.`, "success");
  }

  return (
    <div className="list-item" style={{ borderColor: urgent ? "rgba(239,68,68,0.5)" : "rgba(245,158,11,0.4)", alignItems: "flex-start" }}>
      <div className="thumb" style={urgent
        ? { background: "var(--danger-soft)", color: "#fca5a5" }
        : { background: "rgba(245,158,11,0.16)", color: "#fcd34d" }}>
        <IconAlert width={18} height={18} />
      </div>
      <div className="grow col">
        <span className="bold">URA EFRIS: {parts.join(" · ")}</span>
        {detail && <span className="small muted">{detail}</span>}
        <div className="row gap-8 mt-8">
          {summary.pending > 0 && (
            <button className="btn btn-accent btn-sm" disabled={sending} onClick={sendNow}>
              {sending ? "Sending…" : "Send now"}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/sales?view=efris")}>Review</button>
        </div>
      </div>
    </div>
  );
}
