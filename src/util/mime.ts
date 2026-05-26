/**
 * Tiny extension → MIME-type map.
 *
 * Scoped to the file types a blog typically references — images, video,
 * audio, common documents. Anything not in the table gets the safe default
 * `application/octet-stream`. S3 happily accepts that; browsers will fall
 * back to "download" rather than "render in tab", which is fine for the
 * "attachment" shortcode use case anyway.
 */

const TYPES: Record<string, string> = {
  // images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  // video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  // documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  // archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

export function mimeFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');

  if (dot < 0) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();

  return TYPES[ext] ?? 'application/octet-stream';
}
