import type { Handlers } from 'openapi-cli-kit';
import { gimpRunner, type GimpRun } from './runtime.ts';
import { imageHandlers } from './image-handlers.ts';
import { layerHandlers } from './layer-handlers.ts';
import { bundleHandlers } from './bundle-handlers.ts';
import { pdbHandlers } from './pdb-handlers.ts';
import { scriptHandlers } from './script-handlers.ts';

export { gimpRunner, resolveGimpBinary } from './runtime.ts';
export type { GimpRun } from './runtime.ts';

export function gimpHandlers(run: GimpRun = gimpRunner()): Handlers {
  return { ...imageHandlers(run), ...layerHandlers(run), ...bundleHandlers(run), ...pdbHandlers(run), ...scriptHandlers(run) };
}

export const handlers = (): Handlers => gimpHandlers();
