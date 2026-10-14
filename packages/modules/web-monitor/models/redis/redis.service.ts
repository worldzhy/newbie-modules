import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit {
  private client!: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const raw = this.configService.get("modules.web-monitor.redis");
    const cfg = (() => {
      if (typeof raw === "string") {
        const [host, port, password, db] = raw.split(":");
        return {
          host: host || "127.0.0.1",
          port: port ? Number(port) : 6379,
          password: password || "",
          db: db ? Number(db) : 1,
        };
      }
      return raw || { host: "127.0.0.1", port: 6379, password: "", db: 1 };
    })();
    // ioredis connects (and reconnects) automatically on construction.
    // Calling connect() explicitly rejects with "Redis is already connecting/connected".
    this.client = new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      db: cfg.db,
    });
    this.client.on("error", (err: Error) => {
      this.logger.error("Redis connect error:", err instanceof Error ? err.message : String(err));
    });
  }

  getClient() {
    return this.client;
  }

  async set(key: string, value: string): Promise<string | null>;
  async set(key: string, value: string, expiryToken: "EX", seconds: number): Promise<string | null>;
  async set(
    key: string,
    value: string,
    expiryToken: "EX",
    seconds: number,
    conditionToken: "NX",
  ): Promise<string | null>;
  async set(
    ...args: [string, string] | [string, string, "EX", number] | [string, string, "EX", number, "NX"]
  ): Promise<string | null> {
    if (args.length === 2) return this.client.set(args[0], args[1]);
    const [key, value, expiryToken, seconds, conditionToken] = args;
    if (conditionToken === undefined) return this.client.set(key, value, expiryToken, seconds);
    return this.client.set(key, value, expiryToken, seconds, conditionToken);
  }
  async get(key: string) {
    return this.client.get(key);
  }
  async del(key: string | string[]) {
    return this.client.del(...(Array.isArray(key) ? key : [key]));
  }
  async llen(key: string) {
    return this.client.llen(key);
  }
  async lpush(key: string, value: string) {
    return this.client.lpush(key, value);
  }
  async incr(key: string) {
    return this.client.incr(key);
  }
  async rpop(key: string) {
    return this.client.rpop(key);
  }
  /** Pops up to `count` items in one round trip (RPOP key count, Redis >= 6.2). */
  async rpopBatch(key: string, count: number): Promise<string[]> {
    return (await this.client.rpop(key, count)) || [];
  }
}
