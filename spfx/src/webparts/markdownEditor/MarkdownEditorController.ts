import {
  buildMarkdownEdit,
  buildOrderedListNormalization,
  buildStructuredListEnter,
  buildStructuredListIndent,
  buildStructuredListMove,
  buildStructuredListPaste,
  buildStructuredListToggle,
  type MarkdownEditAction,
  type MarkdownEditChange,
  type StructuredListKind
} from '@markdown-viewer/markdown-core';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownHighlight from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import mermaid from 'mermaid';
import { DrawioEditorBridge } from './DrawioEditorBridge';
import type { IResolvedDrawioConnection } from './DrawioConnection';
import { MarkdownRenderer } from './MarkdownRenderer';

export type EditorViewMode = 'edit' | 'split' | 'preview';

export interface IMarkdownEditorControllerOptions {
  root: HTMLElement;
  drawioConnection: IResolvedDrawioConnection;
  onChanged: (value: string) => void;
  onSave: () => void;
}

const actions: Array<{ action: MarkdownEditAction; label: string }> = [
  { action: 'heading', label: 'H' }, { action: 'bold', label: 'B' },
  { action: 'italic', label: 'I' }, { action: 'strike', label: 'S' },
  { action: 'quote', label: '❯' }, { action: 'unordered-list', label: '•' },
  { action: 'ordered-list', label: '1.' }, { action: 'task-list', label: '☑' },
  { action: 'link', label: 'リンク' }, { action: 'inline-code', label: '</>' },
  { action: 'code-block', label: '```' }, { action: 'table', label: '表' },
  { action: 'mermaid', label: 'Mermaid' }, { action: 'drawio', label: '+ draw.io' },
  { action: 'image', label: '画像' }
];

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdownHighlight);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);

export class MarkdownEditorController {
  private readonly _renderer = new MarkdownRenderer();
  private readonly _preview: HTMLElement;
  private readonly _editorHost: HTMLElement;
  private readonly _editor: EditorView;
  private readonly _drawio: DrawioEditorBridge;
  private _mode: EditorViewMode = 'split';
  private _renderSequence = 0;
  private _drawioSources: string[] = [];
  private _editingDrawioIndex = -1;
  private _applying = false;
  private _normalizingLists = false;

  public constructor(private readonly _options: IMarkdownEditorControllerOptions) {
    _options.root.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'spfxMarkdownFormatToolbar';
    actions.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.addEventListener('click', () => this._apply(item.action));
      toolbar.appendChild(button);
    });
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'spfxMarkdownSaveButton';
    save.textContent = '保存';
    save.addEventListener('click', _options.onSave);
    toolbar.appendChild(save);
    const panes = document.createElement('div');
    panes.className = 'spfxMarkdownPanes';
    this._editorHost = document.createElement('div');
    this._editorHost.className = 'spfxMarkdownEditorPane';
    this._preview = document.createElement('div');
    this._preview.className = 'spfxMarkdownPreview markdown-body';
    panes.append(this._editorHost, this._preview);
    _options.root.append(toolbar, panes);

    const state = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Markdownを編集', spellcheck: 'true' }),
        Prec.high(keymap.of([
          { key: 'Ctrl-.', run: view => this._dispatch(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, 'unordered'), 'input.list.toggle') },
          { key: 'Ctrl-1', run: view => this._dispatch(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, 'ordered'), 'input.list.toggle') },
          { key: 'Ctrl-[', run: view => this._dispatch(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, 'task-unchecked'), 'input.list.toggle') },
          { key: 'Ctrl-]', run: view => this._dispatch(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, 'task-checked'), 'input.list.toggle') },
          { key: 'Enter', run: view => this._dispatch(view, buildStructuredListEnter(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to), 'input.list.enter') },
          { key: 'Tab', run: view => this._dispatch(view, buildStructuredListIndent(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to), 'input.list.indent') },
          { key: 'Shift-Tab', run: view => this._dispatch(view, buildStructuredListIndent(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, true), 'input.list.outdent') },
          { key: 'Alt-ArrowUp', run: view => this._dispatch(view, buildStructuredListMove(view.state.sliceDoc(), view.state.selection.main.head, -1), 'input.list.move') },
          { key: 'Alt-ArrowDown', run: view => this._dispatch(view, buildStructuredListMove(view.state.sliceDoc(), view.state.selection.main.head, 1), 'input.list.move') },
          indentWithTab,
          { key: 'Mod-s', run: () => { _options.onSave(); return true; } }
        ])),
        EditorView.domEventHandlers({
          paste: (event, view) => {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) return false;
            const selection = view.state.selection.main;
            const handled = this._dispatch(view, buildStructuredListPaste(view.state.sliceDoc(), selection.from, selection.to, text), 'input.list.paste');
            if (handled) event.preventDefault();
            return handled;
          }
        }),
        EditorView.updateListener.of(update => {
          if (!this._applying && update.docChanged) {
            const value = update.state.sliceDoc();
            _options.onChanged(value);
            this._render(value);
            if (!this._normalizingLists) {
              const selection = update.state.selection.main;
              const correction = buildOrderedListNormalization(value, selection.anchor, selection.head);
              if (correction) queueMicrotask(() => {
                if (this.value !== value) return;
                this._normalizingLists = true;
                this._dispatch(this._editor, correction, 'input.list.renumber');
                this._normalizingLists = false;
              });
            }
          }
        })
      ]
    });
    this._editor = new EditorView({ state, parent: this._editorHost });
    this._drawio = new DrawioEditorBridge(_options.drawioConnection, source => this._replaceDrawio(source));
    this.setMode('split');
  }

  public get value(): string { return this._editor.state.sliceDoc(); }

  public setValue(value: string): void {
    this._applying = true;
    this._editor.dispatch({ changes: { from: 0, to: this._editor.state.doc.length, insert: value } });
    this._applying = false;
    this._render(value);
  }

  public setMode(mode: EditorViewMode): void {
    this._mode = mode;
    this._options.root.dataset.viewMode = mode;
  }

  public dispose(): void {
    this._drawio.dispose();
    this._editor.destroy();
  }

  private _apply(action: MarkdownEditAction): void {
    const selection = this._editor.state.selection.main;
    const kind = this._listToggleKind(action);
    const change = kind
      ? buildStructuredListToggle(this.value, selection.from, selection.to, kind)
      : buildMarkdownEdit(this.value, selection.from, selection.to, action);
    this._dispatch(this._editor, change, 'input.toolbar');
    this._editor.focus();
  }

  private _dispatch(view: EditorView, change: MarkdownEditChange | null, userEvent: string): boolean {
    if (!change) return false;
    view.dispatch({
      changes: { from: change.from, to: change.to, insert: change.insert },
      selection: { anchor: change.anchor, head: change.head },
      scrollIntoView: true,
      userEvent
    });
    return true;
  }

  private _listToggleKind(action: MarkdownEditAction): StructuredListKind | null {
    if (action === 'unordered-list') return 'unordered';
    if (action === 'ordered-list') return 'ordered';
    if (action === 'task-list') return 'task-unchecked';
    return null;
  }

  private _render(value: string): void {
    const sequence = ++this._renderSequence;
    this._preview.innerHTML = this._renderer.render(value);
    this._drawioSources = [];
    this._preview.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(link => {
      if (/^https?:/i.test(link.href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    });
    this._preview.querySelectorAll<HTMLElement>('pre > code').forEach(code => {
      if (code.classList.contains('language-mermaid')) {
        const source = code.textContent || '';
        const host = document.createElement('div');
        host.className = 'spfxMarkdownMermaid';
        code.parentElement?.replaceWith(host);
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
        void mermaid.render(`spfx-markdown-${sequence}-${Math.random().toString(36).slice(2)}`, source)
          .then(result => { if (sequence === this._renderSequence) host.innerHTML = result.svg; })
          .catch(error => { host.textContent = `Mermaidを描画できません: ${String(error)}`; });
      } else if (code.classList.contains('language-drawio')) {
        const source = code.textContent || '';
        const index = this._drawioSources.push(source.replace(/\n$/, '')) - 1;
        const card = document.createElement('section');
        card.className = 'spfxMarkdownDrawioCard';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'draw.ioで編集';
        button.disabled = !this._options.drawioConnection.enabled;
        button.addEventListener('click', () => {
          this._editingDrawioIndex = index;
          this._drawio.open(this._drawioSources[index]);
        });
        const label = document.createElement('p');
        label.textContent = this._options.drawioConnection.enabled ? 'draw.io図' : 'draw.io接続は無効です';
        card.append(label, button);
        code.parentElement?.replaceWith(card);
      } else {
        hljs.highlightElement(code);
      }
    });
  }

  private _replaceDrawio(source: string): void {
    const selection = this._editingDrawioIndex;
    if (selection < 0) return;
    let current = -1;
    const replaced = this.value.replace(/(```|~~~)drawio[^\r\n]*\r?\n([\s\S]*?)\r?\n\1/gi, match => {
      current += 1;
      return current === selection ? `${match.slice(0, match.indexOf('\n') + 1)}${source}\n${match.match(/(?:```|~~~)$/)?.[0] || '```'}` : match;
    });
    this._editingDrawioIndex = -1;
    this.setValue(replaced);
    this._options.onChanged(replaced);
  }
}
