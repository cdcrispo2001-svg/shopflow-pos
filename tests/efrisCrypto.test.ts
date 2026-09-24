import { beforeAll, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import forge from "node-forge";
import {
  aesDecrypt, aesEncrypt, base64ToBytes, importKeyFile, signSha1, unsealAesKey,
} from "@/features/efris/efrisCrypto";
import { EfrisError, buildRequest, readResponse, ugandaTime } from "@/features/efris/efrisProtocol";

let keys: forge.pki.rsa.KeyPair;
let pem: string;
const aesHex = "00112233445566778899aabbccddeeff";
const identity = { tin: "1000000000", deviceNo: "TCS123", brn: "", taxpayerId: "1", operator: "Amina" };

beforeAll(() => {
  keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  pem = forge.pki.privateKeyToPem(keys.privateKey);
});

function verify(data: string, signature: string): boolean {
  const md = forge.md.sha1.create();
  md.update(data, "utf8");
  return keys.publicKey.verify(md.digest().bytes(), forge.util.decode64(signature));
}

describe("EFRIS crypto", () => {
  it("round-trips AES-ECB content, including non-ASCII text", async () => {
    const text = JSON.stringify({ item: "Ssukaali 1kg — ✓", total: "4500.00" });
    const sealed = await aesEncrypt(text, aesHex);
    expect(await aesDecrypt(base64ToBytes(sealed), aesHex)).toBe(text);
  });

  it("signs with SHA1withRSA that the public key verifies", async () => {
    expect(verify("payload", await signSha1("payload", pem))).toBe(true);
  });

  it("opens the AES key URA seals to the device (T104)", async () => {
    const key = forge.random.getBytesSync(16);
    const sealed = forge.util.encode64(keys.publicKey.encrypt(forge.util.encode64(key), "RSAES-PKCS1-V1_5"));
    expect(await unsealAesKey(sealed, pem)).toBe(forge.util.bytesToHex(key));
  });

  it("imports a password-protected .p12 key file and rejects a wrong password", async () => {
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    const subject = [{ name: "commonName", value: "TCS123" }];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "s3cret", { algorithm: "3des" })).getBytes();
    const bytes = Uint8Array.from(der, (char) => char.charCodeAt(0));

    const imported = await importKeyFile(bytes, "s3cret");
    expect(imported.subject).toBe("TCS123");
    expect(imported.fingerprint).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
    expect(verify("x", await signSha1("x", imported.privateKeyPem))).toBe(true);
    await expect(importKeyFile(bytes, "wrong")).rejects.toThrow(/password/);
  });
});

describe("EFRIS protocol", () => {
  it("builds signed, encrypted requests with URA's global info", async () => {
    const request = await buildRequest("T109", { hello: "URA" }, identity, { privateKeyPem: pem, aesKeyHex: aesHex });
    expect(request.data.dataDescription).toEqual({ codeType: "1", encryptCode: "2", zipCode: "0" });
    expect(verify(request.data.content, request.data.signature)).toBe(true);
    expect(JSON.parse(await aesDecrypt(base64ToBytes(request.data.content), aesHex))).toEqual({ hello: "URA" });
    expect(request.globalInfo).toMatchObject({ interfaceCode: "T109", tin: "1000000000", deviceNo: "TCS123", appId: "AP04" });
    expect(String(request.globalInfo.dataExchangeId)).toMatch(/^[0-9A-F]{32}$/);
  });

  it("sends empty content unsigned (e.g. T104)", async () => {
    const request = await buildRequest("T104", null, identity, { privateKeyPem: pem });
    expect(request.data).toMatchObject({ content: "", signature: "", dataDescription: { codeType: "0" } });
  });

  it("reads gzipped + encrypted replies and raises URA errors", async () => {
    const encrypted = base64ToBytes(await aesEncrypt(JSON.stringify({ ok: true }), aesHex));
    const reply = {
      data: { content: gzipSync(encrypted).toString("base64"), dataDescription: { codeType: "1", encryptCode: "2", zipCode: "1" } },
      returnStateInfo: { returnCode: "00", returnMessage: "SUCCESS" },
    };
    expect(await readResponse(reply, aesHex)).toEqual({ ok: true });

    const failure = readResponse({ returnStateInfo: { returnCode: "2124", returnMessage: "Device is not registered" } });
    await expect(failure).rejects.toBeInstanceOf(EfrisError);
    await expect(failure).rejects.toMatchObject({ code: "2124", retryable: false });
  });

  it("formats times in East Africa Time", () => {
    expect(ugandaTime(Date.UTC(2026, 8, 24, 21, 30, 5))).toBe("2026-09-25 00:30:05");
  });
});
