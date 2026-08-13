"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var MarkdownTextEncoding_1 = require("./MarkdownTextEncoding");
describe('MarkdownTextEncoding', function () {
    it('preserves UTF-8 BOM and CRLF', function () {
        var body = new Uint8Array([0x23, 0x20, 0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x0a]);
        var input = new Uint8Array(3 + body.length);
        input.set([0xef, 0xbb, 0xbf]);
        input.set(body, 3);
        var decoded = (0, MarkdownTextEncoding_1.decodeMarkdownBytes)(input);
        expect(decoded.format).toEqual({ encoding: 'utf-8', bom: true, lineEnding: '\r\n' });
        var expectedBody = new Uint8Array([0x23, 0x20, 0x43, 0x0d, 0x0a, 0x44, 0x0d, 0x0a]);
        var expected = new Uint8Array(3 + expectedBody.length);
        expected.set([0xef, 0xbb, 0xbf]);
        expected.set(expectedBody, 3);
        expect((0, MarkdownTextEncoding_1.encodeMarkdownBytes)('# C\nD\n', decoded.format)).toEqual(expected);
    });
    it('preserves UTF-16LE BOM', function () {
        var input = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x0d, 0x00, 0x0a, 0x00]);
        var decoded = (0, MarkdownTextEncoding_1.decodeMarkdownBytes)(input);
        expect(decoded.text).toBe('A\r\n');
        expect(decoded.format.encoding).toBe('utf-16le');
        expect((0, MarkdownTextEncoding_1.encodeMarkdownBytes)('B\n', decoded.format)).toEqual(new Uint8Array([0xff, 0xfe, 0x42, 0x00, 0x0d, 0x00, 0x0a, 0x00]));
    });
});
//# sourceMappingURL=MarkdownTextEncoding.test.js.map