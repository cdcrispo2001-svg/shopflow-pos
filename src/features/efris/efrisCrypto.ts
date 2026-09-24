import type * as ForgeTypes from "node-forge";

// EFRIS cryptography. URA uses RSA PKCS#1 v1.5 and AES-ECB, neither of which
// the browser's WebCrypto offers, so node-forge is loaded on demand (only for
// shops that switch EFRIS on).
//   - Request/response content: AES-ECB + PKCS#7, base64.
//   - Signature: SHA1withRSA over the base64 content, private key of the device.
//   - T104 returns the AES key encrypted to the device's public key.

type Forge = typeof ForgeTypes;
type PrivateKey = ForgeTypes.pki.rsa.PrivateKey;

let forgeLoad: Promise<Forge> | null = null;

export function loadForge(): Promise<Forge> {
  forgeLoad ??= import("node-forge").then((mod) => ((mod as { default?: Forge }).default ?? mod) as Forge);
  return forgeLoad;
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBinary(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return binary;
}

const fromBinary = (binary: string) => Uint8Array.from(binary, (char) => char.charCodeAt(0));

function hexToBinary(hex: string): string {
  if (!/^[0-9a-f]+$/i.test(hex) || ![32, 48, 64].includes(hex.length)) throw new Error("EFRIS session key is invalid.");
  return toBinary(Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16)));
}

const keyCache = new Map<string, PrivateKey>();

async function privateKey(pem: string): Promise<PrivateKey> {
  const cached = keyCache.get(pem);
  if (cached) return cached;
  const forge = await loadForge();
  const key = forge.pki.privateKeyFromPem(pem) as PrivateKey;
  keyCache.clear();
  keyCache.set(pem, key);
  return key;
}

export async function aesEncrypt(plaintext: string, keyHex: string): Promise<string> {
  const forge = await loadForge();
  const cipher = forge.cipher.createCipher("AES-ECB", hexToBinary(keyHex));
  cipher.start();
  cipher.update(forge.util.createBuffer(plaintext, "utf8"));
  cipher.finish(); // PKCS#7 padding
  return forge.util.encode64(cipher.output.getBytes());
}

export async function aesDecrypt(cipherBytes: Uint8Array, keyHex: string): Promise<string> {
  const forge = await loadForge();
  const decipher = forge.cipher.createDecipher("AES-ECB", hexToBinary(keyHex));
  decipher.start();
  decipher.update(forge.util.createBuffer(toBinary(cipherBytes)));
  if (!decipher.finish()) throw new Error("URA reply could not be decrypted.");
  return bytesToUtf8(fromBinary(decipher.output.getBytes()));
}

export async function signSha1(data: string, privateKeyPem: string): Promise<string> {
  const forge = await loadForge();
  const md = forge.md.sha1.create();
  md.update(data, "utf8");
  return forge.util.encode64((await privateKey(privateKeyPem)).sign(md));
}

/** Opens the AES key URA sealed to this device (T104 `passowrdDes`), returned as hex. */
export async function unsealAesKey(sealedBase64: string, privateKeyPem: string): Promise<string> {
  const forge = await loadForge();
  const opened = (await privateKey(privateKeyPem)).decrypt(forge.util.decode64(sealedBase64), "RSAES-PKCS1-V1_5");
  // URA sends the key base64-encoded inside the RSA envelope.
  let key = /^[A-Za-z0-9+/]+=*$/.test(opened) ? fromBinary(forge.util.decode64(opened)) : fromBinary(opened);
  if (key.length === 0) key = fromBinary(opened);
  if (key.length === 8) key = Uint8Array.from([...key, ...key]);
  if (![16, 24, 32].includes(key.length)) key = key.slice(0, 16);
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) throw new Error("URA sent an encryption key of an unexpected size.");
  return [...key].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ImportedKey {
  privateKeyPem: string;
  fingerprint: string;
  subject: string;
}

async function describeKey(forge: Forge, key: PrivateKey, subject: string): Promise<ImportedKey> {
  const publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  const der = forge.asn1.toDer(forge.pki.publicKeyToAsn1(publicKey)).getBytes();
  const hex = forge.md.sha256.create().update(der).digest().toHex();
  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    fingerprint: hex.slice(0, 16).toUpperCase().match(/..../g)!.join(" "),
    subject,
  };
}

/**
 * Reads the device's private key from the key file made with URA's key tool:
 * a .p12/.pfx (password protected) or a PEM private key.
 */
export async function importKeyFile(bytes: Uint8Array, password: string): Promise<ImportedKey> {
  const forge = await loadForge();
  const head = bytesToUtf8(bytes.slice(0, 64));
  if (head.includes("-----BEGIN")) {
    const pem = bytesToUtf8(bytes);
    let key: PrivateKey | null = null;
    try {
      key = pem.includes("ENCRYPTED")
        ? (forge.pki.decryptRsaPrivateKey(pem, password) as PrivateKey | null)
        : (forge.pki.privateKeyFromPem(pem) as PrivateKey);
    } catch {
      key = null;
    }
    if (!key) throw new Error("Could not read the PEM private key. Check the password.");
    return describeKey(forge, key, "");
  }
  let p12: ForgeTypes.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(toBinary(bytes)), false, password);
  } catch {
    throw new Error("Could not open the key file. Check the password and that it is a .p12 or .pfx file.");
  }
  const { oids } = forge.pki;
  const bags = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
  ];
  const key = bags.find((bag) => bag.key)?.key as PrivateKey | undefined;
  if (!key) throw new Error("The key file has no private key in it.");
  const cert = p12.getBags({ bagType: oids.certBag })[oids.certBag]?.[0]?.cert;
  const subject = String(cert?.subject.getField("CN")?.value ?? "");
  return describeKey(forge, key, subject);
}
