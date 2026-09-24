import { CapacitorHttp } from "@capacitor/core";
import { isNative } from "@/core/utils/platform";
import { EfrisError } from "@/features/efris/efrisProtocol";
import type { EfrisConfig } from "@/features/efris/efrisStore";

// HTTP to URA. The Android app posts directly with native HTTP (no CORS). A
// browser cannot call URA's servers directly, so the web app posts to a relay
// the shop runs (scripts/efris-relay.mjs) which forwards to URA unchanged.

export type EfrisTransport = (url: string, body: unknown) => Promise<unknown>;

export const URA_ENDPOINTS = {
  sandbox: "https://efristest.ura.go.ug/efrisws/ws/taapp/getInformation",
  production: "https://efrisws.ura.go.ug/ws/taapp/getInformation",
} as const;

const TIMEOUT_MS = 60_000;

export function endpointFor(config: Pick<EfrisConfig, "environment" | "relayUrl">): string {
  if (!isNative() && config.relayUrl) return `${config.relayUrl.replace(/\/+$/, "")}/${config.environment}`;
  return URA_ENDPOINTS[config.environment];
}

export const httpTransport: EfrisTransport = async (url, body) => {
  if (isNative()) {
    let res;
    try {
      res = await CapacitorHttp.post({
        url,
        headers: { "Content-Type": "application/json" },
        data: body,
        connectTimeout: 20_000,
        readTimeout: TIMEOUT_MS,
      });
    } catch {
      throw new EfrisError("Could not reach URA. Check the internet connection.", { retryable: true });
    }
    if (res.status >= 400) throw new EfrisError(`URA server answered HTTP ${res.status}.`, { retryable: res.status >= 500 });
    return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    const direct = Object.values(URA_ENDPOINTS).some((endpoint) => url === endpoint);
    throw new EfrisError(
      direct
        ? "Could not reach URA from the browser. Use the Android app, or set an EFRIS relay address in Settings."
        : "Could not reach the EFRIS relay. Check the internet connection and relay address.",
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new EfrisError(`EFRIS server answered HTTP ${res.status}.`, { retryable: res.status >= 500 || res.status === 429 });
  try {
    return await res.json();
  } catch {
    throw new EfrisError("EFRIS server sent an unreadable reply.", { retryable: true });
  }
};
