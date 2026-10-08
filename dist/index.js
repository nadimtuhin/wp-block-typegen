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
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
var VERSION = "1.0.0";
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
  if (!fs.existsSync(dir))
    return fileList;
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
function runCLI(args = process.argv.slice(2)) {
  let targetDir = ".";
  let combinedOut = null;
  let emitCursor = false;
  let checkOnly = false;
  let watchMode = false;
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
      const combinedPath = path.resolve(process.cwd(), combinedOut);
      fs.mkdirSync(path.dirname(combinedPath), { recursive: true });
      const combinedCode = [
        "// Auto-generated combined block types",
        "// Generated by wp-block-typegen",
        "",
        ...generatedOutputs.map((g) => g.types)
      ].join(`

`);
      fs.writeFileSync(combinedPath, combinedCode, "utf-8");
      console.log(`  ✓ Wrote combined types to: ${path.relative(process.cwd(), combinedPath)}`);
    } else {
      for (const item of generatedOutputs) {
        const dir = path.dirname(item.filePath);
        const outPath = path.join(dir, "types.ts");
        fs.writeFileSync(outPath, item.types, "utf-8");
        console.log(`  ✓ Wrote types to: ${path.relative(process.cwd(), outPath)}`);
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
  const initialSuccess = executeRun();
  if (watchMode) {
    console.log(`[wp-block-typegen] Watching for file changes... (Press Ctrl+C to exit)`);
    fs.watch(absoluteTarget, { recursive: true }, (eventType, filename) => {
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
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = runCLI();
  if (!process.argv.includes("-w") && !process.argv.includes("--watch")) {
    process.exit(result.exitCode);
  }
}
export {
  validateBlockJson,
  runCLI,
  getBlockTypeName,
  generateCursorRules,
  generateBlockTypes
};
