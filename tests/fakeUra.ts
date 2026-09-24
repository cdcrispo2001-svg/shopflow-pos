import forge from "node-forge";
import { EfrisError, type EfrisEnvelope } from "@/features/efris/efrisProtocol";

// A stand-in for URA's EFRIS server that speaks the real wire format: it checks
// SHA1withRSA signatures, seals the AES session key to the device's public key
// (T104) and encrypts/decrypts content with AES-ECB, like the real service.

type Json = Record<string, unknown>;

export class FakeUra {
  readonly aesKey = forge.random.getBytesSync(16);
  readonly requests: { code: string; content: Json | Json[] | null }[] = [];
  readonly invoices = new Map<string, { invoiceNo: string; invoiceId: string; antifakeCode: string }>();
  offline = false;
  loseNextInvoiceReply = false;
  private readonly publicKey: forge.pki.rsa.PublicKey;

  constructor(publicKey: forge.pki.rsa.PublicKey) {
    this.publicKey = publicKey;
  }

  private encrypt(value: unknown): string {
    const cipher = forge.cipher.createCipher("AES-ECB", this.aesKey);
    cipher.start();
    cipher.update(forge.util.createBuffer(JSON.stringify(value), "utf8"));
    cipher.finish();
    return forge.util.encode64(cipher.output.getBytes());
  }

  private decrypt(base64: string): unknown {
    const decipher = forge.cipher.createDecipher("AES-ECB", this.aesKey);
    decipher.start();
    decipher.update(forge.util.createBuffer(forge.util.decode64(base64)));
    if (!decipher.finish()) throw new Error("bad padding");
    return JSON.parse(forge.util.decodeUtf8(decipher.output.getBytes()));
  }

  private reply(content: unknown, encrypted: boolean) {
    return {
      data: {
        content: content === null ? "" : encrypted ? this.encrypt(content) : Buffer.from(JSON.stringify(content)).toString("base64"),
        signature: "",
        dataDescription: { codeType: encrypted ? "1" : "0", encryptCode: encrypted ? "2" : "1", zipCode: "0" },
      },
      returnStateInfo: { returnCode: "00", returnMessage: "SUCCESS" },
    };
  }

  private error(code: string, message: string) {
    return { data: { content: "" }, returnStateInfo: { returnCode: code, returnMessage: message } };
  }

  transport = async (_url: string, body: unknown): Promise<unknown> => {
    if (this.offline) throw new EfrisError("Could not reach URA.", { retryable: true });
    const envelope = body as EfrisEnvelope;
    const code = String(envelope.globalInfo.interfaceCode);
    let content: Json | Json[] | null = null;
    if (envelope.data.content) {
      const md = forge.md.sha1.create();
      md.update(envelope.data.content, "utf8");
      if (!this.publicKey.verify(md.digest().bytes(), forge.util.decode64(envelope.data.signature))) {
        return this.error("11", "Signature verification failed");
      }
      content = envelope.data.dataDescription.codeType === "1"
        ? (this.decrypt(envelope.data.content) as Json)
        : JSON.parse(Buffer.from(envelope.data.content, "base64").toString("utf8"));
    }
    this.requests.push({ code, content });

    switch (code) {
      case "T101":
        return this.reply({ currentTime: "24/09/2026 10:00:00" }, false);
      case "T104": {
        const sealed = this.publicKey.encrypt(forge.util.encode64(this.aesKey), "RSAES-PKCS1-V1_5");
        return this.reply({ passowrdDes: forge.util.encode64(sealed), sign: "" }, false);
      }
      case "T103":
        return this.reply({
          taxpayer: { id: "42", legalName: "Kampala Traders Ltd", businessName: "Kampala Traders" },
          device: { deviceStatus: "252", offlineDays: "5" },
          taxType: [{ taxTypeName: "Value Added Tax" }],
        }, true);
      case "T115":
        return this.reply({ rateUnit: [{ value: "101", name: "Stick" }, { value: "PP", name: "Piece" }] }, true);
      case "T130":
        return this.reply([], true);
      case "T109": {
        const invoice = content as Json;
        const reference = String((invoice.sellerDetails as Json).referenceNo);
        if (this.invoices.has(reference)) return this.error("2253", "The referenceNo already exists");
        const fiscal = {
          invoiceNo: `3240000${this.invoices.size + 1}`,
          invoiceId: `ID${this.invoices.size + 1}`,
          antifakeCode: "12345678901234567890",
        };
        this.invoices.set(reference, fiscal);
        if (this.loseNextInvoiceReply) {
          this.loseNextInvoiceReply = false;
          throw new EfrisError("Could not reach URA.", { retryable: true });
        }
        return this.reply({ basicInformation: fiscal, summary: { qrCode: `https://efris.ura.go.ug/v/${fiscal.invoiceNo}` } }, true);
      }
      case "T106": {
        const found = this.invoices.get(String((content as Json).referenceNo));
        return this.reply({ records: found ? [{ invoiceNo: found.invoiceNo, id: found.invoiceId }] : [] }, true);
      }
      case "T108": {
        const found = [...this.invoices.values()].find((fiscal) => fiscal.invoiceNo === (content as Json).invoiceNo);
        return this.reply({ basicInformation: found, summary: { qrCode: `https://efris.ura.go.ug/v/${found?.invoiceNo}` } }, true);
      }
      case "T110":
        return this.reply({ referenceNo: "CN0001" }, true);
      default:
        return this.error("99", `Unknown interface ${code}`);
    }
  };

  count(code: string): number {
    return this.requests.filter((request) => request.code === code).length;
  }

  last(code: string): Json {
    return [...this.requests].reverse().find((request) => request.code === code)?.content as Json;
  }
}
