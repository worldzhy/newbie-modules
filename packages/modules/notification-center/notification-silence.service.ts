import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { matchesDeliveryCondition, validateDeliveryCondition } from "./notification-center.constants";
import type { DeliveryLabels } from "./notification-center.constants";
import { CreateSilenceDto, SilenceDto, UpdateSilenceDto } from "./notification-center.dto";

function toSilenceDto(
  silence: {
    id: string;
    condition: Prisma.JsonValue;
    startsAt: Date;
    endsAt: Date;
    comment: string | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  now = new Date(),
): SilenceDto {
  return {
    id: silence.id,
    condition: silence.condition as SilenceDto["condition"],
    startsAt: silence.startsAt,
    endsAt: silence.endsAt,
    comment: silence.comment,
    createdBy: silence.createdBy,
    isActive: silence.startsAt <= now && silence.endsAt > now,
    createdAt: silence.createdAt,
    updatedAt: silence.updatedAt,
  };
}

/**
 * Maintenance windows (ADR-063): while a silence is active, every notification
 * whose labels match its condition stays in-app with runtimeReason "silenced".
 * A silence is active while startsAt <= now < endsAt, so it can be announced
 * ahead of time and expires without a scheduled job.
 */
@Injectable()
export class NotificationSilenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SilenceDto[]> {
    const now = new Date();
    const silences = await this.prisma.notificationSilence.findMany({ orderBy: { endsAt: "desc" } });
    return silences.map((silence) => toSilenceDto(silence, now));
  }

  async create(input: CreateSilenceDto, createdBy?: string): Promise<SilenceDto> {
    this.assertCondition(input.condition ?? {});
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const endsAt = new Date(input.endsAt);
    this.assertWindow(startsAt, endsAt);
    const created = await this.prisma.notificationSilence.create({
      data: {
        condition: (input.condition ?? {}) as unknown as Prisma.InputJsonValue,
        startsAt,
        endsAt,
        comment: input.comment ?? null,
        createdBy: createdBy ?? null,
      },
    });
    return toSilenceDto(created);
  }

  async update(id: string, input: UpdateSilenceDto): Promise<SilenceDto> {
    const existing = await this.getOrThrow(id);
    if (input.condition !== undefined) {
      this.assertCondition(input.condition);
    }
    const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : existing.endsAt;
    this.assertWindow(startsAt, endsAt);
    await this.assertRewritable(id, existing, input, startsAt, endsAt);
    const updated = await this.prisma.notificationSilence.update({
      where: { id },
      data: {
        ...(input.condition !== undefined ? { condition: input.condition as unknown as Prisma.InputJsonValue } : {}),
        ...(input.startsAt !== undefined ? { startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt } : {}),
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      },
    });
    return toSilenceDto(updated);
  }

  /**
   * End a silence early by moving its end to now. The row is kept so the
   * delivery attempts it produced stay explainable.
   */
  async cancel(id: string): Promise<SilenceDto> {
    const existing = await this.getOrThrow(id);
    const now = new Date();
    if (existing.endsAt <= now) {
      return toSilenceDto(existing, now);
    }
    // A scheduled window has intercepted nothing yet, so ending it early closes
    // it outright: the start collapses to now as well instead of leaving an
    // inverted window (endsAt < startsAt) that every other path rejects
    // (R41-02). An active window keeps its original start.
    const startsAt = existing.startsAt > now ? now : existing.startsAt;
    const updated = await this.prisma.notificationSilence.update({
      where: { id },
      data: { startsAt, endsAt: now },
    });
    return toSilenceDto(updated, now);
  }

  /**
   * The active silence that matches these labels, if any. The first matching
   * window (earliest start) wins so overlapping silences resolve predictably.
   */
  async findActiveId(labels: DeliveryLabels, now = new Date()): Promise<string | null> {
    const silences = await this.prisma.notificationSilence.findMany({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      select: { id: true, condition: true },
    });
    for (const silence of silences) {
      if (matchesDeliveryCondition(silence.condition, labels)) {
        return silence.id;
      }
    }
    return null;
  }

  private async getOrThrow(id: string) {
    const silence = await this.prisma.notificationSilence.findUnique({ where: { id } });
    if (!silence) {
      throw new NotFoundException(`Notification silence not found: ${id}`);
    }
    return silence;
  }

  private assertCondition(condition: unknown): void {
    const problems = validateDeliveryCondition(condition);
    if (problems.length > 0) {
      throw new BadRequestException(`Invalid silence condition: ${problems.join("; ")}`);
    }
  }

  /**
   * A window that already intercepted deliveries belongs to the audit trail
   * (ADR-063): delivery attempts point at it, so its matcher and start are
   * frozen and its end may only move earlier. Without this guard an operator
   * could rewrite the meaning of every attempt that references the window by
   * editing `condition`, and could extend a window that already ended (R41-03).
   */
  private async assertRewritable(
    id: string,
    existing: { condition: Prisma.JsonValue; startsAt: Date; endsAt: Date },
    input: UpdateSilenceDto,
    startsAt: Date,
    endsAt: Date,
  ): Promise<void> {
    const attempts = await this.prisma.notificationDeliveryAttempt.count({ where: { silenceId: id } });
    if (attempts === 0) {
      return;
    }
    const conditionChanged =
      input.condition !== undefined && JSON.stringify(input.condition) !== JSON.stringify(existing.condition);
    const startChanged = input.startsAt !== undefined && startsAt.getTime() !== existing.startsAt.getTime();
    if (conditionChanged || startChanged || endsAt.getTime() > existing.endsAt.getTime()) {
      throw new BadRequestException(
        "A silence that already intercepted deliveries can only be ended earlier; its condition and start are fixed.",
      );
    }
  }

  private assertWindow(startsAt: Date, endsAt: Date): void {
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException("Silence window must contain valid dates.");
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException("Silence must end after it starts.");
    }
  }
}
