import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { platform, release, cpus } from 'node:os';
import { aggregateSamples, comparePerformance, connectCdp, inputHash, validateSample } from './embedded-image-performance.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const positional = args.filter(value => !value.startsWith('--'));
const port = Number(positional[0] ?? 9333);
const version = option('version', 'v0.0.19');
if (!/^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('対象版が不正です。');
const output = resolve(positional[1] ?? `dev/history/${version}/logs/embedded-images-${Date.now()}`);
const fixturePath = resolve(option('fixture', 'samples/v0.0.18.4-100-embedded-images.md'));
const fixture = await readFile(fixturePath, 'utf8');
if ((fixture.match(/data:image\/png;base64,/g) ?? []).length !== 100) throw new Error('100枚の試験入力が必要です。');
const baselinePath = resolve(option('baseline', 'tests/performance/baselines/embedded-images-load.json'));
const trials = Number(option('trials', '5'));
if (!Number.isInteger(trials) || trials < 3 || trials > 20) throw new Error('試行数は3〜20で指定してください。');
const buildKind = option('build-kind');
if (!buildKind) throw new Error('--build-kind=acceptance-debug 等の成果物種別を指定してください。');
await mkdir(output, { recursive: true });
let cdp;
const result = { schemaVersion: 2, timestamp: new Date().toISOString(), status: 'failed', environment: {}, samples: [] };
try {
  const targets = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(10000) }).then(response => { if (!response.ok) throw new Error(`CDP HTTP ${response.status}`); return response.json(); });
  const eligible = targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl && (!option('target') || target.id === option('target')));
  if (eligible.length !== 1) throw new Error('対象ページが一意ではありません。--target=<CDP target id> を指定してください。');
  cdp = await connectCdp(eligible[0].webSocketDebuggerUrl);
  const selected = await cdp.evaluate(`(() => { const tab = [...document.querySelectorAll('.tab')].find(item => (item.title || '').endsWith(${JSON.stringify(basename(fixturePath))})); if (!tab) return false; tab.click(); document.querySelector('[data-ui-command="view.split"]')?.click(); return true; })()`);
  if (!selected) throw new Error('専用fixtureのタブを開いてから測定してください。');
  await cdp.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  const state = await cdp.evaluate(`(() => { const editor = document.querySelector('.cm-content'); const view = (editor?.cmTile?.view ?? editor?.cmView?.view); return { source: view?.state?.doc?.toString(), viewport: [innerWidth,innerHeight,devicePixelRatio], zoom: Number(getComputedStyle(document.querySelector('.preview-container')).zoom) || 1 }; })()`);
  if (!state.source || inputHash(state.source) !== inputHash(fixture.replace(/\r\n?/g, '\n'))) throw new Error('エディター内の本文hashがfixtureと一致しません。未保存内容のある文書は測定しません。');
  if (state.zoom !== 1) throw new Error('倍率100%で測定してください。');
  const browserVersion = await cdp.send('Browser.getVersion');
  result.environment = { fixture: fixturePath, fixtureHash: inputHash(fixture), buildKind, browserVersion: browserVersion.product, viewport: state.viewport, platform: `${platform()} ${release()} ${cpus()[0]?.model}`, mode: 'split-horizontal-100%-warm-preview', revision: execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim(), dirty: execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length > 0 };
  const measurement = async () => {
    const editor = document.querySelector('.cm-content'); const view = editor?.cmTile?.view ?? editor?.cmView?.view;
    if (!view) throw new Error('CodeMirrorが見つかりません');
    const original = view.state.doc.toString();
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const until = async (condition) => { const start = performance.now(); while (!condition()) { if (performance.now()-start > 30000) throw new Error('描画完了タイムアウト'); await frame(); } };
    document.querySelector('[data-ui-command="view.split"]').click();
    const direction = document.querySelector('[data-ui-command="view.direction"]'); direction.value='horizontal'; direction.dispatchEvent(new Event('change',{bubbles:true}));
    const preview = document.querySelector('.preview-container');
    if (!preview) throw new Error('Desktopプレビューが見つかりません');
    const start = performance.now();
    await until(() => preview.querySelectorAll('.markdown-body img').length===100);
    const images = [...preview.querySelectorAll('.markdown-body img')]; images.forEach(image => image.loading='eager');
    await Promise.all(images.map(image => image.decode())); await frame();
    const loadMs = performance.now()-start;
    const scrolling = performance.now(); let last=scrolling,maxFrameMs=0;
    for(let index=0;index<=40;index++){ preview.scrollTop=(preview.scrollHeight-preview.clientHeight)*(index<=20?index:40-index)/20; await frame();const now=performance.now();maxFrameMs=Math.max(maxFrameMs,now-last);last=now; }
    const scrollSweepMs=performance.now()-scrolling;
    const syncStart=performance.now(); view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});
    await until(() => preview.scrollTop >= preview.scrollHeight-preview.clientHeight-10); await frame();
    const syncMs=performance.now()-syncStart;
    const marker='PerformanceProbe'+Date.now();const editStart=performance.now();let editMs;
    try { view.dispatch({changes:{from:0,insert:marker+'\n\n'}}); await until(()=>preview.textContent.includes(marker)); await frame();editMs=performance.now()-editStart; }
    finally { if (view.state.doc.toString().startsWith(marker+'\n\n')) view.dispatch({changes:{from:0,to:marker.length+2,insert:''},selection:{anchor:0}}); }
    await until(()=>!preview.textContent.includes(marker));
    if(view.state.doc.toString()!==original)throw new Error('試験文書の復旧に失敗');
    return {loadMs,scrollSweepMs,maxFrameMs,editMs,syncMs,imageCount:images.length,brokenImages:images.filter(image=>!image.naturalWidth).length,wrongSize:images.filter(image=>image.naturalWidth!==500||image.naturalHeight!==500).length,scrollHeight:preview.scrollHeight,viewportHeight:preview.clientHeight};
  };
  result.warmup = validateSample(await cdp.evaluate(`(${measurement.toString()})()`));
  for(let index=0;index<trials;index++) result.samples.push(validateSample(await cdp.evaluate(`(${measurement.toString()})()`)));
  result.metrics = aggregateSamples(result.samples);
  if(args.includes('--update-baseline')) { await mkdir(dirname(baselinePath),{recursive:true});await writeFile(baselinePath,JSON.stringify({...result,status:'baseline'},null,2));result.status='baseline-written'; }
  else if(args.includes('--measure-only')) result.status='measured-not-compared';
  else { result.regressions=comparePerformance(result,JSON.parse(await readFile(baselinePath,'utf8')));result.status=result.regressions.length?'regression':'passed';if(result.regressions.length)process.exitCode=1; }
} catch(error) { result.error=String(error);process.exitCode=1; }
finally { cdp?.close();await writeFile(resolve(output,'summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result)); }
