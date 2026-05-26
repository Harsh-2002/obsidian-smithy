# Manual test plan — v0.1.0

This is the 14-step matrix the v0.1.0 release ships against. Run them in
order against a **throwaway vault** (clone of a real Hugo blog repo) on
each device you intend to use the plugin on.

## Pre-flight

1. The vault is the root of a Hugo repo.
2. The repo has at least one post under `content/posts/<slug>/index.md`.
3. You have an S3-compatible bucket ready (R2, AWS, MinIO local — any
   preset works for the round-trip).
4. You have a GitHub PAT with `contents: write` on the target repo.

## Install via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from
   the Community plugin browser.
2. Command Palette → **BRAT: Add a beta plugin for testing**.
3. Paste: `https://github.com/Harsh-2002/obsidian-smithy`.
4. Enable **Settings → Community plugins → Smithy**.

## Configure

Open **Settings → Smithy**:

| Section | What to set |
|---|---|
| Site | `posts folder`, `site base URL` |
| Storage | provider preset → fill bucket / endpoint / region / public URL; click "Set value" beside each secret name to enter the actual S3 keys |
| Git | repo owner / name / branch / PAT (via "Set value" modal) |

Run the verification buttons:

- **Test upload** → should show `Upload OK → <CDN URL>`.
- **Test token** → should show `Token OK — <owner>/<repo> is reachable`.

If either fails, fix the config before moving on.

## Test matrix

### 1. Scaffold

Run **New post**. Type a title (e.g. *Test post*). Confirm:

- folder created at `<postsFolder>/test-post/`
- file at `<postsFolder>/test-post/index.md` exists
- frontmatter has `title`, `date`, `draft`, `tags`, `description`
- Obsidian opens the new file

### 2. Attachments (local drop)

Inside `test-post/`, create a sub-folder `_attachments/` (or let Obsidian's
attachment settings put files wherever you've configured — anywhere under
the post folder works). Drop a small PNG / PDF / MP4 in there.

Reference it in `index.md` with at least one of each ref shape:

```md
![an image](attachments/screenshot.png)
[a PDF](attachments/notes.pdf)
![[attachments/clip.mp4]]
[[fixing-xterm-ghostty-over-ssh]]
```

(Adjust the wiki-link target to a slug that exists in your test vault.)

### 3. Publish full

Run **Publish current post**.

Expected:

- PublishModal shows phase chips: Validating → Scanning → Resolving →
  Uploading → Rewriting markdown → Committing → ✓ done
- Per-attachment progress lines appear while uploading
- Modal ends with "Published" + a link to the GitHub commit + a link to
  the live post
- Open `index.md`: every ref above is now an `https://<your-cdn>/...` URL
  except `[[fixing-xterm-ghostty-over-ssh]]` which became
  `[fixing-xterm-ghostty-over-ssh](/posts/fixing-xterm-ghostty-over-ssh/)`
- Check GitHub: one commit with the rewritten markdown landed; no extra
  attachment commits (attachments live only in your local `_attachments/`)

### 4. Idempotency

Re-run **Publish current post** on the same file without changing anything.

Expected: phases progress to ✓ done; "uploaded 0 file(s)"; commit shows
"No-op commit (file content unchanged on the branch)".

### 5. Delta upload

Add one new image reference. Re-run publish.

Expected: only the new attachment uploads; the previously-uploaded refs
are detected as already-CDN and skipped.

### 6. Conflict resolution

Force a SHA mismatch: edit the same post via the GitHub web UI between
two publishes. Then run **Publish current post** again locally.

Expected:

- ConflictModal opens with the message "Branch has newer commits"
- If you have Obsidian Git installed: "Pull and retry" is enabled.
  Click it. Obsidian Git pulls, then the modal re-runs publish.
- If Obsidian Git is NOT installed: "Pull and retry" is disabled with a
  tooltip. "Copy markdown" works and you can paste/resolve manually.

### 7. Provider matrix

Repeat steps 2-3 once with **Cloudflare R2** preset and once with
**MinIO** (local instance). Both should round-trip identically — the
test exercises the SigV4 + path-style toggle paths.

### 8. Mobile install

On iOS and Android: install BRAT in the Obsidian mobile app, add the
plugin URL, enable. Open a post in the test vault (sync via iCloud /
Obsidian Sync / git pull from another tool). Run **Publish current post**.

Expected: same flow as desktop. Watch for:

- `app.secretStorage` works on mobile (no fallback warning in the dev
  console)
- aws4fetch SigV4 PUT succeeds on iOS WKWebView (full ArrayBuffer body)
- Commit succeeds via `fetch` against GitHub API

### 9. Folder filter

Open a personal note outside `<postsFolder>`. Open the Command Palette
and search "Publish current post".

Expected: the command does NOT appear in the palette (checkCallback
returned false because the file isn't in the configured posts folder).

### 10. Secret rotation

Open **Settings → Smithy → Git → PAT** → "Set value" → paste a
NEW PAT. Close settings. Re-run publish.

Expected: publish succeeds with the new token — no plugin reload needed.

### 11. Wiki-link conversion

Write `[[other-real-post-in-your-vault]]` in a draft. Publish.

Expected: rewritten to `[other-real-post-in-your-vault](/posts/other-real-post-in-your-vault/)`
in the committed markdown. If the target doesn't exist, the publish modal
shows a yellow "unresolved-link" warning but the publish still succeeds
(the original `[[…]]` is left in place).

### 12. Shortcode picker

Open any post, place cursor on a blank line, run **Insert Hugo shortcode**.
Pick "Callout".

Expected: `{{< callout type="info" title="" >}}\nbody\n{{< /callout >}}`
is inserted; cursor lands at the empty `title=""` slot.

### 13. Upload single

Run **Upload single attachment to S3** from anywhere. Pick a file via
the native picker.

Expected: file uploads under the `_loose/` slug; CDN URL is copied to
clipboard; success notice fires.

### 14. Performance

Open Obsidian DevTools console:

```js
performance.mark('start');
await app.plugins.disablePlugin('smithy');
await app.plugins.enablePlugin('smithy');
performance.measure('smithy-load', 'start');
performance.getEntriesByName('smithy-load')[0].duration;
```

Expected: < 50ms — `onload()` body alone should be well under 5ms; the
remainder is plugin loader overhead which we can't influence.

## Reporting bugs

Open issues at <https://github.com/Harsh-2002/obsidian-smithy/issues>
with:

- which step failed
- expected vs actual
- Obsidian version, platform
- console errors (DevTools)
- whether `app.secretStorage` was available (check the warn line in the
  console at plugin load)
