import {mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {versionLogDirectory} from '../../../scripts/version-log-path.mjs';
export const testOutputDirectory=versionLogDirectory(fileURLToPath(new URL('../../../',import.meta.url)),'mermaid-research');
mkdirSync(testOutputDirectory,{recursive:true});
export const testOutputUrl=(file='')=>pathToFileURL(join(testOutputDirectory,file));
