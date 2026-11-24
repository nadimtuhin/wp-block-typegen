import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateBlockTypes } from "../src/generator.js";
import { validateBlockJson, type BlockJson } from "../src/validator.js";
import { doctorBlock } from "../src/doctor.js";
import { runBreaking, runDoctor } from "../src/commands.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "wbt-"));
const quiet = <T>(fn: () => T): T => {
  const { log, error, warn } = console;
  console.log = console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { log, error, warn });
  }
};

describe("array types without an explicit type", () => {
  it("parenthesizes union item types (items only)", () => {
    const t = generateBlockTypes({
      name: "a/b",
      attributes: { sizes: { items: { enum: ["s", "m"] } } },
    } as BlockJson);
    // `"s" | "m"[]` would mean `"s" | ("m"[])`
    expect(t).toContain('sizes?: Array<"s" | "m">;');
  });
  it("wraps object rows of a type-less query source", () => {
    const t = generateBlockTypes({
      name: "a/b",
      attributes: {
        links: { source: "query", selector: "a", query: { href: { type: "string", source: "attribute", attribute: "href" } } },
      },
    } as BlockJson);
    expect(t).toContain("links?: Array<{");
    expect(t).not.toMatch(/}\[\];/);
  });
});

describe("doctor on malformed input", () => {
  it("does not crash on a null attribute definition", () => {
    const r = doctorBlock({ name: "a/b", attributes: { x: null } } as unknown as BlockJson);
    expect(r.findings.some((f) => f.field === "attributes.x" && f.level === "error")).toBe(true);
  });
  it("runDoctor reports a block.json that is not an object instead of throwing", () => {
    const dir = tmp();
    const f = path.join(dir, "block.json");
    fs.writeFileSync(f, "null");
    expect(quiet(() => runDoctor([f], false))).toBe(false);
    fs.writeFileSync(f, "[]");
    expect(quiet(() => runDoctor([f], false))).toBe(false);
  });
});

describe("validator: block-level field shapes", () => {
  it("rejects attributes that are not an object", () => {
    for (const attributes of ["title", ["title"], 3]) {
      const r = validateBlockJson({ name: "a/b", apiVersion: 3, attributes });
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.field === "attributes" && i.severity === "error")).toBe(true);
    }
  });
  it("rejects usesContext that is not an array of strings", () => {
    for (const usesContext of ["postId", [1], { postId: true }]) {
      const r = validateBlockJson({ name: "a/b", apiVersion: 3, usesContext });
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.field === "usesContext")).toBe(true);
    }
  });
});

describe("--breaking on malformed JSON", () => {
  const git = (cwd: string, ...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "ignore" });
  it("reports instead of throwing when the working copy is not valid JSON", () => {
    const dir = tmp();
    const f = path.join(dir, "block.json");
    git(dir, "init", "-q");
    fs.writeFileSync(f, JSON.stringify({ name: "a/b", attributes: { t: { type: "string" } } }));
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "init");
    fs.writeFileSync(f, "{ not json");
    expect(quiet(() => runBreaking([f], "HEAD"))).toBe(false);
  });
  it("reports instead of throwing when the old version is not valid JSON", () => {
    const dir = tmp();
    const f = path.join(dir, "block.json");
    git(dir, "init", "-q");
    fs.writeFileSync(f, "{ broken");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "init");
    fs.writeFileSync(f, JSON.stringify({ name: "a/b" }));
    expect(quiet(() => runBreaking([f], "HEAD"))).toBe(false);
  });
});
