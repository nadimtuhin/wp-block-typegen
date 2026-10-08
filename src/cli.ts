#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBlockJson, type BlockJson } from "./validator.js";
import { generateBlockTypes } from "./generator.js";
import { generateCursorRules } from "./cursor-rules.js";
import { runDoctor, runBreaking } from "./commands.js";
import { generatePhpTypes } from "./php.js";
import { generateZod } from "./zod.js";

const VERSION = "1.1.0";

function printHelp(): void {
  console.log(`
wp-block-typegen v${VERSION}
Zero-dependency TypeScript type generator & Cursor AI context builder for WordPress block.json

USAGE:
  wp-block-typegen [options] [directory]

OPTIONS:
  -d, --dir <path>       Target directory to scan for block.json files (default: current directory)
  -o, --out <path>       Output path for a combined types file (default: colocated types.ts next to block.json)
      --cursor           Generate .cursor/rules/gutenberg-blocks.mdc for Cursor / AI assistants
      --doctor           Score each block.json (A+ to F). Exit 1 if any block scores < 70
      --roast            Same as --doctor, but honest
      --breaking <ref>   Diff block.json against a git ref; flag changes that break saved posts
      --php              Also write <block>/types.php (PHPStan array shape for render.php)
      --zod              Also write <block>/schema.ts (zod runtime validator)
      --check            Validate block.json files without writing types (CI gate)
  -w, --watch            Watch for changes to block.json files and regenerate automatically
  -v, --version          Print version and exit
  -h, --help             Show this help message

EXAMPLES:
  wp-block-typegen
  wp-block-typegen src/blocks --cursor
  wp-block-typegen --out src/types/blocks.ts --check
  wp-block-typegen --watch
`);
}

function findBlockJsonFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist" && entry.name !== "build") {
        findBlockJsonFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && entry.name === "block.json") {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

export function runCLI(args: string[] = process.argv.slice(2)): { exitCode: number } {
  let targetDir = ".";
  let combinedOut: string | null = null;
  let emitCursor = false;
  let checkOnly = false;
  let watchMode = false;
  let doctor = false;
  let roast = false;
  let breakingRef: string | null = null;
  let emitPhp = false;
  let emitZod = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      return { exitCode: 0 };
    }
    if (arg === "-v" || arg === "--version") {
      console.log(`wp-block-typegen v${VERSION}`);
      return { exitCode: 0 };
    }
    if (arg === "-d" || arg === "--dir") {
      targetDir = args[++i] || ".";
    } else if (arg === "-o" || arg === "--out") {
      combinedOut = args[++i] || null;
    } else if (arg === "--cursor") {
      emitCursor = true;
    } else if (arg === "--doctor") {
      doctor = true;
    } else if (arg === "--roast") {
      doctor = true;
      roast = true;
    } else if (arg === "--breaking") {
      breakingRef = args[++i] || "HEAD";
    } else if (arg === "--php") {
      emitPhp = true;
    } else if (arg === "--zod") {
      emitZod = true;
    } else if (arg === "--check") {
      checkOnly = true;
    } else if (arg === "-w" || arg === "--watch") {
      watchMode = true;
    } else if (!arg.startsWith("-")) {
      targetDir = arg;
    }
  }

  const absoluteTarget = path.resolve(process.cwd(), targetDir);
  console.log(`[wp-block-typegen] Scanning for block.json in: ${absoluteTarget}`);

  function executeRun(): boolean {
    const files = findBlockJsonFiles(absoluteTarget);

    if (files.length === 0) {
      console.warn(`[wp-block-typegen] No block.json files found in ${absoluteTarget}`);
      return true;
    }

    console.log(`[wp-block-typegen] Found ${files.length} block(s)`);

    const validBlocks: BlockJson[] = [];
    const generatedOutputs: { filePath: string; types: string; block: BlockJson }[] = [];
    let hasErrors = false;

    for (const file of files) {
      try {
        const rawContent = fs.readFileSync(file, "utf-8");
        const parsed = JSON.parse(rawContent);
        const { valid, block, issues } = validateBlockJson(parsed);

        const relativePath = path.relative(process.cwd(), file);

        for (const issue of issues) {
          if (issue.severity === "error") {
            console.error(`  ✖ [ERROR] ${relativePath} (${issue.field}): ${issue.message}`);
            hasErrors = true;
          } else {
            console.warn(`  ⚠ [WARN]  ${relativePath} (${issue.field}): ${issue.message}`);
          }
        }

        if (valid && block) {
          validBlocks.push(block);
          const types = generateBlockTypes(block);
          generatedOutputs.push({ filePath: file, types, block });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✖ [ERROR] Failed to parse ${file}: ${msg}`);
        hasErrors = true;
      }
    }

    if (checkOnly) {
      if (hasErrors) {
        console.error(`[wp-block-typegen] Check failed: errors detected.`);
        return false;
      }
      console.log(`[wp-block-typegen] Check passed: all ${files.length} blocks valid.`);
      return true;
    }

    if (combinedOut) {
      const combinedPath = path.resolve(process.cwd(), combinedOut);
      fs.mkdirSync(path.dirname(combinedPath), { recursive: true });
      const combinedCode = [
        "// Auto-generated combined block types",
        "// Generated by wp-block-typegen",
        "",
        ...generatedOutputs.map((g) => g.types),
      ].join("\n\n");

      fs.writeFileSync(combinedPath, combinedCode, "utf-8");
      console.log(`  ✓ Wrote combined types to: ${path.relative(process.cwd(), combinedPath)}`);
    } else {
      for (const item of generatedOutputs) {
        const dir = path.dirname(item.filePath);
        const outPath = path.join(dir, "types.ts");
        fs.writeFileSync(outPath, item.types, "utf-8");
        console.log(`  ✓ Wrote types to: ${path.relative(process.cwd(), outPath)}`);
        if (emitPhp) fs.writeFileSync(path.join(dir, "types.php"), generatePhpTypes(item.block), "utf-8");
        if (emitZod) fs.writeFileSync(path.join(dir, "schema.ts"), generateZod(item.block), "utf-8");
      }
    }

    if (emitCursor && validBlocks.length > 0) {
      const rulesDir = path.resolve(process.cwd(), ".cursor/rules");
      fs.mkdirSync(rulesDir, { recursive: true });
      const rulesPath = path.join(rulesDir, "gutenberg-blocks.mdc");
      const rulesContent = generateCursorRules(validBlocks);
      fs.writeFileSync(rulesPath, rulesContent, "utf-8");
      console.log(`  ✓ Wrote AI rules context to: ${path.relative(process.cwd(), rulesPath)}`);
    }

    console.log(`[wp-block-typegen] Done. Processed ${generatedOutputs.length} block(s).`);
    return !hasErrors;
  }

  if (doctor || breakingRef) {
    const files = findBlockJsonFiles(absoluteTarget);
    let ok = true;
    if (doctor) ok = runDoctor(files, roast) && ok;
    if (breakingRef) ok = runBreaking(files, breakingRef) && ok;
    return { exitCode: ok ? 0 : 1 };
  }

  const initialSuccess = executeRun();

  if (watchMode) {
    console.log(`[wp-block-typegen] Watching for file changes... (Press Ctrl+C to exit)`);
    fs.watch(absoluteTarget, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith("block.json")) {
        console.log(`\n[wp-block-typegen] Detected change in: ${filename}. Regenerating...`);
        executeRun();
      }
    });
    return { exitCode: 0 };
  }

  return { exitCode: initialSuccess ? 0 : 1 };
}

// Direct invocation check
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = runCLI();
  if (!process.argv.includes("-w") && !process.argv.includes("--watch")) {
    process.exit(result.exitCode);
  }
}
