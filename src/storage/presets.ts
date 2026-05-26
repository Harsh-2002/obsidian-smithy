import type { ProviderPresetId, StorageConfig } from '../types';

/**
 * S3-compatible provider presets — used by the settings UI to pre-fill
 * fields when the user picks a provider. Every field stays editable
 * afterwards (no sealing); the preset is just a starting point.
 *
 * Endpoints often contain a placeholder ({account}, {region}, {bucket}) —
 * the settings UI surfaces these as hints rather than auto-substituting,
 * since the values aren't known at preset-load time.
 */

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  /** Default endpoint with optional {placeholders}. */
  endpoint: string;
  /** Default region or sentinel like "auto". */
  region: string;
  forcePathStyle: boolean;
  /** Suggested public URL pattern shown as a hint in the UI. */
  publicUrlHint: string;
  /** True if the provider supports the S3 `x-amz-acl: public-read` header. */
  supportsACL: boolean;
  /** Free-form note shown under the provider dropdown. */
  note?: string;
}

export const PROVIDER_PRESETS: Record<ProviderPresetId, ProviderPreset> = {
  cloudflare_r2: {
    id: 'cloudflare_r2',
    label: 'Cloudflare R2',
    endpoint: 'https://{account_id}.r2.cloudflarestorage.com',
    region: 'auto',
    forcePathStyle: false,
    publicUrlHint: 'https://<your-cdn-domain>/',
    supportsACL: false,
    note:
      'R2 ignores ACL headers; access is controlled per-bucket via the ' +
      'Cloudflare dashboard.',
  },
  aws_s3: {
    id: 'aws_s3',
    label: 'Amazon S3',
    endpoint: 'https://s3.{region}.amazonaws.com',
    region: 'us-east-1',
    forcePathStyle: false,
    publicUrlHint: 'https://{bucket}.s3.{region}.amazonaws.com/',
    supportsACL: true,
  },
  digitalocean_spaces: {
    id: 'digitalocean_spaces',
    label: 'DigitalOcean Spaces',
    endpoint: 'https://{region}.digitaloceanspaces.com',
    region: 'nyc3',
    forcePathStyle: false,
    publicUrlHint: 'https://{bucket}.{region}.cdn.digitaloceanspaces.com/',
    supportsACL: true,
  },
  wasabi: {
    id: 'wasabi',
    label: 'Wasabi',
    endpoint: 'https://s3.{region}.wasabisys.com',
    region: 'us-east-1',
    forcePathStyle: false,
    publicUrlHint: 'https://s3.{region}.wasabisys.com/{bucket}/',
    supportsACL: true,
  },
  backblaze_b2: {
    id: 'backblaze_b2',
    label: 'Backblaze B2',
    endpoint: 'https://s3.{region}.backblazeb2.com',
    region: 'us-west-002',
    forcePathStyle: false,
    publicUrlHint: 'https://f002.backblazeb2.com/file/{bucket}/',
    supportsACL: false,
    note: 'Use the S3-compatible endpoint. Bucket must be set to "public".',
  },
  minio: {
    id: 'minio',
    label: 'MinIO',
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    publicUrlHint: 'http://localhost:9000/{bucket}/',
    supportsACL: true,
    note: 'Custom self-hosted endpoint. Path-style addressing required.',
  },
  custom: {
    id: 'custom',
    label: 'Custom (S3-compatible)',
    endpoint: '',
    region: '',
    forcePathStyle: false,
    publicUrlHint: '',
    supportsACL: true,
  },
};

/**
 * Apply a preset's defaults to a StorageConfig, preserving user-set values
 * for bucket / publicUrlBase / accessKeyIdSecret / secretAccessKeySecret /
 * pathTemplate — those are not provider-specific.
 */
export function applyPreset(
  current: StorageConfig,
  preset: ProviderPresetId,
): StorageConfig {
  const p = PROVIDER_PRESETS[preset];

  return {
    ...current,
    preset,
    endpoint: p.endpoint,
    region: p.region,
    forcePathStyle: p.forcePathStyle,
  };
}
