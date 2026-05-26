# Forge

Publish posts from your Obsidian vault to a static-site repo (Hugo in v1)
with one command. Uploads attachments to any S3-compatible storage and
commits the rewritten markdown directly via the GitHub REST API. No CI
indirection, no separate CMS server, no per-image deploy — works
identically on desktop and mobile.

> **Status: v0.1.x — beta.** Distributed via BRAT for now; community
> plugin store submission planned after the v0.2 test pass.

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

- **One-command publish** from inside any post in a configured posts folder
- **S3-compatible storage** — built-in presets for Cloudflare R2, AWS S3,
  DigitalOcean Spaces, Wasabi, Backblaze B2, MinIO, and any custom endpoint
- **Date-templated upload paths** (`{year}/{month}/{slug}/{filename}` by
  default; tokens for `{day}`, `{ext}`, `{hash}` available)
- **Wiki-link auto-conversion** so you can write in Obsidian-native style
  and get Hugo-ready markdown on commit
- **Hugo shortcode picker** with built-in templates for callout, gallery,
  audio, video, attachment, bookmark, embed
- **GitHub commit-via-REST-API** — no shell git, mobile-safe
- **Secret storage** via Obsidian's `app.secretStorage` API; settings
  store only secret names, never plaintext values
- **Folder-scoped** — only files inside `settings.site.postsFolder` are
  eligible

## Install (via BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
   from the Community plugin browser
2. Command Palette → **BRAT: Add a beta plugin for testing**
3. Paste this repo's URL → install
4. Enable **Settings → Community plugins → Forge**

## Configure

**Settings → Forge** has three sections:

- **Site** — posts folder, site base URL, default draft state
- **Storage** — provider preset + bucket / endpoint / region / public URL
  base / path template / credential secret names. Click "Set value" next
  to each secret name to enter the actual key (never typed into a regular
  text field). Click **Test upload** to round-trip a 4-byte test object.
- **Git** — repo owner / name / branch / PAT secret name / author /
  commit message template. Click **Test token** to verify scope.

Once configured: open any post inside the posts folder, run
**Command Palette → "Publish current post"** (or bind a hotkey).

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

## License

MIT — see [LICENSE](LICENSE).
