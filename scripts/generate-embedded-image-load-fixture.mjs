import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const output = resolve(process.argv[2] ?? "samples/v0.0.18.4-100-embedded-images.md");
const imageSize = 500;
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, crc]);
};
const rows = [];
for (let y = 0; y < imageSize; y += 1) {
  const row = Buffer.alloc(1 + imageSize * 4);
  for (let x = 0; x < imageSize; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = 66 + Math.floor((x / imageSize) * 80);
    row[offset + 1] = 140 + Math.floor((y / imageSize) * 70);
    row[offset + 2] = 220;
    row[offset + 3] = 255;
  }
  rows.push(row);
}
const png = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  chunk("IHDR", (() => { const data = Buffer.alloc(13); data.writeUInt32BE(imageSize, 0); data.writeUInt32BE(imageSize, 4); data[8] = 8; data[9] = 6; return data; })()),
  chunk("IDAT", deflateSync(Buffer.concat(rows))),
  chunk("IEND", Buffer.alloc(0)),
]);
const image = png.toString("base64");
const lines = ["# 100枚埋め込み画像負荷試験", "", "100枚のdata URL画像を順番に表示する負荷試験用Markdownです。", ""];
for (let index = 1; index <= 100; index += 1) lines.push(`![埋め込み画像 ${index}](data:image/png;base64,${image})`, ...(index < 100 ? [""] : []));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(output);
