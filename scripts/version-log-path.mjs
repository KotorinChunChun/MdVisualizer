import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function versionLogDirectory(projectRoot, scenario, version = process.env.MDVISUALIZER_VERSION, outputDirectory) {
  if (!/^v?\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.-]+)?$/.test(version ?? '')) {
    throw new Error('対象版を --version または MDVISUALIZER_VERSION で指定してください（例: v0.0.18）。');
  }
  const normalized = version.startsWith('v') ? version : `v${version}`;
  const base = path.resolve(projectRoot, 'dev/history', normalized, 'logs');
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const output = outputDirectory ? path.resolve(outputDirectory) : path.join(base, `${stamp}-${scenario}-${randomUUID().slice(0, 8)}`);
  const relative = path.relative(base, output);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('出力先は対象版のlogs配下の実行フォルダーにしてください。');
  }
  return output;
}
