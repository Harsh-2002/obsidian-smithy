# Firstfinger Publisher

A minimal CMS inside Obsidian for Hugo blogs. Write posts locally, drag-drop
attachments, hit one command to publish — the plugin uploads the attachments
to any S3-compatible storage (Cloudflare R2 / AWS S3 / DigitalOcean Spaces /
Wasabi / Backblaze B2 / MinIO / custom), rewrites the markdown to point at
the CDN URLs, and commits the result to GitHub. Works on desktop and
mobile.

> **Status: v0.1.0 — scaffold only.** Pipeline phases land incrementally.
> Track progress on the [project board](#) (TBD).

## Why

The browser-based Sveltia/Decap CMS workflow had too much friction:
multi-step uploads, CI rebuilds per image, mobile UX gaps. This plugin
replaces it with a one-command publish from inside Obsidian itself.

## Features (target for v0.1.0)

- **One-command publish** of any post inside a configured posts folder
- **S3-compatible storage** with built-in presets for the major providers
- **Date-templated upload paths** (`{year}/{month}/{slug}/{filename}`)
- **Wiki-link auto-conversion**: `![[image.png]]` and `[[other-post]]` become
  Hugo-ready markdown on publish
- **Hugo shortcode picker**: insert callout / gallery / audio / video /
  attachment / bookmark / embed via fuzzy search
- **GitHub REST API commit** (no shell git needed; works on mobile)
- **Folder-scoped**: personal notes outside the posts folder are untouched
- **Secret storage** via Obsidian's `app.secretStorage` API (no plaintext
  secrets on disk)

## Install (via BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
   in Obsidian
2. Open Command Palette → **BRAT: Add a beta plugin for testing**
3. Paste: `https://github.com/Harsh-2002/obsidian-firstfinger-publisher`
4. Enable the plugin: **Settings → Community plugins → Firstfinger Publisher**

## Configure

Open **Settings → Firstfinger Publisher** and fill in three sections:

- **Site** — posts folder path, public URL base, default draft state
- **Storage** — provider preset, bucket, endpoint, region, credentials
  (entered as secret names), path template
- **Git** — GitHub repo, branch, PAT (entered as a secret name), commit
  message template

Click **Test upload** and **Test token** to verify the credentials work
before publishing your first post.

## Develop

```bash
npm install
npm run dev    # watch mode, inline sourcemap
npm run build  # production, minified
```

To test live in Obsidian:

```bash
# Clone or symlink into your test vault's plugin folder
ln -s ~/obsidian-firstfinger-publisher ~/<vault>/.obsidian/plugins/firstfinger-publisher
```

Then in Obsidian: **Settings → Community plugins → Firstfinger Publisher**
→ enable.

## License

MIT. See [LICENSE](LICENSE).
