/**
 * Thin fetch wrapper shared by all source adapters.
 *
 * Centralizes timeout, error normalization, and JSON parsing so individual
 * adapters stay focused on payload mapping. Uses the platform `fetch`
 * (available in Node 18+) to avoid adding an HTTP client dependency.
 */

const DEFAULT_TIMEOUT_MS = 15000;

export class SourceHttpError extends Error {
  constructor(
    public readonly source: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

export async function fetchJson<T>(
  source: string,
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options?.method ?? "GET",
      headers: options?.headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SourceHttpError(source, response.status, `${source} request failed with HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SourceHttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SourceHttpError(source, 0, `${source} request timed out after ${timeoutMs}ms.`);
    }
    throw new SourceHttpError(
      source,
      0,
      `${source} request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(
  source: string,
  url: string,
  options?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: options?.headers, signal: controller.signal });
    if (!response.ok) {
      throw new SourceHttpError(source, response.status, `${source} request failed with HTTP ${response.status}.`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof SourceHttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SourceHttpError(source, 0, `${source} request timed out after ${timeoutMs}ms.`);
    }
    throw new SourceHttpError(
      source,
      0,
      `${source} request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
