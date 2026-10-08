# Changelog

## 1.1.1
Tested against 138 real `block.json` files (116 WordPress core blocks plus 10up block-components, convert-to-blocks, block-catalog and others). Generated TypeScript and zod compile under `tsc --strict` on all of them.
- Fix: `rich-text` attribute type (used by 21 core blocks) was rejected as invalid. It is now a string.
- Fix: `source: "query"` rows are typed from their `query` shape instead of `unknown[]`.
- Fix: keys such as `core/accordion-icon-position` or `data-x` are quoted. The output was not valid TypeScript before.
- Fix: `default: null` on a non-nullable type is typed `T | null` (TS) and `.nullish().default(null)` (zod). The doctor no longer reports it as a type mismatch.
- Doctor: `__unstable*` names are not flagged, the god-block threshold is 20 attributes, and attributes without defaults are one grouped finding instead of one line each.

## 1.1.0
- `--doctor` / `--roast`: score each block (A+ to F), exit 1 under 70.
- `--breaking <git-ref>`: flag changes that break saved posts, print a `deprecated` stub.
- `--php`: PHPStan array shape for `render.php`.
- `--zod`: zod runtime schema.
- `dist/` is now committed so the CLI works from a git clone.

## 1.0.0
- Generate TypeScript attribute types and Cursor rules from `block.json`.
