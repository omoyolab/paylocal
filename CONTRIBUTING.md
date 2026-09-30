# Contributing to paylocal

Thanks for helping. This file covers setup, the kinds of changes we are looking for, and
what a pull request needs to be merged.

## Setup

```sh
git clone https://github.com/omoyolab/paylocal
cd paylocal
pnpm install
pnpm check        # lint, typecheck, build, test
```

Node 20 or newer and pnpm 9 or newer. The CLI tests run the built `dist/cli.js`, so run
`pnpm build` (or `pnpm check`) before `pnpm test` if you only changed the CLI.

Useful scripts:

| Script            | What it does           |
| ----------------- | ---------------------- |
| `pnpm dev`        | Rebuild on change      |
| `pnpm test:watch` | Re-run tests on change |
| `pnpm format`     | Prettier               |
| `pnpm check`      | Everything CI runs     |

Try your build locally with `node dist/cli.js …` or `pnpm link --global`.

## What we are looking for

**Payload corrections.** The most valuable contribution. If a real delivery from Paystack
or Flutterwave differs from what paylocal produces, open a payload report issue or send a
PR that updates the template in `src/providers/<provider>.ts`. Strip every secret, token,
email and account number before sharing.

**New events.** Add an entry to the `events` map in the provider file. Each entry needs a
`name` that matches what the provider sends, a one-line `description`, and a `template`
that uses the `ctx` helpers for ids, references and dates so every trigger is fresh. Add a
short test if the event has fields that integrations commonly read.

**New providers.** One file in `src/providers/`, registered in `src/providers/index.ts`.
Implement the `Provider` interface from `src/types.ts`: signing, tampering, shortcuts,
summary fields, and at least the provider's most common event. Add a test file that
mirrors `test/paystack.test.ts`. Link the provider's webhook docs in a comment.

**Bugs and docs.** Always welcome. Small PRs merge fastest.

For anything larger than that, especially the roadmap items (tunnel, mock server), open an
issue or discussion first so we can agree on the shape before you spend a weekend on it.

## Pull request checklist

- `pnpm check` passes.
- New behaviour has a test. Bug fixes have a test that fails without the fix.
- `CHANGELOG.md` has a line under **Unreleased**.
- README updated if a command, flag or event changed.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `docs:`, `test:`, `chore:`. Scope is optional, e.g. `feat(paystack): add refund.failed`.

## Code style

Prettier and ESLint are configured, so formatting is not a review topic. Beyond that:

- No runtime dependencies. Node's standard library is enough.
- Errors thrown to users are `PaylocalError` with a `hint` that says what to do next.
- Keep the CLI thin. Logic lives in `src/core/` so the library API and the CLI stay in sync.

## Releasing (maintainers)

1. Update `CHANGELOG.md`: move **Unreleased** into a new version heading with today's date.
2. `pnpm version <patch|minor|major>` to bump `package.json` and create the tag.
3. `git push --follow-tags`.
4. The release workflow runs `pnpm check`, publishes to npm with provenance, and creates
   the GitHub release from the tag.

Publishing uses npm Trusted Publishing, so there is no token to rotate. The package's
trusted publisher on npmjs.com is this repository's `release.yml` workflow. If that ever
needs re-linking: package Settings → Trusted publisher → GitHub Actions.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
