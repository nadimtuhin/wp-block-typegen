import { describe, expect, it } from "bun:test";
import { doctorBlock, formatReport } from "../src/doctor.js";
import { deprecatedStub, diffBlocks } from "../src/breaking.js";
import { generatePhpTypes } from "../src/php.js";
import { generateZod } from "../src/zod.js";
import type { BlockJson } from "../src/validator.js";

const clean: BlockJson = {
  $schema: "https://schemas.wp.org/trunk/block.json",
  apiVersion: 3,
  name: "a/b",
  description: "d",
  textdomain: "a",
  supports: { html: false },
  attributes: { title: { type: "string", default: "x" } },
};

describe("doctor", () => {
  it("gives a clean block A+", () => {
    const r = doctorBlock(clean);
    expect(r.score).toBe(100);
    expect(r.grade).toBe("A+");
  });
  it("catches type/enum/selector/case errors", () => {
    const r = doctorBlock({
      name: "a/b",
      attributes: {
        Bad_Name: { type: "string" },
        n: { type: "number", default: "3" },
        v: { type: "string", enum: ["a"], default: "z" },
        h: { type: "string", source: "html" },
      },
    });
    const ids = r.findings.map((f) => f.id);
    for (const id of ["attr-case", "default-type", "default-enum", "source-selector"])
      expect(ids).toContain(id);
    expect(r.grade).toBe("F");
  });
  it("accepts integer defaults for integer type and null for nullable", () => {
    const r = doctorBlock({
      ...clean,
      attributes: {
        a: { type: "integer", default: 2 },
        b: { type: ["string", "null"], default: null },
      },
    });
    expect(r.findings.some((f) => f.id === "default-type")).toBe(false);
  });
  it("roast mode changes wording", () => {
    const r = doctorBlock({ name: "a/b", attributes: {} });
    expect(formatReport("x", r, true)).not.toBe(formatReport("x", r, false));
  });
});

describe("breaking", () => {
  const old: BlockJson = {
    name: "a/b",
    attributes: {
      keep: { type: "string", default: "x" },
      gone: { type: "string" },
      kind: { type: "string", enum: ["a", "b"] },
      html: { type: "string", source: "html", selector: "p" },
    },
  };
  it("flags removals, type, enum, source and default changes", () => {
    const now: BlockJson = {
      name: "a/b",
      attributes: {
        keep: { type: "number", default: "y" },
        kind: { type: "string", enum: ["a"] },
        html: { type: "string", source: "html", selector: "h2" },
        fresh: { type: "string" },
      },
    };
    const c = diffBlocks(old, now);
    const has = (lvl: string, f: string) => c.some((x) => x.level === lvl && x.field === f);
    expect(has("breaking", "attributes.gone")).toBe(true);
    expect(has("breaking", "attributes.keep")).toBe(true);
    expect(has("breaking", "attributes.kind")).toBe(true);
    expect(has("breaking", "attributes.html")).toBe(true);
    expect(has("risky", "attributes.keep")).toBe(true);
    expect(has("safe", "attributes.fresh")).toBe(true);
  });
  it("adding an attribute is safe, rename is breaking, stub contains old attrs", () => {
    expect(diffBlocks(old, { ...old, attributes: { ...old.attributes, n: { type: "string" } } }).every((c) => c.level === "safe")).toBe(true);
    expect(diffBlocks(old, { ...old, name: "a/c" }).some((c) => c.level === "breaking")).toBe(true);
    expect(deprecatedStub(old)).toContain('"gone"');
  });
});

describe("php + zod", () => {
  const b: BlockJson = {
    name: "tenup/card",
    attributes: {
      title: { type: "string", default: "" },
      layout: { type: "string", enum: ["row", "col"], default: "row" },
      tags: { type: "array", items: { type: "string" } },
      media: { type: "object", properties: { id: { type: "integer" }, "data-x": { type: "string", default: "" } } },
      when: { type: ["string", "null"], default: null },
    },
  };
  it("emits PHPStan shape with optional keys", () => {
    const p = generatePhpTypes(b);
    expect(p).toContain("@phpstan-type CardAttributes array{title: string, layout: 'row'|'col', tags?: array<string>");
    expect(p).toContain("media?: array{id?: int, 'data-x': string}");
    expect(p).toContain("when: string|null");
  });
  it("emits zod schema with defaults/optional", () => {
    const z = generateZod(b);
    expect(z).toContain('import { z } from "zod";');
    expect(z).toContain('title: z.string().default("")');
    expect(z).toContain('layout: z.enum(["row","col"]).default("row")');
    expect(z).toContain("tags: z.array(z.string()).optional()");
    expect(z).toContain('"data-x": z.string().default("")');
    expect(z).toContain("when: z.union([z.string(), z.null()]).default(null)");
  });
});
