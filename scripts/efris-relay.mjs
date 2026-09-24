// EFRIS relay for the ShopFlow web app. Browsers cannot call URA's EFRIS
// servers directly (URA sends no CORS headers), so the web app posts its
// already signed and encrypted requests here and this forwards them to URA
// unchanged. It never decrypts, logs or stores request contents.
// The Android app does not need it.
//
//   ALLOWED_ORIGIN=https://crispookalia.github.io PORT=8787 node scripts/efris-relay.mjs
//
// Put it behind HTTPS, then set Settings → URA EFRIS → relay address to its URL.
import { createServer } from "node:http";

const TARGETS = {
  "/sandbox": "https://efristest.ura.go.ug/efrisws/ws/taapp/getInformation",
  "/production": "https://efrisws.ura.go.ug/ws/taapp/getInformation",
};
const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED = (process.env.ALLOWED_ORIGIN ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
const MAX_BODY = 2_000_000;

if (ALLOWED.length === 0) {
  console.error("Set ALLOWED_ORIGIN to the web app's address, e.g. ALLOWED_ORIGIN=https://crispookalia.github.io");
  process.exit(1);
}

function allowCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

const server = createServer(async (req, res) => {
  const allowed = allowCors(req, res);
  const target = TARGETS[(req.url ?? "").split("?")[0]];
  if (req.method === "OPTIONS") {
    res.writeHead(allowed && target ? 204 : 403).end();
    return;
  }
  if (req.method !== "POST" || !target) {
    res.writeHead(404).end();
    return;
  }
  if (!allowed) {
    res.writeHead(403).end();
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(60_000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" }).end(body);
  } catch {
    res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Could not reach URA EFRIS." }));
  }
});

server.listen(PORT, () => {
  console.log(`EFRIS relay listening on port ${PORT} for ${ALLOWED.join(", ")}`);
});
