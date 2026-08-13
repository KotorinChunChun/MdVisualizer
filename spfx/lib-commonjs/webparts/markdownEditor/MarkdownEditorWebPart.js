"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var tslib_1 = require("tslib");
var sp_core_library_1 = require("@microsoft/sp-core-library");
var sp_property_pane_1 = require("@microsoft/sp-property-pane");
var sp_http_1 = require("@microsoft/sp-http");
var sp_webpart_base_1 = require("@microsoft/sp-webpart-base");
var DrawioConnection_1 = require("./DrawioConnection");
var MarkdownEditorController_1 = require("./MarkdownEditorController");
var SharePointMarkdownFileBrowser_1 = require("./SharePointMarkdownFileBrowser");
var SharePointMarkdownRepository_1 = require("./SharePointMarkdownRepository");
require("./MarkdownEditor.global.scss");
var MarkdownEditorWebPart = /** @class */ (function (_super) {
    tslib_1.__extends(MarkdownEditorWebPart, _super);
    function MarkdownEditorWebPart() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this._files = [];
        _this._dirty = false;
        _this._generation = 0;
        return _this;
    }
    MarkdownEditorWebPart.prototype.render = function () {
        var _this = this;
        var _a;
        this._generation += 1;
        var generation = this._generation;
        (_a = this._editor) === null || _a === void 0 ? void 0 : _a.dispose();
        this.domElement.innerHTML = '';
        var root = document.createElement('section');
        root.className = 'spfxMarkdownEditor';
        var commands = document.createElement('div');
        commands.className = 'spfxMarkdownCommandBar';
        var refresh = this._button('ファイル一覧', function () { void _this._loadFileChoices(generation); });
        var select = document.createElement('select');
        select.setAttribute('aria-label', 'Markdownファイル');
        select.append(new Option('Markdownファイルを選択してください', ''));
        select.addEventListener('change', function () {
            if (select.value)
                void _this._selectFile(select.value, generation);
        });
        var modes = ['edit', 'split', 'preview'];
        var labels = { edit: '編集のみ', split: '編集／閲覧', preview: '閲覧のみ' };
        modes.forEach(function (mode) {
            var button = _this._button(labels[mode], function () {
                var _a;
                (_a = _this._editor) === null || _a === void 0 ? void 0 : _a.setMode(mode);
                commands.querySelectorAll('[data-view-mode]').forEach(function (item) { return item.setAttribute('aria-pressed', String(item.dataset.viewMode === mode)); });
            });
            button.dataset.viewMode = mode;
            button.setAttribute('aria-pressed', String(mode === 'split'));
            commands.appendChild(button);
        });
        commands.prepend(refresh, select);
        var status = document.createElement('p');
        status.className = 'spfxMarkdownStatus';
        status.setAttribute('role', 'status');
        status.textContent = 'ファイル一覧を読み込んでください。';
        var editorHost = document.createElement('div');
        editorHost.className = 'spfxMarkdownEditorHost';
        root.append(commands, status, editorHost);
        this.domElement.appendChild(root);
        try {
            var connection = (0, DrawioConnection_1.resolveDrawioConnection)({
                mode: this.properties.drawioConnectionMode,
                editorUrl: this.properties.drawioEditorUrl,
                viewerUrl: this.properties.drawioViewerUrl,
                sharePointPageUrl: this.properties.drawioSharePointPageUrl
            }, this._webUrl);
            this._editor = new MarkdownEditorController_1.MarkdownEditorController({
                root: editorHost,
                drawioConnection: connection,
                onChanged: function () { _this._dirty = true; status.textContent = '未保存の変更があります。'; },
                onSave: function () { void _this._saveFile(generation); }
            });
        }
        catch (error) {
            status.textContent = "draw.io\u8A2D\u5B9A\u30A8\u30E9\u30FC: ".concat(this._message(error));
            return;
        }
        if (this.properties.serverRelativeFileUrl) {
            void this._selectFile(this.properties.serverRelativeFileUrl, generation);
        }
        else {
            void this._loadFileChoices(generation);
        }
    };
    MarkdownEditorWebPart.prototype.onDispose = function () {
        var _a;
        this._generation += 1;
        (_a = this._editor) === null || _a === void 0 ? void 0 : _a.dispose();
        this._editor = undefined;
    };
    MarkdownEditorWebPart.prototype.onThemeChanged = function (currentTheme) {
        if (!currentTheme)
            return;
        var semanticColors = currentTheme.semanticColors;
        if (!semanticColors)
            return;
        this.domElement.style.setProperty('--bodyText', semanticColors.bodyText || '');
        this.domElement.style.setProperty('--bodyBackground', semanticColors.bodyBackground || '');
    };
    Object.defineProperty(MarkdownEditorWebPart.prototype, "dataVersion", {
        get: function () { return sp_core_library_1.Version.parse('1.0'); },
        enumerable: false,
        configurable: true
    });
    MarkdownEditorWebPart.prototype.getPropertyPaneConfiguration = function () {
        return {
            pages: [{
                    header: { description: 'Markdown Editor接続設定' },
                    groups: [{
                            groupName: 'SharePoint',
                            groupFields: [
                                (0, sp_property_pane_1.PropertyPaneTextField)('sourceWebUrl', { label: 'SharePointサイトURL（空欄は現在のサイト）' }),
                                (0, sp_property_pane_1.PropertyPaneTextField)('documentLibrary', { label: '文書ライブラリ（空欄はすべて）' }),
                                (0, sp_property_pane_1.PropertyPaneTextField)('subfolderPath', { label: 'サブフォルダー' }),
                                (0, sp_property_pane_1.PropertyPaneDropdown)('drawioConnectionMode', {
                                    label: 'draw.io接続',
                                    options: [
                                        { key: 'official', text: '公式diagrams.net' },
                                        { key: 'selfHosted', text: '自社ホスト' },
                                        { key: 'tenantSite', text: '指定SharePointサイト' },
                                        { key: 'disabled', text: '無効' }
                                    ]
                                }),
                                (0, sp_property_pane_1.PropertyPaneTextField)('drawioEditorUrl', { label: '自社draw.io Editor URL' }),
                                (0, sp_property_pane_1.PropertyPaneTextField)('drawioViewerUrl', { label: '自社draw.io Viewer URL' }),
                                (0, sp_property_pane_1.PropertyPaneTextField)('drawioSharePointPageUrl', { label: 'SharePoint draw.ioページURL' })
                            ]
                        }]
                }]
        };
    };
    Object.defineProperty(MarkdownEditorWebPart.prototype, "_webUrl", {
        get: function () {
            return (this.properties.sourceWebUrl || this.context.pageContext.web.absoluteUrl).replace(/\/$/, '');
        },
        enumerable: false,
        configurable: true
    });
    MarkdownEditorWebPart.prototype._loadFileChoices = function (generation) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var status, browser, files, select_1, error_1;
            return tslib_1.__generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        status = this._status;
                        status.textContent = 'Markdownファイルを検索しています…';
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        browser = new SharePointMarkdownFileBrowser_1.SharePointMarkdownFileBrowser(this.context.spHttpClient, sp_http_1.SPHttpClient.configurations.v1, this._webUrl);
                        return [4 /*yield*/, browser.list(this.properties.documentLibrary || '', this.properties.subfolderPath || '')];
                    case 2:
                        files = _a.sent();
                        if (generation !== this._generation)
                            return [2 /*return*/];
                        this._files = files;
                        select_1 = this.domElement.querySelector('select');
                        if (!select_1)
                            return [2 /*return*/];
                        select_1.innerHTML = '';
                        select_1.append(new Option(files.length ? 'Markdownファイルを選択してください' : 'Markdownファイルがありません', ''));
                        files.forEach(function (file) { return select_1.append(new Option("".concat(file.libraryTitle, " / ").concat(file.relativeFilePath), file.serverRelativeUrl)); });
                        status.textContent = "".concat(files.length, "\u4EF6\u306EMarkdown\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u3057\u305F\u3002");
                        return [3 /*break*/, 4];
                    case 3:
                        error_1 = _a.sent();
                        status.textContent = "\u30D5\u30A1\u30A4\u30EB\u4E00\u89A7\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ".concat(this._message(error_1));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    MarkdownEditorWebPart.prototype._selectFile = function (path, generation) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var status, repository, snapshot, selected, error_2;
            var _a;
            return tslib_1.__generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (this._dirty && !window.confirm('未保存の変更を破棄して別のファイルを開きますか？'))
                            return [2 /*return*/];
                        status = this._status;
                        status.textContent = 'Markdownを読み込んでいます…';
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        repository = new SharePointMarkdownRepository_1.SharePointMarkdownRepository(this.context.spHttpClient, sp_http_1.SPHttpClient.configurations.v1, this._webUrl, path);
                        return [4 /*yield*/, repository.load()];
                    case 2:
                        snapshot = _b.sent();
                        if (generation !== this._generation)
                            return [2 /*return*/];
                        this._repository = repository;
                        this._snapshot = snapshot;
                        this._dirty = false;
                        this.properties.serverRelativeFileUrl = path;
                        (_a = this._editor) === null || _a === void 0 ? void 0 : _a.setValue(snapshot.content);
                        selected = this._files.find(function (file) { return file.serverRelativeUrl === path; });
                        status.textContent = "".concat((selected === null || selected === void 0 ? void 0 : selected.name) || path, " \u3092\u8AAD\u307F\u8FBC\u307F\u307E\u3057\u305F\uFF08").concat(snapshot.format.encoding).concat(snapshot.format.bom ? '・BOMあり' : '', "\uFF09\u3002");
                        return [3 /*break*/, 4];
                    case 3:
                        error_2 = _b.sent();
                        status.textContent = "Markdown\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F: ".concat(this._message(error_2));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    MarkdownEditorWebPart.prototype._saveFile = function (generation) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var snapshot, error_3;
            return tslib_1.__generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this._repository || !this._snapshot || !this._editor) {
                            this._status.textContent = '保存するMarkdownファイルを選択してください。';
                            return [2 /*return*/];
                        }
                        this._status.textContent = '保存しています…';
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this._repository.save(this._editor.value, this._snapshot)];
                    case 2:
                        snapshot = _a.sent();
                        if (generation !== this._generation)
                            return [2 /*return*/];
                        this._snapshot = snapshot;
                        this._dirty = false;
                        this._status.textContent = 'SharePointへ保存しました。';
                        return [3 /*break*/, 4];
                    case 3:
                        error_3 = _a.sent();
                        this._status.textContent = "\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ".concat(this._message(error_3));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    Object.defineProperty(MarkdownEditorWebPart.prototype, "_status", {
        get: function () {
            var status = this.domElement.querySelector('.spfxMarkdownStatus');
            if (!status)
                throw new Error('状態表示領域がありません。');
            return status;
        },
        enumerable: false,
        configurable: true
    });
    MarkdownEditorWebPart.prototype._button = function (label, action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', action);
        return button;
    };
    MarkdownEditorWebPart.prototype._message = function (error) { return error instanceof Error ? error.message : String(error); };
    return MarkdownEditorWebPart;
}(sp_webpart_base_1.BaseClientSideWebPart));
exports.default = MarkdownEditorWebPart;
//# sourceMappingURL=MarkdownEditorWebPart.js.map