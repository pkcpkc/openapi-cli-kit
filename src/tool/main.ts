import path from 'node:path';
import { packageRoot } from '../library.ts';
import { runProcess } from '../process.ts';
import type { CliEntry } from '../project.ts';
import { toolHandlers } from './handlers.ts';
import { toolCli } from './spec.ts';

/** The kit's own CLI as a project entry: its spec in `specs/`, its skill in `skills/`. */
export const toolEntry = (root = packageRoot()): CliEntry => ({
  def: toolCli,
  handlers: toolHandlers,
  specFile: path.join(root, 'specs', 'ocli.openapi.json'),
  skillDir: path.join(root, 'skills', 'ocli'),
  source: 'specs/ocli.openapi.json',
});

/** Runs `ocli` on the process's arguments. */
export const main = (): Promise<number> => runProcess(toolEntry().specFile, toolHandlers());
