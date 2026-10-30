import { Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { Prisma, Webhook } from "@generated/prisma/client";
import pQueue from "p-queue";
import pRetry from "p-retry";
import axios from "axios";
import { UNAUTHORIZED_RESOURCE, WEBHOOK_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private queue = new pQueue({ concurrency: 1 });

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async createWebhook(data: Omit<Omit<Prisma.WebhookCreateInput, "webhook">, "team">): Promise<Webhook> {
    return this.prisma.webhook.create({ data });
  }

  async getWebhooks(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.WebhookWhereUniqueInput;
    where?: Prisma.WebhookWhereInput;
    orderBy?: Prisma.WebhookOrderByWithAggregationInput;
  }): Promise<Webhook[]> {
    const { skip, take, cursor, where, orderBy } = params;
    try {
      const webhooks = await this.prisma.webhook.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
      });
      return webhooks;
    } catch {
      return [];
    }
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
                retries: this.configService.get<number>("modules.webhook.retries"),
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
    if (!this.isSafeUrl(webhook.url)) {
      throw new Error(`Refusing to call unsafe webhook url: ${webhook.id}`);
    }

    const isJson = webhook.contentType === "application/json";
    const body = isJson ? { event } : event;
    const headers: Record<string, string> = {};
    if (webhook.secret) {
      const payload = isJson ? JSON.stringify(body) : String(body);
      headers["X-Webhook-Signature"] = `sha256=${createHmac("sha256", webhook.secret).update(payload).digest("hex")}`;
    }

    await axios.post(webhook.url, body, { headers });
    await this.prisma.webhook.update({
      where: { id: webhook.id },
      data: { lastFiredAt: new Date() },
    });
  }

  /**
   * Webhook targets are user-supplied, so only allow http(s) and reject
   * loopback / private / link-local hosts to avoid SSRF against the host.
   */
  private isSafeUrl(rawUrl: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }
    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const a = Number(ipv4[1]);
      const b = Number(ipv4[2]);
      return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      );
    }
    if (!hostname.includes(":")) {
      return true;
    }
    return !(
      hostname === "::1" ||
      hostname.startsWith("fe80:") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd")
    );
  }
}
