import type { BlockAttributeSchema, BlockJson } from "./validator.js";

export type Level = "error" | "warn" | "info";
export interface Finding {
  id: string;
  level: Level;
  field: string;
  message: string;
  roast: string;
}
export interface Report {
  findings: Finding[];
  score: number;
  grade: string;
  quip: string;
}

const PENALTY: Record<Level, number> = { error: 15, warn: 5, info: 1 };
const GRADES: [number, string, string][] = [
  [97, "A+", "Ship it. Frame it."],
  [90, "A", "Clean. Your future self says thanks."],
  [80, "B", "Solid. A few loose threads."],
  [70, "C", "Works on your machine."],
  [50, "D", "Held together by hope."],
  [0, "F", "Call the block police."],
];

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

function defaultMatches(s: BlockAttributeSchema): boolean {
  if (s.default === undefined || !s.type) return true;
  const actual = typeOf(s.default);
  const types = Array.isArray(s.type) ? s.type : [s.type];
  return types.some((t) =>
    t === "integer" ? Number.isInteger(s.default) : t === actual,
  );
}

export function doctorBlock(b: BlockJson): Report {
  const f: Finding[] = [];
  const add = (
    id: string,
    level: Level,
    field: string,
    message: string,
    roast: string,
  ) => f.push({ id, level, field, message, roast });

  if (!b.$schema)
    add("no-schema", "warn", "$schema", "Missing $schema (no editor autocomplete).",
      "No $schema. Your editor is flying blind and so are you.");
  if (typeof b.apiVersion !== "number" || b.apiVersion < 3)
    add("api-version", "warn", "apiVersion", "Use apiVersion 3 (iframed editor, WP 6.3+).",
      "apiVersion < 3. This block called, it wants its 2019 back.");
  if (!b.description)
    add("no-description", "info", "description", "Add a description for the inserter.",
      "No description. Mystery blocks are only fun in escape rooms.");
  if (!b.textdomain)
    add("no-textdomain", "warn", "textdomain", "Missing textdomain: title/description are untranslatable.",
      "No textdomain. Translators have filed a missing-person report.");
  if (b.supports && (b.supports as Record<string, unknown>).html !== false)
    add("html-editing", "info", "supports.html", 'Set supports.html=false so users cannot hand-edit markup into an invalid block.',
      "Raw HTML editing is on. Someone WILL paste a <marquee>.");

  const attrs = Object.entries(b.attributes ?? {});
  if (attrs.length > 15)
    add("god-block", "warn", "attributes", `${attrs.length} attributes. Split into inner blocks.`,
      `${attrs.length} attributes. This isn't a block, it's a lifestyle.`);

  for (const [k, s] of attrs) {
    const at = `attributes.${k}`;
    if (!/^[a-z][a-zA-Z0-9]*$/.test(k))
      add("attr-case", "warn", at, `"${k}" should be camelCase.`,
        `"${k}"? Pick a case and commit to it.`);
    if (s.default === undefined && s.source === undefined)
      add("no-default", "info", at, `"${k}" has no default; it is optional everywhere.`,
        `"${k}" has no default. undefined is not a personality.`);
    if (!defaultMatches(s))
      add("default-type", "error", at, `Default ${JSON.stringify(s.default)} does not match type ${JSON.stringify(s.type)}.`,
        `"${k}" says ${JSON.stringify(s.type)} but defaults to ${JSON.stringify(s.default)}. Bold.`);
    if (s.enum && s.default !== undefined && !s.enum.includes(s.default as never))
      add("default-enum", "error", at, `Default ${JSON.stringify(s.default)} is not in enum.`,
        `Default isn't in its own enum. Not even the block trusts the block.`);
    if (s.source === "html" && !s.selector)
      add("source-selector", "error", at, 'source "html" needs a selector.',
        `source:"html" with no selector. Where, exactly?`);
  }

  const score = Math.max(0, 100 - f.reduce((n, x) => n + PENALTY[x.level], 0));
  const [, grade, quip] = GRADES.find(([min]) => score >= min)!;
  return { findings: f, score, grade, quip };
}

export function formatReport(name: string, r: Report, roast = false): string {
  const filled = Math.round(r.score / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const icon = { error: "✖", warn: "⚠", info: "·" } as const;
  const lines = [
    `┌─ ${name}`,
    `│  ${bar}  ${r.score}/100  grade ${r.grade}`,
    `│  ${r.quip}`,
  ];
  for (const x of r.findings)
    lines.push(`│  ${icon[x.level]} ${x.field}: ${roast ? x.roast : x.message}`);
  lines.push("└─");
  return lines.join("\n");
}
