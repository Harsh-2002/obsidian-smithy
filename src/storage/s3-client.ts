import { AwsClient } from 'aws4fetch';

import type { StorageConfig } from '../types';

/**
 * S3-compatible client.
 *
 * Uses Cloudflare's `aws4fetch` for SigV4 signing — pure browser, ~2KB,
 * works identically on desktop Electron and mobile WebView. No Node
 * dependencies.
 *
 * The instance is cheap; settings tab can recreate one per "Test upload"
 * click without performance concern.
 */

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3Client {
  private awsClient: AwsClient;

  constructor(
    private readonly config: StorageConfig,
    creds: S3Credentials,
  ) {
    if (!config.endpoint) {
      throw new Error('S3 endpoint is not configured');
    }
    if (!creds.accessKeyId || !creds.secretAccessKey) {
      throw new Error('S3 credentials are not configured');
    }

    this.awsClient = new AwsClient({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      service: 's3',
      region: config.region || 'us-east-1',
    });
  }

  /**
   * PUT an object to the configured bucket. Returns nothing on success;
   * throws on any non-2xx response with the body included for diagnosis.
   */
  async putObject(
    key: string,
    body: ArrayBuffer,
    contentType: string,
  ): Promise<void> {
    const url = this.buildObjectUrl(key);

    const res = await this.awsClient.fetch(url, {
      method: 'PUT',
      body,
      headers: {
        'Content-Type': contentType,
        // Public-read ACL — providers that don't honor it (R2, B2) ignore
        // safely. AWS S3 and DO Spaces respect it.
        'x-amz-acl': 'public-read',
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');

      throw new Error(
        `S3 PUT failed (${res.status} ${res.statusText}) for key "${key}": ${
          errText || '<empty body>'
        }`,
      );
    }
  }

  /**
   * HEAD an object — used by "Test upload" to confirm round-trip without
   * downloading the body. Returns true if the object exists.
   */
  async objectExists(key: string): Promise<boolean> {
    const url = this.buildObjectUrl(key);
    const res = await this.awsClient.fetch(url, { method: 'HEAD' });

    return res.ok;
  }

  /**
   * Build the URL for an object. Path-style vs virtual-hosted-style is a
   * provider-specific choice; presets carry the right flag.
   *
   *   path-style (MinIO, some custom):
   *     {endpoint}/{bucket}/{key}
   *   virtual-hosted-style (AWS S3, R2 with custom hostname, DO Spaces):
   *     {endpoint with bucket baked in via custom hostname} OR
   *     standard "{bucket}.{endpoint-host}/{key}" if endpoint is a
   *     bare regional host.
   *
   * For simplicity and S3 compatibility across providers, we use:
   *   path-style:        {endpoint}/{bucket}/{encodedKey}
   *   virtual-hosted:    {endpoint}/{encodedKey}   (R2 with custom domain
   *                      uses a bucket-specific endpoint already)
   *
   * R2 endpoints look like `https://<account>.r2.cloudflarestorage.com`
   * and accept either form; we emit path-style there for consistency
   * (it works for every provider).
   */
  private buildObjectUrl(key: string): string {
    const ep = this.config.endpoint.replace(/\/+$/, '');
    const encoded = encodeKeyForUrl(key);

    if (this.config.forcePathStyle) {
      return `${ep}/${this.config.bucket}/${encoded}`;
    }

    // Default: path-style on the provided endpoint. This is the most
    // compatible variant — AWS S3 also accepts it.
    return `${ep}/${this.config.bucket}/${encoded}`;
  }
}

/**
 * Encode an S3 object key for inclusion in a URL. We preserve slashes (path
 * separators) and percent-encode the segments.
 */
function encodeKeyForUrl(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Build the final public CDN URL for an uploaded object.
 *
 * `publicUrlBase` is configured by the user and may or may not end with `/`;
 * we normalize.
 */
export function publicUrlFor(publicUrlBase: string, key: string): string {
  const base = publicUrlBase.replace(/\/+$/, '');
  const encoded = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  return `${base}/${encoded}`;
}
