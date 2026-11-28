import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const helperFile = new URL('../python/helpers.py', import.meta.url);
const hasPython = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('GIMP Python helpers', () => {
  it.skipIf(!hasPython)('compiles with the local Python interpreter', () => {
    execFileSync('python3', [
      '-c',
      'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")',
      helperFile.pathname,
    ], { stdio: 'pipe' });
  });
});
