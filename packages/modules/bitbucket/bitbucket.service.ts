import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Thrown when the service has no usable credentials. Callers should gate on
 * `isConfigured()`; this error is the fail-safe for code paths that reach the
 * HTTP layer without it.
 */
export class BitbucketNotConfiguredError extends Error {
  constructor() {
    super("Bitbucket credentials are not configured (no workspace access token nor OAuth consumer)");
    this.name = "BitbucketNotConfiguredError";
  }
}

const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";
const BITBUCKET_TOKEN_URL = "https://bitbucket.org/site/oauth2/access_token";

@Injectable()
export class BitbucketService {
  private readonly logger = new Logger(BitbucketService.name);

  private readonly workspace?: string;
  private readonly accessToken?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;

  /** Cached workspace access token (minted from the OAuth consumer) + expiry. */
  private mintedToken?: { token: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {
    const config = this.config.getOrThrow("modules.bitbucket");
    this.workspace = config.workspace;
    this.accessToken = config.accessToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    if (this.workspace && (this.accessToken || (this.clientId && this.clientSecret))) {
      this.logger.log(`Bitbucket service configured for workspace "${this.workspace}"`);
    } else {
      this.logger.warn("Bitbucket credentials not configured");
    }
  }

  /** Whether enough credentials are present to call the Bitbucket API. */
  isConfigured(): boolean {
    return Boolean(this.workspace && (this.accessToken || (this.clientId && this.clientSecret)));
  }

  /**
   * Parse a Bitbucket repository URL into `{ workspace, repo }`. Accepts the
   * HTTPS and SSH forms, with or without a trailing `.git`/slash:
   *   https://bitbucket.org/<workspace>/<repo>(.git)(/)
   *   git@bitbucket.org:<workspace>/<repo>(.git)
   * Returns null for anything else (non-Bitbucket hosts, deeper paths, garbage).
   */
  parseBitbucketUrl(url: string): { workspace: string; repo: string } | null {
    const match = url.trim().match(/bitbucket\.org[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (!match) return null;
    return { workspace: match[1], repo: match[2] };
  }

  /**
   * Read a UTF-8 text file at HEAD. Returns null when the path does not exist
   * (404) or is not a regular file; other API failures throw so a broken
   * credential stays visible instead of reading as "no material".
   */
  async getFileContent(workspace: string, repo: string, path: string): Promise<string | null> {
    const token = await this.bearerToken();
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src/HEAD/${encodedPath}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Bitbucket API ${response.status} for ${url}: ${text.slice(0, 300)}`);
    }
    return response.text();
  }

  // --- HTTP helpers ------------------------------------------------------

  /**
   * Resolves the bearer token: a static workspace access token when provided,
   * otherwise a token minted from the OAuth consumer (cached until expiry).
   */
  private async bearerToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (this.clientId && this.clientSecret) {
      if (this.mintedToken && this.mintedToken.expiresAt > Date.now() + 60_000) {
        return this.mintedToken.token;
      }
      const token = await this.mintWorkspaceToken();
      this.mintedToken = token;
      return token.token;
    }
    throw new BitbucketNotConfiguredError();
  }

  private async mintWorkspaceToken(): Promise<{ token: string; expiresAt: number }> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "urn:bitbucket:oauth2:workspace_access_token",
      workspace: this.workspace ?? "",
    });
    const response = await fetch(BITBUCKET_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Bitbucket token mint ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    return {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}
