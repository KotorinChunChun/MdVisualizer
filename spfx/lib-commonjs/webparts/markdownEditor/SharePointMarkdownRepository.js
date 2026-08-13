"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharePointMarkdownRepository = exports.SharePointSaveConflictError = void 0;
var tslib_1 = require("tslib");
var MarkdownTextEncoding_1 = require("./MarkdownTextEncoding");
var SharePointSaveConflictError = /** @class */ (function (_super) {
    tslib_1.__extends(SharePointSaveConflictError, _super);
    function SharePointSaveConflictError() {
        var _this = _super.call(this, 'SharePoint上のファイルが別のユーザーまたは処理によって更新されています。再読込して差分を確認してください。') || this;
        _this.name = 'SharePointSaveConflictError';
        Object.setPrototypeOf(_this, SharePointSaveConflictError.prototype);
        return _this;
    }
    return SharePointSaveConflictError;
}(Error));
exports.SharePointSaveConflictError = SharePointSaveConflictError;
var SharePointMarkdownRepository = /** @class */ (function () {
    function SharePointMarkdownRepository(_client, _configuration, webUrl, serverRelativeFileUrl) {
        this._client = _client;
        this._configuration = _configuration;
        var normalizedWebUrl = webUrl.replace(/\/$/, '');
        var escapedPath = serverRelativeFileUrl.replace(/'/g, "''");
        this._fileEndpoint = "".concat(normalizedWebUrl, "/_api/web/GetFileByServerRelativePath(decodedUrl='").concat(escapedPath, "')");
    }
    SharePointMarkdownRepository.prototype.load = function () {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var _a, metadata, contentResponse, bytes, _b, decoded, etag;
            return tslib_1.__generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, Promise.all([
                            this._loadMetadata(),
                            this._client.get("".concat(this._fileEndpoint, "/$value"), this._configuration, {
                                headers: { Accept: 'application/octet-stream' }
                            })
                        ])];
                    case 1:
                        _a = _c.sent(), metadata = _a[0], contentResponse = _a[1];
                        return [4 /*yield*/, this._ensureSuccess(contentResponse, 'Markdownファイルを読み込めませんでした。')];
                    case 2:
                        _c.sent();
                        _b = Uint8Array.bind;
                        return [4 /*yield*/, contentResponse.arrayBuffer()];
                    case 3:
                        bytes = new (_b.apply(Uint8Array, [void 0, _c.sent()]))();
                        decoded = (0, MarkdownTextEncoding_1.decodeMarkdownBytes)(bytes);
                        etag = metadata.ETag || contentResponse.headers.get('ETag') || '';
                        if (!etag)
                            throw new Error('SharePointからeTagを取得できないため、安全な保存を開始できません。');
                        return [2 /*return*/, { content: decoded.text, format: decoded.format, etag: etag, lastModified: metadata.TimeLastModified }];
                }
            });
        });
    };
    SharePointMarkdownRepository.prototype.save = function (content, snapshot) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var payload, body, response, metadata;
            return tslib_1.__generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!snapshot.etag)
                            throw new Error('保存に必要なeTagがありません。ファイルを再読込してください。');
                        payload = (0, MarkdownTextEncoding_1.encodeMarkdownBytes)(content, snapshot.format);
                        body = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
                        return [4 /*yield*/, this._client.post("".concat(this._fileEndpoint, "/$value"), this._configuration, {
                                body: body,
                                headers: {
                                    Accept: 'application/json;odata=nometadata',
                                    'Content-Type': 'application/octet-stream',
                                    'IF-MATCH': snapshot.etag,
                                    'X-HTTP-Method': 'PUT'
                                }
                            })];
                    case 1:
                        response = _a.sent();
                        if (response.status === 412)
                            throw new SharePointSaveConflictError();
                        return [4 /*yield*/, this._ensureSuccess(response, 'Markdownファイルを保存できませんでした。')];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, this._loadMetadata()];
                    case 3:
                        metadata = _a.sent();
                        if (!metadata.ETag)
                            throw new Error('保存は完了しましたが、新しいeTagを取得できませんでした。再読込してください。');
                        return [2 /*return*/, { content: content, format: snapshot.format, etag: metadata.ETag, lastModified: metadata.TimeLastModified }];
                }
            });
        });
    };
    SharePointMarkdownRepository.prototype._loadMetadata = function () {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var response;
            return tslib_1.__generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._client.get("".concat(this._fileEndpoint, "?$select=ETag,TimeLastModified"), this._configuration, { headers: { Accept: 'application/json;odata=nometadata' } })];
                    case 1:
                        response = _a.sent();
                        return [4 /*yield*/, this._ensureSuccess(response, 'SharePointファイルのメタデータを取得できませんでした。')];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, response.json()];
                }
            });
        });
    };
    SharePointMarkdownRepository.prototype._ensureSuccess = function (response, prefix) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var detail, _a;
            return tslib_1.__generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (response.ok)
                            return [2 /*return*/];
                        detail = '';
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, response.text()];
                    case 2:
                        detail = (_b.sent()).slice(0, 500);
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [3 /*break*/, 4];
                    case 4: throw new Error("".concat(prefix, " HTTP ").concat(response.status, " ").concat(response.statusText).concat(detail ? ": ".concat(detail) : ''));
                }
            });
        });
    };
    return SharePointMarkdownRepository;
}());
exports.SharePointMarkdownRepository = SharePointMarkdownRepository;
//# sourceMappingURL=SharePointMarkdownRepository.js.map