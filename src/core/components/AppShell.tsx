import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  IconDashboard, IconCart, IconBox, IconReceipt, IconSettings,
} from "@/core/components/icons";

const NAV = [
  { to: "/", label: "Home", Icon: IconDashboard, end: true },
  { to: "/checkout", label: "Sell", Icon: IconCart, end: false },
  { to: "/products", label: "Products", Icon: IconBox, end: false },
  { to: "/sales", label: "Sales", Icon: IconReceipt, end: false },
  { to: "/settings", label: "Settings", Icon: IconSettings, end: false },
];

interface TopbarProps { title: string; subtitle?: string; right?: ReactNode; }

export function Topbar({ title, subtitle, right }: TopbarProps) {
  return (
    <div className="topbar">
      <div className="col">
        <h1>{title}</h1>
        {subtitle && <span className="subtitle">{subtitle}</span>}
      </div>
      {right}
    </div>
  );
}

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="bottom-nav">
      {NAV.map(({ to, label, Icon, end }) => {
        const active = end ? pathname === to : pathname.startsWith(to);
        return (
          <NavLink key={to} to={to} className={`nav-item ${active ? "active" : ""}`}>
            <Icon />
            <span>{label}</span>
            <span className="nav-dot" />
          </NavLink>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      {children}
      <BottomNav />
    </div>
  );
}
