import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";
import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

const output = resolve(process.argv[2] ?? "web/tests/.php-zip-fixtures");
await mkdir(output, { recursive: true });

const b64url = value => Buffer.from(value).toString("base64url");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const claims = { iss: "https://accounts.google.com", aud: "client-google", sub: "google-user", nonce: "nonce-google", iat: 1700000000, exp: 1700000600 };
const header = { alg: "RS256", typ: "JWT", kid: "test-key" };
const signing = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
const signer = createSign("RSA-SHA256");
signer.update(signing);
await writeFile(resolve(output, "oidc.json"), JSON.stringify({ privatePem: privateKey.export({ format: "pem", type: "pkcs8" }), jwk: { keys: [{ ...jwk, kid: "test-key", use: "sig", alg: "RS256" }] }, jwt: `${signing}.${signer.sign(privateKey).toString("base64url")}` }));

async function makeZip(name, entries, options = {}) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [entryName, content] of entries) {
    await writer.add(entryName, new TextReader(content), options);
  }
  const blob = await writer.close();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(resolve(output, name), bytes);
  return bytes;
}

await makeZip("plain.zip", [["document.txt", "plain"]]);
await makeZip("encrypted.zip", [["document.txt", "encrypted"]], { password: "test-password", encryptionStrength: 3 });
const traversal = await makeZip("traversal.zip", [["../escape.txt", "escape"]], { password: "test-password", encryptionStrength: 3 });
const fs = await import("node:fs/promises");
const tampered = new Uint8Array(await fs.readFile(resolve(output, "encrypted.zip")));
tampered[Math.min(40, tampered.length - 1)] ^= 0xff;
await writeFile(resolve(output, "tampered.zip"), tampered);

const oversized = new Uint8Array(await fs.readFile(resolve(output, "encrypted.zip")));
const central = Buffer.from(oversized).lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
if (central < 0) throw new Error("central directory not found");
new DataView(oversized.buffer, oversized.byteOffset, oversized.byteLength).setUint32(central + 24, 128 * 1024 * 1024 + 1, true);
await writeFile(resolve(output, "oversized.zip"), oversized);
