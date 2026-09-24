import { unsealAesKey } from "@/features/efris/efrisCrypto";
import {
  EfrisError, buildRequest, readResponse, ugandaDate, type EfrisIdentity,
} from "@/features/efris/efrisProtocol";
import { endpointFor, httpTransport, type EfrisTransport } from "@/features/efris/efrisTransport";
import {
  getEfrisConfig, getEfrisKey, getEfrisSession, saveEfrisSession, sessionScope,
  type EfrisConfig, type EfrisDictionary, type EfrisKeyMaterial,
} from "@/features/efris/efrisStore";

// High-level URA EFRIS calls. Interface codes follow URA's System-to-System
// interface design: T101 time, T103 sign-in, T104 session key, T106/T108
// invoice lookup, T109 invoice upload, T110 credit note, T115 dictionary,
// T130 goods registration.

const AES_TTL_MS = 23 * 3_600_000;

export interface SignInResult {
  legalName: string;
  businessName: string;
  taxpayerId: string;
  offlineDays: number;
  deviceStatus: string;
  vatRegistered?: boolean;
}

export interface FiscalResult {
  invoiceNo: string; // FDN
  invoiceId: string;
  antifakeCode: string; // verification code
  qrCode: string;
}

export interface EfrisGoods {
  operationType: "101" | "102"; // add | modify
  goodsName: string;
  goodsCode: string;
  measureUnit: string;
  unitPrice: string;
  currency: string;
  commodityCategoryId: string;
  haveExciseTax: "102";
  description: string;
  stockPrewarning: string;
  havePieceUnit: "102";
  haveOtherUnit: "102";
  goodsTypeCode: "101";
}

export interface GoodsResult { goodsCode: string; ok: boolean; message?: string }

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

/** What is still missing before the device can talk to URA. */
export function missingSetup(config: EfrisConfig, key: EfrisKeyMaterial | undefined): string[] {
  const missing: string[] = [];
  if (!/^\d{10}$/.test(config.tin)) missing.push("TIN");
  if (!config.deviceNo) missing.push("device number");
  if (!key) missing.push("private key file");
  return missing;
}

function fiscalResult(content: unknown): FiscalResult {
  const body = obj(content);
  const basic = obj(body.basicInformation);
  const result = {
    invoiceNo: text(basic.invoiceNo),
    invoiceId: text(basic.invoiceId),
    antifakeCode: text(basic.antifakeCode),
    qrCode: text(obj(body.summary).qrCode),
  };
  if (!result.invoiceNo) throw new EfrisError("URA accepted the request but sent no fiscal document number.");
  return result;
}

export class EfrisClient {
  private readonly config: EfrisConfig;
  private readonly key: EfrisKeyMaterial;
  private readonly transport: EfrisTransport;
  private readonly operator: string;

  constructor(config: EfrisConfig, key: EfrisKeyMaterial, transport: EfrisTransport = httpTransport, operator = "Cashier") {
    this.config = config;
    this.key = key;
    this.transport = transport;
    this.operator = operator;
  }

  static async fromStore(transport?: EfrisTransport, operator?: string): Promise<EfrisClient> {
    const [config, key] = await Promise.all([getEfrisConfig(), getEfrisKey()]);
    const missing = missingSetup(config, key);
    if (missing.length) throw new EfrisError(`Finish URA EFRIS setup in Settings: ${missing.join(", ")}.`);
    return new EfrisClient(config, key!, transport, operator);
  }

  private identity(): EfrisIdentity {
    const { tin, deviceNo, brn, taxpayerId } = this.config;
    return { tin, deviceNo, brn, taxpayerId, operator: this.operator };
  }

  private async exchange(code: string, content: unknown, aesKeyHex: string | undefined, encrypt: boolean) {
    const request = await buildRequest(code, content, this.identity(), {
      privateKeyPem: this.key.privateKeyPem,
      aesKeyHex: encrypt ? aesKeyHex : undefined,
    });
    return readResponse(await this.transport(endpointFor(this.config), request), aesKeyHex);
  }

  /** The AES session key (T104), cached for 23 hours per environment/TIN/device. */
  async aesKey(force = false): Promise<string> {
    const scope = sessionScope(this.config);
    const cached = await getEfrisSession();
    if (!force && cached?.scope === scope && Date.now() - cached.fetchedAt < AES_TTL_MS) return cached.aesKeyHex;
    const content = obj(await this.exchange("T104", null, undefined, false));
    const sealed = text(content.passowrdDes ?? content.passwordDes); // URA's spelling
    if (!sealed) throw new EfrisError("URA did not send a session key (T104).");
    let aesKeyHex: string;
    try {
      aesKeyHex = await unsealAesKey(sealed, this.key.privateKeyPem);
    } catch {
      throw new EfrisError("URA's session key does not match this private key. Check the key file and device number.");
    }
    await saveEfrisSession({ aesKeyHex, fetchedAt: Date.now(), scope });
    return aesKeyHex;
  }

  /** Sends with the session key, refreshing it once if URA rejects it. */
  private async call(code: string, content: unknown, encrypt: boolean): Promise<unknown> {
    try {
      return await this.exchange(code, content, await this.aesKey(), encrypt);
    } catch (error) {
      const keyProblem = error instanceof EfrisError && !error.retryable && /key|sign|decrypt|encrypt|secret|token/i.test(error.message);
      if (!keyProblem) throw error;
      return this.exchange(code, content, await this.aesKey(true), encrypt);
    }
  }

  async serverTime(): Promise<string> {
    return text(obj(await this.exchange("T101", null, undefined, false)).currentTime);
  }

  async signIn(): Promise<SignInResult> {
    const content = obj(await this.call("T103", null, false));
    const taxpayer = obj(content.taxpayer);
    const device = obj(content.device);
    const taxTypes = list(content.taxType).map(obj);
    const offlineDays = Number(device.offlineDays);
    return {
      legalName: text(taxpayer.legalName),
      businessName: text(taxpayer.businessName),
      taxpayerId: text(taxpayer.id) || "1",
      offlineDays: Number.isSafeInteger(offlineDays) && offlineDays > 0 ? offlineDays : 5,
      deviceStatus: text(device.deviceStatus),
      vatRegistered: taxTypes.length
        ? taxTypes.some((type) => /value added|\bvat\b/i.test(text(type.taxTypeName)))
        : undefined,
    };
  }

  async dictionary(): Promise<EfrisDictionary> {
    const content = obj(await this.call("T115", null, false));
    const units = list(content.rateUnit ?? content.rateUnits)
      .map(obj)
      .map((unit) => ({ code: text(unit.value ?? unit.code), name: text(unit.name) }))
      .filter((unit) => unit.code);
    return { units, fetchedAt: Date.now() };
  }

  async uploadGoods(goods: EfrisGoods[]): Promise<GoodsResult[]> {
    const replies = list(await this.call("T130", goods, true)).map(obj);
    return goods.map(({ goodsCode }) => {
      const reply = replies.find((r) => text(r.goodsCode ?? obj(r.commodityGoodsExtendEntity).goodsCode) === goodsCode);
      const code = text(reply?.returnCode);
      const message = text(reply?.returnMessage);
      const failed = !!reply && !!code && code !== "00" && !/exist/i.test(message);
      return { goodsCode, ok: !failed, message: failed ? message || `URA error ${code}` : undefined };
    });
  }

  async uploadInvoice(invoice: unknown): Promise<FiscalResult> {
    return fiscalResult(await this.call("T109", invoice, true));
  }

  /** Recovers an invoice URA already has (e.g. after a timeout) by our reference number. */
  async findInvoice(referenceNo: string, issuedAt: number): Promise<FiscalResult | null> {
    const day = 86_400_000;
    const query = {
      referenceNo,
      startDate: ugandaDate(issuedAt - day),
      endDate: ugandaDate(issuedAt + day),
      pageNo: "1",
      pageSize: "10",
      queryType: "1",
    };
    const record = list(obj(await this.call("T106", query, true)).records).map(obj)[0];
    if (!record?.invoiceNo) return null;
    return fiscalResult(await this.call("T108", { invoiceNo: text(record.invoiceNo) }, true));
  }

  /** Credit note application (T110); URA returns a reference number to track approval. */
  async applyCreditNote(application: unknown): Promise<string> {
    const referenceNo = text(obj(await this.call("T110", application, true)).referenceNo);
    if (!referenceNo) throw new EfrisError("URA accepted the credit note but sent no reference number.");
    return referenceNo;
  }
}
