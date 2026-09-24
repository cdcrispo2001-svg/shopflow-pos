import {
  aesDecrypt, aesEncrypt, base64ToBytes, bytesToBase64, bytesToUtf8, gunzip, signSha1, utf8ToBytes,
} from "@/features/efris/efrisCrypto";

// The URA EFRIS system-to-system message format. Every call is a POST of
// { data, globalInfo, returnStateInfo } to one endpoint; `globalInfo.interfaceCode`
// (T101, T109, ...) picks the operation and `data.content` carries the payload.

export class EfrisError extends Error {
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, options: { code?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = "EfrisError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}

export interface EfrisIdentity {
  tin: string;
  deviceNo: string;
  brn: string;
  taxpayerId: string;
  operator: string;
}

export interface EfrisEnvelope {
  data: {
    content: string;
    signature: string;
    dataDescription: { codeType: string; encryptCode: string; zipCode: string };
  };
  globalInfo: Record<string, unknown>;
  returnStateInfo: { returnCode: string; returnMessage: string };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "yyyy-MM-dd HH:mm:ss" in East Africa Time (UTC+3, no daylight saving). */
export function ugandaTime(ms = Date.now()): string {
  const d = new Date(ms + 3 * 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export const ugandaDate = (ms = Date.now()) => ugandaTime(ms).slice(0, 10);

export function exchangeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function globalInfo(interfaceCode: string, id: EfrisIdentity, now = Date.now()): Record<string, unknown> {
  return {
    appId: "AP04",
    version: "1.1.20191201",
    dataExchangeId: exchangeId(),
    interfaceCode,
    requestCode: "TP",
    requestTime: ugandaTime(now),
    responseCode: "TA",
    userName: "admin",
    deviceMAC: "FFFFFFFFFFFF",
    deviceNo: id.deviceNo,
    tin: id.tin,
    brn: id.brn,
    taxpayerID: id.taxpayerId || "1",
    longitude: "32.5825",
    latitude: "0.3476",
    agentType: "0",
    extendField: {
      responseDateFormat: "dd/MM/yyyy",
      responseTimeFormat: "dd/MM/yyyy HH:mm:ss",
      referenceNo: "",
      operatorName: id.operator,
    },
  };
}

function hasContent(content: unknown): boolean {
  if (content === null || content === undefined) return false;
  return typeof content !== "object" || Object.keys(content).length > 0;
}

/**
 * Builds a signed request. With `aesKeyHex` the content is AES-encrypted
 * (codeType 1); without it the content is plain base64 JSON (codeType 0).
 */
export async function buildRequest(
  interfaceCode: string,
  content: unknown,
  id: EfrisIdentity,
  keys: { privateKeyPem: string; aesKeyHex?: string },
): Promise<EfrisEnvelope> {
  let body = "";
  let signature = "";
  const encrypted = !!keys.aesKeyHex;
  if (hasContent(content)) {
    const json = JSON.stringify(content);
    body = encrypted ? await aesEncrypt(json, keys.aesKeyHex!) : bytesToBase64(utf8ToBytes(json));
    signature = await signSha1(body, keys.privateKeyPem);
  }
  return {
    data: {
      content: body,
      signature,
      dataDescription: { codeType: encrypted ? "1" : "0", encryptCode: encrypted ? "2" : "1", zipCode: "0" },
    },
    globalInfo: globalInfo(interfaceCode, id),
    returnStateInfo: { returnCode: "", returnMessage: "" },
  };
}

/** Checks URA's return state and decodes (unzips, decrypts) the reply content. */
export async function readResponse(raw: unknown, aesKeyHex?: string): Promise<unknown> {
  if (!raw || typeof raw !== "object") throw new EfrisError("URA sent an unreadable reply.", { retryable: true });
  const reply = raw as Partial<EfrisEnvelope>;
  const code = String(reply.returnStateInfo?.returnCode ?? "");
  const message = String(reply.returnStateInfo?.returnMessage ?? "");
  if (code !== "00" && message.toUpperCase() !== "SUCCESS") {
    throw new EfrisError(message || `URA returned error ${code || "(no code)"}.`, { code });
  }
  const content = reply.data?.content;
  if (!content || typeof content !== "string") return null;
  const description = reply.data?.dataDescription;
  let bytes = base64ToBytes(content);
  if (description?.zipCode === "1") bytes = await gunzip(bytes);
  let text: string;
  if (description?.codeType === "1") {
    if (!aesKeyHex) throw new EfrisError("URA sent an encrypted reply but no session key is available.");
    text = await aesDecrypt(bytes, aesKeyHex);
  } else {
    text = bytesToUtf8(bytes);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new EfrisError("URA's reply was not valid data.", { retryable: true });
  }
}
