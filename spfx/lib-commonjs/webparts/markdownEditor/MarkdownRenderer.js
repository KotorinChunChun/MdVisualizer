"use strict";
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarkdownRenderer = void 0;
var tslib_1 = require("tslib");
var markdown_core_1 = require("@markdown-viewer/markdown-core");
var unified_1 = require("unified");
var remark_parse_1 = tslib_1.__importDefault(require("remark-parse"));
var remark_gfm_1 = tslib_1.__importDefault(require("remark-gfm"));
var remark_rehype_1 = tslib_1.__importDefault(require("remark-rehype"));
var rehype_raw_1 = tslib_1.__importDefault(require("rehype-raw"));
var rehype_sanitize_1 = tslib_1.__importStar(require("rehype-sanitize"));
var rehype_stringify_1 = tslib_1.__importDefault(require("rehype-stringify"));
var schema = tslib_1.__assign(tslib_1.__assign({}, rehype_sanitize_1.defaultSchema), { attributes: tslib_1.__assign(tslib_1.__assign({}, rehype_sanitize_1.defaultSchema.attributes), { '*': tslib_1.__spreadArray(tslib_1.__spreadArray([], (((_a = rehype_sanitize_1.defaultSchema.attributes) === null || _a === void 0 ? void 0 : _a['*']) || []), true), [
            ['className', /^(?:language-[a-z0-9_-]+|hljs(?:-[a-z0-9_-]+)?)$/i],
            'id',
            'title'
        ], false), a: tslib_1.__spreadArray(tslib_1.__spreadArray([], (((_b = rehype_sanitize_1.defaultSchema.attributes) === null || _b === void 0 ? void 0 : _b.a) || []), true), ['target', 'rel'], false), img: tslib_1.__spreadArray(tslib_1.__spreadArray([], (((_c = rehype_sanitize_1.defaultSchema.attributes) === null || _c === void 0 ? void 0 : _c.img) || []), true), ['src', 'alt', 'width', 'height'], false) }), protocols: tslib_1.__assign(tslib_1.__assign({}, rehype_sanitize_1.defaultSchema.protocols), { href: tslib_1.__spreadArray([], markdown_core_1.MARKDOWN_ALLOWED_LINK_PROTOCOLS, true), src: tslib_1.__spreadArray([], markdown_core_1.MARKDOWN_ALLOWED_IMAGE_PROTOCOLS, true) }) });
var MarkdownRenderer = /** @class */ (function () {
    function MarkdownRenderer() {
        this._processor = (0, unified_1.unified)()
            .use(remark_parse_1.default)
            .use(remark_gfm_1.default)
            .use(remark_rehype_1.default, { allowDangerousHtml: true })
            .use(rehype_raw_1.default)
            .use(rehype_sanitize_1.default, schema)
            .use(rehype_stringify_1.default);
    }
    MarkdownRenderer.prototype.render = function (source) {
        return this._processor.processSync(source).toString();
    };
    return MarkdownRenderer;
}());
exports.MarkdownRenderer = MarkdownRenderer;
//# sourceMappingURL=MarkdownRenderer.js.map