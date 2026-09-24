import type { EfrisTaxCategory, ProductEfris } from "@/core/types/models";
import { useEfrisUnits } from "@/features/efris/efrisStore";
import { taxCategoryFor } from "@/features/efris/efrisInvoice";

interface Props {
  value?: ProductEfris;
  barcode?: string;
  taxRate: number;
  onChange: (next: ProductEfris) => void;
}

const URA_FIELDS: (keyof ProductEfris)[] = ["goodsCode", "commodityCode", "unitCode", "taxCategory"];

/** URA EFRIS details for a product (shown only when EFRIS is on). */
export function EfrisProductFields({ value, barcode, taxRate, onChange }: Props) {
  const units = useEfrisUnits();
  const efris = value ?? {};
  const category = taxCategoryFor({ efris }, taxRate);

  // Changing what URA knows about an item means it has to be registered again.
  function update(patch: Partial<ProductEfris>) {
    const next: ProductEfris = { ...efris, ...patch };
    if (URA_FIELDS.some((field) => field in patch && patch[field] !== efris[field])) delete next.registeredAt;
    onChange(next);
  }

  return (
    <div className="card-flat efris-box">
      <div className="between">
        <span className="bold">URA EFRIS</span>
        <span className={`pill ${efris.registeredAt ? "pill-ok" : "pill-warn"}`}>
          {efris.registeredAt ? "Registered with URA" : "Not registered yet"}
        </span>
      </div>
      <div className="field-row mt-8">
        <div className="field">
          <label>Commodity code *</label>
          <input className="input" inputMode="numeric" value={efris.commodityCode ?? ""} placeholder="e.g. 50161509"
            onChange={(e) => update({ commodityCode: e.target.value.replace(/\D/g, "") || undefined })} />
        </div>
        <div className="field">
          <label>Unit code</label>
          <input className="input" list="efris-units" value={efris.unitCode ?? ""} placeholder="101"
            onChange={(e) => update({ unitCode: e.target.value.trim() || undefined })} />
          <datalist id="efris-units">
            {units.map((unit) => <option key={unit.code} value={unit.code}>{unit.name}</option>)}
          </datalist>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>VAT category</label>
          <select className="select" value={category}
            onChange={(e) => update({ taxCategory: e.target.value as EfrisTaxCategory })}>
            <option value="01">Standard 18%</option>
            <option value="02">Zero-rated 0%</option>
            <option value="03">Exempt</option>
          </select>
        </div>
        <div className="field">
          <label>URA goods code</label>
          <input className="input" value={efris.goodsCode ?? ""} placeholder={barcode || "Uses the barcode"}
            onChange={(e) => update({ goodsCode: e.target.value.trim() || undefined })} />
        </div>
      </div>
      {category === "01" && taxRate !== 18 && (
        <p className="small" style={{ color: "#fcd34d" }}>Standard-rated items must have a tax rate of 18%.</p>
      )}
      <p className="small muted">
        Commodity codes are on the EFRIS portal under Goods &amp; Services. Each item needs one before URA
        e-receipts can be issued for it; then register it from Settings → URA EFRIS.
      </p>
    </div>
  );
}
