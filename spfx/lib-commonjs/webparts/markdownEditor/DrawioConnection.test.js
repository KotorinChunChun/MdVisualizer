"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var DrawioConnection_1 = require("./DrawioConnection");
describe('resolveDrawioConnection', function () {
    it('uses the official editor only for official mode', function () {
        var _a;
        expect((_a = (0, DrawioConnection_1.resolveDrawioConnection)({ mode: 'official' }, 'https://tenant.sharepoint.com/sites/wiki').editorUrl) === null || _a === void 0 ? void 0 : _a.origin)
            .toBe(DrawioConnection_1.OFFICIAL_DRAWIO_ORIGIN);
    });
    it('accepts a same-origin SharePoint page and rejects another host', function () {
        expect((0, DrawioConnection_1.resolveDrawioConnection)({
            mode: 'tenantSite',
            sharePointPageUrl: 'https://tenant.sharepoint.com/sites/tools/SitePages/drawio.aspx'
        }, 'https://tenant.sharepoint.com/sites/wiki').external).toBe(false);
        expect(function () { return (0, DrawioConnection_1.resolveDrawioConnection)({
            mode: 'tenantSite',
            sharePointPageUrl: 'https://other.example/drawio'
        }, 'https://tenant.sharepoint.com/sites/wiki'); }).toThrow('同一オリジン');
    });
});
//# sourceMappingURL=DrawioConnection.test.js.map