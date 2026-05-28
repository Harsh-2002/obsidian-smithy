# CLAUDE.md — architecture & codebase map

Technical reference for Claude Code and contributors. **README.md is the
user-facing doc; this file is the developer map.** Keep it in sync when the
structure changes.

## What it is

One-command publish of Obsidian posts to a Hugo static-site repo: upload
attachments to S3-compatible storage, convert Obsidian markdown to Hugo, and
commit via the GitHub REST API. Runs identically on desktop and mobile — no
Node-only APIs, no runtime dependencies beyond the Obsidian app.

## Lifecycle (`src/main.ts`)

- **`onload()`** — register commands + settings tab only; keep under ~5 ms.
  Every command gates on a `ready` flag and no-ops until deferred init runs.
- **`onLayoutReady` → `deferredInit()`** — `loadSettings`, mount the status-bar
  chip, attach the paste-rename listener, flip `ready`, and open the welcome
  modal on a truly fresh install.
- **`onunload()`** — `chip.destroy()` + detach the paste listener. Anything
  registered via `registerEvent` / `registerInterval` / `addStatusBarItem`
  auto-cleans.

## Publish pipeline (`src/publish/pipeline.ts`)

The product *is* this sequence; each phase is a thin module that owns one step:

```
validate → walk → resolve → upload → rewrite → transform → commit → stamp/notify
```

| Phase | File | Responsibility |
|---|---|---|
| validate | `publish/validate.ts` | File is under `postsFolder`; frontmatter parses; `title`+`date` present. |
| walk | `publish/walker.ts` | Find local refs `![]()`, `[]()`, `![[ ]]`, `[[ ]]`. Drops refs inside code regions. Carries source offsets. |
| resolve | `publish/resolve.ts` | Classify each ref: upload (attachment), rewrite (wiki-link → permalink + `#heading` anchor), or warn. Note embeds (`.md`) are NOT uploaded. |
| upload | `storage/s3-client.ts` | SigV4 PUT to the configured bucket. |
| rewrite | `publish/rewrite.ts` | Atomic offset-based substitution via `vault.process`, applied right-to-left so earlier offsets stay valid. **Mutates the vault note** (CDN URLs persist; idempotent). |
| transform | `publish/transform.ts` | Obsidian→Hugo body conversion on the **committed copy only**. Code-fence safe. |
| commit | `git/github-rest.ts` | Commit via the Contents API; conflict detection; optional `workflow_dispatch`. |

## Invariants — do not break these

- **Vault vs published copy.** Asset/link rewrites (`rewrite.ts`) persist in the
  vault note. *Syntax* conversion (`transform.ts`) touches only the git copy, so
  authors keep Obsidian-native syntax in their editor.
- **Code regions are sacred.** `walker.ts` and `transform.ts` both skip fenced +
  inline code via `util/code-regions.ts`. Examples in technical posts stay
  verbatim.
- **Mobile.** No Node APIs, no regex lookbehind (iOS < 16.4), responsive modals.
- **Secrets.** Settings store the *name* of each secret; values live in
  `app.secretStorage` (`src/secrets.ts`) — never in `data.json` or git.
- **Frontmatter.** The parser reads both `+++` (hand-rolled TOML subset,
  `frontmatter/toml.ts`) and `---` (Obsidian `parseYaml`). New posts scaffold
  YAML by default (`site.frontmatterFormat`). Writeback
  (`util/frontmatter-update.ts`) preserves the file's existing delimiter and
  quotes YAML values that would otherwise be re-typed.
- **Idempotency.** Refs already on the CDN are skipped; `commitFile` no-ops when
  the new body equals the current one.

## Directory map

```
src/
  main.ts          entry point: command registration + lifecycle
  types.ts         all shared types (single source of truth)
  settings.ts      DEFAULT_SETTINGS, load/save, deep-merge migration
  secrets.ts       app.secretStorage wrapper (+ localStorage fallback)
  commands/        one file per command-palette action (thin orchestration)
  publish/         the pipeline: validate, walker, resolve, rewrite,
                   transform, lint, pipeline
  engine/          EngineAdapter; hugo.ts = permalink + scaffoldPost (Hugo-only)
  frontmatter/     parse (+++ / ---) + hand-rolled TOML subset reader
  storage/         S3 client, provider presets, path-template tokens
  git/             GitHub REST (commit, content SHA, conflict, dispatch)
  ui/              modals, settings tab, status-bar chip, snippet/shortcode picker
  util/            code-regions, slug, mime, hash, frontmatter-update,
                   hugo-config-detect, check-configured, pasted-image-rename
```

## Conventions

- **Tests** are colocated `*.test.ts` (Vitest). Pure logic is deliberately
  extracted so it can be tested without an Obsidian `App`: `transform`,
  `code-regions`, `splitLinkTarget`/`headingAnchor`, frontmatter `parse`/`toml`,
  `frontmatter-update`, `path-template`, `slug`, `walker`. App-dependent paths
  are covered by the manual matrix in `TESTING.md`.
- TS `strict`; eslint must pass. The esbuild bundle (`main.js`) must stay under
  **100 KB** — enforced by `ci.yml`.

## Where to start for a common change

- **New command** → add `src/commands/<x>.ts`, register it in `main.ts` (gate on
  `ready`).
- **New Obsidian→Hugo conversion** → add a transform in `transform.ts` (operate
  on non-code segments only) + a `transform.test.ts` case.
- **New shortcode in the picker** → `src/ui/shortcodes.ts` (`SHORTCODES`); match
  the site's actual shortcode signature.
- **New storage provider** → `src/storage/presets.ts`.
- **Another static-site generator** → implement `EngineAdapter` in `src/engine/`
  and extend `EngineId` in `types.ts`.

## Build / test / release

```bash
npm run dev      # watch build (inline sourcemap)
npm run build    # tsc --noEmit + esbuild production → main.js
npm run lint     # eslint src/**/*.ts
npm run test     # vitest run
npm run check    # lint + test + build
```

**Release** uses CalVer `YYYY.MM.DD` (no semver). Exactly one active release +
tag at a time — `release-cleanup.yml` prunes priors on `release: published`.
Bump `manifest.json`, `package.json`, and `versions.json` to the date (the value
in `versions.json` is the minimum Obsidian app version, not a second plugin
version). Same-day re-releases keep the same date string. See the "Release
policy" section in `README.md`.
