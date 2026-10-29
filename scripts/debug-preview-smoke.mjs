import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlan } from './gui-smoke/plan.mjs';
import { runPlan } from './gui-smoke/runner.mjs';
import { connectCdp } from './gui-smoke/cdp.mjs';
import { takeVersionArgument, versionLogDirectory } from './version-log-path.mjs';

export function parseOptions(argv) {
  const { version, args } = takeVersionArgument(argv);
  const options = { version, port: 9333, selected: [], changed: [], planOnly: false, documentName: 'v0.0.10-editing.md' };
  // 既存の <port> <outputDirectory> 呼出しも維持する。
  if (args[0] && !args[0].startsWith('--')) options.port = Number(args.shift());
  if (args[0] && !args[0].startsWith('--')) options.directory = args.shift();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--plan-only') { options.planOnly = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key}の値がありません。`);
    if (key === '--scenario') options.selected.push(...value.split(','));
    else if (key === '--changed') options.changed.push(value);
    else if (key === '--port') options.port = Number(value);
    else if (key === '--output') options.directory = value;
    else if (key === '--target-id') options.targetId = value;
    else if (key === '--document-name') options.documentName = value;
    else throw new Error(`不明な引数です: ${key}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('CDPポートが不正です。');
  if (!options.documentName || /[\\/]/.test(options.documentName)) throw new Error('専用文書のファイル名だけを指定してください。');
  return options;
}

export async function main(argv) {
  const options = parseOptions(argv);
  const plan = createPlan(options);
  if (options.planOnly) { console.log(JSON.stringify(plan, null, 2)); return plan.reviewRequired.length ? 2 : 0; }
  const root = path.resolve(import.meta.dirname, '..');
  const directory = versionLogDirectory(root, 'gui-smoke', options.version, options.directory);
  await mkdir(directory, { recursive: true });
  let session;
  try {
    const handlers = {
      connect: async () => { session = await connectCdp({ ...options, directory }); return { targetId: session.targetId }; },
      document: async () => (await import('./gui-smoke/document.mjs')).run(session, options.documentName),
    };
    for (const id of ['view-context', 'structured-list', 'mermaid', 'drawio', 'diff']) {
      handlers[id] = async () => (await import(`./gui-smoke/${id}.mjs`)).run(session);
    }
    const evidenceKind = plan.steps.some(s => s.kind === 'manual' && s.status !== 'excluded') ? 'webview-cdp-and-operator-observation' : 'webview-cdp';
    const { summary, report, summaryPath } = await runPlan({ plan, directory, handlers, evidenceKind });
    // 従来のreport利用者を維持する。部分実行のreportには対象項目だけを含める。
    await writeFile(path.join(directory, 'preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ summaryPath, status: summary.status, steps: summary.steps.filter(s => s.status !== 'excluded').map(({ id, status, elapsedMs }) => ({ id, status, elapsedMs })) }, null, 2));
    return summary.status === 'passed' || summary.status === 'not-required' ? 0 : summary.status === 'failed' ? 1 : 2;
  } finally { session?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
