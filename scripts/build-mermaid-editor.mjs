import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeRoot = path.join(repositoryRoot, "dev", "research", "20260913_mermaid-editor");
const outputPath = path.join(repositoryRoot, "src", "generated", "mermaidEditorDocument.ts");

const readPrototype = (relativePath) => readFile(path.join(prototypeRoot, relativePath), "utf8");
// Template literals must not contain a literal closing script tag.  The output,
// however, must contain one: <\\/script> is not an HTML closing tag.
const scriptEnd = "</scr" + "ipt>";
const escapeScriptEnd = (value) => value.replace(/<\/script/gi, "<\\/script");

const rendererSource = (await readPrototype("renderer.js"))
  .replace(/const parentOrigin=[^;]+;\s*if\(!\['localhost','127\.0\.0\.1'\]\.includes\(new URL\(parentOrigin\)\.hostname\)\)throw Error\([^;]+\);\s*/m, "")
  .replace(/if\(e\.source!==parent\|\|e\.origin!==parentOrigin\|\|e\.data\?\.kind!==['"]render['"]\)return;/, "if(e.source!==parent||e.data?.kind!=='render')return;")
  .replace(/,parentOrigin\)/g, ",'*')")
  .replace(/parent\.postMessage\(\{kind:['"]renderer-ready['"]\},parentOrigin\);/, "parent.postMessage({kind:'renderer-ready'},'*');");
const rendererBundle = await build({
  entryPoints: [path.join(prototypeRoot, "renderer.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  write: false,
  legalComments: "eof",
  plugins: [{
    name: "renderer-srcdoc-transport",
    setup(plugin) {
      plugin.onLoad({ filter: /renderer\.js$/ }, () => ({ contents: rendererSource, loader: "js", resolveDir: prototypeRoot }));
    },
  }],
});

const rendererDocument = `<!doctype html><html lang="ja"><meta charset="utf-8"><body><script>${escapeScriptEnd(rendererBundle.outputFiles[0].text)}${scriptEnd}<script>
addEventListener('message', async event => {
  if (event.source !== parent || event.data?.kind !== 'render') return;
  // The bundled renderer above owns Mermaid rendering.  Its localhost-only
  // transport is replaced by this local srcdoc boundary in the host build.
});
parent.postMessage({ kind: 'renderer-ready' }, '*');
${scriptEnd}</body></html>`;

const rendererAdapter = `
const rendererDocument = ${JSON.stringify(rendererDocument)};
export class Renderer {
  constructor(){ this.id=0; this.queue=Promise.resolve(); this.reset(); }
  reset(){
    this.removeReadyListener?.(); this.frame?.remove();
    this.frame=document.createElement('iframe');
    this.frame.style.cssText='position:fixed;left:-20000px;top:0;width:1400px;height:1000px;border:0;pointer-events:none';
    this.frame.srcdoc=rendererDocument; this.frame.setAttribute('aria-hidden','true'); document.body.append(this.frame);
    this.ready=new Promise(resolve=>{ const listen=event=>{ if(event.source===this.frame.contentWindow&&event.data?.kind==='renderer-ready'){ removeEventListener('message',listen); resolve(); }}; this.removeReadyListener=()=>removeEventListener('message',listen); addEventListener('message',listen); });
  }
  cancel(){ if(this.finish){ this.finish({error:'新しい編集により描画を中止しました。',diagnostics:[],excluded:[]}); this.reset(); } }
  render(code,recover=false){ const task=()=>new Promise(async resolve=>{ const id=++this.id; let done=false; const finish=result=>{if(done)return;done=true;this.finish=null;clearTimeout(timer);removeEventListener('message',listen);resolve(result)}; this.finish=finish; const listen=event=>{if(event.source===this.frame.contentWindow&&event.data?.kind==='render-result'&&event.data.id===id)finish(event.data)}; const timer=setTimeout(()=>{this.reset();finish({error:'描画が10秒を超えたため中止しました。',diagnostics:[],excluded:[]})},10000); addEventListener('message',listen); await this.ready; if(!done)this.frame.contentWindow.postMessage({kind:'render',id,code,recover},'*'); }); const promise=this.queue.then(task,task); this.queue=promise.then(()=>{}); return promise; }
}`;

const appBundle = await build({
  entryPoints: [path.join(prototypeRoot, "app.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  write: false,
  legalComments: "eof",
  plugins: [{
    name: "host-renderer",
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\/render-client\.js$/ }, () => ({ path: "host-renderer", namespace: "mermaid-host" }));
      plugin.onLoad({ filter: /.*/, namespace: "mermaid-host" }, () => ({ contents: rendererAdapter, loader: "js" }));
    },
  }],
});

const prototypeHtml = await readPrototype("index.html");
const prototypeCss = await readPrototype("style.css");
const sampleNames = (await readdir(path.join(prototypeRoot, "samples"))).filter((name) => name.endsWith(".mmd"));
const sampleSources = Object.fromEntries(await Promise.all(sampleNames
  .map(async (name) => [name.slice(0, -4), await readPrototype(`samples/${name}`)])));
const body = prototypeHtml.match(/<body>([\s\S]*)<script type="module" src="app\.js"><\/script><\/body>/i)?.[1];
if (!body) throw new Error("Mermaid試作版のHTML構造を読み取れません。");
const hostBridge = `<script>
(() => {
  let nonce = '';
  const samples = ${JSON.stringify(sampleSources)};
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const value = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const match = /(?:^|\\/)samples\\/([^/?#]+)\\.mmd(?:[?#].*)?$/.exec(value);
    if (match && Object.prototype.hasOwnProperty.call(samples, match[1])) return Promise.resolve(new Response(samples[match[1]], { status: 200, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }));
    return originalFetch(input, init);
  };
  const send = payload => parent.postMessage({ ...payload, nonce }, '*');
  const replaceSource = source => {
    const editor = window.mermaidStudio?.editor;
    if (!editor || typeof source !== 'string') return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
  };
  addEventListener('message', event => {
    if (event.source !== parent || typeof event.data?.nonce !== 'string') return;
    nonce = event.data.nonce;
    if (event.data.kind === 'mdvisualizer-mermaid-source') replaceSource(event.data.source);
    if (event.data.kind === 'mdvisualizer-mermaid-request-current-source') send({ kind: 'mdvisualizer-mermaid-current-source', source: window.mermaidStudio?.code ?? '' });
  });
  Object.defineProperty(window, 'mdVisualizerMermaidHost', { value: { source: () => window.mermaidStudio?.code ?? '' } });
  parent.postMessage({ kind: 'mdvisualizer-mermaid-ready' }, '*');
})();
<\/script>`;
const document = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${prototypeCss}\n/* MdVisualizer host mode: source ownership is the parent document. */\n#open,#folder,#save,#filename,.local-badge,.aside-footer{display:none!important}\n@media(max-width:480px){.topbar{min-height:54px;padding:6px;gap:6px}.brand{min-width:0}.brand strong{font-size:14px}.split{grid-template-columns:1fr;grid-template-rows:minmax(220px,42%) minmax(280px,58%)}#divider{display:none}.code-pane{border-bottom:1px solid var(--border)}.document-heading{padding:8px 12px}.toolbar{max-height:88px;overflow:auto;padding:6px}.preview-pane .pane-title{padding-inline:10px}.preview-footer{padding:7px 10px}}}</style></head><body>${body}<script>${escapeScriptEnd(appBundle.outputFiles[0].text)}${scriptEnd}${hostBridge}</body></html>`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `// This file is generated by scripts/build-mermaid-editor.mjs. Do not edit.\nexport const mermaidEditorDocument = ${JSON.stringify(document)};\n`, "utf8");
console.log(`Mermaid editor host document generated: ${path.relative(repositoryRoot, outputPath)}`);
