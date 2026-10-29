import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlan, normalizeChangedPath } from './gui-smoke/plan.mjs';
import { runPlan } from './gui-smoke/runner.mjs';
import { recordManual } from './gui-smoke-manual.mjs';
import { connectCdp } from './gui-smoke/cdp.mjs';
import { parseOptions, main } from './debug-preview-smoke.mjs';
import { spawnSync } from 'node:child_process';

async function fixture(body) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mdvisualizer-gui-timing-'));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const ids = plan => plan.steps.filter(s => s.status !== 'excluded').map(s => s.id);
const passHandlers = Object.fromEntries(['connect', 'document', 'view-context', 'structured-list', 'mermaid', 'drawio', 'diff'].map(id => [id, async () => ({ [id]: true })]));

test('単独図の選択は接続と文書だけを前提にする', () => {
  assert.deepEqual(ids(createPlan({ selected: ['drawio'] })), ['connect', 'document', 'drawio']);
  assert.throws(() => createPlan({ selected: ['unknown'] }), /未知/);
  assert.throws(() => createPlan({ selected: ['diff'], changed: ['src/App.tsx'] }), /同時/);
});
test('共有正本・Windowsパスを正規化しDiffだけを選ぶ', () => {
  const plan = createPlan({ changed: ['web-platform\\packages\\editor-ui\\src\\components\\DocumentDiffWorkspace.tsx'] });
  assert.deepEqual(ids(plan), ['connect', 'document', 'diff']);
  assert.match(plan.steps.find(s => s.id === 'diff').reasons[0], /影響/);
  assert.throws(() => normalizeChangedPath('../outside'), /相対/);
});
test('SharePoint修正で無関係な図を選ばずネイティブ観測を要求する', () => {
  const plan = createPlan({ changed: ['src-tauri/src/sharepoint/navigation.rs'] });
  assert.deepEqual(ids(plan), ['native-prepare', 'received-url', 'url-copy', 'settings-errors', 'wiki-open']);
});
test('文書だけは対象外、未登録は要判断、横断変更は広く選択する', () => {
  assert.equal(ids(createPlan({ changed: ['docs/user/a.md'] })).length, 0);
  assert.deepEqual(createPlan({ changed: ['new-runtime/a.cs'] }).reviewRequired, ['new-runtime/a.cs']);
  assert.ok(ids(createPlan({ changed: ['src/App.tsx'] })).includes('wiki-open'));
});
test('既定は従来5シナリオ、依存は重複実行しない', () => {
  assert.equal(ids(createPlan()).length, 7);
  assert.deepEqual(ids(createPlan({ selected: ['mermaid', 'diff', 'mermaid'] })), ['connect', 'document', 'mermaid', 'diff']);
});
test('単独シナリオだけを実行し時刻・経過時間・対象外を保存する', () => fixture(async directory => {
  const called = [];
  const handlers = Object.fromEntries(Object.entries(passHandlers).map(([id, fn]) => [id, async context => { called.push(id); return fn(context); }]));
  const { summary, summaryPath } = await runPlan({ plan: createPlan({ selected: ['drawio'] }), directory, handlers, evidenceKind: 'fixture' });
  assert.deepEqual(called, ['connect', 'document', 'drawio']);
  assert.equal(summary.passed, true);
  assert.equal(summary.steps.find(s => s.id === 'mermaid').status, 'excluded');
  assert.ok(summary.steps.find(s => s.id === 'drawio').elapsedMs >= 0);
  assert.ok(summary.steps.find(s => s.id === 'connect').finishedAt);
  assert.equal(JSON.parse(await readFile(summaryPath)).evidenceKind, 'fixture');
  await assert.rejects(runPlan({ plan: createPlan(), directory, handlers }), /EEXIST/);
}));
test('失敗までの結果と後続未実施を保存し無条件retryしない', () => fixture(async directory => {
  let attempts = 0;
  const { summary } = await runPlan({ plan: createPlan(), directory, handlers: { ...passHandlers, mermaid: async () => { attempts++; throw new Error('表示不良'); } }, evidenceKind: 'fixture' });
  assert.equal(attempts, 1);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.steps.find(s => s.id === 'view-context').status, 'passed');
  assert.equal(summary.steps.find(s => s.id === 'drawio').status, 'not-run');
  assert.match(summary.steps.find(s => s.id === 'mermaid').error, /表示不良/);
}));
test('接続待ちが打切りを超えれば後続を実行しない', () => fixture(async directory => {
  const { summary } = await runPlan({ plan: createPlan({ selected: ['diff'] }), directory, handlers: { connect: () => new Promise(() => {}) }, timeoutMs: 10, evidenceKind: 'fixture' });
  assert.equal(summary.status, 'failed');
  assert.match(summary.steps[0].error, /打ち切り/);
  assert.equal(summary.steps[1].status, 'not-run');
}));
test('空選択・要判断・手動未実施を合格にしない', () => fixture(async root => {
  const docs = await runPlan({ plan: createPlan({ changed: ['docs/a.md'] }), directory: path.join(root, 'docs'), handlers: {} });
  assert.equal(docs.summary.status, 'not-required'); assert.equal(docs.summary.passed, false);
  const unknown = await runPlan({ plan: createPlan({ changed: ['unknown.txt', 'src/App.tsx'] }), directory: path.join(root, 'unknown'), handlers: new Proxy({}, { get() { throw new Error('実行してはいけない'); } }) });
  assert.equal(unknown.summary.status, 'review-required');
  const manual = await runPlan({ plan: createPlan({ selected: ['url-copy'] }), directory: path.join(root, 'manual'), handlers: {} });
  assert.equal(manual.summary.status, 'pending'); assert.equal(manual.summary.passed, false);
}));
test('手動は開始・依存・証跡を要求し計測と観測者判定を区別する', () => fixture(async directory => {
  const { summaryPath } = await runPlan({ plan: createPlan({ selected: ['url-copy'] }), directory, handlers: {} });
  const input = { summaryPath, id: 'url-copy', action: 'start' };
  await assert.rejects(recordManual(input), /前提/);
  const begin = new Date('2026-10-29T12:00:00Z');
  await writeFile(path.join(directory, 'observed.txt'), '専用fixtureとの一致を観測した');
  for (const id of ['native-prepare', 'received-url', 'url-copy']) {
    await recordManual({ summaryPath, id, action: 'start', now: begin });
    await assert.rejects(recordManual({ summaryPath, id, action: 'finish', outcome: 'passed', reason: '観測した' }), /証跡/);
    await assert.rejects(recordManual({ summaryPath, id, action: 'finish', outcome: 'passed', reason: '観測した', evidence: ['../outside'] }), /同じ実行/);
    const step = await recordManual({ summaryPath, id, action: 'finish', outcome: 'passed', reason: '専用fixtureとの一致を観測した', evidence: ['observed.txt'], now: new Date(begin.getTime() + 1500) });
    assert.equal(step.elapsedMs, 1500); assert.equal(step.evidenceKind, 'operator-observation'); assert.equal(step.evidence[0].sha256.length, 64);
    await assert.rejects(recordManual({ summaryPath, id, action: 'start' }), /上書き/);
  }
  assert.equal(JSON.parse(await readFile(summaryPath)).passed, true);
}));

test('CLIは対象版・シナリオ・変更パスを検証し従来の位置引数も保持する', () => {
  const options = parseOptions(['9334', 'output', '--version', 'v0.0.19', '--scenario', 'mermaid,diff']);
  assert.equal(options.port, 9334); assert.deepEqual(options.selected, ['mermaid', 'diff']);
  assert.throws(() => parseOptions(['--version', 'v0.0.19', '--port', '0']), /ポート/);
  assert.throws(() => parseOptions(['--version', 'v0.0.19', '--scenario']), /値がありません/);
  assert.throws(() => parseOptions(['--version', 'v0.0.19', '--unknown', 'a']), /不明/);
  assert.throws(() => parseOptions(['--version', 'v0.0.19', '--document-name', '../a.md']), /ファイル名/);
});

const moduleCases = [
  ['view-context', [{ ok: true, stayedPreview: true, selectedText: '本文', labels: ['マークダウンでコピー', 'プレーンテキストでコピー', '編集', '下にブロックを追加', '行選択', 'ブロック全体を選択', 'すべて選択'], requestedLine: 3, highlightedLine: 3 }, undefined], 0, { stayedPreview: false }],
  ['structured-list', [{ found: true, directItems: 2, orderedDepth: 3, joinedOrderedText: false, standardDirectItems: 2, standardChildItems: 2, standardJoinedText: false, bullets: ['odd', 'even', 'odd', 'even'].map(value => ({ markerClass: `markdown-list-marker-${value}` })) }], 0, { orderedDepth: 1 }],
  ['mermaid', [undefined, true, { opened: true, maximumFit: true, extraScrollableCanvas: false, canvasBackground: 'rgb(255, 255, 255)', inlineBackground: 'rgb(255, 255, 255)' }, undefined], 2, { maximumFit: false }],
  ['drawio', [undefined, true, { opened: true, maximumFit: true, extraRightBottomWhitespace: false }, undefined], 2, { extraRightBottomWhitespace: true }],
  ['diff', [{ opened: true, panes: 2, interactiveDiagrams: 0, durationMs: 10 }, { panes: 2, codePanes: 2, durationMs: 10 }, { panes: 4, codePanes: 2, renderedPanes: 2, interactiveDiagrams: 0, durationMs: 10 }, { synced: true }, true], 3, { synced: false }],
];
for (const [id, values, brokenIndex, mutation] of moduleCases) {
  test(`${id}: 独立実行で従来の期待値を保持し不良結果を拒否する`, async () => {
    const { run } = await import(`./gui-smoke/${id}.mjs`);
    function driver(outputs) {
      const queue = structuredClone(outputs);
      return { queue, evaluate: async expression => { new Function(`return (${expression});`); assert.ok(queue.length, '想定外の評価呼出し'); return queue.shift(); }, screenshot: async filename => filename };
    }
    const valid = driver(values);
    await run(valid); assert.equal(valid.queue.length, 0);
    const bad = structuredClone(values); bad[brokenIndex] = { ...bad[brokenIndex], ...mutation };
    await assert.rejects(run(driver(bad)), /verification failed/);
  });
}

test('文書準備は専用タブがない場合に止まり、図の読込を要求しない', async () => {
  const { run } = await import('./gui-smoke/document.mjs');
  let expression;
  await assert.rejects(run({ evaluate: async value => { expression = value; return { ready: false, reason: '専用タブなし' }; } }), /専用タブなし/);
  new Function(`return (${expression});`);
  assert.ok(!expression.includes('mermaid') && !expression.includes('drawio'));
  assert.deepEqual(await run({ evaluate: async () => ({ ready: true }) }), { documentReady: true });
});

function socketFixture({ silent = false, evaluationError = false } = {}) {
  return class FixtureSocket extends EventTarget {
    static instances = [];
    constructor() { super(); this.constructor.instances.push(this); this.calls = []; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(packet) {
      const message = JSON.parse(packet); this.calls.push(message);
      if (silent && message.method === 'Runtime.evaluate') return;
      let result = {};
      if (message.method === 'Runtime.evaluate') result = evaluationError ? { exceptionDetails: { text: 'fixture例外' } } : { result: { value: 42 } };
      if (message.method === 'Page.captureScreenshot') result = { data: Buffer.from('fixture').toString('base64') };
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, result }) })));
    }
    close() { this.closed = true; this.dispatchEvent(new Event('close')); }
  };
}
const target = { type: 'page', id: 'fixture-target', url: 'tauri://localhost', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/fixture' };
const fetchFixture = targets => async () => ({ ok: true, json: async () => targets });
test('CDPは一意なローカル接続だけを許可し評価例外と待機打切りを伝える', () => fixture(async directory => {
  const Socket = socketFixture();
  const session = await connectCdp({ port: 9333, directory, fetchImpl: fetchFixture([target]), Socket });
  try {
    assert.equal(await session.evaluate('6*7'), 42);
    await session.screenshot('fixture.png');
    await assert.rejects(session.screenshot('../outside.png'), /不正/);
  } finally { session.close(); }
  assert.equal(Socket.instances[0].closed, true);
  await assert.rejects(connectCdp({ port: 9333, directory, fetchImpl: fetchFixture([target, target]), Socket }), /一意/);
  await assert.rejects(connectCdp({ port: 9333, directory, fetchImpl: fetchFixture([{ ...target, webSocketDebuggerUrl: 'ws://example.com:9333/x' }]), Socket }), /ローカル/);
  for (const options of [{ silent: true }, { evaluationError: true }]) {
    const faulty = await connectCdp({ port: 9333, directory, fetchImpl: fetchFixture([target]), Socket: socketFixture(options), commandTimeoutMs: 10 });
    try { await assert.rejects(faulty.evaluate('1'), /fixture例外|打ち切り/); } finally { faulty.close(); }
  }
}));

test('PowerShell PlanOnlyは存在しないサンプルでもビルド・起動なしで選択結果を返す', () => {
  const script = path.join(import.meta.dirname, 'run-debug-MdVisualizer-all-smoke.ps1');
  const result = spawnSync('pwsh', ['-NoProfile', '-File', script, '-TargetVersion', 'v0.0.19', '-Scenario', 'drawio', '-PlanOnly', '-FallbackMarkdownPaths', 'Z:\\存在しない専用fixture.md'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(ids(JSON.parse(result.stdout)), ['connect', 'document', 'drawio']);
});
