import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {versionLogDirectory} from './version-log-path.mjs';
const project=path.resolve('tmp/path-fixture');
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
