import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = await realpath(path.dirname(fileURLToPath(import.meta.url)));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.mmd':'text/plain; charset=utf-8', '.mermaid':'text/plain; charset=utf-8' };
http.createServer(async (req,res) => {
  try {
    if(!/^([a-z0-9-]+\.localhost|localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')){res.writeHead(403).end();return;}
    if(req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const actual = await realpath(target);
    if(!actual.startsWith(root + path.sep)) {res.writeHead(403).end();return;}
    const data = await readFile(actual);
    res.writeHead(200, { 'Content-Type':mime[path.extname(actual)] || 'text/plain', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' http://*.localhost:${Number(process.env.MERMAID_EDITOR_PORT||4178)} http://localhost:${Number(process.env.MERMAID_EDITOR_PORT||4178)} http://127.0.0.1:${Number(process.env.MERMAID_EDITOR_PORT||4178)}; object-src 'none'; base-uri 'none'` });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {res.writeHead(404).end('見つかりません');}
}).listen(Number(process.env.MERMAID_EDITOR_PORT || 4178), '127.0.0.1', function(){console.log(`Mermaid Studio: http://127.0.0.1:${this.address().port}`);});
