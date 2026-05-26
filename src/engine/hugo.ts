import type { EngineAdapter, PluginSettings } from '../types';

/**
 * Hugo engine adapter.
 *
 * Conventions:
 *   - Posts live at `<postsFolder>/<slug>/index.md` (page bundles).
 *   - Permalink follows Hugo's default `/<section>/<slug>/`. v1 assumes
 *     `posts` is the section name (the most common Hugo blog layout).
 *
 * If the user's Hugo site uses a different permalink scheme, they can
 * override siteBaseUrl and we'll build URLs against that — the
 * `/posts/<slug>/` path component remains identical to the default.
 */

export const HugoEngine: EngineAdapter = {
  id: 'hugo',

  permalinkFor(postFilePath: string, settings: PluginSettings): string {
    const slug = slugFromPostPath(postFilePath, settings.site.postsFolder);

    if (!slug) return '';

    const base = settings.site.siteBaseUrl.replace(/\/+$/, '');
    const path = `/posts/${slug}/`;

    return base ? `${base}${path}` : path;
  },

  scaffoldPost({ title, date, draft }) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateLine = `${yyyy}-${mm}-${dd}`;

    // Default TOML frontmatter — the most portable shape across Hugo themes.
    return [
      '+++',
      `title = "${escapeQuotes(title)}"`,
      `date = ${dateLine}`,
      `draft = ${draft}`,
      'tags = []',
      'description = ""',
      '+++',
      '',
      '',
    ].join('\n');
  },
};

/**
 * Extract `<slug>` from `<postsFolder>/<slug>/index.md`.
 * Returns empty string if the path doesn't match the expected layout.
 */
export function slugFromPostPath(
  postFilePath: string,
  postsFolder: string,
): string {
  const root = postsFolder.replace(/\/+$/, '') + '/';

  if (!postFilePath.startsWith(root)) return '';
  const rel = postFilePath.slice(root.length);
  // rel is `<slug>/index.md` (or other filename inside the slug folder).
  const firstSlash = rel.indexOf('/');

  if (firstSlash < 0) {
    // No subfolder — strip a trailing .md and return the basename.
    return rel.replace(/\.md$/i, '');
  }

  return rel.slice(0, firstSlash);
}

function escapeQuotes(s: string): string {
  return s.replaceAll('"', '\\"');
}
