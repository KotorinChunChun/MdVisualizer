import Encoding from "encoding-japanese";
export type TextEncoding = "UTF-8" | "UTF-16LE" | "UTF-16BE" | "Shift_JIS";
export function detectEncoding(bytes: Uint8Array): TextEncoding {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "UTF-16LE";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "UTF-16BE";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "UTF-8";
  const detected = Encoding.detect([...bytes], ["UTF16LE", "UTF16BE", "UTF8", "SJIS"]) as string;
  if (detected === "UTF16LE") return "UTF-16LE";
  if (detected === "UTF16BE") return "UTF-16BE";
  return detected === "SJIS" ? "Shift_JIS" : "UTF-8";
}
export function decode(bytes: Uint8Array, encoding: TextEncoding) { const label = encoding === "Shift_JIS" ? "shift_jis" : encoding.toLowerCase(); return new TextDecoder(label).decode(bytes); }
export function hasBom(bytes: Uint8Array): boolean {
  return (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) || (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
}
export function encode(text: string, encoding: TextEncoding, bom = false): Uint8Array {
  const withPrefix = (bytes: Uint8Array, prefix: number[]) => { const result = new Uint8Array(prefix.length + bytes.length); result.set(prefix); result.set(bytes, prefix.length); return result; };
  if (encoding === "UTF-8") { const bytes = new TextEncoder().encode(text); return bom ? withPrefix(bytes, [0xef, 0xbb, 0xbf]) : bytes; }
  const charset = encoding === "Shift_JIS" ? "SJIS" : encoding === "UTF-16LE" ? "UTF16LE" : "UTF16BE";
  const bytes = new Uint8Array(Encoding.convert(text, { to: charset, from: "UNICODE", type: "array" }) as number[]);
  if (encoding === "Shift_JIS") {
    const roundtrip = Encoding.convert([...bytes], { to: "UNICODE", from: "SJIS", type: "string" }) as string;
    if (roundtrip !== text) throw new Error("Shift_JISで保存できない文字があります。UTF-8へ切り替えてください。");
    return bytes;
  }
  return bom ? withPrefix(bytes, encoding === "UTF-16LE" ? [0xff, 0xfe] : [0xfe, 0xff]) : bytes;
}
