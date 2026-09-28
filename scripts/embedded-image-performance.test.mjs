import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateSamples, comparePerformance, connectCdp, evaluatedValue, validateSample } from './embedded-image-performance.mjs';
const sample = { loadMs:10,editMs:20,syncMs:5,scrollSweepMs:100,maxFrameMs:17,imageCount:100,brokenImages:0,wrongSize:0,scrollHeight:10000,viewportHeight:800 };
test('CDP remote objectの値と評価例外を識別する', () => {
  assert.deepEqual(evaluatedValue({result:{value:sample}}),sample);
  assert.throws(()=>evaluatedValue({exceptionDetails:{text:'Script failed'}}),/Script failed/);
  assert.throws(()=>evaluatedValue({result:{type:'undefined'}}),/result.value/);
});
test('0枚・壊れた画像・不正値・寸法違いを拒否する', () => {
  for(const invalid of [{imageCount:0},{brokenImages:1},{wrongSize:1},{loadMs:NaN},{scrollSweepMs:0},{timeout:true}]) assert.throws(()=>validateSample({...sample,...invalid}));
});
test('複数試行の中央値とp95を集計し、意図的な遅延を検知する', () => {
  const baseline={schemaVersion:2,environment:{fixtureHash:'a',buildKind:'debug',mode:'split'},metrics:aggregateSamples([sample,sample,sample])};
  assert.deepEqual(comparePerformance(baseline,baseline),[]);
  const slow={...baseline,metrics:{...baseline.metrics,editMs:{median:5000}}};
  assert.equal(comparePerformance(slow,baseline)[0].metric,'editMs');
  assert.throws(()=>comparePerformance({...baseline,environment:{...baseline.environment,fixtureHash:'b'}},baseline),/一致しません/);
  assert.throws(()=>comparePerformance(baseline,{}),/無効/);
});
test('接続・応答タイムアウトと途中切断で待機を必ず解放する', async () => {
  const Original=globalThis.WebSocket;
  class FakeSocket extends EventTarget {
    constructor(url){super();this.url=url;if(url!=='never-open')queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    send(){if(this.url==='disconnect')queueMicrotask(()=>this.close());}
    close(){this.dispatchEvent(new Event('close'));}
  }
  globalThis.WebSocket=FakeSocket;
  try {
    await assert.rejects(connectCdp('never-open',10),/接続タイムアウト/);
    const silent=await connectCdp('silent',10);
    await assert.rejects(silent.send('Runtime.evaluate'),/応答タイムアウト/);silent.close();
    const broken=await connectCdp('disconnect',100);
    await assert.rejects(broken.send('Runtime.evaluate'),/終了/);broken.close();
  } finally {globalThis.WebSocket=Original;}
});
