"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICIAL_DRAWIO_EDITOR_URL = exports.OFFICIAL_DRAWIO_ORIGIN = void 0;
exports.resolveDrawioConnection = resolveDrawioConnection;
exports.OFFICIAL_DRAWIO_ORIGIN = 'https://embed.diagrams.net';
exports.OFFICIAL_DRAWIO_EDITOR_URL = "".concat(exports.OFFICIAL_DRAWIO_ORIGIN, "/?embed=1&proto=json&spin=1&libraries=1&noSaveBtn=1");
function httpsUrl(value, label) {
    var url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error("".concat(label, "\u306F\u8CC7\u683C\u60C5\u5831\u3092\u542B\u307E\u306A\u3044HTTPS URL\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002"));
    return url;
}
function resolveDrawioConnection(properties, currentWebUrl) {
    var mode = properties.mode || 'official';
    if (mode === 'disabled')
        return { mode: mode, enabled: false, external: false };
    if (mode === 'official') {
        return { mode: mode, enabled: true, editorUrl: new URL(exports.OFFICIAL_DRAWIO_EDITOR_URL), external: true };
    }
    if (mode === 'selfHosted') {
        var editorUrl_1 = httpsUrl(properties.editorUrl || '', '自社draw.io Editor URL');
        var viewerUrl = properties.viewerUrl ? httpsUrl(properties.viewerUrl, '自社draw.io Viewer URL') : undefined;
        return { mode: mode, enabled: true, editorUrl: editorUrl_1, viewerUrl: viewerUrl, external: editorUrl_1.origin !== new URL(currentWebUrl).origin };
    }
    var editorUrl = httpsUrl(properties.sharePointPageUrl || '', 'SharePoint draw.ioページURL');
    if (editorUrl.origin !== new URL(currentWebUrl).origin) {
        throw new Error('指定サイトのdraw.ioページは現在のSharePointと同一オリジンである必要があります。');
    }
    return { mode: mode, enabled: true, editorUrl: editorUrl, external: false };
}
//# sourceMappingURL=DrawioConnection.js.map