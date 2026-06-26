import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { db } from "@/core/db/database";
import { Topbar } from "@/core/components/AppShell";
import { useSettings } from "@/hooks/useSettings";
import { formatMoney, formatNumber } from "@/core/utils/format";
import {
  todayMetrics, metricsBetween, dailyTrend, topProducts, lowStockProducts, inventoryValue,
} from "@/features/sales/reports";
import { subDays, startOfDay, endOfDay } from "date-fns";
import {
  IconTrend, IconWallet, IconReceipt, IconAlert, IconCart, IconBox, IconTag,
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
  const period = useMemo(() => {
    const from = startOfDay(subDays(new Date(), range - 1)).getTime();
    const to = endOfDay(new Date()).getTime();
    return metricsBetween(sales, from, to);
  }, [sales, range]);
  const trend = useMemo(() => dailyTrend(sales, range), [sales, range]);
  const top = useMemo(() => topProducts(sales, range), [sales, range]);
  const lowStock = useMemo(() => lowStockProducts(products), [products]);
  const stockValue = useMemo(() => inventoryValue(products), [products]);

  const maxTrend = Math.max(1, ...trend.map((t) => t.revenue));

  return (
    <>
      <Topbar title={settings.name || "Dashboard"} subtitle="Live business overview" />
      <div className="page">
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
                  tickFormatter={(v) => { const n = Number(v); return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`; }} domain={[0, maxTrend]} />
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

        {/* Low stock */}
        {lowStock.length > 0 && (
          <>
            <div className="section-title">Restock alerts</div>
            {lowStock.slice(0, 5).map((p) => (
              <div key={p.id} className="list-item" onClick={() => navigate("/products")} role="button">
                <div className="thumb" style={{ background: "var(--danger-soft)", color: "#fca5a5" }}>
                  <IconAlert width={18} height={18} />
                </div>
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
            <div key={t.name} className="list-item">
              <div className="thumb">#{i + 1}</div>
              <div className="grow col">
                <span className="bold">{t.name}</span>
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
