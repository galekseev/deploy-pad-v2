#!/usr/bin/env node
// The published entry point. Plain JavaScript by necessity: Node refuses to
// strip types from a file inside node_modules (stack.md §1). Everything with
// behaviour worth testing lives in src/main.ts.
import '../dist/main.js';
