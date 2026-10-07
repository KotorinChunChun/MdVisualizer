import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { takeVersionArgument, versionLogDirectory } from './version-log-path.mjs';
const root = path.resolve(import.meta.dirname, '..');
const { version, args } = takeVersionArgument(process.argv.slice(2));
process.env.MDVISUALIZER_VERSION = version;
const output = versionLogDirectory(root, 'test-profile', version);
fs.mkdirSync(output, { recursive: true });
const resultFile = path.join(output, 'vitest.json');
const started = performance.now();
const log = fs.openSync(path.join(output, 'vitest.log'), 'w');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...args, '--reporter=default', '--reporter=json', `--outputFile=${resultFile}`], { cwd: root, stdio: ['ignore', log, log] });
fs.closeSync(log);
if (result.error) throw result.error;
if (fs.existsSync(resultFile)) {
  const data = JSON.parse(fs.readFileSync(resultFile));
  const files = data.testResults.map(item => ({ file: path.relative(root, item.name), durationMs: item.endTime - item.startTime, status: item.status, tests: item.assertionResults.length })).sort((a, b) => b.durationMs - a.durationMs);
  const tests = data.testResults.flatMap(item => item.assertionResults.map(test => ({ file: path.relative(root, item.name), name: test.fullName, durationMs: test.duration ?? null, status: test.status }))).sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1));
  const report = { wallMs: Math.round(performance.now() - started), passed: data.numPassedTests, failed: data.numFailedTests, files, tests,
    note: 'ファイル時間は重なって実行されるため合計を実時間とみなさない。transform/import/environmentの内訳はVitest標準レポートで別途確認する。' };
  fs.writeFileSync(path.join(output, 'timing.json'), JSON.stringify(report, null, 2));
  const cell = value => String(value ?? '').replace(/[\t\r\n]/g, ' ');
  fs.writeFileSync(path.join(output, 'slow-tests.tsv'), ['ファイル\tテスト\t所要時間ms\t状態', ...tests.map(test => [test.file, test.name, test.durationMs, test.status].map(cell).join('\t'))].join('\n') + '\n');
  console.log(JSON.stringify({ ...report, files: files.slice(0, 15), tests: tests.slice(0, 10), output }, null, 2));
}
process.exitCode = result.status ?? 1;
