# Forge

Publish posts from your Obsidian vault to a static-site repo (Hugo in v1)
with one command. Uploads attachments to any S3-compatible storage and
commits the rewritten markdown directly via the GitHub REST API. No CI
indirection, no separate CMS server, no per-image deploy — works
identically on desktop and mobile.

> **Status: v0.5.x — beta.** Distributed via BRAT for now; community
> plugin store submission planned after the v0.5 stability soak.

## How it works

```
write in Obsidian
       │
       │  drag/drop an image into a post folder
       │  (lands in <post>/_attachments/, gitignored)
       │
       ▼
"Publish current post"
       │
       ├─ scans your markdown for local refs
       │  ![](image.png), [text](file.pdf), ![[wiki-embed]], [[other-post]]
       │
       ├─ uploads each attachment to your S3 bucket
       │  (R2 / S3 / Spaces / Wasabi / B2 / MinIO / custom)
       │
       ├─ rewrites the markdown:
       │  • image / file refs → CDN URLs
       │  • wiki-embeds       → ![](CDN URL)
       │  • wiki-links        → [text](/posts/slug/) (Hugo permalink)
       │
       └─ commits the rewritten post to GitHub via the REST API
           (works on mobile — no shell git needed)
```

Personal notes outside the configured posts folder are never touched.

## Features

- **First-run welcome modal** — opens automatically on a fresh install
  and walks you through the 3 sections to configure. Detects an
  existing Hugo config in your vault and offers to prefill the Site
  section.
- **Encrypted settings export/import** — move a configured Forge
  between devices (desktop ↔ iPhone) via a passphrase-protected file
  that rides the vault. AES-GCM via WebCrypto, no plaintext secrets
  ever land on disk.
- **Insert sample post** command — drops a ready-to-publish demo post
  so you can verify your setup end-to-end before writing real content.
- **One-command publish** with `Mod+Shift+P` default hotkey, from any
  post in the configured posts folder
- **Status-bar chip** shows publish freshness ("✓ published 2h ago"),
  unpublished-edit warnings, live phase during publish, and lint
  warnings — all in one element
- **Frontmatter linting** while you write (debounced 2s) — missing
  title / date / description / tags / cover surface as soft warnings
- **Dry-run publish** — see what would upload + rewrite + commit
  without touching S3 or git
- **S3-compatible storage** — built-in presets for Cloudflare R2,
  AWS S3, DigitalOcean Spaces, Wasabi, Backblaze B2, MinIO, custom
- **Date-templated upload paths** (`{year}/{month}/{slug}/{filename}`
  default; tokens for `{day}`, `{ext}`, `{hash}` available)
- **Wiki-link auto-conversion** — `![[image.png]]` and `[[other-post]]`
  become Hugo-ready markdown on commit; resolved post titles flow
  through, not just slugs
- **Hugo shortcode picker** for callout, gallery, audio, video,
  attachment, bookmark, embed
- **GitHub commit-via-REST-API** — no shell git, mobile-safe
- **Undo last publish** — per-post history captured at publish time;
  revert via a clean revert commit + local rollback
- **Publish all drafts** batch command with per-row Publish/Skip
- **Auto-rename pasted screenshots** (opt-in) → `<slug>-screenshot-N.<ext>`
- **Secret storage** via Obsidian's `app.secretStorage` API
- **Folder-scoped** — only files inside `settings.site.postsFolder`
  are eligible; personal notes never touched
- **Mobile-friendly** — responsive modal sizing, no Node-only APIs

## Quick start

1. **Install BRAT** from Community plugins.
2. Command Palette → **BRAT: Add a beta plugin for testing** →
   `Harsh-2002/obsidian-forge` → install.
3. Enable **Settings → Community plugins → Forge**.
4. The **welcome modal** opens automatically on first run and walks
   you through the 3 sections. If you have an existing Hugo blog
   config in your vault, it offers to prefill the Site section for
   you.
5. Once Test all is ✓, open a post inside the posts folder and hit
   **Mod+Shift+P** (Cmd on Mac, Ctrl elsewhere).

### Moving to a second device (iPhone, work laptop, etc.)

1. On the device that's already configured, Command Palette →
   **Forge: Export settings…** → enter a passphrase → file lands in
   your vault as `forge-settings.forge-config`.
2. Sync the vault to the second device (via Obsidian Sync, iCloud,
   Working Copy + git, Dropbox — anything).
3. On the second device: install Forge (BRAT), then Command Palette
   → **Forge: Import settings…** → enter the same passphrase. Done.
4. Run **Test all** in Settings to verify the import succeeded.

The bundle includes your 3 secrets (PAT + S3 access key + S3 secret),
encrypted with AES-GCM. Lose the passphrase and the file is
unrecoverable — pick something you'll remember.

### Cross-device sync options

Forge runs the same publish flow on any device — you just need the
vault visible there. Free options:

- **Vault = your blog repo.** Clone the repo as your vault. On iOS
  use Working Copy for git, Obsidian for editing. No subscriptions.
- **iCloud Drive** (free, Apple-only).
- **Syncthing** (free, self-hosted P2P).
- **Dropbox / Google Drive / OneDrive** (free tier).
- **Obsidian Sync** ($10/mo, easiest but optional).

## Configure manually

**Settings → Forge** has three sections, plus a 🟢/🟡/🔴 status badge
at the top showing whether everything's wired up:

- **Site** — posts folder, site base URL, default draft state.
- **Storage** — provider preset + bucket / endpoint / region / public URL
  base / path template / credential secret names. Click **Create token**
  to open your provider's API tokens page; **Set value** to enter the
  actual key. **Test upload** round-trips a 4-byte test object.
- **Git** — repo owner / name / branch / PAT / author / commit message
  template. Paste `owner/repo` into the Owner field and it auto-splits.
  **Create token** opens GitHub's PAT creation page with the right
  scopes preselected. **Test token** verifies access.

If you ever need the welcome modal back, Command Palette →
**Forge: Show welcome guide**.

## Develop

```bash
git clone https://github.com/Harsh-2002/obsidian-forge
cd obsidian-forge
npm install
npm run dev    # watch + inline sourcemap
npm run build  # production
```

To test live in a sandbox vault:

```bash
ln -s "$PWD" ~/<vault>/.obsidian/plugins/forge
```

Then in Obsidian: enable under Community plugins.

## Release policy — only the latest, always

There is **exactly one active release** in this repo at any time. When
a new version ships:

1. The new tag + GitHub release are created.
2. The `release-cleanup.yml` workflow auto-runs on the
   `release: published` event and deletes every prior release + tag.

Net effect: visiting <https://github.com/Harsh-2002/obsidian-forge/releases>
always shows the latest, nothing else. BRAT installs the latest tag, and
nobody asks for older versions in practice, so storing N copies costs
storage + bandwidth without a payoff. Older versions stay reachable via
the git log if anyone ever needs to bisect.

This is enforced by [`/.github/workflows/release-cleanup.yml`](.github/workflows/release-cleanup.yml).

## License

MIT — see [LICENSE](LICENSE).
