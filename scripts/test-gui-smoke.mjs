import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlan, normalizeChangedPath } from './gui-smoke/plan.mjs';
import { runPlan } from './gui-smoke/runner.mjs';
import { recordManual } from './gui-smoke-manual.mjs';

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
