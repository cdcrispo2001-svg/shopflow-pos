import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { db } from "@/core/db/database";
import { Topbar } from "@/core/components/AppShell";
import { ProductImage } from "@/core/components/ProductImage";
import { EfrisStatusBanner } from "@/features/efris/EfrisStatusBanner";
import { useSettings } from "@/hooks/useSettings";
import { formatMoney, formatNumber } from "@/core/utils/format";
import {
  todayMetrics, metricsBetween, dailyTrend, topProducts, lowStockProducts, inventoryValue,
  paymentBreakdown, outstandingCredit,
} from "@/features/sales/reports";
import { subDays, startOfDay, endOfDay, formatDistanceToNow } from "date-fns";
import {
  IconTrend, IconWallet, IconReceipt, IconCart, IconBox, IconTag, IconBackup,
} from "@/core/components/icons";

type Range = 7 | 30;

export function DashboardPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const sales = useLiveQuery(() => db.sales.toArray(), [], []);
  const products = useLiveQuery(() => db.products.toArray(), [], []);
  const [range, setRange] = useState<Range>(7);

  const sym = settings.currencySymbol;
  const today = useMemo(() => todayMetrics(sales), [sales]);
  const { period, payments } = useMemo(() => {
    const from = startOfDay(subDays(new Date(), range - 1)).getTime();
    const to = endOfDay(new Date()).getTime();
    return { period: metricsBetween(sales, from, to), payments: paymentBreakdown(sales, from, to) };
  }, [sales, range]);
  const credit = useMemo(() => outstandingCredit(sales), [sales]);

  // Nudge to back up once the last backup is older than the reminder window.
  const backupNudge = useMemo(() => {
    const days = settings.backupReminderDays;
    if (!days || (sales.length === 0 && products.length === 0)) return null;
    const last = settings.lastBackupAt;
    if (!last) return "You haven't backed up your shop data yet.";
    if (Date.now() - last < days * 86_400_000) return null;
    return `Last backup was ${formatDistanceToNow(last, { addSuffix: true })}.`;
  }, [settings.backupReminderDays, settings.lastBackupAt, sales.length, products.length]);
  const paymentMax = Math.max(1, ...payments.map((p) => p.amount));
  const trend = useMemo(() => dailyTrend(sales, range), [sales, range]);
  const top = useMemo(() => topProducts(sales, range), [sales, range]);
  const lowStock = useMemo(() => lowStockProducts(products), [products]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const stockValue = useMemo(() => inventoryValue(products), [products]);

  const maxTrend = Math.max(1, ...trend.map((t) => t.revenue));

  return (
    <>
      <Topbar title={settings.name || "Dashboard"} subtitle="Live business overview" />
      <div className="page">
        <EfrisStatusBanner />
        {backupNudge && (
          <div className="list-item" style={{ borderColor: "rgba(245,158,11,0.4)" }}>
            <div className="thumb" style={{ background: "rgba(245,158,11,0.16)", color: "#fcd34d" }}>
              <IconBackup width={18} height={18} />
            </div>
            <div className="grow col">
              <span className="bold">Back up your data</span>
              <span className="small muted">{backupNudge}</span>
            </div>
            <button className="btn btn-accent btn-sm" onClick={() => navigate("/settings")}>Back up</button>
          </div>
        )}

        {/* Today headline */}
        <div className="stat-grid">
          <div className="stat accent">
            <div className="label"><IconWallet width={14} height={14} /> Today's sales</div>
            <div className="value">{formatMoney(today.revenue, sym)}</div>
            <div className="sub">{today.transactions} sale(s) · {today.itemsSold} items</div>
          </div>
          <div className="stat">
            <div className="label"><IconTrend width={14} height={14} /> Today's profit</div>
            <div className="value" style={{ color: today.profit >= 0 ? "var(--success)" : "var(--danger)" }}>
              {formatMoney(today.profit, sym)}
            </div>
            <div className="sub">Avg sale {formatMoney(today.avgSale, sym)}</div>
          </div>
        </div>

        {/* Range toggle */}
        <div className="between mt-24">
          <div className="section-title" style={{ margin: 0 }}>Sales trend</div>
          <div className="row gap-8">
            {([7, 30] as Range[]).map((r) => (
              <button key={r} className={`btn btn-sm ${range === r ? "btn-primary" : "btn-ghost"}`} onClick={() => setRange(r)}>
                {r}d
              </button>
            ))}
          </div>
        </div>

        <div className="card mt-8" style={{ paddingLeft: 4, paddingRight: 4 }}>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#26365a" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} width={36}
                  tickFormatter={(v) => { const n = Number(v); return n >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : `${n}`; }} domain={[0, maxTrend]} />
                <Tooltip
                  contentStyle={{ background: "#16213a", border: "1px solid #2b3a5c", borderRadius: 10, color: "#e8eefb", fontSize: 12 }}
                  formatter={(v) => formatMoney(Number(v), sym)} />
                <Area type="monotone" dataKey="revenue" stroke="#14b8a6" strokeWidth={2.5} fill="url(#rev)" name="Revenue" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="between" style={{ padding: "4px 12px 0" }}>
            <span className="small muted">Revenue ({range}d)</span>
            <span className="bold">{formatMoney(period.revenue, sym)}</span>
          </div>
          <div className="between" style={{ padding: "4px 12px" }}>
            <span className="small muted">Profit ({range}d)</span>
            <span className="bold" style={{ color: "var(--success)" }}>{formatMoney(period.profit, sym)}</span>
          </div>
        </div>

        {/* Secondary stats */}
        <div className="stat-grid mt-16">
          <div className="stat">
            <div className="label"><IconReceipt width={14} height={14} /> Transactions ({range}d)</div>
            <div className="value">{formatNumber(period.transactions)}</div>
          </div>
          <div className="stat">
            <div className="label"><IconBox width={14} height={14} /> Stock value</div>
            <div className="value">{formatMoney(stockValue, sym)}</div>
            <div className="sub">{products.length} product(s)</div>
          </div>
        </div>

        {/* Money owed on credit sales */}
        {credit.amount > 0 && (
          <button className="list-item full mt-16" style={{ textAlign: "left" }}
            onClick={() => navigate("/sales?view=credit")}>
            <div className="thumb" style={{ background: "rgba(245,158,11,0.16)", color: "#fcd34d" }}>
              <IconWallet width={18} height={18} />
            </div>
            <div className="grow col">
              <span className="bold">Owed by customers</span>
              <span className="small muted">{credit.receipts} unpaid credit sale(s) · {credit.customers} customer(s)</span>
            </div>
            <span className="bold" style={{ color: "var(--accent)" }}>{formatMoney(credit.amount, sym)}</span>
          </button>
        )}

        {/* How customers paid */}
        {payments.length > 0 && (
          <>
            <div className="section-title">Payment methods ({range}d)</div>
            <div className="card-flat" style={{ padding: 14 }}>
              {payments.map((p, i) => (
                <div key={p.method} className={i ? "mt-16" : undefined}>
                  <div className="between small">
                    <span>{p.method} <span className="dim">· {p.count} sale(s)</span></span>
                    <span className="bold">{formatMoney(p.amount, sym)}</span>
                  </div>
                  <div className="bar-track mt-8">
                    <div className="bar-fill" style={{ width: `${(p.amount / paymentMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Low stock */}
        {lowStock.length > 0 && (
          <>
            <div className="section-title">Restock alerts</div>
            {lowStock.slice(0, 5).map((p) => (
              <div key={p.id} className="list-item" onClick={() => navigate("/products")} role="button">
                <ProductImage product={p} size={44} />
                <div className="grow col">
                  <span className="bold">{p.name}</span>
                  <span className="small muted">Reorder level: {p.lowStockAt}</span>
                </div>
                <span className={`pill ${p.stock <= 0 ? "pill-danger" : "pill-warn"}`}>{p.stock} left</span>
              </div>
            ))}
          </>
        )}

        {/* Top products */}
        <div className="section-title">Best sellers ({range}d)</div>
        {top.length === 0 ? (
          <div className="empty"><IconTag /><p>No sales yet. Make a sale to see insights.</p></div>
        ) : (
          top.map((t, i) => (
            <div key={t.productId} className="list-item">
              <ProductImage product={productsById.get(t.productId) ?? { name: t.name }} size={44} />
              <div className="grow col">
                <span className="bold">#{i + 1} {t.name}</span>
                <span className="small muted">{t.qty} sold</span>
              </div>
              <span className="bold">{formatMoney(t.revenue, sym)}</span>
            </div>
          ))
        )}

        <button className="btn btn-primary btn-block btn-lg mt-24" onClick={() => navigate("/checkout")}>
          <IconCart /> New sale
        </button>
      </div>
    </>
  );
}
