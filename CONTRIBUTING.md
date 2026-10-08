# Contributing

Bug reports, failing `block.json` examples and pull requests are welcome.

## Setup

```bash
bun install
bun test
bun run build   # dist/ is committed so the CLI runs from a git clone
```

## Pull requests

- Add or update a test in `tests/` for any behavior change.
- Run `bun test`, `bun x tsc --noEmit` and `bun run build`, and commit the rebuilt `dist/`.
- Keep zero runtime dependencies. If you need one, open an issue first.
- New doctor checks need a test and a one-line reason in the README.

## Reporting a bug

Include the smallest `block.json` that reproduces it, the command you ran, and the output you expected.
