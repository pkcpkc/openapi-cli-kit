// Writes the kit's own spec and its skill's command reference (`npm run specs`).
import path from 'node:path';
import { writeCli } from '../src/project.ts';
import { toolEntry } from '../src/tool/main.ts';

for (const file of writeCli(toolEntry())) console.log(`Wrote ${path.relative(process.cwd(), file)}`);
