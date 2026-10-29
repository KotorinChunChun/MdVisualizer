import { readFile, open, unlink, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { saveSummary, updateOutcome } from './gui-smoke/runner.mjs';

// ネイティブ操作の代行はしない。観測者が別のUI操作で得た証跡と所要時間を記録する。
export async function recordManual({ summaryPath, id, action, outcome, reason, evidence = [], now = new Date() }) {
  const lockPath = `${summaryPath}.lock`;
  const lock = await open(lockPath, 'wx');
  try {
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    if (summary.reviewRequired.length) throw new Error('未判定の変更パスがあります。先に検証対象を選択してください。');
    const entry = summary.steps.find(s => s.id === id);
    if (!entry || entry.kind !== 'manual' || entry.status === 'excluded') throw new Error(`選択された手動工程ではありません: ${id}`);
    if (action === 'start') {
      if (entry.status !== 'not-run') throw new Error('開始済みの工程を再開・上書きしません。再試行は新しい実行フォルダーへ記録してください。');
      if (summary.steps.some(s => s.status === 'running')) throw new Error('別の工程を実行中です。');
      if (entry.requires.some(required => summary.steps.find(s => s.id === required)?.status !== 'passed')) throw new Error('前提の手動準備・観測が未完了です。');
      entry.startedAt = now.toISOString();
      entry.status = 'running';
    } else if (action === 'finish') {
      if (entry.status !== 'running') throw new Error('開始されていない工程は完了にできません。');
      if (!['passed', 'failed'].includes(outcome) || !reason?.trim()) throw new Error('passed/failedと観測した判定理由が必要です。');
      if (outcome === 'passed' && evidence.length === 0) throw new Error('手動合格には観測した証跡ファイルが必要です。');
      const evidenceRecords = [];
      const directory = path.dirname(summaryPath);
      const realDirectory = await realpath(directory);
      for (const value of evidence) {
        const file = path.resolve(directory, value);
        const relative = path.relative(directory, file);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('証跡は同じ実行フォルダー内へ保存してください。');
        const realRelative = path.relative(realDirectory, await realpath(file));
        if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error('証跡のリンク先が同じ実行フォルダー内にありません。');
        const info = await stat(file);
        if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('証跡は20MiB以下のファイルにしてください。');
        evidenceRecords.push({ file: relative, bytes: info.size, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
      }
      entry.elapsedMs = now.getTime() - Date.parse(entry.startedAt);
      if (!Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0) throw new Error('時計が戻ったため所要時間を記録できません。');
      entry.finishedAt = now.toISOString();
      entry.evidenceKind = 'operator-observation';
      entry.status = outcome;
      entry.reason = reason;
      entry.evidence = evidenceRecords;
      entry.budgetMs = ['native-prepare', 'native-startup'].includes(id) ? 300_000 : ['native-target', 'native-recording'].includes(id) ? 60_000 : 120_000;
      entry.budgetExceeded = entry.elapsedMs > entry.budgetMs;
    } else throw new Error('actionはstartまたはfinishを指定してください。');
    summary.updatedAt = now.toISOString();
    await saveSummary(summaryPath, updateOutcome(summary));
    return entry;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [summaryPath, id, action, ...args] = process.argv.slice(2);
    if (!summaryPath || !id || !action) throw new Error('gui-smoke-manual.mjs <gui-summary.json> <工程ID> start|finish [--outcome passed|failed --reason 観測内容 --evidence 相対ファイル名]');
    const root = path.resolve(import.meta.dirname, '..');
    const relative = path.relative(root, path.resolve(summaryPath)).replaceAll('\\', '/');
    if (!/^dev\/history\/v\d+\.\d+\.\d+(?:\.\d+)?\/logs\/[^/]+\/gui-summary\.json$/.test(relative)) throw new Error('対象版logs内のgui-summary.jsonを指定してください。');
    const options = { summaryPath: path.resolve(summaryPath), id, action, evidence: [] };
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]; const value = args[i + 1];
      if (!['--outcome', '--reason', '--evidence'].includes(key) || !value || value.startsWith('--')) throw new Error('不明な引数または値の欠落です。');
      if (key === '--evidence') options.evidence.push(value);
      else options[key.slice(2)] = value;
    }
    console.log(JSON.stringify(await recordManual(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
