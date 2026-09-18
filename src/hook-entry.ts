#!/usr/bin/env node
// Dedicated executable for the PreToolUse hook (`dist/hook.js`).
//
// Kept separate from `cli.ts` so the hot path never loads the CLI's argument
// parser, renderers or indexer graph — see `hook-client.ts` for why that
// matters. `sens hook` still works; this is the same thing without the bundle.

import { runHookClient } from "./hook-client.js";

void runHookClient();
