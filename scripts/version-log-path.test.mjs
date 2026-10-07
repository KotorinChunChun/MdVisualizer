import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {versionLogDirectory, takeVersionArgument} from './version-log-path.mjs';
const project=path.resolve('tmp/path-fixture');
test('明示版が環境版に優先し、検証対象引数を保持する',()=>{
 assert.deepEqual(takeVersionArgument(['--version','v0.0.19','--related','src/a.ts'],'v0.0.18'), {version:'v0.0.19',args:['--related','src/a.ts']});
 assert.deepEqual(takeVersionArgument(['src/a.test.ts','--version=v0.0.19'],''), {version:'v0.0.19',args:['src/a.test.ts']});
 assert.deepEqual(takeVersionArgument(['--force'],'v0.0.19'), {version:'v0.0.19',args:['--force']});
});
test('対象版の欠落・重複・不正値を実行前に拒否する',()=>{
 for (const args of [[],['--version'],['--version','--force'],['--version=../bad'],['--version=v0.0.19','--version=v0.0.20']]) assert.throws(()=>takeVersionArgument(args,''));
});
test('版を明示しない場合は出力先を推測しない',()=>assert.throws(()=>versionLogDirectory(project,'test','')));
test('版にパストラバーサルを混入できない',()=>assert.throws(()=>versionLogDirectory(project,'test','../v0.0.18')));
test('対象版ごと・実行ごとに出力先を分離する',()=>{
 const a=versionLogDirectory(project,'test','0.0.18'),b=versionLogDirectory(project,'test','v0.0.18');
 assert(a.startsWith(path.join(project,'dev/history/v0.0.18/logs')+path.sep));assert.notEqual(a,b);
});
test('上書き指定でもdev直下や別版へ出力できない',()=>{
 assert.throws(()=>versionLogDirectory(project,'test','v0.0.18',path.join(project,'dev/test-videos')));
 assert.throws(()=>versionLogDirectory(project,'test','v0.0.18',path.join(project,'dev/history/v0.0.17/logs/run')));
 const wanted=path.join(project,'dev/history/v0.0.18/logs/run');assert.equal(versionLogDirectory(project,'test','v0.0.18',wanted),wanted);
});
