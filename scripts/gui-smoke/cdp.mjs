import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function connectCdp({ port, directory, targetId, fetchImpl = fetch, Socket = WebSocket, commandTimeoutMs = 25_000 }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CDPポートが不正です。');
  let targets = [];
  const deadline = performance.now() + 10_000;
  do {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json`, { redirect: 'error', signal: AbortSignal.timeout(500) });
      if (!response.ok) throw new Error('専用WebViewの一覧取得に失敗しました。');
      targets = (await response.json()).filter(candidate => candidate.type === 'page' && (
        candidate.url.startsWith('tauri://') || candidate.url.startsWith('http://tauri.localhost/')
      ) && (!targetId || candidate.id === targetId));
      if (targets.length) break;
    } catch { /* 起動直後の専用endpointを上限付きで待つ。 */ }
    await delay(100);
  } while (performance.now() < deadline);
  if (targets.length !== 1) throw new Error(`専用Tauriページを一意に選べません（${targets.length}件）。専用ポートと--target-idを確認してください。`);
  const target = targets[0];
  const endpoint = new URL(target.webSocketDebuggerUrl);
  if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || Number(endpoint.port) !== port || endpoint.username || endpoint.password) {
    throw new Error('同じローカルポート以外のCDP接続は拒否します。');
  }
  const socket = new Socket(endpoint.href);
  let sequence = 0;
  const pending = new Map();
  function rejectPending(message) {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear();
  }
  const close = () => { rejectPending('CDP接続を終了しました。'); socket.close(); };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP接続が3秒以内に完了しませんでした。')), 3000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP接続エラーです。')); }, { once: true });
    });
    socket.addEventListener('close', () => rejectPending('CDP接続が閉じられました。'));
    socket.addEventListener('error', () => rejectPending('CDP通信エラーです。'));
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { rejectPending('CDP応答がJSONではありません。'); return; }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: 応答待ちを打ち切りました。`)); }, commandTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'WebViewの評価エラー');
      return result.result.value;
    };
    const screenshot = async filename => {
      if (!/^[a-z0-9-]+\.png$/.test(filename)) throw new Error('スクリーンショット名が不正です。');
      const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const output = path.join(directory, filename);
      await writeFile(output, Buffer.from(capture.data, 'base64'));
      return output;
    };
    await command('Page.enable');
    await command('Runtime.enable');
    return { evaluate, screenshot, close, targetId: target.id };
  } catch (error) { close(); throw error; }
}
