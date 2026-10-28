# Contributing

Thanks for helping. Read [AGENTS.md](AGENTS.md) first: its commit, pull request and code rules apply to everyone.

## Before you start

- Open an issue for anything larger than a small fix, so the design can be agreed first.
- Changes to anything in `spec/` are protocol changes. They need the spec text, the reference implementation and the test vectors updated together, and both apps have to be able to follow.

## Development

Requirements: Node 24 or later and pnpm (the version is pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
```

## Pull requests

- One change per pull request, branched from the latest `main`.
- One-line commit messages in the `type(scope): description` form, with no body.
- Fill in the pull request template, including the exact commands you ran and their results.

By contributing you agree that your work is licensed under the [AGPL-3.0](LICENSE).
