#!/usr/bin/env node

import { runCLI } from "../dist/cli.js";

const result = runCLI();
if (!process.argv.includes("-w") && !process.argv.includes("--watch")) {
  process.exit(result.exitCode);
}
