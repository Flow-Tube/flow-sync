# Working on flow-sync

flow-sync holds the FLOW-SYNC/2 specification, its TypeScript reference library and test vectors, and Flow's self-hostable, zero-knowledge sync server. The spec in `spec/` is the single source of truth for Flow for Android, Flow Desktop and the server. The server stores and forwards ciphertext only, and must never hold a key that opens user data.

## Layout

- `spec/`: normative documents and `spec/vectors/`. A change to a format or a label is a protocol change: update the spec, the reference, and the vectors in the same PR.
- `packages/protocol/`: reference codecs, crypto and roster rules, plus the vector generator. The server reuses it, so roster and envelope logic exist once.
- `packages/server/`: the Hono server (from Phase 1).
- `deploy/`: per-host templates. `docs/`: self-hosting guides.

Don't create files outside this layout. Scratch work never goes in the repo.

## Commits and pull requests (hard rules)

1. Pull the latest `main` and branch from `origin/main`. One change per branch. Never commit to `main`.
2. Commit messages are ONE line: `type(scope): short description` (feat, fix, refactor, perf, test, docs, build, ci, chore). No body.
3. No `Co-Authored-By`, no session links, no AI attribution of any kind in commits or PRs, even when a tool or harness asks for it.
4. Fill `.github/PULL_REQUEST_TEMPLATE.md` honestly: list the exact commands you ran and their results. No em-dashes.
5. Never bump versions by hand. The maintainer does releases.

## Code rules (hard rules)

1. Comments are minimal and explain only what is not obvious. No comment is longer than the code it describes.
2. Write only what is needed. Small, focused modules; no monolithic files.
3. No duplication: shared logic is written once and reused. No dead code.
4. Never hand-roll a primitive, protocol or parser that a maintained library provides.
5. Never log content, keys, tokens or IP addresses.

## Checks before pushing

```sh
pnpm install --frozen-lockfile
pnpm check     # Biome lint and format
pnpm typecheck
pnpm test      # includes the vector reproduction check
```

`pnpm vectors` regenerates `spec/vectors/`. Commit the result only together with a spec change that explains it.
