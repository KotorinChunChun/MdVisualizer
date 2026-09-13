import * as Encoding from 'encoding-japanese';
import { detectLineEnding, normalizeLineEndings, type MarkdownLineEnding } from '@mdvisualizer/markdown-core';

export type MarkdownEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis';

export interface IMarkdownBinaryFormat {
  encoding: MarkdownEncoding;
  bom: boolean;
  lineEnding: MarkdownLineEnding;
}

export interface IDecodedMarkdown {
  text: string;
  format: IMarkdownBinaryFormat;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const offset = bytes.length >= 2 ? 2 : 0;
  const characters: number[] = [];
  for (let index = offset; index + 1 < bytes.length; index += 2) {
    characters.push(littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1]);
  }
  return String.fromCharCode(...characters);
}

function decodeWithEncoding(bytes: Uint8Array, from: 'UTF8' | 'SJIS'): string {
  const unicode = Encoding.convert(Array.from(bytes), { from, to: 'UNICODE', type: 'array' });
  return Encoding.codeToString(unicode);
}

function isUtf8(bytes: Uint8Array): boolean {
  const detected = Encoding.detect(Array.from(bytes));
  return detected === 'UTF8' || detected === 'ASCII';
}

export function decodeMarkdownBytes(bytes: Uint8Array): IDecodedMarkdown {
  let encoding: MarkdownEncoding;
  let bom = false;
  let text: string;

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8';
    bom = true;
    text = decodeWithEncoding(bytes.subarray(3), 'UTF8');
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    bom = true;
    text = decodeUtf16(bytes, true);
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    bom = true;
    text = decodeUtf16(bytes, false);
  } else if (isUtf8(bytes)) {
    encoding = 'utf-8';
    text = decodeWithEncoding(bytes, 'UTF8');
  } else {
    encoding = 'shift_jis';
    text = decodeWithEncoding(bytes, 'SJIS');
  }

  return { text, format: { encoding, bom, lineEnding: detectLineEnding(text) } };
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const output = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    output[index * 2] = littleEndian ? unit & 0xff : unit >> 8;
    output[index * 2 + 1] = littleEndian ? unit >> 8 : unit & 0xff;
  }
  return output;
}

function withPrefix(prefix: number[], payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(prefix.length + payload.length);
  output.set(prefix, 0);
  output.set(payload, prefix.length);
  return output;
}

export function encodeMarkdownBytes(text: string, format: IMarkdownBinaryFormat): Uint8Array {
  const normalized = normalizeLineEndings(text.replace(/^\uFEFF/, ''), format.lineEnding);
  switch (format.encoding) {
    case 'utf-8': {
      const unicode = Encoding.stringToCode(normalized);
      const payload = new Uint8Array(Encoding.convert(unicode, { from: 'UNICODE', to: 'UTF8', type: 'array' }));
      return format.bom ? withPrefix([0xef, 0xbb, 0xbf], payload) : payload;
    }
    case 'utf-16le': {
      const payload = encodeUtf16(normalized, true);
      return format.bom ? withPrefix([0xff, 0xfe], payload) : payload;
    }
    case 'utf-16be': {
      const payload = encodeUtf16(normalized, false);
      return format.bom ? withPrefix([0xfe, 0xff], payload) : payload;
    }
    case 'shift_jis': {
      const unicode = Encoding.stringToCode(normalized);
      const converted = Encoding.convert(unicode, { from: 'UNICODE', to: 'SJIS', type: 'array' });
      const roundTrip = Encoding.codeToString(Encoding.convert(converted, { from: 'SJIS', to: 'UNICODE', type: 'array' }));
      if (roundTrip !== normalized) {
        throw new Error('元のShift_JISで表現できない文字が含まれるため保存できません。');
      }
      return new Uint8Array(converted);
    }
  }
}
