import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.shopflow.pos",
  appName: "ShopFlow POS",
  webDir: "dist",
  android: {
    // Allow the WebView to share files (backups) via content URIs.
    allowMixedContent: false,
  },
};

export default config;
