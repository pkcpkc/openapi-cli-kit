import type { Handlers } from 'openapi-cli-kit';
import fs from 'node:fs';
import { batch, quotePython, type GimpRun } from './runtime.ts';
import { requireFile } from './shared.ts';

export function scriptHandlers(run: GimpRun): Handlers {
  return {
    'script-run': async ({ args }) => {
      const file = args.script as string;
      requireFile(file);
      const source = fs.readFileSync(file, 'utf8');
      const body = await batch(run, `import contextlib
import io
script_output = io.StringIO()
script_namespace = {"__name__": "__main__", "__file__": ${quotePython(file)}, "Gimp": Gimp, "Gio": Gio}
with contextlib.redirect_stdout(script_output):
    exec(compile(${quotePython(source)}, ${quotePython(file)}, "exec"), script_namespace)
emit({"script": ${quotePython(file)}, "stdout": script_output.getvalue(), "result": script_namespace.get("result")})`);
      return { body };
    }
  };
}
