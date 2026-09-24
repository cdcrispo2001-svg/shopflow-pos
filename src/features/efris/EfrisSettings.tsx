import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import { useToast } from "@/core/components/Toast";
import { isNative } from "@/core/utils/platform";
import { importKeyFile } from "@/features/efris/efrisCrypto";
import { missingSetup } from "@/features/efris/efrisClient";
import {
  clearEfrisKey, saveEfrisConfig, saveEfrisKey, useEfrisConfig, useEfrisKey, type EfrisConfig,
} from "@/features/efris/efrisStore";
import {
  connectEfris, efrisSummary, processQueue, registerProducts, retryFailed,
} from "@/features/efris/efrisQueue";
import { formatDistanceToNow } from "date-fns";
import { IconCheck } from "@/core/components/icons";

/** Settings section for URA EFRIS (only rendered for shops in Uganda). */
export function EfrisSettings() {
  const { toast } = useToast();
  const config = useEfrisConfig();
  const key = useEfrisKey();
  const sales = useLiveQuery(() => db.sales.toArray(), [], []);
  const [draft, setDraft] = useState<EfrisConfig>(config);
  const [dirty, setDirty] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dirty) setDraft(config);
  }, [config, dirty]);

  const set = <K extends keyof EfrisConfig>(field: K, value: EfrisConfig[K]) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
  };

  async function save(patch: Partial<EfrisConfig> = {}): Promise<boolean> {
    try {
      await saveEfrisConfig({ ...draft, ...patch });
      setDirty(false);
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "EFRIS settings could not be saved.", "error");
      return false;
    }
  }

  async function run(label: string, work: () => Promise<string>) {
    if (dirty && !(await save())) return;
    setBusy(label);
    setStatus(null);
    try {
      const message = await work();
      setStatus(message);
      toast(message, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "URA request failed.";
      setStatus(message);
      toast(message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function onKeyFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await run("key", async () => {
      const imported = await importKeyFile(new Uint8Array(await file.arrayBuffer()), password);
      await saveEfrisKey({ ...imported, importedAt: Date.now() });
      setPassword("");
      return `Private key imported (${imported.fingerprint}).`;
    });
  }

  const summary = efrisSummary(sales, config.offlineDays);
  const missing = missingSetup(draft, key);

  return (
    <div className="card mt-8">
      <div className="switch-row" style={{ paddingTop: 0 }}>
        <div className="col">
          <span>Issue URA e-receipts (EFRIS)</span>
          <span className="small muted">Sends every sale to URA and prints its fiscal number and QR code</span>
        </div>
        <label className="switch">
          <input type="checkbox" checked={draft.enabled}
            onChange={async (e) => { if (await save({ enabled: e.target.checked })) toast(e.target.checked ? "EFRIS turned on." : "EFRIS turned off."); }} />
          <span className="track" />
        </label>
      </div>

      {draft.enabled && (
        <>
          <p className="small muted">
            Before you start: register for EFRIS on the URA portal, ask URA for system-to-system (API) access and a
            device number, create your key pair with URA's key tool and upload the public key to the portal. Then
            enter the details below and import the private key file. Test in Sandbox before going live.
          </p>

          <div className="field mt-16">
            <label>Environment</label>
            <select className="select" value={draft.environment}
              onChange={(e) => set("environment", e.target.value as EfrisConfig["environment"])}>
              <option value="sandbox">Sandbox (testing)</option>
              <option value="production">Production (live e-receipts)</option>
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label>TIN</label>
              <input className="input" inputMode="numeric" maxLength={10} value={draft.tin}
                placeholder="10 digits" onChange={(e) => set("tin", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="field">
              <label>Device number</label>
              <input className="input" value={draft.deviceNo} placeholder="From URA"
                onChange={(e) => set("deviceNo", e.target.value.trim())} />
            </div>
          </div>
          <div className="field">
            <label>BRN / NIN (optional)</label>
            <input className="input" value={draft.brn} onChange={(e) => set("brn", e.target.value.trim())} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Legal name</label>
              <input className="input" value={draft.legalName} placeholder="Filled in on connect"
                onChange={(e) => set("legalName", e.target.value)} />
            </div>
            <div className="field">
              <label>Trading name</label>
              <input className="input" value={draft.businessName} placeholder="Filled in on connect"
                onChange={(e) => set("businessName", e.target.value)} />
            </div>
          </div>
          <div className="switch-row">
            <div className="col">
              <span>VAT registered</span>
              <span className="small muted">VAT-registered shops issue e-invoices; others issue e-receipts</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={draft.vatRegistered} onChange={(e) => set("vatRegistered", e.target.checked)} />
              <span className="track" />
            </label>
          </div>
          {!isNative() && (
            <div className="field">
              <label>EFRIS relay address (web app only)</label>
              <input className="input" value={draft.relayUrl} placeholder="https://your-relay.example.com"
                onChange={(e) => set("relayUrl", e.target.value.trim())} />
              <span className="small muted">
                Browsers cannot talk to URA directly. The Android app can; on the web, run the ShopFlow EFRIS relay
                (scripts/efris-relay.mjs) and enter its address.
              </span>
            </div>
          )}
          {dirty && (
            <button className="btn btn-primary btn-block" onClick={async () => { if (await save()) toast("EFRIS settings saved.", "success"); }}>
              <IconCheck /> Save EFRIS details
            </button>
          )}

          <div className="section-title">Device key</div>
          {key ? (
            <div className="between">
              <div className="col">
                <span className="bold">Key loaded · {key.fingerprint}</span>
                <span className="small muted">
                  {key.subject ? `${key.subject} · ` : ""}imported {formatDistanceToNow(key.importedAt, { addSuffix: true })}.
                  Kept on this device only, never in backups.
                </span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                if (confirm("Remove the private key from this device? URA e-receipts stop until you import it again.")) {
                  await clearEfrisKey();
                  toast("Private key removed.");
                }
              }}>Remove</button>
            </div>
          ) : (
            <>
              <div className="field">
                <label>Key file password</label>
                <input className="input" type="password" autoComplete="off" value={password}
                  onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button className="btn btn-ghost btn-block" disabled={busy === "key"} onClick={() => fileRef.current?.click()}>
                {busy === "key" ? "Reading key…" : "Import private key (.p12 / .pfx / .pem)"}
              </button>
              <input ref={fileRef} type="file" accept=".p12,.pfx,.pem,.key,application/x-pkcs12" hidden onChange={onKeyFile} />
            </>
          )}

          <div className="section-title">Connection</div>
          {missing.length > 0 ? (
            <p className="small muted">Still needed: {missing.join(", ")}.</p>
          ) : (
            <p className="small muted">
              {config.lastSignInAt
                ? `Signed in ${formatDistanceToNow(config.lastSignInAt, { addSuffix: true })} · device ${config.deviceStatus || "ok"} · offline allowance ${config.offlineDays} days.`
                : "Not connected yet — test the connection first."}
            </p>
          )}
          <button className="btn btn-primary btn-block mt-8" disabled={!!busy || missing.length > 0}
            onClick={() => run("connect", async () => {
              const r = await connectEfris();
              return `Connected to URA ${draft.environment}: ${r.businessName || r.legalName || "taxpayer found"}`
                + ` · offline allowance ${r.offlineDays} days${r.units ? ` · ${r.units} units downloaded` : ""}.`;
            })}>
            {busy === "connect" ? "Connecting…" : "Test connection & download URA data"}
          </button>
          <button className="btn btn-ghost btn-block mt-8" disabled={!!busy || missing.length > 0}
            onClick={() => run("register", async () => {
              const r = await registerProducts();
              const failed = r.failed.map((f) => `${f.name}: ${f.message}`).join("; ");
              return `${r.registered} product(s) registered with URA.${failed ? ` Not registered — ${failed}` : ""}`
                + (r.skipped ? ` ${r.skipped} skipped (no commodity code or already registered).` : "");
            })}>
            {busy === "register" ? "Registering…" : "Register products with URA"}
          </button>

          <div className="section-title">E-receipt queue</div>
          <p className="small muted">
            {summary.pending} waiting · {summary.failed} rejected · {summary.creditNotesDue} credit note(s) due
            {summary.oldestAt ? ` · oldest ${formatDistanceToNow(summary.oldestAt, { addSuffix: true })}` : ""}
          </p>
          <div className="field-row mt-8">
            <button className="btn btn-ghost grow" disabled={!!busy || summary.pending === 0}
              onClick={() => run("queue", async () => {
                const r = await processQueue();
                if (r.error) throw new Error(r.error);
                return `${r.fiscalised} sale(s) fiscalised.${r.failed ? ` ${r.failed} rejected.` : ""}`;
              })}>
              {busy === "queue" ? "Sending…" : "Send waiting now"}
            </button>
            <button className="btn btn-ghost grow" disabled={!!busy || summary.failed === 0}
              onClick={() => run("retry", async () => {
                const r = await retryFailed();
                if (r.error) throw new Error(r.error);
                return `${r.fiscalised} fiscalised, ${r.failed} still rejected.`;
              })}>
              {busy === "retry" ? "Retrying…" : "Retry rejected"}
            </button>
          </div>
          {status && <p className="small mt-8" style={{ color: "var(--text-muted)" }}>{status}</p>}
        </>
      )}
    </div>
  );
}
