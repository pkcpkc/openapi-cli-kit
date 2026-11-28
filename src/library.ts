import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './runner/errors.ts';
import { buildSpec, type CliDef } from './dsl.ts';
import { profileArtifacts, profileIndexText, specText } from './project.ts';
import { referenceText } from './reference.ts';
import { ITEMS } from '../library/index.ts';

/**
 * The library: ready-made CLIs, each a folder `library/<name>/` with its definition (`spec.ts`, exporting `cli`), its
 * handlers (`handlers.ts`, exporting `handlers()`), any more source files, and its agent skill (`SKILL.md`). `addItem`
 * copies one into a project, which then owns and may change it, as with any generated code.
 */
export interface LibraryItem {
  /** The name to add it by: `ocli add <name>`. */
  name: string;
  /** Its binary, as the library names it (`--as` renames it on adding). */
  binary: string;
  summary: string;
  def: CliDef;
  /** Its source files in `library/<name>/`, copied as they are (the binary renamed). */
  files: string[];
  /** Tools it runs that must be on the machine; `macApp` and `envVar` can satisfy the requirement when command is absent. */
  requires: { command: string; install: string; macApp?: string; envVar?: string }[];
}

export const LIBRARY: LibraryItem[] = ITEMS;

export const findItem = (name: string): LibraryItem | undefined => LIBRARY.find((i) => i.name === name || i.binary === name);

/** The package's own folder (where `package.json` is), from here in `src/` or in `dist/src/`. */
export function packageRoot(from = path.dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file) && (JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string }).name === 'openapi-cli-kit') return dir;
    if (path.dirname(dir) === dir) throw new Error('openapi-cli-kit: package.json not found');
  }
}

export interface AddOptions {
  /** The project folder. */
  cwd: string;
  /** Another binary name for it. */
  as?: string;
  /** The folder its code goes in (one folder per CLI): default `cli`. */
  dir?: string;
  /** The folder of the agent skills: default `.agents/skills`. */
  skillsDir?: string;
  /** Overwrite what is there. */
  force?: boolean;
  /** Leave `package.json` as it is (by default its `bin` gets the launcher). */
  noPackage?: boolean;
}

export interface AddResult {
  item: string;
  binary: string;
  files: string[];
  /** The `bin` entry added to package.json, if one was. */
  bin?: string;
  /** What is left to do: dependencies to install, tools missing on this machine. */
  next: string[];
}

const BINARY = /^[a-z][a-z0-9-]*$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  [key: string]: unknown;
}

/** Whether a command runs here (on the PATH). */
function onPath(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Whether a macOS application bundle is installed in /Applications or ~/Applications. */
export function macAppInstalled(app: string, platform = process.platform, home = process.env.HOME ?? ''): boolean {
  if (platform !== 'darwin') return false;
  const base = app.replace(/\.app$/i, '').toLowerCase();
  for (const directory of ['/Applications', path.join(home, 'Applications')]) {
    let names: string[];
    try {
      names = fs.readdirSync(directory);
    } catch {
      continue;
    }
    if (names.some((name) => {
      const lower = name.toLowerCase();
      return lower === `${base}.app` || (lower.endsWith('.app') && (lower.startsWith(`${base} `) || lower.startsWith(`${base}-`)));
    })) return true;
  }
  return false;
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const launcher = (binary: string, item: string) => `#!/usr/bin/env node
// ${binary}: from the openapi-cli-kit library (${item}). Its contract is ${binary}.openapi.json beside this file.
import { register } from 'tsx/esm/api';

register();
const { runProcess } = await import('openapi-cli-kit');
const { handlers } = await import('./handlers.ts');
await runProcess(new URL('./${binary}.openapi.json', import.meta.url), handlers());
`;

/**
 * Adds a library CLI to a project: its code to `<dir>/<binary>/` (the source files, its full and focused OpenAPI specs,
 * and a launcher `bin.mjs`), its skill to `<skillsDir>/<binary>/` (`SKILL.md` and generated command/profile references),
 * and the launcher to package.json's `bin`. With `as`, every mention of its binary is renamed.
 */
export function addItem(name: string, options: AddOptions): AddResult {
  const item = findItem(name);
  if (!item) throw new CliError(404, `No library item ${name}`, `ocli list shows them: ${LIBRARY.map((i) => i.name).join(', ')}`);
  const binary = options.as ?? item.binary;
  if (!BINARY.test(binary)) throw new CliError(400, `--as ${binary}: a binary name is lowercase letters, digits and dashes`);
  const rename = (text: string) => (binary === item.binary ? text : text.replace(new RegExp(`(?<![\\w-])${escape(item.binary)}(?![\\w-])`, 'g'), binary));

  const codeDir = path.resolve(options.cwd, options.dir ?? 'cli', binary);
  const skillDir = path.resolve(options.cwd, options.skillsDir ?? '.agents/skills', binary);
  const taken = [codeDir, path.join(skillDir, 'SKILL.md')].filter((f) => fs.existsSync(f));
  if (taken.length && !options.force) throw new CliError(409, `Already there: ${taken.join(', ')}`, 'Add --force to overwrite it, or --as for another name');

  const source = path.join(packageRoot(), 'library', item.name);
  const files: string[] = [];
  const put = (file: string, text: string, mode?: number) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { encoding: 'utf8', ...(mode ? { mode } : {}) });
    files.push(file);
  };
  for (const file of item.files) put(path.join(codeDir, file), rename(fs.readFileSync(path.join(source, file), 'utf8')));
  const def = JSON.parse(rename(JSON.stringify(item.def))) as CliDef;
  const specFile = path.join(codeDir, `${binary}.openapi.json`);
  put(specFile, specText(def));
  put(path.join(codeDir, 'bin.mjs'), launcher(binary, item.name), 0o755);
  put(path.join(skillDir, 'SKILL.md'), rename(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')));
  put(path.join(skillDir, 'references', 'commands.md'), referenceText(buildSpec(def), path.relative(options.cwd, specFile)));
  for (const profile of profileArtifacts(def)) {
    const profileFileName = profile.specFileName.replace(def.binary, binary);
    const profileFile = path.join(codeDir, profileFileName);
    put(profileFile, profile.spec);
    put(path.join(skillDir, 'references', 'profiles', `${profile.name}.openapi.json`), profile.spec);
    put(
      path.join(skillDir, 'references', 'profiles', `${profile.name}.commands.md`),
      profile.reference.replace(def.binary, binary),
    );
  }
  if (Object.keys(def.profiles ?? {}).length) {
    put(path.join(skillDir, 'references', 'profiles.md'), profileIndexText(def));
  }

  const next: string[] = [];
  const pkgFile = path.join(options.cwd, 'package.json');
  let bin: string | undefined;
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as PackageManifest;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const missing = ['openapi-cli-kit', 'tsx'].filter((d) => !deps[d]);
    if (missing.length) next.push(`npm install ${missing.join(' ')}`);
    if (!options.noPackage) {
      bin = path.relative(options.cwd, path.join(codeDir, 'bin.mjs')).split(path.sep).join('/');
      pkg.bin = { ...(typeof pkg.bin === 'object' ? pkg.bin : {}), [binary]: bin };
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      next.push(`npm link (puts ${binary} on the PATH)`);
    }
  } else next.push('npm install openapi-cli-kit tsx', `Add "bin": {"${binary}": "${path.relative(options.cwd, path.join(codeDir, 'bin.mjs'))}"} to package.json`);
  for (const r of item.requires) {
    const envBinary = r.envVar ? process.env[r.envVar] : undefined;
    if (onPath(r.command) || (envBinary && isExecutable(envBinary)) || (r.macApp && macAppInstalled(r.macApp))) continue;
    next.push(`${r.command} is not installed here: ${r.install}`);
  }
  return { item: item.name, binary, files, ...(bin ? { bin } : {}), next };
}
