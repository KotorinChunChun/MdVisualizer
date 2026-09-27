import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const version = process.argv[2];
assert.match(version ?? '', /^v\d+\.\d+\.\d+(?:\.\d+)?$/, '対象版を明示してください');
const folder = path.join(root, 'dev/history', version);
const req = fs.readFileSync(path.join(folder, `${version}-req.md`), 'utf8');
const tests = fs.readFileSync(path.join(folder, `${version}-test-requirements.md`), 'utf8');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, `web-platform/tests/fixtures/${version}-ui-cases.json`), 'utf8'));
const ids = [...req.matchAll(/^- \[[ x]\] ([A-Z]\d{2}):/gm)].map(m => m[1]);
assert(ids.length > 0, '要求IDがありません');
const fixtureIds = fixtures.cases.map(c => c.id);
assert.equal(new Set(fixtureIds).size, fixtureIds.length, 'fixture ID重複');
for (const id of ids) {
  assert(fixtureIds.includes(id), `${id}: サンプル/検証入力定義がない`);
  assert(new RegExp(`\\| ${id}(?: |\\|)`).test(tests), `${id}: テスト要件に対応行がない`);
}
const failures = [];
const walk = directory => {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) walk(file);
    else if (file.endsWith('.md')) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g)) {
        if (!fs.existsSync(path.join(root, decodeURIComponent(match[1])))) failures.push(`${path.relative(root,file)}: ${match[1]}`);
      }
    }
  }
};
walk(path.join(root, 'docs'));
assert.deepEqual(failures, [], 'docsリンク切れ');
console.log(`要求/サンプル/テスト要件 ${ids.length} ID一致、docsリンク検査成功`);
