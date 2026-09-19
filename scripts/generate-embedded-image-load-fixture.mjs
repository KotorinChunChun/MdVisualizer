import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = resolve(process.argv[2] ?? "samples/v0.0.18.4-100-embedded-images.md");
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const lines = ["# 100枚埋め込み画像負荷試験", "", "100枚のdata URL画像を順番に表示する負荷試験用Markdownです。", ""];
for (let index = 1; index <= 100; index += 1) lines.push(`![埋め込み画像 ${index}](data:image/png;base64,${pixel})`, ...(index < 100 ? [""] : []));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(output);
