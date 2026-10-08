import type { BlockJson } from "./validator.js";

export interface Change {
  level: "breaking" | "risky" | "safe";
  field: string;
  message: string;
}

const j = (v: unknown) => JSON.stringify(v);
const normType = (t: unknown) => j(Array.isArray(t) ? [...t].sort() : t);

// ponytail: top-level attribute diff only; nested object property changes are not compared.
export function diffBlocks(o: BlockJson, n: BlockJson): Change[] {
  const out: Change[] = [];
  const add = (level: Change["level"], field: string, message: string) =>
    out.push({ level, field, message });

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
    for (const key of ["source", "selector", "attribute"] as const)
      if (os[key] !== ns[key])
        add("breaking", at, `${key} ${j(os[key])} -> ${j(ns[key])}. Serialization changed; block validation will fail.`);
    const gone = (os.enum ?? []).filter((v) => !(ns.enum ?? []).includes(v));
    if (os.enum && ns.enum && gone.length)
      add("breaking", at, `Enum values removed: ${j(gone)}. Posts using them become invalid.`);
    else if (os.enum && !ns.enum) add("safe", at, "Enum constraint lifted.");
    else if (!os.enum && ns.enum)
      add("risky", at, `New enum ${j(ns.enum)}. Existing free-form values may no longer match.`);
    if (j(os.default) !== j(ns.default))
      add("risky", at, `Default ${j(os.default)} -> ${j(ns.default)}. Defaults are not serialized: posts that omit it will render differently.`);
  }
  for (const k of Object.keys(na))
    if (!(k in oa)) add("safe", `attributes.${k}`, "Added.");

  return out;
}

export function deprecatedStub(old: BlockJson): string {
  return [
    "// Paste into registerBlockType(..., { deprecated: [ ... ] })",
    "{",
    `  attributes: ${JSON.stringify(old.attributes ?? {}, null, 2).replace(/\n/g, "\n  ")},`,
    "  save: /* paste the PREVIOUS save() here */,",
    "  migrate: (attributes) => attributes,",
    "}",
  ].join("\n");
}
