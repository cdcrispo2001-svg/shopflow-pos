import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/core/components/AppShell";
import { DashboardPage } from "@/features/sales/DashboardPage";
import { CheckoutPage } from "@/features/billing/CheckoutPage";
import { ProductsPage } from "@/features/products/ProductsPage";
import { SalesPage } from "@/features/sales/SalesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useAutoBackup } from "@/hooks/useAutoBackup";

export default function App() {
  useAutoBackup();
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
