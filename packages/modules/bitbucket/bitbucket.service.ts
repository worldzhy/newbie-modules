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
    super("Bitbucket credentials are not configured (no workspace access token nor personal API token pair)");
    this.name = "BitbucketNotConfiguredError";
  }
}

const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

/** Outbound fetch budget; matches the 30s convention for external vendor APIs. */
const BITBUCKET_FETCH_TIMEOUT_MS = 30_000;

/** Default max_depth for recursive tree walks; 999 covers any reasonable repo. */
const BITBUCKET_TREE_MAX_DEPTH = 999;

/** Page size for paginated Bitbucket endpoints; matches the default (100). */
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

/** Repository metadata read through the platform credentials. */
export interface RepositoryInfo {
  /** `workspace/repo` as Bitbucket reports it. */
  fullName: string;
  cloneUrl: string;
  /** null when the repository is empty (no commits, hence no main branch). */
  defaultBranch: string | null;
  private: boolean;
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

/** A single page of paginated Bitbucket results. The `next` URL is absolute. */
interface BitbucketPaginatedResponse<T> {
  values: T[];
  next?: string;
  page?: number;
  pagelen?: number;
  size?: number;
}

/**
 * Bitbucket Cloud accepts two mutually-exclusive credential forms:
 *   - Workspace/Project/Repository access tokens → Bearer (single token value)
 *   - Personal API tokens → Basic HTTP Auth (email + api_token, base64)
 *
 * Precedence: if both are configured the Bearer form wins because access
 * tokens are the service-identity form (no personal tie, longer expiry).
 */
type AuthConfig =
  { kind: "bearer"; token: string } | { kind: "basic"; email: string; apiToken: string } | { kind: "none" };

@Injectable()
export class BitbucketService {
  private readonly logger = new Logger(BitbucketService.name);

  private readonly auth: AuthConfig;

  constructor(private readonly config: ConfigService) {
    const bitbucket = this.config.getOrThrow("modules.bitbucket");
    const workspaceToken: string | undefined = bitbucket.accessToken;
    const apiEmail: string | undefined = bitbucket.apiEmail;
    const apiToken: string | undefined = bitbucket.apiToken;

    if (workspaceToken) {
      this.auth = { kind: "bearer", token: workspaceToken };
      this.logger.log("Bitbucket service configured (workspace access token, Bearer auth)");
    } else if (apiEmail && apiToken) {
      this.auth = { kind: "basic", email: apiEmail, apiToken };
      this.logger.log(`Bitbucket service configured (personal API token for ${apiEmail}, Basic auth)`);
    } else {
      this.auth = { kind: "none" };
      this.logger.warn(
        "Bitbucket credentials not configured: set BITBUCKET_ACCESS_TOKEN (workspace token) or BITBUCKET_API_EMAIL + BITBUCKET_API_TOKEN (personal API token)",
      );
    }
  }

  /** Whether any usable credentials are present to call the Bitbucket API. */
  isConfigured(): boolean {
    return this.auth.kind !== "none";
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

  /** Build the Authorization header value from the configured credential form. */
  private authorizationHeader(): string {
    switch (this.auth.kind) {
      case "bearer":
        return `Bearer ${this.auth.token}`;
      case "basic": {
        const raw = `${this.auth.email}:${this.auth.apiToken}`;
        // Node Buffer is available globally in NestJS; avoid pulling an extra import.
        return `Basic ${Buffer.from(raw).toString("base64")}`;
      }
      default:
        throw new BitbucketNotConfiguredError();
    }
  }

  /** Shared fetch wrapper: injects auth header + timeout + consistent error mapping. */
  private async apiFetch(
    url: string,
    opts: { accept404?: boolean; tolerateStatus?: number[] } = {},
  ): Promise<Response> {
    if (this.auth.kind === "none") throw new BitbucketNotConfiguredError();
    const response = await fetch(url, {
      headers: {
        Authorization: this.authorizationHeader(),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(BITBUCKET_FETCH_TIMEOUT_MS),
    });
    if (opts.accept404 && response.status === 404) return response;
    if (opts.tolerateStatus?.includes(response.status)) return response;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Bitbucket API ${response.status} for ${url}: ${text.slice(0, 300)}`);
    }
    return response;
  }

  /**
   * Read a UTF-8 text file at a given ref. Defaults to HEAD. Returns null
   * when the path does not exist (404) or is not a regular file; other API
   * failures throw so a broken credential stays visible instead of reading
   * as "no material".
   */
  async getFileContent(workspace: string, repo: string, path: string, ref = "HEAD"): Promise<string | null> {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const encodedRef = encodeURIComponent(ref);
    const url = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src/${encodedRef}/${encodedPath}`;
    const response = await this.apiFetch(url, { accept404: true });
    if (response.status === 404) return null;
    return response.text();
  }

  /**
   * Repository metadata as visible to the configured credential, or null on
   * 404 (absent, or invisible to the token); other failures throw.
   */
  async getRepository(workspace: string, repo: string): Promise<RepositoryInfo | null> {
    const url = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}`;
    const response = await this.apiFetch(url, { accept404: true });
    if (response.status === 404) return null;

    const json = (await response.json()) as {
      full_name?: string;
      is_private?: boolean;
      mainbranch?: { name?: string } | null;
      links?: { clone?: { href?: string }[] } | null;
    };
    return {
      fullName: json.full_name ?? `${workspace}/${repo}`,
      cloneUrl: json.links?.clone?.[0]?.href ?? `https://bitbucket.org/${workspace}/${repo}.git`,
      defaultBranch: json.mainbranch?.name ?? null,
      private: json.is_private ?? false,
    };
  }

  /**
   * Read one commit's metadata by ref (branch name, tag or SHA). Returns
   * null on 404 (unknown repo/ref); other failures throw. Mirrors
   * GitHubService.getCommit so host code can treat both services as
   * interchangeable for the CODE_SCAN snapshot pin.
   */
  async getCommit(workspace: string, repo: string, ref: string): Promise<RepositoryCommit | null> {
    const url = `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(ref)}`;
    const response = await this.apiFetch(url, { accept404: true });
    if (response.status === 404) return null;

    const json = (await response.json()) as {
      hash: string;
      message?: string;
      date?: string;
      author?: { raw?: string; user?: { display_name?: string; nickname?: string } } | string;
    };

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
    // Start at the repo root. Bitbucket requires a trailing slash when
    // listing the root directory.
    const entries: RepositoryTreeEntry[] = [];
    let truncated = false;
    let nextUrl: string | undefined = this.buildTreePageUrl(workspace, repo, ref, recursive);

    while (nextUrl) {
      let response: Response;
      try {
        response = await this.apiFetch(nextUrl, { accept404: true, tolerateStatus: [555] });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          this.logger.warn(`Bitbucket tree walk timed out for ${workspace}/${repo}@${ref}; marking as truncated`);
          truncated = true;
          break;
        }
        throw error;
      }

      if (response.status === 404) return null;

      // apiFetch already throws on !ok, so we know it's 2xx here — except
      // 555, Bitbucket's "max_depth too large" timeout which we want to
      // tolerate as truncation rather than fail the whole run.
      if (response.status === 555) {
        this.logger.warn(`Bitbucket returned 555 for tree walk of ${workspace}/${repo}@${ref}; marking as truncated`);
        truncated = true;
        break;
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
