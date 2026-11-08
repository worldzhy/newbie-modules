import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EventCatalogService } from "./event-catalog.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

const RETENTION_DAYS_KEY = "modules.event-emitter.retentionDays";

/// Validates the retention days resolved from the assembler's bare env
/// mapping (ADR-033): the value must be a declared positive integer — there
/// is no built-in fallback, so a host that forgets it fails to boot instead
/// of silently pruning on a guessed window.
function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received '${value}'.`);
  }
  return value;
}

export interface EventDescription {
  key: string;
  name: string;
  description: string | null;
  payloadExample: unknown;
  declared: boolean;
  listenerCount: number;
  emissionCount: number;
  lastEmittedAt: Date | null;
}

@Injectable()
export class EventEmitterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventEmitterService.name);

  /// Retention cut point computed once at construction (a boot-time decision,
  /// not a per-request concern).
  private readonly retentionDays: number;

  /// Bound once so onModuleDestroy can detach the exact same callback.
  private readonly recordEmission = (event: string | string[], payload: unknown) => {
    const eventKey = Array.isArray(event) ? event.join(".") : String(event);
    this.record(eventKey, payload).catch((error) => {
      this.logger.error(`Failed to record emission of ${eventKey}: ${getErrorMessage(error)}`);
    });
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly eventCatalog: EventCatalogService,
    private readonly config: ConfigService,
  ) {
    this.retentionDays = requirePositiveInteger(
      Number(this.config.getOrThrow<string>(RETENTION_DAYS_KEY)),
      RETENTION_DAYS_KEY,
    );
  }

  onModuleInit() {
    this.eventEmitter.onAny(this.recordEmission);
  }

  onModuleDestroy() {
    this.eventEmitter.offAny(this.recordEmission);
  }

  /// Merge the declaration catalog with observed emission stats: declared
  /// events show their metadata, undeclared-but-observed events show up with
  /// declared=false so nothing fires invisibly.
  async listEvents(): Promise<EventDescription[]> {
    const declarations = this.eventCatalog.listDeclarations();
    const stats = await this.prisma.eventEmission.groupBy({
      by: ["eventKey"],
      _count: { _all: true },
      _max: { emittedAt: true },
    });
    const statsByKey = new Map(stats.map((row) => [row.eventKey, row]));

    const events: EventDescription[] = declarations.map((declaration) => {
      const stat = statsByKey.get(declaration.key);
      return {
        key: declaration.key,
        name: declaration.name ?? "",
        description: declaration.description ?? null,
        payloadExample: declaration.payloadExample ?? null,
        declared: true,
        listenerCount: this.eventEmitter.listenerCount(declaration.key),
        emissionCount: stat?._count._all ?? 0,
        lastEmittedAt: stat?._max.emittedAt ?? null,
      };
    });

    const declaredKeys = new Set(declarations.map((declaration) => declaration.key));
    for (const [eventKey, stat] of statsByKey) {
      if (!declaredKeys.has(eventKey)) {
        events.push({
          key: eventKey,
          name: "",
          description: null,
          payloadExample: null,
          declared: false,
          listenerCount: this.eventEmitter.listenerCount(eventKey),
          emissionCount: stat._count._all,
          lastEmittedAt: stat._max.emittedAt,
        });
      }
    }

    return events.sort((a, b) => a.key.localeCompare(b.key));
  }

  listEmissions(eventKey: string | undefined, page?: number, pageSize?: number) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EventEmission,
      pagination: { page, pageSize },
      findManyArgs: {
        where: eventKey ? { eventKey: { contains: eventKey } } : {},
        orderBy: { emittedAt: "desc" },
      },
    });
  }

  private async record(eventKey: string, payload: unknown) {
    // Lazy cleanup: each insert prunes all rows older than the configured
    // retention. No scheduler, no extra dependency — write pressure is
    // proportional to insert rate so cleanup scales naturally.
    // Prisma deleteMany doesn't support take/limit, so this is a full
    // prune per write; because writes are frequent the accumulated stale
    // rows are bounded under normal operation.
    await this.prisma.eventEmission.deleteMany({
      where: {
        emittedAt: { lt: new Date(Date.now() - this.retentionDays * 86_400_000) },
      },
    });

    await this.prisma.eventEmission.create({
      data: {
        eventKey,
        payload: this.toJsonPayload(payload),
        listenerCount: this.eventEmitter.listenerCount(eventKey),
      },
    });
  }

  /// Persist exactly what JSON can represent: normalize through a stringify
  /// round-trip so functions and class instances degrade to their JSON shape;
  /// unserializable payloads (circular, BigInt) degrade to a marker object.
  private toJsonPayload(payload: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
    if (payload === undefined || payload === null) {
      return Prisma.DbNull;
    }
    try {
      return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
    } catch {
      return { serializationError: "Payload is not JSON-serializable" };
    }
  }
}
