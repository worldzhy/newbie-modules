import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  DEFAULT_DELIVERY_RULE_CONDITION,
  DEFAULT_DELIVERY_RULE_PRIORITY,
  DEFAULT_RECOVERY_RULE_CONDITION,
  DEFAULT_RECOVERY_RULE_PRIORITY,
  DELIVERY_RULE_ACTIONS,
  DELIVERY_RULE_PRIORITY_STEP,
  matchesDeliveryCondition,
  PG_UNIQUE_VIOLATION,
  validateDeliveryCondition,
} from "./notification-center.constants";
import type { DeliveryLabels, DeliveryRuleAction, DeliveryVerdict } from "./notification-center.constants";
import {
  CreateDeliveryRuleDto,
  DeliveryRuleDto,
  SimulateDeliveryRequestDto,
  SimulateDeliveryResultDto,
  UpdateDeliveryRuleDto,
} from "./notification-center.dto";

function toRuleDto(rule: {
  id: string;
  priority: number;
  condition: Prisma.JsonValue;
  action: string;
  isEnabled: boolean;
  updatedAt: Date;
}): DeliveryRuleDto {
  return {
    id: rule.id,
    priority: rule.priority,
    condition: rule.condition as DeliveryRuleDto["condition"],
    action: rule.action,
    isEnabled: rule.isEnabled,
    updatedAt: rule.updatedAt,
  };
}

/**
 * The ordered delivery rule table (ADR-062). This is the only configuration
 * entity: the first enabled rule whose condition matches decides whether an
 * alert is pushed, and an event that matches nothing is suppressed.
 */
@Injectable()
export class NotificationDeliveryRuleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationDeliveryRuleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed the default rules when the table is empty, so a fresh install keeps
   * pushing high and critical signals (instead of starting from "everything
   * suppressed") and still announces recoveries. `remove()` refuses to delete
   * the last rule, so an empty table only ever exists before this seed runs.
   */
  async onApplicationBootstrap(): Promise<void> {
    const count = await this.prisma.notificationDeliveryRule.count();
    if (count > 0) {
      return;
    }
    try {
      await this.prisma.$transaction([
        this.prisma.notificationDeliveryRule.create({
          data: {
            priority: DEFAULT_DELIVERY_RULE_PRIORITY,
            condition: DEFAULT_DELIVERY_RULE_CONDITION as unknown as Prisma.InputJsonValue,
            action: "deliver",
          },
        }),
        this.prisma.notificationDeliveryRule.create({
          data: {
            priority: DEFAULT_RECOVERY_RULE_PRIORITY,
            condition: DEFAULT_RECOVERY_RULE_CONDITION as unknown as Prisma.InputJsonValue,
            action: "deliver",
          },
        }),
      ]);
      this.logger.log("Seeded the default delivery rules (high+ deliver, resolved deliver)");
    } catch (error: unknown) {
      // A concurrent instance seeded first; the unique priority settles it.
      if ((error as { code?: string })?.code !== PG_UNIQUE_VIOLATION) {
        throw error;
      }
    }
  }

  async list(): Promise<DeliveryRuleDto[]> {
    const rules = await this.prisma.notificationDeliveryRule.findMany({ orderBy: { priority: "asc" } });
    return rules.map(toRuleDto);
  }

  async create(input: CreateDeliveryRuleDto): Promise<DeliveryRuleDto> {
    this.assertCondition(input.condition);
    this.assertAction(input.action);
    const last = await this.prisma.notificationDeliveryRule.findFirst({
      orderBy: { priority: "desc" },
      select: { priority: true },
    });
    const created = await this.prisma.notificationDeliveryRule.create({
      data: {
        priority: (last?.priority ?? 0) + DELIVERY_RULE_PRIORITY_STEP,
        condition: input.condition as unknown as Prisma.InputJsonValue,
        action: input.action,
        isEnabled: input.isEnabled ?? true,
      },
    });
    return toRuleDto(created);
  }

  async update(id: string, input: UpdateDeliveryRuleDto): Promise<DeliveryRuleDto> {
    if (input.condition !== undefined) {
      this.assertCondition(input.condition);
    }
    if (input.action !== undefined) {
      this.assertAction(input.action);
    }
    await this.getRuleOrThrow(id);
    const updated = await this.prisma.notificationDeliveryRule.update({
      where: { id },
      data: {
        ...(input.condition !== undefined ? { condition: input.condition as unknown as Prisma.InputJsonValue } : {}),
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      },
    });
    return toRuleDto(updated);
  }

  /**
   * Delete one rule. The last rule cannot be deleted: an empty table means
   * "nothing is ever pushed", which is expressed explicitly by disabling the
   * remaining rule (or adding a catch-all suppress rule) instead of by an
   * empty configuration surface.
   */
  async remove(id: string): Promise<{ id: string }> {
    const count = await this.prisma.notificationDeliveryRule.count();
    if (count <= 1) {
      throw new BadRequestException("At least one delivery rule must remain; disable it instead of deleting it.");
    }
    await this.getRuleOrThrow(id);
    await this.prisma.notificationDeliveryRule.delete({ where: { id } });
    return { id };
  }

  /**
   * Rewrite the rule order from a complete list of ids. `priority` is unique,
   * so the rewrite runs in two passes through a negative range to avoid
   * colliding with the target values.
   */
  async reorder(ids: string[]): Promise<DeliveryRuleDto[]> {
    const existing = await this.prisma.notificationDeliveryRule.findMany({ select: { id: true } });
    const known = new Set(existing.map((rule) => rule.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new BadRequestException("Rearrange payload must list every delivery rule exactly once.");
    }
    await this.prisma.$transaction([
      ...ids.map((id, index) =>
        this.prisma.notificationDeliveryRule.update({ where: { id }, data: { priority: -(index + 1) } }),
      ),
      ...ids.map((id, index) =>
        this.prisma.notificationDeliveryRule.update({
          where: { id },
          data: { priority: (index + 1) * DELIVERY_RULE_PRIORITY_STEP },
        }),
      ),
    ]);
    return this.list();
  }

  /**
   * The rule decision for one delivery event (ADR-062): the first enabled rule
   * whose condition matches wins; no match suppresses.
   */
  async evaluate(labels: DeliveryLabels): Promise<DeliveryVerdict> {
    const rules = await this.prisma.notificationDeliveryRule.findMany({
      where: { isEnabled: true },
      orderBy: { priority: "asc" },
      select: { id: true, condition: true, action: true },
    });
    for (const rule of rules) {
      if (matchesDeliveryCondition(rule.condition, labels)) {
        return { action: rule.action as DeliveryRuleAction, ruleId: rule.id, reason: "rule" };
      }
    }
    return { action: "suppress", ruleId: null, reason: "no-rule-matched" };
  }

  /**
   * Replay the rule table for one event without touching any state. The
   * ordered model is order-sensitive, so this is the operator's only reliable
   * way to see which rule (if any) decides a real notification.
   */
  async simulate(input: SimulateDeliveryRequestDto, visibleProjectIds: string[]): Promise<SimulateDeliveryResultDto> {
    const labels = input.recordId
      ? await this.labelsFromRecord(input.recordId, visibleProjectIds)
      : this.labelsFromInput(input);
    const rules = await this.prisma.notificationDeliveryRule.findMany({
      where: { isEnabled: true },
      orderBy: { priority: "asc" },
      select: { id: true, condition: true, action: true },
    });
    let matchedIndex: number | null = null;
    let verdict: DeliveryVerdict = { action: "suppress", ruleId: null, reason: "no-rule-matched" };
    for (const [index, rule] of rules.entries()) {
      if (!matchesDeliveryCondition(rule.condition, labels)) {
        continue;
      }
      matchedIndex = index + 1;
      verdict = { action: rule.action as DeliveryRuleAction, ruleId: rule.id, reason: "rule" };
      break;
    }
    // ADR-065 §6: the decision is evaluated per delivery and never frozen.
    // Runtime interception (subscription switch, center switch, push port) is
    // owned by NotificationCenterService; the simulator answers the rule
    // question, which is the order-sensitive part an operator cannot eyeball.
    return {
      labels,
      decision: verdict.action,
      reason: verdict.reason,
      matchedRuleId: verdict.ruleId,
      matchedRuleIndex: matchedIndex,
      ruleCount: rules.length,
      runtimeReason: null,
      delivered: verdict.action === "deliver",
    };
  }

  private async labelsFromRecord(recordId: string, visibleProjectIds: string[]): Promise<DeliveryLabels> {
    const record = await this.prisma.notificationRecord.findUnique({
      where: { id: recordId },
      select: { notificationKey: true, severity: true, projectId: true, status: true },
    });
    // A record outside the caller's visible projects reads as not-found, the
    // same way reads and delivery attempts behave, so the simulator cannot be
    // used to inspect another project's events (R39-06).
    if (!record || (record.projectId && !visibleProjectIds.includes(record.projectId))) {
      throw new NotFoundException(`Notification not found: ${recordId}`);
    }
    return {
      state: record.status === "resolved" ? "resolved" : "firing",
      severity: record.severity,
      notificationKey: record.notificationKey,
      projectId: record.projectId ?? undefined,
    };
  }

  private labelsFromInput(input: SimulateDeliveryRequestDto): DeliveryLabels {
    if (!input.notificationKey || !input.severity) {
      throw new BadRequestException("Provide either recordId, or both notificationKey and severity.");
    }
    return {
      state: input.state === "resolved" ? "resolved" : "firing",
      severity: input.severity,
      notificationKey: input.notificationKey,
      projectId: input.projectId,
    };
  }

  private async getRuleOrThrow(id: string): Promise<void> {
    const rule = await this.prisma.notificationDeliveryRule.findUnique({ where: { id }, select: { id: true } });
    if (!rule) {
      throw new NotFoundException(`Delivery rule not found: ${id}`);
    }
  }

  private assertCondition(condition: unknown): void {
    const problems = validateDeliveryCondition(condition);
    if (problems.length > 0) {
      throw new BadRequestException(`Invalid delivery condition: ${problems.join("; ")}`);
    }
  }

  private assertAction(action: string): void {
    if (!(DELIVERY_RULE_ACTIONS as readonly string[]).includes(action)) {
      throw new BadRequestException(
        `Invalid delivery action: ${action}. Must be one of ${DELIVERY_RULE_ACTIONS.join(", ")}.`,
      );
    }
  }
}
