import path from 'node:path';
import {randomUUID} from 'node:crypto';

// ツール固有の引数へ対象版を混ぜず、manifestから開発対象版を推測しない。
export function takeVersionArgument(args, fallback = process.env.MDVISUALIZER_VERSION) {
  const remaining = [];
  let version = fallback;
  let specified = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--version' || arg.startsWith('--version=')) {
      if (specified) throw new Error('--version は一度だけ指定してください。');
      specified = true;
      version = arg === '--version' ? args[++i] : arg.slice('--version='.length);
      if (!version || version.startsWith('--')) throw new Error('--version の値がありません。');
    } else remaining.push(arg);
  }
  // 出力を作る前に形式を検証する。
  versionLogDirectory(process.cwd(), 'validate-version', version);
  return { version, args: remaining };
}

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
