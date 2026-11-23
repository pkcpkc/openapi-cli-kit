#!/usr/bin/env node
// ocli: the kit's own command, described by specs/ocli.openapi.json
const { main } = await import('../dist/src/tool/main.js');
await main();
