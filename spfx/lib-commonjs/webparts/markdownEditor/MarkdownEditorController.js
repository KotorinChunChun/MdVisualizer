"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarkdownEditorController = void 0;
var tslib_1 = require("tslib");
var markdown_core_1 = require("@markdown-viewer/markdown-core");
var codemirror_1 = require("codemirror");
var commands_1 = require("@codemirror/commands");
var lang_markdown_1 = require("@codemirror/lang-markdown");
var state_1 = require("@codemirror/state");
var view_1 = require("@codemirror/view");
var core_1 = tslib_1.__importDefault(require("highlight.js/lib/core"));
var bash_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/bash"));
var css_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/css"));
var javascript_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/javascript"));
var json_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/json"));
var markdown_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/markdown"));
var powershell_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/powershell"));
var typescript_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/typescript"));
var xml_1 = tslib_1.__importDefault(require("highlight.js/lib/languages/xml"));
var mermaid_1 = tslib_1.__importDefault(require("mermaid"));
var DrawioEditorBridge_1 = require("./DrawioEditorBridge");
var MarkdownRenderer_1 = require("./MarkdownRenderer");
var actions = [
    { action: 'heading', label: 'H' }, { action: 'bold', label: 'B' },
    { action: 'italic', label: 'I' }, { action: 'strike', label: 'S' },
    { action: 'quote', label: '❯' }, { action: 'unordered-list', label: '•' },
    { action: 'ordered-list', label: '1.' }, { action: 'task-list', label: '☑' },
    { action: 'link', label: 'リンク' }, { action: 'inline-code', label: '</>' },
    { action: 'code-block', label: '```' }, { action: 'table', label: '表' },
    { action: 'mermaid', label: 'Mermaid' }, { action: 'drawio', label: '+ draw.io' },
    { action: 'image', label: '画像' }
];
core_1.default.registerLanguage('bash', bash_1.default);
core_1.default.registerLanguage('css', css_1.default);
core_1.default.registerLanguage('javascript', javascript_1.default);
core_1.default.registerLanguage('json', json_1.default);
core_1.default.registerLanguage('markdown', markdown_1.default);
core_1.default.registerLanguage('powershell', powershell_1.default);
core_1.default.registerLanguage('typescript', typescript_1.default);
core_1.default.registerLanguage('xml', xml_1.default);
var MarkdownEditorController = /** @class */ (function () {
    function MarkdownEditorController(_options) {
        var _this = this;
        this._options = _options;
        this._renderer = new MarkdownRenderer_1.MarkdownRenderer();
        this._mode = 'split';
        this._renderSequence = 0;
        this._drawioSources = [];
        this._editingDrawioIndex = -1;
        this._applying = false;
        _options.root.innerHTML = '';
        var toolbar = document.createElement('div');
        toolbar.className = 'spfxMarkdownFormatToolbar';
        actions.forEach(function (item) {
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.label;
            button.addEventListener('click', function () { return _this._apply(item.action); });
            toolbar.appendChild(button);
        });
        var save = document.createElement('button');
        save.type = 'button';
        save.className = 'spfxMarkdownSaveButton';
        save.textContent = '保存';
        save.addEventListener('click', _options.onSave);
        toolbar.appendChild(save);
        var panes = document.createElement('div');
        panes.className = 'spfxMarkdownPanes';
        this._editorHost = document.createElement('div');
        this._editorHost.className = 'spfxMarkdownEditorPane';
        this._preview = document.createElement('div');
        this._preview.className = 'spfxMarkdownPreview markdown-body';
        panes.append(this._editorHost, this._preview);
        _options.root.append(toolbar, panes);
        var state = state_1.EditorState.create({
            doc: '',
            extensions: [
                codemirror_1.basicSetup,
                (0, lang_markdown_1.markdown)({ base: lang_markdown_1.markdownLanguage }),
                view_1.EditorView.lineWrapping,
                view_1.EditorView.contentAttributes.of({ 'aria-label': 'Markdownを編集', spellcheck: 'true' }),
                view_1.keymap.of([commands_1.indentWithTab, { key: 'Mod-s', run: function () { _options.onSave(); return true; } }]),
                view_1.EditorView.updateListener.of(function (update) {
                    if (!_this._applying && update.docChanged) {
                        var value = update.state.sliceDoc();
                        _options.onChanged(value);
                        _this._render(value);
                    }
                })
            ]
        });
        this._editor = new view_1.EditorView({ state: state, parent: this._editorHost });
        this._drawio = new DrawioEditorBridge_1.DrawioEditorBridge(_options.drawioConnection, function (source) { return _this._replaceDrawio(source); });
        this.setMode('split');
    }
    Object.defineProperty(MarkdownEditorController.prototype, "value", {
        get: function () { return this._editor.state.sliceDoc(); },
        enumerable: false,
        configurable: true
    });
    MarkdownEditorController.prototype.setValue = function (value) {
        this._applying = true;
        this._editor.dispatch({ changes: { from: 0, to: this._editor.state.doc.length, insert: value } });
        this._applying = false;
        this._render(value);
    };
    MarkdownEditorController.prototype.setMode = function (mode) {
        this._mode = mode;
        this._options.root.dataset.viewMode = mode;
    };
    MarkdownEditorController.prototype.dispose = function () {
        this._drawio.dispose();
        this._editor.destroy();
    };
    MarkdownEditorController.prototype._apply = function (action) {
        var selection = this._editor.state.selection.main;
        var change = (0, markdown_core_1.buildMarkdownEdit)(this.value, selection.from, selection.to, action);
        this._editor.dispatch({
            changes: { from: change.from, to: change.to, insert: change.insert },
            selection: { anchor: change.anchor, head: change.head },
            scrollIntoView: true,
            userEvent: 'input.toolbar'
        });
        this._editor.focus();
    };
    MarkdownEditorController.prototype._render = function (value) {
        var _this = this;
        var sequence = ++this._renderSequence;
        this._preview.innerHTML = this._renderer.render(value);
        this._drawioSources = [];
        this._preview.querySelectorAll('a[href]').forEach(function (link) {
            if (/^https?:/i.test(link.href)) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
        });
        this._preview.querySelectorAll('pre > code').forEach(function (code) {
            var _a, _b;
            if (code.classList.contains('language-mermaid')) {
                var source = code.textContent || '';
                var host_1 = document.createElement('div');
                host_1.className = 'spfxMarkdownMermaid';
                (_a = code.parentElement) === null || _a === void 0 ? void 0 : _a.replaceWith(host_1);
                mermaid_1.default.initialize({ startOnLoad: false, securityLevel: 'strict' });
                void mermaid_1.default.render("spfx-markdown-".concat(sequence, "-").concat(Math.random().toString(36).slice(2)), source)
                    .then(function (result) { if (sequence === _this._renderSequence)
                    host_1.innerHTML = result.svg; })
                    .catch(function (error) { host_1.textContent = "Mermaid\u3092\u63CF\u753B\u3067\u304D\u307E\u305B\u3093: ".concat(String(error)); });
            }
            else if (code.classList.contains('language-drawio')) {
                var source = code.textContent || '';
                var index_1 = _this._drawioSources.push(source.replace(/\n$/, '')) - 1;
                var card = document.createElement('section');
                card.className = 'spfxMarkdownDrawioCard';
                var button = document.createElement('button');
                button.type = 'button';
                button.textContent = 'draw.ioで編集';
                button.disabled = !_this._options.drawioConnection.enabled;
                button.addEventListener('click', function () {
                    _this._editingDrawioIndex = index_1;
                    _this._drawio.open(_this._drawioSources[index_1]);
                });
                var label = document.createElement('p');
                label.textContent = _this._options.drawioConnection.enabled ? 'draw.io図' : 'draw.io接続は無効です';
                card.append(label, button);
                (_b = code.parentElement) === null || _b === void 0 ? void 0 : _b.replaceWith(card);
            }
            else {
                core_1.default.highlightElement(code);
            }
        });
    };
    MarkdownEditorController.prototype._replaceDrawio = function (source) {
        var selection = this._editingDrawioIndex;
        if (selection < 0)
            return;
        var current = -1;
        var replaced = this.value.replace(/(```|~~~)drawio[^\r\n]*\r?\n([\s\S]*?)\r?\n\1/gi, function (match) {
            var _a;
            current += 1;
            return current === selection ? "".concat(match.slice(0, match.indexOf('\n') + 1)).concat(source, "\n").concat(((_a = match.match(/(?:```|~~~)$/)) === null || _a === void 0 ? void 0 : _a[0]) || '```') : match;
        });
        this._editingDrawioIndex = -1;
        this.setValue(replaced);
        this._options.onChanged(replaced);
    };
    return MarkdownEditorController;
}());
exports.MarkdownEditorController = MarkdownEditorController;
//# sourceMappingURL=MarkdownEditorController.js.map