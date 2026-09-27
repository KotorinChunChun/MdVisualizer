// Web子リポジトリの正本へ委譲する互換入口。
import { runWebPlatformBuild } from './run-web-platform-build.mjs';
import { auditContract } from './ui-command-contract.mjs';
if (auditContract().errors.length) throw new Error('UI対応表が変更内容と一致しません。');
await runWebPlatformBuild('build-web');
