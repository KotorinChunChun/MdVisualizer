"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharePointMarkdownFileBrowser = void 0;
var tslib_1 = require("tslib");
var markdown_core_1 = require("@markdown-viewer/markdown-core");
var SharePointMarkdownFileBrowser = /** @class */ (function () {
    function SharePointMarkdownFileBrowser(_client, _configuration, webUrl) {
        this._client = _client;
        this._configuration = _configuration;
        this._webUrl = webUrl.replace(/\/$/, '');
    }
    SharePointMarkdownFileBrowser.prototype.listLibraries = function () {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var url, response, rows;
            return tslib_1.__generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        url = "".concat(this._webUrl, "/_api/web/lists?") +
                            '$select=Id,Title,RootFolder/Name,RootFolder/ServerRelativeUrl&$expand=RootFolder&' +
                            '$filter=Hidden%20eq%20false%20and%20BaseTemplate%20eq%20101&$top=5000';
                        return [4 /*yield*/, this._client.get(url, this._configuration, { headers: { Accept: 'application/json;odata=nometadata' } })];
                    case 1:
                        response = _a.sent();
                        return [4 /*yield*/, this._ensureSuccess(response, 'SharePointの文書ライブラリ一覧を取得できませんでした。')];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, response.json()];
                    case 3:
                        rows = (_a.sent()).value || [];
                        return [2 /*return*/, rows.map(function (row) {
                                var _a, _b;
                                return ({
                                    id: row.Id,
                                    title: row.Title,
                                    rootFolderName: ((_a = row.RootFolder) === null || _a === void 0 ? void 0 : _a.Name) || row.Title,
                                    rootFolderServerRelativeUrl: ((_b = row.RootFolder) === null || _b === void 0 ? void 0 : _b.ServerRelativeUrl) || ''
                                });
                            }).filter(function (row) { return row.rootFolderServerRelativeUrl; })];
                }
            });
        });
    };
    SharePointMarkdownFileBrowser.prototype.list = function () {
        return tslib_1.__awaiter(this, arguments, void 0, function (librarySelector, subfolder) {
            var libraries, selector, selected, result;
            var _a;
            var _this = this;
            if (librarySelector === void 0) { librarySelector = ''; }
            if (subfolder === void 0) { subfolder = ''; }
            return tslib_1.__generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.listLibraries()];
                    case 1:
                        libraries = _b.sent();
                        selector = this._normalize(librarySelector).toLocaleLowerCase('ja');
                        selected = selector ? libraries.filter(function (library) { return [library.title, library.rootFolderName]
                            .some(function (value) { return _this._normalize(value).toLocaleLowerCase('ja') === selector; }); }) : libraries;
                        if (selector && selected.length === 0)
                            throw new Error("\u6587\u66F8\u30E9\u30A4\u30D6\u30E9\u30EA\u300C".concat(librarySelector, "\u300D\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002"));
                        return [4 /*yield*/, Promise.all(selected.map(function (library) { return _this._listLibrary(library, subfolder); }))];
                    case 2:
                        result = _b.sent();
                        return [2 /*return*/, (_a = []).concat.apply(_a, result).sort(function (left, right) { return left.serverRelativeUrl.localeCompare(right.serverRelativeUrl, 'ja'); })];
                }
            });
        });
    };
    SharePointMarkdownFileBrowser.prototype._listLibrary = function (library, subfolder) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var result, root, child, queue, folder, endpoint, _a, files, folders;
            var _this = this;
            return tslib_1.__generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        result = [];
                        root = "/".concat(this._normalize(library.rootFolderServerRelativeUrl));
                        child = this._normalize(subfolder);
                        queue = ["".concat(root).concat(child ? "/".concat(child) : '')];
                        _b.label = 1;
                    case 1:
                        if (!(queue.length > 0)) return [3 /*break*/, 3];
                        folder = queue.shift();
                        endpoint = "".concat(this._webUrl, "/_api/web/GetFolderByServerRelativePath(decodedUrl='").concat(folder.replace(/'/g, "''"), "')");
                        return [4 /*yield*/, Promise.all([
                                this._getCollection("".concat(endpoint, "/Files?$select=Name,ServerRelativeUrl,TimeLastModified&$top=5000")),
                                this._getCollection("".concat(endpoint, "/Folders?$select=Name,ServerRelativeUrl&$top=5000"))
                            ])];
                    case 2:
                        _a = _b.sent(), files = _a[0], folders = _a[1];
                        files.forEach(function (file) {
                            if (!file.Name || !file.ServerRelativeUrl || !(0, markdown_core_1.isMarkdownDocumentName)(file.Name))
                                return;
                            var normalized = "/".concat(_this._normalize(file.ServerRelativeUrl));
                            result.push({
                                name: file.Name,
                                serverRelativeUrl: normalized,
                                libraryTitle: library.title,
                                relativeFilePath: normalized.startsWith("".concat(root, "/")) ? normalized.slice(root.length + 1) : file.Name,
                                lastModified: file.TimeLastModified
                            });
                        });
                        folders.forEach(function (folderRow) { if (folderRow.ServerRelativeUrl)
                            queue.push("/".concat(_this._normalize(folderRow.ServerRelativeUrl))); });
                        return [3 /*break*/, 1];
                    case 3: return [2 /*return*/, result];
                }
            });
        });
    };
    SharePointMarkdownFileBrowser.prototype._getCollection = function (initialUrl) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var rows, url, response, page;
            return tslib_1.__generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        rows = [];
                        url = initialUrl;
                        _a.label = 1;
                    case 1:
                        if (!url) return [3 /*break*/, 5];
                        return [4 /*yield*/, this._client.get(url, this._configuration, { headers: { Accept: 'application/json;odata=nometadata' } })];
                    case 2:
                        response = _a.sent();
                        return [4 /*yield*/, this._ensureSuccess(response, 'SharePointのファイル一覧を取得できませんでした。')];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, response.json()];
                    case 4:
                        page = _a.sent();
                        rows.push.apply(rows, (page.value || []));
                        url = page['@odata.nextLink'];
                        return [3 /*break*/, 1];
                    case 5: return [2 /*return*/, rows];
                }
            });
        });
    };
    SharePointMarkdownFileBrowser.prototype._normalize = function (value) {
        return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
    };
    SharePointMarkdownFileBrowser.prototype._ensureSuccess = function (response, prefix) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            return tslib_1.__generator(this, function (_a) {
                if (response.ok)
                    return [2 /*return*/];
                throw new Error("".concat(prefix, " HTTP ").concat(response.status, " ").concat(response.statusText));
            });
        });
    };
    return SharePointMarkdownFileBrowser;
}());
exports.SharePointMarkdownFileBrowser = SharePointMarkdownFileBrowser;
//# sourceMappingURL=SharePointMarkdownFileBrowser.js.map