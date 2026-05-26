import { App, Notice, TFile, TFolder } from 'obsidian';

import type { PluginSettings } from '../types';

/**
 * "Smithy: Insert sample post" command — drops a complete, publish-ready
 * demo post into the user's posts folder so they can verify the full
 * pipeline (S3 upload + git commit) before committing real writing.
 *
 * Behaviour:
 *   - Creates `<postsFolder>/smithy-hello/index.md` with realistic
 *     frontmatter + body that exercises images, lists, headings.
 *   - On collision (`smithy-hello/` already exists), appends `-1`, `-2`,
 *     etc. NEVER overwrites.
 *   - Opens the newly-created file in the active leaf so the user
 *     can immediately publish it.
 *
 * No image asset bundled — the body references an http(s) image so the
 * publish pipeline doesn't see it as a local upload candidate. The
 * sample's purpose is to demonstrate the FRONTMATTER + body shape, not
 * to exercise the upload path (which the Test all button already does).
 */
export async function insertSamplePostCommand(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  const postsRoot = settings.site.postsFolder.replace(/\/+$/, '');

  if (!postsRoot) {
    new Notice('Set the Posts folder in Smithy settings first');
    return;
  }

  await ensureFolder(app, postsRoot);

  const slug = await pickAvailableSlug(app, postsRoot, 'smithy-hello');
  const bundleDir = `${postsRoot}/${slug}`;
  const indexPath = `${bundleDir}/index.md`;

  await ensureFolder(app, bundleDir);

  const now = new Date();
  const body = buildSampleBody(slug, now);
  const file = await app.vault.create(indexPath, body);

  // Open in the active leaf so the user lands inside the post.
  const leaf = app.workspace.getLeaf(false);

  await leaf.openFile(file);

  new Notice(`Sample post created at ${indexPath}`, 6000);
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);

  if (existing instanceof TFolder) return;
  if (existing instanceof TFile) {
    throw new Error(`Expected folder at ${path}, found a file`);
  }
  await app.vault.createFolder(path);
}

async function pickAvailableSlug(
  app: App,
  postsRoot: string,
  base: string,
): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const path = `${postsRoot}/${candidate}`;

    if (!app.vault.getAbstractFileByPath(path)) return candidate;
  }
  // Improbable — but fail loud if we get here so the user can clean up.
  throw new Error('Could not find a free slug after 50 attempts');
}

function buildSampleBody(slug: string, now: Date): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;

  return [
    '+++',
    'title = "Hello, Smithy"',
    `date = ${date}`,
    'draft = true',
    'description = "A sample post to verify your Smithy setup end-to-end."',
    'tags = ["smithy", "hello"]',
    'cover = ""',
    '+++',
    '',
    '# Hello, Smithy',
    '',
    "This is a sample post Smithy created so you can test the publish flow before writing your first real article. Once you're confident everything works, delete this folder.",
    '',
    '## What to try',
    '',
    '- Drop an image into this folder — Smithy will upload it to your S3 bucket on publish.',
    '- Reference an image like `![alt](my-image.png)` or `![[my-image.png]]`. Both work.',
    "- Add `cover = \"my-image.png\"` to the frontmatter above — Smithy will upload that too and rewrite the URL.",
    '- Hit **Mod+Shift+P** (Cmd on Mac, Ctrl elsewhere) to publish.',
    '',
    '## Things to know',
    '',
    "1. Smithy talks to GitHub's REST API, so the same publish hotkey works on desktop AND iPhone.",
    '2. Attachments go to S3, NOT into your git repo — keeps the repo light.',
    '3. The status bar at the bottom shows publish state for whichever post is active.',
    '',
    '> If something fails, the publish modal explains what went wrong. Most issues come from missing token permissions — re-run "Test all" in settings to verify.',
    '',
    `Slug: \`${slug}\``,
    '',
  ].join('\n');
}
