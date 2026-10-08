# Changelog

## 1.1.0
- `--doctor` / `--roast`: score each block (A+ to F), exit 1 under 70.
- `--breaking <git-ref>`: flag changes that break saved posts, print a `deprecated` stub.
- `--php`: PHPStan array shape for `render.php`.
- `--zod`: zod runtime schema.
- `dist/` is now committed so the CLI works from a git clone.

## 1.0.0
- Generate TypeScript attribute types and Cursor rules from `block.json`.
