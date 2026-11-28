import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from 'openapi-cli-kit';

export type GimpRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const quotePython = (value: string) => JSON.stringify(value);
const pythonHelpersPath = fileURLToPath(new URL('./python/helpers.py', import.meta.url));

function executableOnPath(command: string, searchPath: string | undefined): string | undefined {
  for (const directory of searchPath?.split(path.delimiter) ?? []) {
    const candidate = path.join(directory || process.cwd(), command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function gimpAppExecutable(env: Record<string, string | undefined>): string | undefined {
  const roots = [path.join(env.HOME ?? os.homedir(), 'Applications'), '/Applications'];
  for (const root of roots) {
    let appNames: string[];
    try {
      appNames = fs.readdirSync(root).filter((name) => /^gimp(?:[ -].*)?\.app$/i.test(name));
    } catch {
      continue;
    }
    appNames.sort((a, b) => (a.toLowerCase() === 'gimp.app' ? -1 : b.toLowerCase() === 'gimp.app' ? 1 : a.localeCompare(b)));
    for (const appName of appNames) {
      const app = path.join(root, appName);
      const info = path.join(app, 'Contents', 'Info.plist');
      let executable: string | undefined;
      try {
        const plist = fs.readFileSync(info, 'utf8');
        executable = /<key>\s*CFBundleExecutable\s*<\/key>\s*<string>([^<]+)<\/string>/i.exec(plist)?.[1];
        if (!executable) {
          executable = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', info], { encoding: 'utf8' }).trim();
        }
      } catch {
        continue;
      }
      const binary = path.join(app, 'Contents', 'MacOS', executable);
      try {
        fs.accessSync(binary, fs.constants.X_OK);
        if (fs.statSync(binary).isFile()) return binary;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

export function resolveGimpBinary(env: Record<string, string | undefined> = process.env, platform = process.platform): string {
  if (env.GIMP_BINARY) return env.GIMP_BINARY;
  const onPath = executableOnPath('gimp', env.PATH);
  if (onPath) return onPath;
  return platform === 'darwin' ? gimpAppExecutable(env) ?? 'gimp' : 'gimp';
}

export function gimpRunner(env: Record<string, string | undefined> = process.env, platform = process.platform): GimpRun {
  const bin = resolveGimpBinary(env, platform);
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env } as NodeJS.ProcessEnv }, (err, stdout, stderr) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          reject(new CliError(503, `GIMP CLI is missing (could not run ${bin})`, 'Install GIMP 3 from https://www.gimp.org/downloads/, or set GIMP_BINARY to its executable'));
          return;
        }
        resolve({
          code: err && typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : err ? -1 : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      });
    });
}

function responseScript(output: string, action: string): string {
  return `import json
import traceback

OUTPUT = ${quotePython(output)}
HELPERS = ${quotePython(pythonHelpersPath)}

class CliFailure(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status

def emit(value):
    with open(OUTPUT, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False)

try:
    import gi
    gi.require_version("Gimp", "3.0")
    gi.require_version("Gio", "2.0")
    from gi.repository import Gimp, Gio
    with open(HELPERS, encoding="utf-8") as helpers_file:
        exec(compile(helpers_file.read(), HELPERS, "exec"), globals())
${action
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
except CliFailure as error:
    emit({"_status": error.status, "_error": str(error)})
except ImportError as error:
    emit({"_status": 503, "_error": str(error)})
except Exception as error:
    emit({"_status": 500, "_error": str(error), "_traceback": traceback.format_exc()})
`;
}

export async function batch(run: GimpRun, action: string): Promise<Record<string, unknown>> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-'));
  const scriptFile = path.join(directory, 'batch.py');
  const resultFile = path.join(directory, 'result.json');

  try {
    fs.writeFileSync(scriptFile, responseScript(resultFile, action), 'utf8');
    const expression = `exec(open(${quotePython(scriptFile)}, encoding="utf-8").read())`;
    const result = await run([
      '--new-instance',
      '--no-interface',
      '--no-splash',
      '--no-shm',
      '--console-messages',
      '--batch-interpreter=python-fu-eval',
      '-b',
      expression,
      '--quit',
    ]);

    if (!fs.existsSync(resultFile)) {
      const message = result.stderr.trim().split('\n')[0] || result.stdout.trim().split('\n')[0];
      if (/unknown option|batch.?interpreter|python.?fu.?eval|no interpreter/i.test(message)) {
        throw new CliError(503, message || 'This GIMP installation does not provide the GIMP 3 Python batch interpreter', 'Install GIMP 3 with Python support and check GIMP_BINARY');
      }
      if (result.code !== 0) throw new CliError(500, message || `GIMP exited with ${result.code}`);
      throw new CliError(500, 'GIMP batch mode returned no result', 'Check that this is a GIMP 3 installation with its Python batch interpreter enabled');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      throw new CliError(500, `GIMP batch mode returned invalid JSON: ${(error as Error).message}`);
    }

    if (result.code !== 0) {
      const message = result.stderr.trim().split('\n')[0] || result.stdout.trim().split('\n')[0];
      throw new CliError(500, message || `GIMP exited with ${result.code}`);
    }
    if (typeof payload._error === 'string') {
      const status = payload._status === 400 ? 400 : payload._status === 404 ? 404 : payload._status === 503 ? 503 : 500;
      const hint = status === 503 ? 'Install GIMP 3 with Python support and check GIMP_BINARY' : undefined;
      throw new CliError(status, payload._error, hint);
    }
    return payload;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
