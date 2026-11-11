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

/** Outbound fetch budget; matches the 30s convention for external vendor APIs (jdy). */
const BITBUCKET_FETCH_TIMEOUT_MS = 30_000;

/** Default max_depth for recursive tree walks; 999 covers any reasonable repo. */
const BITBUCKET_TREE_MAX_DEPTH = 999;

/** Page size for paginated Bitbucket endpoints; matches the default (10). */
const BITBUCKET_PAGELEN = 100;

/** One commit as surfaced by the read-only repository accessors (mirrors GitHubService). */
export interface RepositoryCommit {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: Date | null;
}

/** One node of a Git tree (mirrors GitHubService). */
export interface RepositoryTreeEntry {
  path: string;
  /** Git object type: `blob` (file), `tree` (directory) or `commit` (submodule). */
  type: string;
  sha: string;
  size: number | null;
}

/** A Git tree plus a truncation flag. */
export interface RepositoryTree {
  entries: RepositoryTreeEntry[];
  truncated: boolean;
}

/**
 * Map Bitbucket source entry types to the generic Git vocabulary used by
 * the rest of the platform. Host-side consumers switch on `"blob"` /
 * `"tree"` / `"commit"`; Bitbucket returns `"commit_file"` /
 * `"commit_directory"` / `"commit"` for submodules.
 */
function bitbucketEntryTypeToGit(type: string): string {
  switch (type) {
    case "commit_file":
      return "blob";
    case "commit_directory":
      return "tree";
    case "commit":
      return "commit"; // submodule
    default:
      return type; // pass through unknown types as-is
  }
}

/**
 * A single page of paginated Bitbucket results. The `next` URL is absolute
 * and can be followed directly.
 */
interface BitbucketPaginatedResponse<T> {
  values: T[];
  next?: string;
  page?: number;
  pagelen?: number;
  size?: number;
}

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
   * Read a UTF-8 text file at a given ref. Defaults to HEAD. Returns null
   * when the path does not exist (404) or is not a regular file; other API
   * failures throw so a broken credential stays visible instead of reading
   * as "no material".
   */
  async getFileContent(workspace: string, repo: string, path: string, ref = "HEAD"): Promise<string | null> {
    if (!this.accessToken) throw new BitbucketNotConfiguredError();
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const encodedRef = encodeURIComponent(ref);
    const url = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src/${encodedRef}/${encodedPath}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(BITBUCKET_FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Bitbucket API ${response.status} for ${url}: ${text.slice(0, 300)}`);
    }
    return response.text();
  }

  /**
   * Read one commit's metadata by ref (branch name, tag or SHA). Returns
   * null on 404 (unknown repo/ref); other failures throw. Mirrors
   * GitHubService.getCommit so host code can treat both services as
   * interchangeable for the CODE_SCAN snapshot pin.
   */
  async getCommit(workspace: string, repo: string, ref: string): Promise<RepositoryCommit | null> {
    if (!this.accessToken) throw new BitbucketNotConfiguredError();
    const url = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(ref)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(BITBUCKET_FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Bitbucket API ${response.status} for ${url}: ${text.slice(0, 300)}`);
    }
    const json = (await response.json()) as {
      hash: string;
      message?: string;
      date?: string;
      author?: { raw?: string; user?: { display_name?: string; nickname?: string } } | string;
    };

    // Bitbucket author is either a raw string like "Name <email>" or a struct
    // with raw + user. Prefer the parsed pieces when available.
    let authorName: string | null = null;
    let authorEmail: string | null = null;
    if (typeof json.author === "string") {
      const parsed = this.parseAuthorRaw(json.author);
      authorName = parsed.name;
      authorEmail = parsed.email;
    } else if (json.author) {
      if (json.author.user?.display_name) authorName = json.author.user.display_name;
      else if (json.author.user?.nickname) authorName = json.author.user.nickname;
      const parsed = this.parseAuthorRaw(json.author.raw ?? "");
      authorEmail = parsed.email;
    }

    return {
      sha: json.hash,
      message: json.message ?? "",
      authorName,
      authorEmail,
      committedAt: json.date ? new Date(json.date) : null,
    };
  }

  /** Parse "Name <email@domain>" into { name, email }; missing parts yield null. */
  private parseAuthorRaw(raw: string): { name: string | null; email: string | null } {
    const m = raw.match(/^(.+?)\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim() || null, email: m[2] || null };
    // No angle brackets — treat the whole thing as name if non-empty.
    return { name: raw.trim() || null, email: null };
  }

  /**
   * Read the Git tree at `ref` (branch, tag or commit sha). `recursive` walks
   * subdirectories; Bitbucket's API uses `max_depth=N` for this. Returns null
   * on 404 (unknown repo/ref); a `truncated` flag is set when the walk hits
   * the hard Bitbucket timeout (555) or max_depth ceiling so the caller can
   * surface an honest partial-scan warning instead of silently reporting a
   * clean result.
   *
   * Mirrors GitHubService.getTree so the host's CODE_SCAN snapshot walker
   * treats both services as interchangeable.
   */
  async getTree(workspace: string, repo: string, ref: string, recursive = false): Promise<RepositoryTree | null> {
    if (!this.accessToken) throw new BitbucketNotConfiguredError();

    // Start at the repo root. Bitbucket requires a trailing slash when
    // listing the root directory.
    const entries: RepositoryTreeEntry[] = [];
    let truncated = false;
    let nextUrl: string | undefined = this.buildTreePageUrl(workspace, repo, ref, recursive);

    while (nextUrl) {
      let response: Response;
      try {
        response = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          signal: AbortSignal.timeout(BITBUCKET_FETCH_TIMEOUT_MS),
        });
      } catch (error) {
        // Timeout from too-large max_depth or network failure — surface as
        // truncation so the caller knows it didn't get the full tree.
        if (error instanceof DOMException && error.name === "TimeoutError") {
          this.logger.warn(`Bitbucket tree walk timed out for ${workspace}/${repo}@${ref}; marking as truncated`);
          truncated = true;
          break;
        }
        throw error;
      }

      if (response.status === 404) return null;
      if (response.status === 555) {
        // Bitbucket's "max_depth too large" timeout.
        this.logger.warn(`Bitbucket returned 555 for tree walk of ${workspace}/${repo}@${ref}; marking as truncated`);
        truncated = true;
        break;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Bitbucket API ${response.status} for ${nextUrl}: ${text.slice(0, 300)}`);
      }

      const page = (await response.json()) as BitbucketPaginatedResponse<{
        path: string;
        type: string;
        commit?: { hash?: string };
        size?: number;
      }>;

      for (const value of page.values) {
        entries.push({
          path: value.path,
          type: bitbucketEntryTypeToGit(value.type),
          sha: value.commit?.hash ?? "",
          size: typeof value.size === "number" ? value.size : null,
        });
      }

      nextUrl = page.next ?? undefined;
    }

    return { entries, truncated };
  }

  /** Build the first-page URL for a tree listing; follow `next` links after. */
  private buildTreePageUrl(workspace: string, repo: string, ref: string, recursive: boolean): string {
    const base = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src/${encodeURIComponent(ref)}/`;
    const params = new URLSearchParams({ pagelen: String(BITBUCKET_PAGELEN) });
    if (recursive) params.set("max_depth", String(BITBUCKET_TREE_MAX_DEPTH));
    return `${base}?${params.toString()}`;
  }
}
