import { createHash } from 'node:crypto';

export const metricLimits = { loadMs: [1.5, 250], editMs: [1.5, 100], syncMs: [1.5, 100], scrollSweepMs: [1.5, 100], maxFrameMs: [1.75, 8] };
export const inputHash = text => createHash('sha256').update(text).digest('hex');
export function validateSample(sample, expectedCount = 100) {
  if (!sample || sample.timeout || sample.imageCount !== expectedCount || sample.brokenImages !== 0 || sample.wrongSize !== 0 || sample.scrollHeight <= sample.viewportHeight) throw new Error('画像件数・寸法・スクロール領域が試験条件と一致しません。');
  for (const key of Object.keys(metricLimits)) if (!Number.isFinite(sample[key]) || sample[key] <= 0) throw new Error(`無効な測定値: ${key}`);
  return sample;
}
export function aggregateSamples(samples) {
  if (samples.length < 3) throw new Error('性能測定には3回以上の試行が必要です。');
  samples.forEach(sample => validateSample(sample));
  return Object.fromEntries(Object.keys(metricLimits).map(key => {
    const sorted = samples.map(sample => sample[key]).sort((a, b) => a - b);
    return [key, { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }];
  }));
}
export function comparePerformance(result, baseline) {
  if (baseline.schemaVersion !== 2 || !baseline.metrics || !baseline.environment) throw new Error('基準値の形式が無効です。');
  for (const key of ['fixtureHash', 'buildKind', 'browserVersion', 'viewport', 'platform', 'mode']) {
    if (JSON.stringify(result.environment[key]) !== JSON.stringify(baseline.environment[key])) throw new Error(`基準値と測定条件が一致しません: ${key}`);
  }
  return Object.entries(metricLimits).flatMap(([key, [multiplier, allowance]]) => {
    const previous = baseline.metrics[key]?.median, actual = result.metrics[key]?.median;
    if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(actual) || actual <= 0) throw new Error(`無効な基準値: ${key}`);
    const allowed = previous * multiplier + allowance;
    return actual > allowed ? [{ metric: key, actual, baseline: previous, allowed }] : [];
  });
}

/** CDPのprotocol wrapperとremote objectを取り除き、評価例外を成功にしない。 */
export function evaluatedValue(result) {
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'CDP評価例外');
  if (!result.result || !Object.hasOwn(result.result, 'value')) throw new Error('CDP応答にresult.valueがありません。');
  return result.result.value;
}

export async function connectCdp(url, timeout = 10000) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP接続タイムアウト')); }, timeout);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP接続失敗')); }, { once: true });
  });
  let serial = 0;
  const pending = new Map();
  const rejectAll = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP接続が終了しました。')); } pending.clear(); };
  socket.addEventListener('close', rejectAll);
  socket.addEventListener('error', rejectAll);
  socket.addEventListener('message', event => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  const send = (method, params = {}, timeoutMs = timeout) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP応答タイムアウト: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { socket.send(JSON.stringify({ id, method, params })); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  return { send, evaluate: async (expression, timeoutMs = 60000) => evaluatedValue(await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs)), close: () => { rejectAll(); socket.close(); } };
}
