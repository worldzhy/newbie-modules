import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseRepositorySlug } from "@devbie/newbie/utilities/repository-url.util";

/**
 * Thrown when the service has no usable credentials. Callers should gate on
 * `isConfigured()`; this error is the fail-safe for code paths that reach the
 * HTTP layer without it.
 */
export class BitbucketNotConfiguredError extends Error {
  constructor() {
    super("Bitbucket access token is not configured");
    this.name = "BitbucketNotConfiguredError";
  }
}

const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

@Injectable()
export class BitbucketService {
  private readonly logger = new Logger(BitbucketService.name);

  private readonly accessToken?: string;

  constructor(private readonly config: ConfigService) {
    const bitbucket = this.config.getOrThrow("modules.bitbucket");
    this.accessToken = bitbucket.accessToken;

    if (this.accessToken) {
      this.logger.log("Bitbucket service configured (workspace access token)");
    } else {
      this.logger.warn("Bitbucket access token not configured");
    }
  }

  /** Whether a workspace access token is present to call the Bitbucket API. */
  isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  /**
   * Parse a Bitbucket repository URL into `{ workspace, repo }`. Accepts the
   * HTTPS and SSH forms, with or without a trailing `.git`/slash:
   *   https://bitbucket.org/<workspace>/<repo>(.git)(/)
   *   git@bitbucket.org:<workspace>/<repo>(.git)
   * Returns null for anything else (non-Bitbucket hosts, deeper paths, garbage).
   */
  parseBitbucketUrl(url: string): { workspace: string; repo: string } | null {
    const slug = parseRepositorySlug(url);
    if (!slug) return null;
    if (!/bitbucket\.org/.test(url)) return null;
    return { workspace: slug.owner, repo: slug.repo };
  }

  /**
   * Read a UTF-8 text file at HEAD. Returns null when the path does not exist
   * (404) or is not a regular file; other API failures throw so a broken
   * credential stays visible instead of reading as "no material".
   */
  async getFileContent(workspace: string, repo: string, path: string): Promise<string | null> {
    if (!this.accessToken) throw new BitbucketNotConfiguredError();
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src/HEAD/${encodedPath}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Bitbucket API ${response.status} for ${url}: ${text.slice(0, 300)}`);
    }
    return response.text();
  }
}
