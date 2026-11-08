import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { Prisma, Webhook } from "@generated/prisma/client";
import pQueue from "p-queue";
import pRetry from "p-retry";
import axios from "axios";
import { UNAUTHORIZED_RESOURCE, WEBHOOK_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/// Delivery retries per webhook call (ADR-033: a tuning knob nobody tuned
/// stays code, not environment surface).
const WEBHOOK_RETRIES = 3;

/// A target that accepts the connection but never responds must not occupy the
/// delivery queue indefinitely; retries then fail the webhook like any other
/// transport error (R20-15).
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Address ranges that must never be reachable from a user-supplied webhook.
 * Mirrors the url-monitor SSRF guard: loopback, private, link-local (cloud
 * metadata), shared address space, multicast and reserved blocks.
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<{ base: number; prefix: number }> = [
  { base: 0x00000000, prefix: 8 }, // "this network"
  { base: 0x0a000000, prefix: 8 }, // private
  { base: 0x64400000, prefix: 10 }, // shared address space
  { base: 0x7f000000, prefix: 8 }, // loopback
  { base: 0xa9fe0000, prefix: 16 }, // link-local (cloud metadata)
  { base: 0xac100000, prefix: 12 }, // private
  { base: 0xc0a80000, prefix: 16 }, // private
  { base: 0xe0000000, prefix: 4 }, // multicast
  { base: 0xf0000000, prefix: 4 }, // reserved
];

function parseIpv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** True when the address (brackets already stripped) is not publicly routable. */
function isBlockedAddress(rawAddress: string): boolean {
  const version = isIP(rawAddress);
  if (version === 4) {
    const value = parseIpv4(rawAddress);
    if (value === null) return true;
    return BLOCKED_IPV4_RANGES.some(({ base, prefix }) => {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return (value & mask) === (base & mask);
    });
  }
  if (version === 6) {
    const normalized = rawAddress.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    // IPv4-mapped IPv6 ("::ffff:127.0.0.1") is judged by the embedded IPv4.
    for (const prefix of ["::ffff:", "0:0:0:0:0:ffff:"]) {
      if (normalized.startsWith(prefix)) {
        const embedded = normalized.slice(prefix.length);
        if (isIP(embedded) === 4) return isBlockedAddress(embedded);
        const hextets = embedded.split(":");
        if (hextets.length === 2) {
          const high = parseInt(hextets[0] || "0", 16);
          const low = parseInt(hextets[1] || "0", 16);
          if (Number.isInteger(high) && Number.isInteger(low)) {
            return isBlockedAddress(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
          }
        }
        return true;
      }
    }
    const firstHextet = parseInt(normalized.split(":")[0] || "0", 16);
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    return false;
  }
  return true;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private queue = new pQueue({ concurrency: 1 });

  constructor(private prisma: PrismaService) {}

  /**
   * Columns a client may filter on. Everything else — including `teamId`,
   * `secret` and relation predicates — is rejected so a caller cannot widen the
   * tenant scope or probe columns that are never meant as filters.
   */
  private static readonly FILTER_FIELDS = new Set([
    "id",
    "isActive",
    "url",
    "contentType",
    "event",
    "lastFiredAt",
    "createdAt",
    "updatedAt",
  ]);

  async createWebhook(data: Omit<Omit<Prisma.WebhookCreateInput, "webhook">, "team">): Promise<Webhook> {
    return this.prisma.webhook.create({ data });
  }

  async getWebhooks(params: {
    teamId: number;
    skip?: number;
    take?: number;
    cursor?: Prisma.WebhookWhereUniqueInput;
    where?: Record<string, unknown>;
    orderBy?: Prisma.WebhookOrderByWithAggregationInput;
  }): Promise<Webhook[]> {
    const { teamId, skip, take, cursor, where, orderBy } = params;
    const scopedWhere = this.scopeWhere(teamId, where);
    try {
      const webhooks = await this.prisma.webhook.findMany({
        skip,
        take,
        cursor,
        where: scopedWhere,
        orderBy,
      });
      return webhooks;
    } catch {
      return [];
    }
  }

  /** Merge the caller's filters into an AND clause that always pins `teamId`. */
  private scopeWhere(teamId: number, where?: Record<string, unknown>): Prisma.WebhookWhereInput {
    const conditions: Prisma.WebhookWhereInput[] = [];
    for (const [field, value] of Object.entries(where ?? {})) {
      if (!WebhookService.FILTER_FIELDS.has(field)) {
        throw new BadRequestException(`Unsupported webhook filter field: ${field}`);
      }
      conditions.push({ [field]: value } as Prisma.WebhookWhereInput);
    }
    return conditions.length > 0 ? { teamId, AND: conditions } : { teamId };
  }

  async getWebhook(teamId: number, id: number): Promise<Webhook> {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id },
    });
    if (!webhook) throw new NotFoundException(WEBHOOK_NOT_FOUND);
    if (webhook.teamId !== teamId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return webhook;
  }

  async updateWebhook(teamId: number, id: number, data: Prisma.WebhookUpdateInput): Promise<Webhook> {
    const testWebhook = await this.prisma.webhook.findUnique({
      where: { id },
    });
    if (!testWebhook) throw new NotFoundException(WEBHOOK_NOT_FOUND);
    if (testWebhook.teamId !== teamId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const webhook = await this.prisma.webhook.update({
      where: { id },
      data,
    });
    return webhook;
  }

  async replaceWebhook(teamId: number, id: number, data: Prisma.WebhookCreateInput): Promise<Webhook> {
    const testWebhook = await this.prisma.webhook.findUnique({
      where: { id },
    });
    if (!testWebhook) throw new NotFoundException(WEBHOOK_NOT_FOUND);
    if (testWebhook.teamId !== teamId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const webhook = await this.prisma.webhook.update({
      where: { id },
      data,
    });
    return webhook;
  }

  async deleteWebhook(teamId: number, id: number): Promise<Webhook> {
    const testWebhook = await this.prisma.webhook.findUnique({
      where: { id },
    });
    if (!testWebhook) throw new NotFoundException(WEBHOOK_NOT_FOUND);
    if (testWebhook.teamId !== teamId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const webhook = await this.prisma.webhook.delete({
      where: { id },
    });
    return webhook;
  }

  async getWebhookScopes(): Promise<Record<string, string>> {
    const scopes: Record<string, string> = {
      "create-api-key": "Create API key",
      "update-api-key": "Update API key",
      "delete-api-key": "Delete API key",
      "create-domain": "Create domain",
      "delete-domain": "Delete domain",
      "verify-domain-txt": "Verify domain (TXT)",
      "verify-domain-html": "Verify domain (HTML)",
      "update-info": "Update info",
      delete: "Delete group",
      "add-membership": "Add membership",
      "update-membership": "Update membership",
      "delete-membership": "Delete membership",
      "create-billing": "Create billing",
      "update-billing": "Update billing",
      "delete-billing": "Delete billing",
      "write-source": "Write source",
      "delete-source": "Delete source",
      "create-subscription": "Create subscription",
      "delete-subscription": "Delete subscription",
      "create-webhook": "Create webhook",
      "update-webhook": "Update webhook",
      "delete-webhook": "Delete webhook",
    };
    return scopes;
  }

  triggerWebhook(teamId: number, event: string) {
    this.prisma.webhook
      .findMany({ where: { teamId, isActive: true, event } })
      .then((webhooks) => {
        webhooks.forEach((webhook) =>
          this.queue
            .add(() =>
              pRetry(() => this.callWebhook(webhook, event), {
                retries: WEBHOOK_RETRIES,
                onFailedAttempt: (error) => {
                  this.logger.error(
                    `Triggering webhoook failed, retrying (${error.retriesLeft} attempts left)`,
                    error.error.name,
                  );
                  if (error.retriesLeft === 0)
                    this.prisma.webhook
                      .update({
                        where: { id: webhook.id },
                        data: { isActive: false },
                      })
                      .then(() => {})
                      .catch(() => {});
                },
              }),
            )
            .then(() => {})
            .catch(() => {}),
        );
      })
      .catch((error) => this.logger.error("Unable to get webhooks", error));
  }

  private async callWebhook(webhook: Webhook, event: string) {
    await this.assertSafeUrl(webhook.url);

    const isJson = webhook.contentType === "application/json";
    const body = isJson ? { event } : event;
    const headers: Record<string, string> = {};
    if (webhook.secret) {
      const payload = isJson ? JSON.stringify(body) : String(body);
      headers["X-Webhook-Signature"] = `sha256=${createHmac("sha256", webhook.secret).update(payload).digest("hex")}`;
    }

    // Redirects are not followed: a public host could otherwise answer 302 to
    // an internal address and bypass the guard. A redirected webhook is a
    // configuration error the operator can fix on the target side.
    await axios.post(webhook.url, body, {
      headers,
      timeout: WEBHOOK_TIMEOUT_MS,
      maxRedirects: 0,
    });
    await this.prisma.webhook.update({
      where: { id: webhook.id },
      data: { lastFiredAt: new Date() },
    });
  }

  /**
   * Webhook targets are user-supplied, so only allow http(s) URLs whose host
   * resolves exclusively to public addresses. The literal-IP check alone was
   * bypassable by a hostname pointing at 127.0.0.1 (R20-15); resolving every
   * address closes that gap for the request that follows.
   */
  private async assertSafeUrl(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Refusing to call malformed webhook url: ${rawUrl}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Refusing to call non-http(s) webhook url: ${rawUrl}`);
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      throw new Error(`Refusing to call internal webhook host: ${hostname}`);
    }
    if (isIP(hostname)) {
      if (isBlockedAddress(hostname)) {
        throw new Error(`Refusing to call non-public webhook address: ${hostname}`);
      }
      return;
    }
    const addresses = await dns.lookup(hostname, { all: true });
    const blocked = addresses.find(({ address }) => isBlockedAddress(address));
    if (blocked) {
      throw new Error(`Refusing to call webhook host ${hostname} resolving to ${blocked.address}`);
    }
  }
}
