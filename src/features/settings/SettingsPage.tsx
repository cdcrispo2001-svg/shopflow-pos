import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from "react";
import { Topbar } from "@/core/components/AppShell";
import { useSettings, saveSettings } from "@/hooks/useSettings";
import { useToast } from "@/core/components/Toast";
import type { ShopSettings } from "@/core/types/models";
import {
  bluetoothSupported, connectedPrinterName, pairPrinter, forgetPrinter,
} from "@/core/utils/bluetoothPrinter";
import {
  downloadJsonBackup, downloadCsvReport, emailBackup, restoreBackup,
} from "@/core/utils/backup";
import { runAutoBackup } from "@/core/utils/autoBackup";
import { isNative, platformName } from "@/core/utils/platform";
import { formatDistanceToNow } from "date-fns";
import {
  IconBluetooth, IconBackup, IconMail, IconRestore, IconCheck,
} from "@/core/components/icons";

function Row({ children }: { children: ReactNode }) {
  return <div className="card mt-8">{children}</div>;
}

export function SettingsPage() {
  const settings = useSettings();
  const { toast } = useToast();
  const [draft, setDraft] = useState<ShopSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const [printerName, setPrinterName] = useState<string | null>(connectedPrinterName());
  const fileRef = useRef<HTMLInputElement>(null);

  // hydrate the local draft once settings load (and when not mid-edit)
  useEffect(() => {
    if (!dirty) setDraft(settings);
  }, [settings, dirty]);

  const set = <K extends keyof ShopSettings>(k: K, v: ShopSettings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  async function save() {
    await saveSettings(draft);
    setDirty(false);
    toast("Settings saved.", "success");
  }

  async function pair() {
    const r = await pairPrinter();
    if (r.ok) {
      setPrinterName(r.value);
      toast(`Connected: ${r.value}`, "success");
    } else {
      toast(r.error.message, "error");
    }
  }

  async function doEmailBackup() {
    const r = await emailBackup(draft.email, draft.name, draft.currencySymbol);
    if (r.ok) {
      toast(r.value === "shared" ? "Backup shared." : "Email draft opened — attach the downloaded files.", "success");
    } else {
      toast(r.error.message, "error");
    }
  }

  async function onRestoreFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("Restoring replaces ALL current data with the backup. Continue?")) {
      e.target.value = "";
      return;
    }
    const text = await file.text();
    const r = await restoreBackup(text);
    e.target.value = "";
    if (r.ok) toast(`Restored ${r.value.products} products, ${r.value.sales} sales.`, "success");
    else toast(r.error.message, "error");
  }

  return (
    <>
      <Topbar title="Settings" subtitle="Shop, printer & backups"
        right={dirty ? <button className="btn btn-primary btn-sm" onClick={save}><IconCheck /> Save</button> : undefined} />
      <div className="page">
        {/* Shop details */}
        <div className="section-title">Shop details (printed on receipts)</div>
        <Row>
          <div className="field">
            <label>Shop name</label>
            <input className="input" value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="field">
            <label>Tagline</label>
            <input className="input" value={draft.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} />
          </div>
          <div className="field">
            <label>Address</label>
            <input className="input" value={draft.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Phone</label>
              <input className="input" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="field">
              <label>Cashier name</label>
              <input className="input" value={draft.cashierName} onChange={(e) => set("cashierName", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Email (for backups)</label>
            <input className="input" type="email" value={draft.email}
              placeholder="you@example.com" onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="field">
            <label>Receipt footer</label>
            <textarea className="input" rows={2} value={draft.receiptFooter}
              onChange={(e) => set("receiptFooter", e.target.value)} />
          </div>
        </Row>

        {/* Money & tax */}
        <div className="section-title">Money & tax</div>
        <Row>
          <div className="field-row">
            <div className="field">
              <label>Currency code</label>
              <input className="input" value={draft.currency} onChange={(e) => set("currency", e.target.value)} />
            </div>
            <div className="field">
              <label>Symbol</label>
              <input className="input" value={draft.currencySymbol} onChange={(e) => set("currencySymbol", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Default tax rate % (new products)</label>
            <input className="input" type="number" inputMode="decimal" value={draft.defaultTaxRate || ""}
              onChange={(e) => set("defaultTaxRate", Number(e.target.value || 0))} />
          </div>
          <div className="switch-row">
            <div className="col">
              <span>Prices include tax</span>
              <span className="small muted">Tax is backed out of entered prices</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={draft.taxInclusive} onChange={(e) => set("taxInclusive", e.target.checked)} />
              <span className="track" />
            </label>
          </div>
        </Row>

        {/* Printer */}
        <div className="section-title">Thermal printer</div>
        <Row>
          <div className="between">
            <div className="col">
              <span className="bold">{printerName ?? "No printer paired"}</span>
              <span className="small muted">
                {bluetoothSupported()
                  ? "Connect a Bluetooth ESC/POS printer for auto-receipting."
                  : "Web Bluetooth unavailable here — browser print is used as fallback."}
              </span>
            </div>
            <span className={`pill ${printerName ? "pill-ok" : ""}`}>{printerName ? "Ready" : "Off"}</span>
          </div>
          <div className="field-row mt-16">
            <button className="btn btn-primary grow" onClick={pair} disabled={!bluetoothSupported()}>
              <IconBluetooth /> {printerName ? "Re-pair" : "Pair printer"}
            </button>
            {printerName && (
              <button className="btn btn-ghost grow" onClick={() => { forgetPrinter(); setPrinterName(null); toast("Printer disconnected."); }}>
                Forget
              </button>
            )}
          </div>
          <div className="field-row mt-8">
            <div className="field" style={{ margin: 0 }}>
              <label>Paper width</label>
              <select className="select" value={draft.receiptWidth}
                onChange={(e) => set("receiptWidth", Number(e.target.value) as 32 | 48)}>
                <option value={32}>58 mm (32 chars)</option>
                <option value={48}>80 mm (48 chars)</option>
              </select>
            </div>
          </div>
        </Row>

        {/* Backup */}
        <div className="section-title">Backup & sync to email</div>
        <Row>
          <p className="small muted">
            Your data lives on this device. Email a backup regularly so you can restore it
            anywhere — or hand it to your accountant as a CSV.
            {settings.lastBackupAt
              ? ` Last backup ${formatDistanceToNow(settings.lastBackupAt, { addSuffix: true })}.`
              : " No backup yet."}
          </p>
          <button className="btn btn-primary btn-block mt-16" onClick={doEmailBackup}>
            <IconMail /> Email / share backup
          </button>
          <div className="field-row mt-8">
            <button className="btn btn-ghost grow" onClick={async () => {
              const r = await downloadJsonBackup();
              toast(r.ok ? "Backup file downloaded." : r.error.message, r.ok ? "success" : "error");
            }}>
              <IconBackup /> Download
            </button>
            <button className="btn btn-ghost grow" onClick={async () => {
              const r = await downloadCsvReport(draft.currencySymbol);
              toast(r.ok ? "Sales CSV downloaded." : r.error.message, r.ok ? "success" : "error");
            }}>
              CSV report
            </button>
          </div>
          <button className="btn btn-ghost btn-block mt-8" onClick={() => fileRef.current?.click()}>
            <IconRestore /> Restore from backup file
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onRestoreFile} />
        </Row>

        {/* Automatic backups */}
        <div className="section-title">Automatic backups</div>
        <Row>
          <div className="switch-row">
            <div className="col">
              <span>Enable auto-backup</span>
              <span className="small muted">Backs up automatically when a backup is due</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={draft.autoBackupEnabled}
                onChange={(e) => set("autoBackupEnabled", e.target.checked)} />
              <span className="track" />
            </label>
          </div>

          {draft.autoBackupEnabled && (
            <>
              <div className="field mt-8">
                <label>How often</label>
                <select className="select" value={draft.autoBackupFrequency}
                  onChange={(e) => set("autoBackupFrequency", e.target.value as ShopSettings["autoBackupFrequency"])}>
                  <option value="open">Every time I open the app</option>
                  <option value="daily">Once a day</option>
                  <option value="weekly">Once a week</option>
                </select>
              </div>
              <div className="switch-row">
                <div className="col">
                  <span>Save a file to this device</span>
                  <span className="small muted">
                    {isNative() ? "Saved to the app's storage folder" : "Downloads a backup file"}
                  </span>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={draft.autoBackupToDevice}
                    onChange={(e) => set("autoBackupToDevice", e.target.checked)} />
                  <span className="track" />
                </label>
              </div>
              <div className="switch-row">
                <div className="col">
                  <span>Also open email / share</span>
                  <span className="small muted">Prompts to email the backup when due</span>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={draft.autoBackupEmail}
                    onChange={(e) => set("autoBackupEmail", e.target.checked)} />
                  <span className="track" />
                </label>
              </div>
              <button className="btn btn-ghost btn-block mt-8" onClick={async () => {
                await saveSettings(draft);
                setDirty(false);
                const r = await runAutoBackup({ ...draft });
                toast(r.savedTo ? `Backed up now (${r.products} products, ${r.sales} sales).` : "Backup run.", "success");
              }}>
                <IconBackup /> Run a backup now
              </button>
            </>
          )}
        </Row>

        <p className="center dim small mt-24">
          ShopFlow POS · v1.0 · offline-first · {platformName()}
        </p>
      </div>
    </>
  );
}
