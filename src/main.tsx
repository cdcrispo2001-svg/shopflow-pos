import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import { ToastProvider } from "@/core/components/Toast";
import { ensureSettings } from "@/core/db/database";
import "@/core/theme/global.css";

// Make sure the singleton shop-settings row exists before first render.
void ensureSettings();

// Router base — "" at root (dev/APK), "/shopflow-pos" on GitHub Pages.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
