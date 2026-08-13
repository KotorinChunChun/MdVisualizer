"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeMarkdownBytes = decodeMarkdownBytes;
exports.encodeMarkdownBytes = encodeMarkdownBytes;
var tslib_1 = require("tslib");
var Encoding = tslib_1.__importStar(require("encoding-japanese"));
var markdown_core_1 = require("@markdown-viewer/markdown-core");
function decodeUtf16(bytes, littleEndian) {
    var offset = bytes.length >= 2 ? 2 : 0;
    var characters = [];
    for (var index = offset; index + 1 < bytes.length; index += 2) {
        characters.push(littleEndian
            ? bytes[index] | (bytes[index + 1] << 8)
            : (bytes[index] << 8) | bytes[index + 1]);
    }
    return String.fromCharCode.apply(String, characters);
}
function decodeWithEncoding(bytes, from) {
    var unicode = Encoding.convert(Array.from(bytes), { from: from, to: 'UNICODE', type: 'array' });
    return Encoding.codeToString(unicode);
}
function isUtf8(bytes) {
    var detected = Encoding.detect(Array.from(bytes));
    return detected === 'UTF8' || detected === 'ASCII';
}
function decodeMarkdownBytes(bytes) {
    var encoding;
    var bom = false;
    var text;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        encoding = 'utf-8';
        bom = true;
        text = decodeWithEncoding(bytes.subarray(3), 'UTF8');
    }
    else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        encoding = 'utf-16le';
        bom = true;
        text = decodeUtf16(bytes, true);
    }
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        encoding = 'utf-16be';
        bom = true;
        text = decodeUtf16(bytes, false);
    }
    else if (isUtf8(bytes)) {
        encoding = 'utf-8';
        text = decodeWithEncoding(bytes, 'UTF8');
    }
    else {
        encoding = 'shift_jis';
        text = decodeWithEncoding(bytes, 'SJIS');
    }
    return { text: text, format: { encoding: encoding, bom: bom, lineEnding: (0, markdown_core_1.detectLineEnding)(text) } };
}
function encodeUtf16(text, littleEndian) {
    var output = new Uint8Array(text.length * 2);
    for (var index = 0; index < text.length; index += 1) {
        var unit = text.charCodeAt(index);
        output[index * 2] = littleEndian ? unit & 0xff : unit >> 8;
        output[index * 2 + 1] = littleEndian ? unit >> 8 : unit & 0xff;
    }
    return output;
}
function withPrefix(prefix, payload) {
    var output = new Uint8Array(prefix.length + payload.length);
    output.set(prefix, 0);
    output.set(payload, prefix.length);
    return output;
}
function encodeMarkdownBytes(text, format) {
    var normalized = (0, markdown_core_1.normalizeLineEndings)(text.replace(/^\uFEFF/, ''), format.lineEnding);
    switch (format.encoding) {
        case 'utf-8': {
            var unicode = Encoding.stringToCode(normalized);
            var payload = new Uint8Array(Encoding.convert(unicode, { from: 'UNICODE', to: 'UTF8', type: 'array' }));
            return format.bom ? withPrefix([0xef, 0xbb, 0xbf], payload) : payload;
        }
        case 'utf-16le': {
            var payload = encodeUtf16(normalized, true);
            return format.bom ? withPrefix([0xff, 0xfe], payload) : payload;
        }
        case 'utf-16be': {
            var payload = encodeUtf16(normalized, false);
            return format.bom ? withPrefix([0xfe, 0xff], payload) : payload;
        }
        case 'shift_jis': {
            var unicode = Encoding.stringToCode(normalized);
            var converted = Encoding.convert(unicode, { from: 'UNICODE', to: 'SJIS', type: 'array' });
            var roundTrip = Encoding.codeToString(Encoding.convert(converted, { from: 'SJIS', to: 'UNICODE', type: 'array' }));
            if (roundTrip !== normalized) {
                throw new Error('元のShift_JISで表現できない文字が含まれるため保存できません。');
            }
            return new Uint8Array(converted);
        }
    }
}
//# sourceMappingURL=MarkdownTextEncoding.js.map