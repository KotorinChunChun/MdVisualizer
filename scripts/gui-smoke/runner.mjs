import { mkdir, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function saveSummary(file, summary) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

export function updateOutcome(summary) {
  const active = summary.steps.filter(s => s.status !== 'excluded');
  summary.passed = summary.reviewRequired.length === 0 && active.length > 0 && active.every(s => s.status === 'passed');
  summary.status = summary.reviewRequired.length ? 'review-required'
    : active.some(s => s.status === 'failed') ? 'failed'
      : summary.passed ? 'passed' : active.length ? 'pending' : 'not-required';
  return summary;
}

// 各シナリオの実装・接続先を注入できる。fixture成功を実WebViewの成功と混同しない。
export async function runPlan({ plan, directory, handlers, evidenceKind = 'webview-cdp', timeoutMs = 30_000 }) {
  await mkdir(directory, { recursive: true });
  const summaryPath = path.join(directory, 'gui-summary.json');
  // 再開・再実行で過去結果を上書きしない。
  const reservation = await open(summaryPath, 'wx');
  await reservation.close();
  const summary = { ...structuredClone(plan), evidenceKind, startedAt: new Date().toISOString(), wallMs: 0, passed: false, status: 'pending' };
  const started = performance.now();
  const report = {};
  let failed = plan.reviewRequired.length > 0;
  try {
    await saveSummary(summaryPath, updateOutcome(summary));
    for (const entry of summary.steps) {
      if (entry.status === 'excluded' || entry.kind === 'manual' || failed) continue;
      const missing = entry.requires.filter(id => summary.steps.find(s => s.id === id)?.status !== 'passed');
      if (missing.length) throw new Error(`${entry.id}の前提が未完了です: ${missing.join(', ')}`);
      entry.startedAt = new Date().toISOString();
      entry.status = 'running';
      await saveSummary(summaryPath, updateOutcome(summary));
      const begin = performance.now();
      let timer;
      try {
        if (typeof handlers[entry.id] !== 'function') throw new Error(`実装がありません: ${entry.id}`);
        entry.result = await Promise.race([
          Promise.resolve().then(() => handlers[entry.id]({ report })),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${entry.id}: ${timeoutMs}msで打ち切り`)), timeoutMs); }),
        ]);
        if (entry.result && typeof entry.result === 'object') Object.assign(report, entry.result);
        entry.status = 'passed';
      } catch (error) {
        entry.status = 'failed';
        entry.error = String(error.message ?? error);
        failed = true;
      } finally {
        clearTimeout(timer);
        entry.elapsedMs = Math.round(performance.now() - begin);
        entry.finishedAt = new Date().toISOString();
        await saveSummary(summaryPath, updateOutcome(summary));
      }
    }
  } finally {
    summary.wallMs = Math.round(performance.now() - started);
    summary.finishedAt = new Date().toISOString();
    await saveSummary(summaryPath, updateOutcome(summary));
  }
  return { summary, report, summaryPath };
}
