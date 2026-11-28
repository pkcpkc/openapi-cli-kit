import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gimpHandlers } from '../handlers.ts';
import { hasGimp, runGimpCli, solidPng } from './support.ts';

describe('GIMP layer handlers', () => {
  it('creates nested groups and applies group masks, filters, visibility, moves, deletion and merges', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gimp-cli-groups-'));
    const base = path.join(directory, 'base.png');
    const overlay = path.join(directory, 'overlay.png');
    const project = path.join(directory, 'project.xcf');
    fs.writeFileSync(base, solidPng(32, 24, [220, 30, 30, 255]));
    fs.writeFileSync(overlay, solidPng(12, 10, [20, 40, 220, 180]));

    const command = async (argv: string[]) => {
      const result = await runGimpCli(gimpHandlers(), [...argv, '--json']);
      expect(result.code, result.err).toBe(0);
      return result.json();
    };

    try {
      await command(['image', 'assemble', '--layer', base, '--layer', overlay, '--out', project]);
      const grouped = await command(['layers', 'group-add', project, '--parent', 'Root', '--name', 'Details', '--out', path.join(directory, 'grouped.xcf')]);
      expect(grouped).toMatchObject({ width: 32, height: 24 });

      const listing = await command(['layers', 'list', path.join(directory, 'grouped.xcf')]);
      const root = (listing.layers as Array<{ path: string; children: Array<{ path: string }> }>)[0];
      const layerToMove = root.children.find((layer) => layer.path.endsWith('overlay.png'))?.path;
      expect(layerToMove).toBeTruthy();

      const movedFile = path.join(directory, 'moved.xcf');
      await command(['layers', 'move', path.join(directory, 'grouped.xcf'), layerToMove!, '--to', 'Root/Details', '--index', '0', '--out', movedFile]);
      const hiddenFile = path.join(directory, 'hidden.xcf');
      await command(['layers', 'hide', movedFile, 'Root/Details', '--out', hiddenFile]);
      const shownFile = path.join(directory, 'shown.xcf');
      await command(['layers', 'show', hiddenFile, 'Root/Details', '--out', shownFile]);

      const effectsFile = path.join(directory, 'group-effects.xcf');
      await command(['layers', 'mask-add', shownFile, 'Root/Details', '--type', 'black', '--out', effectsFile]);
      const bundleDirectory = path.join(directory, 'group-bundle');
      const bundle = await command(['layers', 'export', effectsFile, 'Root/Details', '--dir', bundleDirectory]);
      expect(bundle.masks).toHaveLength(1);
      expect(fs.statSync(path.join(bundleDirectory, 'masks', 'mask-01.png')).size).toBeGreaterThan(0);
      const manifest = JSON.parse(fs.readFileSync(path.join(bundleDirectory, 'manifest.json'), 'utf8')) as { masks: Array<{ layerPath: string; applyMask: boolean }> };
      expect(manifest.masks[0]).toMatchObject({ layerPath: 'Root/Details', applyMask: true });
      const restored = await command(['layers', 'import', effectsFile, '--bundle', bundleDirectory, '--group', 'Root', '--out', path.join(directory, 'restored-mask.xcf')]);
      const restoredTree = await command(['layers', 'list', path.join(directory, 'restored-mask.xcf')]);
      const restoredRoot = (restoredTree.layers as Array<{ children: Array<{ name: string; mask?: { applyMask: boolean } }> }>)[0];
      expect(restoredRoot.children[0]).toMatchObject({ name: 'Details #1', mask: { applyMask: true } });
      expect(restored).toMatchObject({ width: 32, height: 24 });

      const currentTree = await command(['layers', 'list', shownFile]);
      const currentChildren = (currentTree.layers as Array<{ children: Array<{ path: string; children?: Array<{ path: string }> }> }>)[0].children;
      const overlayPath = currentChildren.find((item) => item.path === 'Root/Details')?.children?.[0].path;
      expect(overlayPath).toBeTruthy();
      const maskedLayerFile = path.join(directory, 'masked-layer.xcf');
      await command(['layers', 'mask-add', shownFile, overlayPath!, '--type', 'white', '--out', maskedLayerFile]);
      const layerBundleDir = path.join(directory, 'layer-bundle');
      await command(['layers', 'export', maskedLayerFile, overlayPath!, '--dir', layerBundleDir]);
      const reimportedLayer = path.join(directory, 'reimported-layer.xcf');
      await command(['layers', 'import', maskedLayerFile, '--bundle', layerBundleDir, '--group', 'Root', '--out', reimportedLayer]);
      const reimportedTree = await command(['layers', 'list', reimportedLayer]);
      const reimportedRoot = (reimportedTree.layers as Array<{ children: Array<{ mask?: { visible: boolean } }> }>)[0];
      expect(reimportedRoot.children[0].mask).toMatchObject({ visible: true });

      await command(['image', 'effect', effectsFile, '--preset', 'grayscale', '--layer', 'Root/Details', '--out', path.join(directory, 'filtered.xcf')]);

      const currentListing = await command(['layers', 'list', shownFile]);
      const currentRoot = (currentListing.layers as Array<{ children: Array<{ path: string }> }>)[0];
      const mergedFile = path.join(directory, 'merged.xcf');
      await command(['layers', 'merge', shownFile, '--layer', currentRoot.children[0].path, '--layer', currentRoot.children[1].path, '--out', mergedFile]);
      const deletedFile = path.join(directory, 'deleted-layer.xcf');
      await command(['layers', 'delete', shownFile, currentRoot.children[1].path, '--out', deletedFile]);
      const deletedGroupFile = path.join(directory, 'deleted-group.xcf');
      await command(['layers', 'delete', shownFile, 'Root/Details', '--out', deletedGroupFile]);
      expect(fs.statSync(mergedFile).size).toBeGreaterThan(0);
      expect(fs.statSync(deletedFile).size).toBeGreaterThan(0);
      expect(fs.statSync(deletedGroupFile).size).toBeGreaterThan(0);

      const groupedLayers = path.join(directory, 'layers-grouped.xcf');
      const projectListing = await command(['layers', 'list', project]);
      const projectRoot = (projectListing.layers as Array<{ children: Array<{ path: string }> }>)[0];
      await command([
        'layers', 'group', project, '--layer', projectRoot.children[0].path, '--layer', projectRoot.children[1].path,
        '--name', 'Combined', '--out', groupedLayers,
      ]);
      const combined = await command(['layers', 'list', groupedLayers]);
      expect((combined.layers as Array<{ children: Array<{ path: string; group: boolean }> }>)[0].children[0].group).toBe(true);
      const mergedGroup = path.join(directory, 'merged-group.xcf');
      await command(['layers', 'merge', groupedLayers, '--layer', 'Root/Combined', '--out', mergedGroup]);
      expect(fs.statSync(mergedGroup).size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
