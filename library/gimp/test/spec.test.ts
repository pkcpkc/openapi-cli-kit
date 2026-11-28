import { describe, it, expect } from 'vitest';
import { buildSpec, commands, lintSpec } from '../../../src/index.ts';
import { cli } from '../spec.ts';

describe('gimp-cli schema profiles', () => {
  it('provides smaller, lint-clean OpenAPI profiles for each command group', () => {
    const full = buildSpec(cli);
    const allOperationIds = new Set(cli.ops.map((op) => op.id));
    const profiledOperationIds = new Set<string>();

    for (const [name, profile] of Object.entries(cli.profiles ?? {})) {
      const focused = buildSpec(cli, name);
      const ids = commands(focused).map((command) => command.op.operationId);
      expect(ids).toEqual(profile.operationIds);
      expect(lintSpec(focused)).toEqual([]);
      expect(JSON.stringify(focused).length).toBeLessThan(JSON.stringify(full).length);
      ids.forEach((id) => profiledOperationIds.add(id));
    }

    expect(profiledOperationIds).toEqual(allOperationIds);
    expect(commands(buildSpec(cli, 'script')).map((command) => command.op.operationId)).toEqual(['script-run']);
    expect(commands(buildSpec(cli, 'image')).map((command) => command.op.operationId)).toContain('image-effect');
    expect(commands(buildSpec(cli, 'layers')).map((command) => command.op.operationId)).not.toContain('image-effect');
  });
});
