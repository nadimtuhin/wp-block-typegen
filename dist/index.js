// src/validator.ts
var VALID_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
  "null"
]);
function validateBlockJson(data) {
  const issues = [];
  if (!data || typeof data !== "object") {
    return {
      valid: false,
      issues: [{ field: "root", message: "block.json must be a valid JSON object", severity: "error" }]
    };
  }
  const raw = data;
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    issues.push({
      field: "name",
      message: 'Missing or empty "name" property',
      severity: "error"
    });
  } else if (!raw.name.includes("/")) {
    issues.push({
      field: "name",
      message: `Block name "${raw.name}" must include a namespace prefix (e.g. "namespace/block-name")`,
      severity: "error"
    });
  }
  if (typeof raw.apiVersion !== "number") {
    issues.push({
      field: "apiVersion",
      message: 'Missing "apiVersion". Modern WordPress blocks should declare apiVersion: 3',
      severity: "warning"
    });
  } else if (raw.apiVersion < 2) {
    issues.push({
      field: "apiVersion",
      message: `apiVersion ${raw.apiVersion} is legacy. Consider upgrading to apiVersion: 3`,
      severity: "warning"
    });
  }
  if (raw.attributes && typeof raw.attributes === "object") {
    const attrs = raw.attributes;
    for (const [attrName, attrValue] of Object.entries(attrs)) {
      if (!attrValue || typeof attrValue !== "object") {
        issues.push({
          field: `attributes.${attrName}`,
          message: `Attribute "${attrName}" must be an object definition`,
          severity: "error"
        });
        continue;
      }
      const attr = attrValue;
      if (attr.type) {
        const typesToCheck = Array.isArray(attr.type) ? attr.type : [attr.type];
        for (const t of typesToCheck) {
          if (!VALID_TYPES.has(t)) {
            issues.push({
              field: `attributes.${attrName}.type`,
              message: `Invalid attribute type "${t}". Must be one of: ${Array.from(VALID_TYPES).join(", ")}`,
              severity: "error"
            });
          }
        }
      }
      if ((attrName.toLowerCase().includes("image") || attrName.toLowerCase().includes("media")) && attr.type === "object" && attr.properties && !("alt" in attr.properties)) {
        issues.push({
          field: `attributes.${attrName}.properties`,
          message: `Accessibility (WCAG 2.1): Media object "${attrName}" is missing an "alt" text property`,
          severity: "warning"
        });
      }
    }
  }
  const hasErrors = issues.some((i) => i.severity === "error");
  return {
    valid: !hasErrors,
    block: raw,
    issues
  };
}
// src/generator.ts
function toPascalCase(str) {
  return str.replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase()).replace(/^[a-z]/, (chr) => chr.toUpperCase());
}
function getBlockTypeName(blockName, prefixNamespace = false) {
  const parts = blockName.split("/");
  if (parts.length === 2) {
    const [namespace, name] = parts;
    return prefixNamespace ? `${toPascalCase(namespace)}${toPascalCase(name)}` : toPascalCase(name);
  }
  return toPascalCase(blockName);
}
function resolveType(schema, indent = 2) {
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum.map((val) => typeof val === "string" ? JSON.stringify(val) : String(val)).join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((t) => resolvePrimitiveType(t, schema, indent)).join(" | ");
  }
  if (typeof schema.type === "string") {
    return resolvePrimitiveType(schema.type, schema, indent);
  }
  if (schema.properties) {
    return resolveObjectType(schema.properties, indent);
  }
  if (schema.items) {
    return `${resolveType(schema.items, indent)}[]`;
  }
  return "unknown";
}
function resolvePrimitiveType(type, schema, indent) {
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      if (schema.items) {
        const itemType = resolveType(schema.items, indent);
        return itemType.includes("|") || itemType.includes("{") ? `Array<${itemType}>` : `${itemType}[]`;
      }
      return "unknown[]";
    case "object":
      if (schema.properties) {
        return resolveObjectType(schema.properties, indent);
      }
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}
function resolveObjectType(properties, indent) {
  const pad = " ".repeat(indent);
  const innerPad = " ".repeat(indent + 2);
  const lines = ["{"];
  for (const [key, propSchema] of Object.entries(properties)) {
    const isOptional = propSchema.default === undefined;
    const propType = resolveType(propSchema, indent + 2);
    lines.push(`${innerPad}${key}${isOptional ? "?" : ""}: ${propType};`);
  }
  lines.push(`${pad}}`);
  return lines.join(`
`);
}
function generateBlockTypes(block, options = {}) {
  const {
    includeReactProps = true,
    prefixNamespace = false
  } = options;
  const typeBase = getBlockTypeName(block.name, prefixNamespace);
  const attrInterfaceName = `${typeBase}Attributes`;
  const setAttrsTypeName = `${typeBase}SetAttributes`;
  const editPropsName = `${typeBase}EditProps`;
  const savePropsName = `${typeBase}SaveProps`;
  const output = [];
  output.push("/**");
  output.push(` * Auto-generated by wp-block-typegen`);
  output.push(` * Block: ${block.name}`);
  if (block.title)
    output.push(` * Title: ${block.title}`);
  if (block.description)
    output.push(` * Description: ${block.description}`);
  output.push(" */");
  output.push("");
  output.push(`export interface ${attrInterfaceName} {`);
  const attrs = block.attributes || {};
  const entries = Object.entries(attrs);
  if (entries.length === 0) {
    output.push("  [key: string]: unknown;");
  } else {
    for (const [key, schema] of entries) {
      const hasDefault = schema.default !== undefined;
      const isOptional = !hasDefault;
      const tsType = resolveType(schema, 2);
      if (schema.default !== undefined) {
        output.push(`  /** @default ${JSON.stringify(schema.default)} */`);
      }
      output.push(`  ${key}${isOptional ? "?" : ""}: ${tsType};`);
    }
  }
  output.push("}");
  output.push("");
  output.push(`export type ${setAttrsTypeName} = (attributes: Partial<${attrInterfaceName}>) => void;`);
  output.push("");
  if (includeReactProps) {
    output.push(`export interface ${editPropsName} {`);
    output.push(`  attributes: ${attrInterfaceName};`);
    output.push(`  setAttributes: ${setAttrsTypeName};`);
    output.push(`  isSelected?: boolean;`);
    output.push(`  clientId?: string;`);
    if (block.usesContext && block.usesContext.length > 0) {
      output.push(`  context: {`);
      for (const ctx of block.usesContext) {
        output.push(`    ${ctx}?: unknown;`);
      }
      output.push(`  };`);
    } else {
      output.push(`  context?: Record<string, unknown>;`);
    }
    output.push("}");
    output.push("");
    output.push(`export interface ${savePropsName} {`);
    output.push(`  attributes: ${attrInterfaceName};`);
    output.push("}");
    output.push("");
  }
  return output.join(`
`);
}
// src/cursor-rules.ts
function generateCursorRules(blocks) {
  const lines = [];
  lines.push("# WordPress Gutenberg Block Development Rules");
  lines.push("");
  lines.push("These rules are auto-generated by wp-block-typegen to keep AI assistants (Cursor, GitHub Copilot, Claude Code) aligned with project block definitions and WordPress standards.");
  lines.push("");
  lines.push("## Registered Blocks in this Project");
  lines.push("");
  for (const block of blocks) {
    lines.push(`### Block: \`${block.name}\``);
    if (block.title)
      lines.push(`- **Title:** ${block.title}`);
    if (block.description)
      lines.push(`- **Description:** ${block.description}`);
    if (block.apiVersion)
      lines.push(`- **API Version:** ${block.apiVersion}`);
    if (block.attributes && Object.keys(block.attributes).length > 0) {
      lines.push("- **Attributes Schema:**");
      for (const [key, attr] of Object.entries(block.attributes)) {
        const typeStr = Array.isArray(attr.type) ? attr.type.join(" | ") : attr.type || "unknown";
        const enumStr = attr.enum ? ` (enum: ${attr.enum.map((e) => JSON.stringify(e)).join(", ")})` : "";
        const defaultStr = attr.default !== undefined ? ` [default: ${JSON.stringify(attr.default)}]` : "";
        lines.push(`  - \`${key}\`: \`${typeStr}\`${enumStr}${defaultStr}`);
      }
    } else {
      lines.push("- **Attributes:** None declared");
    }
    if (block.usesContext && block.usesContext.length > 0) {
      lines.push(`- **Uses Context:** ${block.usesContext.map((c) => `\`${c}\``).join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## Coding Standards for Gutenberg Blocks");
  lines.push("");
  lines.push("1. **Type Safety:** Always import and use the generated types (`*Attributes`, `*EditProps`) from the generated block types file. Never use `any`.");
  lines.push("2. **Block Wrapper:** In `edit.tsx`, always wrap root output with `const blockProps = useBlockProps(); return <div {...blockProps}>...</div>;`");
  lines.push("3. **State Mutation:** Never mutate `attributes` directly. Always call `setAttributes({ key: newValue })` with a partial update.");
  lines.push("4. **Save Component:** In `save.tsx`, use `useBlockProps.save()`. Do not call hooks (`useState`, `useEffect`) inside `save()`.");
  lines.push("5. **Accessibility (WCAG 2.1):**");
  lines.push("   - All `<img>` or `<MediaUpload>` elements must provide meaningful `alt` text.");
  lines.push("   - Never create empty buttons or icon-only buttons without an `aria-label`.");
  lines.push("   - Ensure all interactive elements in `edit.tsx` are keyboard navigable.");
  lines.push("6. **Zero Deprecations:** Keep `block.json` attributes synchronized with generated types before writing new migrations.");
  lines.push("");
  return lines.join(`
`);
}
// src/cli.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/commands.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// src/doctor.ts
var PENALTY = { error: 15, warn: 5, info: 1 };
var GRADES = [
  [97, "A+", "Ship it. Frame it."],
  [90, "A", "Clean. Your future self says thanks."],
  [80, "B", "Solid. A few loose threads."],
  [70, "C", "Works on your machine."],
  [50, "D", "Held together by hope."],
  [0, "F", "Call the block police."]
];
var typeOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
function defaultMatches(s) {
  if (s.default === undefined || !s.type)
    return true;
  const actual = typeOf(s.default);
  const types = Array.isArray(s.type) ? s.type : [s.type];
  return types.some((t) => t === "integer" ? Number.isInteger(s.default) : t === actual);
}
function doctorBlock(b) {
  const f = [];
  const add = (id, level, field, message, roast) => f.push({ id, level, field, message, roast });
  if (!b.$schema)
    add("no-schema", "warn", "$schema", "Missing $schema (no editor autocomplete).", "No $schema. Your editor is flying blind and so are you.");
  if (typeof b.apiVersion !== "number" || b.apiVersion < 3)
    add("api-version", "warn", "apiVersion", "Use apiVersion 3 (iframed editor, WP 6.3+).", "apiVersion < 3. This block called, it wants its 2019 back.");
  if (!b.description)
    add("no-description", "info", "description", "Add a description for the inserter.", "No description. Mystery blocks are only fun in escape rooms.");
  if (!b.textdomain)
    add("no-textdomain", "warn", "textdomain", "Missing textdomain: title/description are untranslatable.", "No textdomain. Translators have filed a missing-person report.");
  if (b.supports && b.supports.html !== false)
    add("html-editing", "info", "supports.html", "Set supports.html=false so users cannot hand-edit markup into an invalid block.", "Raw HTML editing is on. Someone WILL paste a <marquee>.");
  const attrs = Object.entries(b.attributes ?? {});
  if (attrs.length > 15)
    add("god-block", "warn", "attributes", `${attrs.length} attributes. Split into inner blocks.`, `${attrs.length} attributes. This isn't a block, it's a lifestyle.`);
  for (const [k, s] of attrs) {
    const at = `attributes.${k}`;
    if (!/^[a-z][a-zA-Z0-9]*$/.test(k))
      add("attr-case", "warn", at, `"${k}" should be camelCase.`, `"${k}"? Pick a case and commit to it.`);
    if (s.default === undefined && s.source === undefined)
      add("no-default", "info", at, `"${k}" has no default; it is optional everywhere.`, `"${k}" has no default. undefined is not a personality.`);
    if (!defaultMatches(s))
      add("default-type", "error", at, `Default ${JSON.stringify(s.default)} does not match type ${JSON.stringify(s.type)}.`, `"${k}" says ${JSON.stringify(s.type)} but defaults to ${JSON.stringify(s.default)}. Bold.`);
    if (s.enum && s.default !== undefined && !s.enum.includes(s.default))
      add("default-enum", "error", at, `Default ${JSON.stringify(s.default)} is not in enum.`, `Default isn't in its own enum. Not even the block trusts the block.`);
    if (s.source === "html" && !s.selector)
      add("source-selector", "error", at, 'source "html" needs a selector.', `source:"html" with no selector. Where, exactly?`);
  }
  const score = Math.max(0, 100 - f.reduce((n, x) => n + PENALTY[x.level], 0));
  const [, grade, quip] = GRADES.find(([min]) => score >= min);
  return { findings: f, score, grade, quip };
}
function formatReport(name, r, roast = false) {
  const filled = Math.round(r.score / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const icon = { error: "✖", warn: "⚠", info: "·" };
  const lines = [
    `┌─ ${name}`,
    `│  ${bar}  ${r.score}/100  grade ${r.grade}`,
    `│  ${r.quip}`
  ];
  for (const x of r.findings)
    lines.push(`│  ${icon[x.level]} ${x.field}: ${roast ? x.roast : x.message}`);
  lines.push("└─");
  return lines.join(`
`);
}

// src/breaking.ts
var j = (v) => JSON.stringify(v);
var normType = (t) => j(Array.isArray(t) ? [...t].sort() : t);
function diffBlocks(o, n) {
  const out = [];
  const add = (level, field, message) => out.push({ level, field, message });
  if (o.name !== n.name)
    add("breaking", "name", `Renamed ${o.name} -> ${n.name}. Every saved post loses this block.`);
  const oa = o.attributes ?? {};
  const na = n.attributes ?? {};
  for (const [k, os] of Object.entries(oa)) {
    const ns = na[k];
    const at = `attributes.${k}`;
    if (!ns) {
      add("breaking", at, `Removed. Saved values are dropped from existing posts.`);
      continue;
    }
    if (normType(os.type) !== normType(ns.type))
      add("breaking", at, `Type ${normType(os.type)} -> ${normType(ns.type)}. Old content fails validation.`);
    for (const key of ["source", "selector", "attribute"])
      if (os[key] !== ns[key])
        add("breaking", at, `${key} ${j(os[key])} -> ${j(ns[key])}. Serialization changed; block validation will fail.`);
    const gone = (os.enum ?? []).filter((v) => !(ns.enum ?? []).includes(v));
    if (os.enum && ns.enum && gone.length)
      add("breaking", at, `Enum values removed: ${j(gone)}. Posts using them become invalid.`);
    else if (os.enum && !ns.enum)
      add("safe", at, "Enum constraint lifted.");
    else if (!os.enum && ns.enum)
      add("risky", at, `New enum ${j(ns.enum)}. Existing free-form values may no longer match.`);
    if (j(os.default) !== j(ns.default))
      add("risky", at, `Default ${j(os.default)} -> ${j(ns.default)}. Defaults are not serialized: posts that omit it will render differently.`);
  }
  for (const k of Object.keys(na))
    if (!(k in oa))
      add("safe", `attributes.${k}`, "Added.");
  return out;
}
function deprecatedStub(old) {
  return [
    "// Paste into registerBlockType(..., { deprecated: [ ... ] })",
    "{",
    `  attributes: ${JSON.stringify(old.attributes ?? {}, null, 2).replace(/\n/g, `
  `)},`,
    "  save: /* paste the PREVIOUS save() here */,",
    "  migrate: (attributes) => attributes,",
    "}"
  ].join(`
`);
}

// src/commands.ts
var rel = (f) => path.relative(process.cwd(), f);
function runDoctor(files, roast) {
  let ok = true;
  for (const f of files) {
    let block;
    try {
      block = JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch (e) {
      console.error(`✖ ${rel(f)}: invalid JSON (${e instanceof Error ? e.message : e})`);
      ok = false;
      continue;
    }
    const r = doctorBlock(block);
    console.log(formatReport(block.name ?? rel(f), r, roast));
    if (r.score < 70)
      ok = false;
  }
  return ok;
}
function runBreaking(files, ref) {
  let ok = true;
  for (const f of files) {
    let oldRaw;
    try {
      oldRaw = execFileSync("git", ["-C", path.dirname(f), "show", `${ref}:./${path.basename(f)}`], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      console.log(`· ${rel(f)}: not present at ${ref} (new block, nothing to break)`);
      continue;
    }
    const oldB = JSON.parse(oldRaw);
    const newB = JSON.parse(fs.readFileSync(f, "utf-8"));
    const changes = diffBlocks(oldB, newB);
    const risky = changes.filter((c) => c.level !== "safe");
    console.log(`
${newB.name} vs ${ref}: ${changes.length ? "" : "no attribute changes"}`);
    const icon = { breaking: "✖ BREAKING", risky: "⚠ RISKY   ", safe: "✓ safe    " };
    for (const c of changes)
      console.log(`  ${icon[c.level]} ${c.field}: ${c.message}`);
    if (changes.some((c) => c.level === "breaking")) {
      ok = false;
      console.log(`
  Add a deprecation so existing posts keep working:
`);
      console.log(deprecatedStub(oldB).replace(/^/gm, "  "));
    } else if (!risky.length && changes.length)
      console.log("  Safe to ship.");
  }
  return ok;
}

// src/php.ts
var key = (k) => /^[A-Za-z_]\w*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`;
var lit = (v) => typeof v === "string" ? `'${v.replace(/'/g, "\\'")}'` : String(v);
function php(s) {
  if (s.enum?.length)
    return s.enum.map(lit).join("|");
  const ts = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (!ts.length)
    return "mixed";
  return ts.map((t) => prim(t, s)).join("|");
}
function prim(t, s) {
  switch (t) {
    case "string":
      return "string";
    case "number":
      return "int|float";
    case "integer":
      return "int";
    case "boolean":
      return "bool";
    case "null":
      return "null";
    case "array":
      return `array<${s.items ? php(s.items) : "mixed"}>`;
    case "object":
      return s.properties ? shape(s.properties) : "array<string, mixed>";
    default:
      return "mixed";
  }
}
function shape(props) {
  const parts = Object.entries(props).map(([k, p]) => `${key(k)}${p.default === undefined ? "?" : ""}: ${php(p)}`);
  return `array{${parts.join(", ")}}`;
}
function generatePhpTypes(block) {
  const base = getBlockTypeName(block.name);
  return `<?php
/**
 * Auto-generated by wp-block-typegen. Block: ${block.name}
 *
 * In render.php:
 *   @phpstan-import-type ${base}Attributes from ${base}BlockTypes
 *   @var ${base}Attributes $attributes
 *
 * @phpstan-type ${base}Attributes ${shape(block.attributes ?? {})}
 */
final class ${base}BlockTypes {}
`;
}

// src/zod.ts
var key2 = (k) => /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
function zt(s) {
  if (s.enum?.length) {
    if (s.enum.every((v) => typeof v === "string"))
      return `z.enum(${JSON.stringify(s.enum)})`;
    const l = s.enum.map((v) => `z.literal(${JSON.stringify(v)})`);
    return l.length === 1 ? l[0] : `z.union([${l.join(", ")}])`;
  }
  const ts = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const parts = ts.map((t) => prim2(t, s));
  if (!parts.length)
    return "z.unknown()";
  return parts.length === 1 ? parts[0] : `z.union([${parts.join(", ")}])`;
}
function prim2(t, s) {
  switch (t) {
    case "string":
      return "z.string()";
    case "number":
      return "z.number()";
    case "integer":
      return "z.number().int()";
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array":
      return `z.array(${s.items ? zt(s.items) : "z.unknown()"})`;
    case "object":
      return s.properties ? obj(s.properties) : "z.record(z.string(), z.unknown())";
    default:
      return "z.unknown()";
  }
}
function obj(props) {
  const rows = Object.entries(props).map(([k, p]) => `${key2(k)}: ${zt(p)}${p.default !== undefined ? `.default(${JSON.stringify(p.default)})` : ".optional()"}`);
  return `z.object({ ${rows.join(", ")} })`;
}
function generateZod(block) {
  const base = getBlockTypeName(block.name);
  return `// Auto-generated by wp-block-typegen. Block: ${block.name}
import { z } from "zod";

export const ${base}AttributesSchema = ${obj(block.attributes ?? {})};

export type ${base}AttributesParsed = z.infer<typeof ${base}AttributesSchema>;
`;
}

// src/cli.ts
var VERSION = "1.1.0";
function printHelp() {
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
function findBlockJsonFiles(dir, fileList = []) {
  if (!fs2.existsSync(dir))
    return fileList;
  const entries = fs2.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path2.join(dir, entry.name);
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
function runCLI(args = process.argv.slice(2)) {
  let targetDir = ".";
  let combinedOut = null;
  let emitCursor = false;
  let checkOnly = false;
  let watchMode = false;
  let doctor = false;
  let roast = false;
  let breakingRef = null;
  let emitPhp = false;
  let emitZod = false;
  for (let i = 0;i < args.length; i++) {
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
  const absoluteTarget = path2.resolve(process.cwd(), targetDir);
  console.log(`[wp-block-typegen] Scanning for block.json in: ${absoluteTarget}`);
  function executeRun() {
    const files = findBlockJsonFiles(absoluteTarget);
    if (files.length === 0) {
      console.warn(`[wp-block-typegen] No block.json files found in ${absoluteTarget}`);
      return true;
    }
    console.log(`[wp-block-typegen] Found ${files.length} block(s)`);
    const validBlocks = [];
    const generatedOutputs = [];
    let hasErrors = false;
    for (const file of files) {
      try {
        const rawContent = fs2.readFileSync(file, "utf-8");
        const parsed = JSON.parse(rawContent);
        const { valid, block, issues } = validateBlockJson(parsed);
        const relativePath = path2.relative(process.cwd(), file);
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
      } catch (err) {
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
      const combinedPath = path2.resolve(process.cwd(), combinedOut);
      fs2.mkdirSync(path2.dirname(combinedPath), { recursive: true });
      const combinedCode = [
        "// Auto-generated combined block types",
        "// Generated by wp-block-typegen",
        "",
        ...generatedOutputs.map((g) => g.types)
      ].join(`

`);
      fs2.writeFileSync(combinedPath, combinedCode, "utf-8");
      console.log(`  ✓ Wrote combined types to: ${path2.relative(process.cwd(), combinedPath)}`);
    } else {
      for (const item of generatedOutputs) {
        const dir = path2.dirname(item.filePath);
        const outPath = path2.join(dir, "types.ts");
        fs2.writeFileSync(outPath, item.types, "utf-8");
        console.log(`  ✓ Wrote types to: ${path2.relative(process.cwd(), outPath)}`);
        if (emitPhp)
          fs2.writeFileSync(path2.join(dir, "types.php"), generatePhpTypes(item.block), "utf-8");
        if (emitZod)
          fs2.writeFileSync(path2.join(dir, "schema.ts"), generateZod(item.block), "utf-8");
      }
    }
    if (emitCursor && validBlocks.length > 0) {
      const rulesDir = path2.resolve(process.cwd(), ".cursor/rules");
      fs2.mkdirSync(rulesDir, { recursive: true });
      const rulesPath = path2.join(rulesDir, "gutenberg-blocks.mdc");
      const rulesContent = generateCursorRules(validBlocks);
      fs2.writeFileSync(rulesPath, rulesContent, "utf-8");
      console.log(`  ✓ Wrote AI rules context to: ${path2.relative(process.cwd(), rulesPath)}`);
    }
    console.log(`[wp-block-typegen] Done. Processed ${generatedOutputs.length} block(s).`);
    return !hasErrors;
  }
  if (doctor || breakingRef) {
    const files = findBlockJsonFiles(absoluteTarget);
    let ok = true;
    if (doctor)
      ok = runDoctor(files, roast) && ok;
    if (breakingRef)
      ok = runBreaking(files, breakingRef) && ok;
    return { exitCode: ok ? 0 : 1 };
  }
  const initialSuccess = executeRun();
  if (watchMode) {
    console.log(`[wp-block-typegen] Watching for file changes... (Press Ctrl+C to exit)`);
    fs2.watch(absoluteTarget, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith("block.json")) {
        console.log(`
[wp-block-typegen] Detected change in: ${filename}. Regenerating...`);
        executeRun();
      }
    });
    return { exitCode: 0 };
  }
  return { exitCode: initialSuccess ? 0 : 1 };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path2.resolve(process.argv[1])) {
  const result = runCLI();
  if (!process.argv.includes("-w") && !process.argv.includes("--watch")) {
    process.exit(result.exitCode);
  }
}
export {
  validateBlockJson,
  runCLI,
  getBlockTypeName,
  generateZod,
  generatePhpTypes,
  generateCursorRules,
  generateBlockTypes,
  formatReport,
  doctorBlock,
  diffBlocks,
  deprecatedStub
};
