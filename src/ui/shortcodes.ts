/**
 * Hugo shortcode snippets surfaced in the snippet picker.
 *
 * Each entry produces a snippet to insert at the cursor; `${cursor}`
 * marks where the caret should land after insertion.
 */

export interface ShortcodeDef {
  id: string;
  label: string;
  description: string;
  /** The body to insert. `${cursor}` is the post-insert cursor position. */
  template: string;
}

export const SHORTCODES: ShortcodeDef[] = [
  {
    id: 'callout',
    label: 'Callout',
    description: 'Boxed info/warn/success/danger note.',
    template:
      '{{< callout type="info" title="${cursor}" >}}\nbody\n{{< /callout >}}',
  },
  {
    id: 'gallery',
    label: 'Gallery',
    description: 'CSS-grid image gallery (pipe-separated srcs).',
    template:
      '{{< gallery cols="3" srcs="${cursor}" >}}',
  },
  {
    id: 'audio',
    label: 'Audio',
    description: 'HTML5 audio player with optional title.',
    template:
      '{{< audio src="${cursor}" title="" >}}',
  },
  {
    id: 'video',
    label: 'Video',
    description: 'HTML5 video player with optional poster.',
    template:
      '{{< video src="${cursor}" poster="" >}}',
  },
  {
    id: 'attachment',
    label: 'Attachment',
    description: 'Download card for any file with a Material icon.',
    template:
      '{{< attachment src="${cursor}" name="" size="" >}}',
  },
  {
    id: 'bookmark',
    label: 'Bookmark',
    description: 'Link-preview card with thumbnail + description.',
    template:
      '{{< bookmark url="${cursor}" title="" description="" image="" >}}',
  },
  {
    id: 'embed',
    label: 'Embed',
    description: 'Sandboxed iframe (videos, demos).',
    template:
      '{{< embed src="${cursor}" height="480" >}}',
  },
];
