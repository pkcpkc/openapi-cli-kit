import type { Handlers } from 'openapi-cli-kit';
import { CliError } from 'openapi-cli-kit';
import fs from 'node:fs';
import path from 'node:path';
import { batch, quotePython, type GimpRun } from './runtime.ts';

const procedureParamCode = `def parameter_list(raw):
    if isinstance(raw, tuple):
        raw = next((value for value in raw if not isinstance(value, int)), [])
    output = []
    for parameter in raw or []:
        value_type = getattr(parameter, "value_type", None)
        output.append({
            "name": parameter.name,
            "nick": parameter.nick or "",
            "description": parameter.blurb or "",
            "type": getattr(value_type, "name", str(value_type or "unknown")),
        })
    return output`;
export function pdbHandlers(run: GimpRun): Handlers {
  return {
    'pdb-list': async ({ flags }) => {
      const match = flags.match as string;
      try {
        new RegExp(match);
      } catch (error) {
        throw new CliError(400, `--match is not a valid regular expression: ${(error as Error).message}`);
      }
      const offset = flags.offset as number;
      const limit = flags.limit as number;
      const body = await batch(
        run,
        `pdb = Gimp.get_pdb()
names = pdb.query_procedures(${quotePython(match)}, ".*", ".*", ".*", ".*", ".*", ".*", ".*")
if isinstance(names, tuple):
    names = next((value for value in names if not isinstance(value, int)), [])
names = list(names or [])
emit({"total": len(names), "offset": ${offset}, "limit": ${limit}, "procedures": names[${offset}:${offset + limit}]})`
      );
      return { body };
    },
    'pdb-info': async ({ args }) => {
      const body = await batch(
        run,
        `${procedureParamCode}
procedure = Gimp.get_pdb().lookup_procedure(${quotePython(args.procedure)})
if procedure is None:
    emit({"_status": 404, "_error": "No installed GIMP procedure named " + ${quotePython(args.procedure)}})
else:
    emit({
        "name": procedure.get_name(),
        "blurb": procedure.get_blurb() or "",
        "help": procedure.get_help() or "",
        "helpId": procedure.get_help_id() or "",
        "arguments": parameter_list(procedure.get_arguments()),
        "returns": parameter_list(procedure.get_return_values()),
    })`
      );
      return { body };
    },
    'pdb-dump': async ({ flags }) => {
      const file = flags.out as string;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const body = await batch(
        run,
        `file = Gio.File.new_for_path(${quotePython(file)})
if not Gimp.get_pdb().dump_to_file(file):
    raise RuntimeError("GIMP could not write the PDB dump")
emit({"file": ${quotePython(file)}})`
      );
      return { body, text: `${file}\n` };
    }
  };
}
