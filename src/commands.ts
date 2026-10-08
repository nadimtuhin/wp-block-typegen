import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { doctorBlock, formatReport } from "./doctor.js";
import { deprecatedStub, diffBlocks } from "./breaking.js";
import type { BlockJson } from "./validator.js";

const rel = (f: string) => path.relative(process.cwd(), f);

/** Returns false if any block grades below C (score < 70). */
export function runDoctor(files: string[], roast: boolean): boolean {
  let ok = true;
  for (const f of files) {
    let block: BlockJson;
    try {
      block = JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch (e) {
      console.error(`✖ ${rel(f)}: invalid JSON (${e instanceof Error ? e.message : e})`);
      ok = false;
      continue;
    }
    const r = doctorBlock(block);
    console.log(formatReport(block.name ?? rel(f), r, roast));
    if (r.score < 70) ok = false;
  }
  return ok;
}

/** Compares each block.json to its version at `ref`. Returns false if any breaking change. */
export function runBreaking(files: string[], ref: string): boolean {
  let ok = true;
  for (const f of files) {
    let oldRaw: string;
    try {
      oldRaw = execFileSync("git", ["-C", path.dirname(f), "show", `${ref}:./${path.basename(f)}`], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      console.log(`· ${rel(f)}: not present at ${ref} (new block, nothing to break)`);
      continue;
    }
    const oldB: BlockJson = JSON.parse(oldRaw);
    const newB: BlockJson = JSON.parse(fs.readFileSync(f, "utf-8"));
    const changes = diffBlocks(oldB, newB);
    const risky = changes.filter((c) => c.level !== "safe");
    console.log(`\n${newB.name} vs ${ref}: ${changes.length ? "" : "no attribute changes"}`);
    const icon = { breaking: "✖ BREAKING", risky: "⚠ RISKY   ", safe: "✓ safe    " } as const;
    for (const c of changes) console.log(`  ${icon[c.level]} ${c.field}: ${c.message}`);
    if (changes.some((c) => c.level === "breaking")) {
      ok = false;
      console.log(`\n  Add a deprecation so existing posts keep working:\n`);
      console.log(deprecatedStub(oldB).replace(/^/gm, "  "));
    } else if (!risky.length && changes.length) console.log("  Safe to ship.");
  }
  return ok;
}
