import { BadRequestException } from "@nestjs/common";

/**
 * `appKey` is a storage partition key: it becomes part of Mongo collection
 * names and ClickHouse table names. Restrict it to the identifier-safe set so
 * a malformed value is rejected at the boundary instead of reaching DDL.
 */
export const APP_KEY_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

export function isValidAppKey(appKey: unknown): appKey is string {
  return typeof appKey === "string" && APP_KEY_PATTERN.test(appKey);
}

export function assertAppKey(appKey: unknown): string {
  if (!isValidAppKey(appKey)) {
    throw new BadRequestException("appKey must match ^[A-Za-z0-9_]{1,64}$");
  }
  return appKey;
}

/**
 * Reads a target identifier with the same precedence the authorization guard
 * uses (route params → query → body). A controller must never resolve the
 * write target from a different source than the guard: otherwise a request
 * can be authorized against a project where the caller holds the action
 * (e.g. from `?projectId=A`) while the write lands on another project.
 */
export function pickRequestId(
  req: { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: Record<string, unknown> },
  key: string,
): string | undefined {
  const value = req.params?.[key] ?? req.query?.[key] ?? req.body?.[key];
  return typeof value === "string" && value ? value : undefined;
}

const decryptP: Record<string, number> = {
  QR: 0,
  xa: 1,
  cL: 2,
  pF: 3,
  Oe: 4,
  bn: 5,
  sM: 6,
  yt: 7,
  Uv: 8,
  ik: 9,
};

export const func = {
  isSkipIp(ip?: string) {
    if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.includes("127.0.0.1") || ip.includes("::ffff")) return true;
    return false;
  },
  randomString(len = 7) {
    const $chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz23456789";
    const maxPos = $chars.length;
    let pwd = "";
    for (let i = 0; i < len; i++) {
      pwd += $chars.charAt(Math.floor(Math.random() * maxPos));
    }
    return pwd + Date.now();
  },
  result<T>(jn: Partial<{ code: number; desc: string; data: T; time?: number }> = {}) {
    // return Object.assign({ code: 1000, desc: 'Success', data: '' }, jn);
    return jn.data;
  },
  errResult<T>(jn: Partial<{ code: number; desc: string; data: T; time?: number }> = {}) {
    // return Object.assign({ code: 1010, desc: 'Request failed', data: '' }, jn);
    return jn.data;
  },
  format(date: Date, fmt: string) {
    const o: Record<string, number> = {
      "M+": date.getMonth() + 1,
      "d+": date.getDate(),
      "h+": date.getHours(),
      "H+": date.getHours() > 12 ? date.getHours() - 12 : date.getHours(),
      "m+": date.getMinutes(),
      "s+": date.getSeconds(),
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (date.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (const k in o) {
      if (new RegExp("(" + k + ")").test(fmt)) {
        fmt = fmt.replace(RegExp.$1, RegExp.$1.length === 1 ? String(o[k]) : ("00" + o[k]).substr(("" + o[k]).length));
      }
    }
    return fmt;
  },
  getRealIp(headers: Record<string, string | string[] | undefined>, ip?: string) {
    const realIp = headers["x-real-ip"];
    if (typeof realIp === "string" && realIp) return realIp;
    const forwardedFor = headers["x-forwarded-for"];
    // X-Forwarded-For may be a comma-separated chain ("client, proxy1, ...");
    // the first hop is the original client address.
    if (typeof forwardedFor === "string" && forwardedFor) return forwardedFor.split(",")[0].trim();
    return ip;
  },
  // Simplified: replace pure numeric path segments with *
  urlHelper(raw: unknown) {
    const input = typeof raw === "string" ? raw : String(raw ?? "");
    try {
      const schemeIdx = input.indexOf("://");
      if (schemeIdx !== -1) {
        const pathStart = input.indexOf("/", schemeIdx + 3);
        if (pathStart === -1) return input;
        const head = input.slice(0, pathStart);
        const path = input.slice(pathStart).replace(/\/\d+\b/g, "/*");
        return head + path;
      }
      return input.replace(/\/\d+\b/g, "/*");
    } catch {
      return input;
    }
  },
  // Added: object check (arrays included)
  isObject(input: unknown): input is Record<string, unknown> {
    return input !== null && typeof input === "object";
  },
  // Coerce an untyped ingest value to Date; numeric values are epoch ms.
  toDate(value: unknown) {
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    return new Date(String(value));
  },
  // Client-supplied timestamps must never poison the drain: an unparseable
  // value falls back to the ingest time instead of becoming `Invalid Date`,
  // which would make every store write fail and requeue the raw item forever.
  // A digits-only string is an epoch timestamp, not a date string: parsing it
  // with `Date` would silently fall back to now (R10-02).
  //
  // Range caveat (R20-32): ClickHouse DateTime is an unsigned 32-bit
  // epoch-seconds column bounded by 1970-01-01 and 2106-02-07. Values outside
  // that range are silently clamped by the writer, not rejected — a 1900 date
  // lands on 1970-01-01, a 2107 date on 2106-02-07. No application-level
  // guard exists or is planned; treat out-of-range dates as a display concern.
  toDateOrNow(value: unknown) {
    const date =
      value instanceof Date
        ? value
        : typeof value === "number"
          ? new Date(value)
          : typeof value === "string" && /^\d+$/.test(value)
            ? new Date(Number(value))
            : new Date(String(value));
    return Number.isNaN(date.getTime()) ? new Date() : date;
  },
  // Coerce a client-supplied numeric field to a finite number; anything else
  // (NaN, Infinity, non-numeric string, object) returns undefined so the
  // caller can decide whether to skip writing the field entirely. Skipping
  // is preferred over writing 0 because Mongo's $avg skips missing keys but
  // includes explicit zeros — a poisoned "abc" must never drag the average down.
  toNumberOrUndefined(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  },
  // Coerce a client-supplied field to a string; objects are JSON-stringified,
  // anything else returns undefined so the caller can skip writing the field.
  toStringOrUndefined(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return undefined;
      }
    }
    return undefined;
  },
  filterKeyWord(input: unknown) {
    try {
      return typeof input === "string" ? input : JSON.stringify(input);
    } catch {
      return "";
    }
  },
  // Client-supplied search text must never be compiled as a pattern: an
  // unescaped value turns a user filter into a regex (Mongo server-side ReDoS
  // for `$regex`, Node-side ReDoS for `new RegExp`). See R15-02/R5-P2-05.
  escapeRegExp(input: unknown) {
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },
  decryptPhone(str: unknown) {
    if (typeof str !== "string") return str;
    const out: string[] = [];
    let pair = "";
    for (const item of str.split("")) {
      pair += item;
      if (pair.length === 2) {
        const digit = decryptP[pair];
        pair = "";
        // An unknown pair means the payload is not a valid encoded phone: fail
        // the whole value instead of returning a silently truncated number.
        if (digit === undefined) return undefined;
        out.push(String(digit));
      }
    }
    // A dangling odd character can never form a pair, so the value is invalid.
    if (pair.length) return undefined;
    return out.join("");
  },
  setMatchTime(query: Record<string, unknown>, $match: Record<string, unknown>) {
    const createTime: Record<string, unknown> = {};
    if (query.beginTime) {
      createTime.$gte = new Date(String(query.beginTime));
      $match.createTime = createTime;
    }
    if (query.endTime) {
      createTime.$lte = new Date(String(query.endTime));
      $match.createTime = createTime;
    }
  },
};

const ips = ["118.112.75.70", "119.57.35.106", "221.231.219.26", "140.206.142.182"];
export const getRandomIp = () => ips[Math.floor(Math.random() * ips.length)];

// Run an async worker over items with a bounded number of in-flight tasks so a
// large list cannot stampede downstream stores (Mongo/ClickHouse) at once.
export const mapWithConcurrency = async <T>(
  items: T[],
  concurrencyLimit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  let nextIndex = 0;
  const limit = Math.min(Math.max(Math.floor(concurrencyLimit) || 1, 1), items.length);
  const workers = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  });
  await Promise.all(workers);
};
