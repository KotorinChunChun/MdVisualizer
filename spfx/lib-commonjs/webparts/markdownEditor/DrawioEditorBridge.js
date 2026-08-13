"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DrawioEditorBridge = void 0;
function parseMessage(event, source, origin) {
    if (!source || event.source !== source || event.origin !== origin)
        return undefined;
    try {
        var value = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        return value && typeof value === 'object' ? value : undefined;
    }
    catch (_a) {
        return undefined;
    }
}
var DrawioEditorBridge = /** @class */ (function () {
    function DrawioEditorBridge(_connection, _onSave) {
        var _this = this;
        this._connection = _connection;
        this._onSave = _onSave;
        this._source = '';
        this._receive = function (event) {
            var _a, _b, _c, _d;
            var origin = (_a = _this._connection.editorUrl) === null || _a === void 0 ? void 0 : _a.origin;
            if (!origin)
                return;
            var message = parseMessage(event, ((_b = _this._frame) === null || _b === void 0 ? void 0 : _b.contentWindow) || null, origin);
            if (!message)
                return;
            if (message.event === 'init') {
                (_d = (_c = _this._frame) === null || _c === void 0 ? void 0 : _c.contentWindow) === null || _d === void 0 ? void 0 : _d.postMessage(JSON.stringify({
                    action: 'load',
                    xml: _this._source,
                    title: 'Markdown diagram',
                    noSaveBtn: 1,
                    saveAndExit: 1,
                    fit: 1
                }), origin);
            }
            else if (message.event === 'save' && typeof message.xml === 'string' && message.xml.length <= 20 * 1024 * 1024) {
                _this._onSave(message.xml.trim());
                if (message.exit)
                    _this.close();
            }
            else if (message.event === 'exit') {
                _this.close();
            }
        };
    }
    DrawioEditorBridge.prototype.open = function (source) {
        var _this = this;
        if (!this._connection.enabled || !this._connection.editorUrl)
            throw new Error('draw.io接続が無効です。');
        if (this._connection.mode === 'official' && !window.confirm('図データを公式diagrams.netへ送信して編集します。続行しますか？'))
            return;
        this.close();
        this._source = source.trim() || '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
        var overlay = document.createElement('div');
        overlay.className = 'spfxMarkdownDrawioOverlay';
        var header = document.createElement('header');
        header.innerHTML = '<strong>draw.io図の編集</strong>';
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = '閉じる';
        close.addEventListener('click', function () { return _this.close(); });
        header.appendChild(close);
        var frame = document.createElement('iframe');
        frame.src = this._connection.editorUrl.toString();
        frame.title = 'draw.io editor';
        frame.referrerPolicy = 'no-referrer';
        frame.setAttribute('allow', 'clipboard-read; clipboard-write');
        overlay.append(header, frame);
        document.body.appendChild(overlay);
        this._overlay = overlay;
        this._frame = frame;
        window.addEventListener('message', this._receive);
    };
    DrawioEditorBridge.prototype.close = function () {
        var _a;
        window.removeEventListener('message', this._receive);
        (_a = this._overlay) === null || _a === void 0 ? void 0 : _a.remove();
        this._overlay = undefined;
        this._frame = undefined;
    };
    DrawioEditorBridge.prototype.dispose = function () { this.close(); };
    return DrawioEditorBridge;
}());
exports.DrawioEditorBridge = DrawioEditorBridge;
//# sourceMappingURL=DrawioEditorBridge.js.map