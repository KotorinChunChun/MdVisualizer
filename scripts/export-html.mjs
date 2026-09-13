#!/usr/bin/env node
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { exportHtml } from './html-export/export.mjs';
import { boundedFile, decodeText, LIMITS } from './html-export/io.mjs';

const help = `Markdownを閲覧専用の単一HTMLへ出力します。
使い方: node scripts/export-html.mjs 入力.md --output 出力.html [オプション]
        node scripts/export-html.mjs - --base-dir 資産フォルダー --output 出力.html

  --output, -o       保存先（必須、.html/.htm）
  --theme           dark（既定）/light/github/solarized/nord
  --css             本文に適用する追加CSS（:scopeも使用可、外部参照不可）
  --title           HTMLのタイトル（既定: 入力ファイル名）
  --base-dir        標準入力の相対参照基準（既定: カレントディレクトリー）
  --allow-remote    HTTP(S)資産・draw.ioビューアーの取得を許可
  --drawio-viewer   手元のviewer-static.min.js（信頼するコードを指定）
  --browser         生成用Edge/Chrome実行ファイル
  --force           同名HTMLの上書きを許可
  --help, -h        この説明を表示

全行・全列を出力します。失敗時は既存HTMLを変更しません。
生成にはNode.js・インストール済み依存・Chromiumが必要です。
完成HTMLの閲覧にはネット接続・JavaScript・元の画像ファイルは不要です。`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    output: { type: 'string', short: 'o' }, theme: { type: 'string', default: 'dark' }, css: { type: 'string' }, title: { type: 'string' },
    'base-dir': { type: 'string' }, 'allow-remote': { type: 'boolean' }, 'drawio-viewer': { type: 'string' }, browser: { type: 'string' },
    force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); }
  else {
    if (positionals.length !== 1 || !values.output) throw new Error('入力Markdownと --output を指定してください。--help で使用方法を確認できます。');
    if (values['base-dir'] && positionals[0] !== '-') throw new Error('--base-dir は標準入力時に指定してください。ファイル入力の基準は入力ファイルの場所です。');
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    const input = positionals[0] === '-' ? null : await realpath(positionals[0]);
    let bytes;
    if (input) bytes = await boundedFile(input, LIMITS.document);
    else {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) { size += chunk.length; if (size > LIMITS.document) throw new Error('標準入力の容量上限を超えました。'); chunks.push(chunk); }
      bytes = Buffer.concat(chunks);
    }
    const result = await exportHtml({ markdown: decodeText(bytes), baseDir: input ? path.dirname(input) : values['base-dir'] ?? process.cwd(),
      output: path.resolve(values.output), title: values.title ?? (input ? path.basename(input, path.extname(input)) : '無題'),
      theme: values.theme, css: values.css ? decodeText(await boundedFile(values.css, LIMITS.document)) : '', force: values.force,
      allowRemote: values['allow-remote'], drawioViewer: values['drawio-viewer'], browserPath: values.browser,
      protectedPaths: new Set(input ? [input.toLowerCase()] : []), signal: controller.signal, onProgress: message => console.error(message),
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(`HTML出力に失敗しました: ${String(error.message).replace(/(?:https?:\/\/|file:)[^\s)]+/gi, '[参照先]')}`);
  process.exitCode = 1;
}
