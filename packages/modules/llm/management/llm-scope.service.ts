import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { LlmScopeCatalog } from "./llm-scope-catalog.service";
import { LlmScopeBindingResponseDto } from "./llm-scope.dto";

type AssignmentWithConnection = Prisma.LlmScopeAssignmentGetPayload<{ include: { connection: true } }>;

/**
 * Consumer-scope to LLM connection binding (ADR-006, catalog in ADR-043). One
 * scope binds to exactly one connection; a connection can serve many scopes.
 * Changing a binding takes effect on the next consumer call — no restart needed.
 */
@Injectable()
export class LlmScopeService {
  private readonly logger = new Logger(LlmScopeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: LlmScopeCatalog,
  ) {}

  async bind(scope: string, connectionId: string): Promise<LlmScopeBindingResponseDto> {
    // The catalog is the single source of truth for valid scopes: a typo or a
    // scope whose consumer was removed must fail here instead of creating a
    // binding nothing will ever read.
    if (!this.catalog.has(scope)) {
      throw new BadRequestException(`Unknown LLM scope "${scope}"; only scopes registered by a consumer can be bound.`);
    }

    // Verify the target connection exists before touching the binding.
    const connection = await this.prisma.llmConnection.findUnique({ where: { id: connectionId } });
    if (!connection) {
      throw new NotFoundException(`LLM connection ${connectionId} not found.`);
    }

    // Upsert: create the binding if missing, or switch an existing scope to
    // the new connection. The scope UNIQUE constraint is the structural backstop.
    await this.prisma.llmScopeAssignment.upsert({
      where: { scope },
      update: { connectionId },
      create: { scope, connectionId },
    });
    this.logger.log(
      `LLM scope "${scope}" bound to connection ${connectionId} (${connection.provider}/${connection.model})`,
    );
    return {
      scope,
      label: this.catalog.labelOf(scope),
      connectionId,
      connectionName: connection.name,
      connectionModel: connection.model,
    };
  }

  async unbind(scope: string): Promise<LlmScopeBindingResponseDto> {
    const assignment = await this.prisma.llmScopeAssignment.findUnique({
      where: { scope },
      include: { connection: true },
    });
    if (!assignment) {
      throw new NotFoundException(`No connection bound to scope "${scope}".`);
    }
    await this.prisma.llmScopeAssignment.delete({ where: { scope } });
    this.logger.log(`LLM scope "${scope}" unbound from connection ${assignment.connectionId}`);
    return {
      scope,
      label: this.catalog.labelOf(scope),
      connectionId: assignment.connectionId,
      connectionName: assignment.connection.name,
      connectionModel: assignment.connection.model,
    };
  }

  /**
   * Every consumer scope with its binding, bound or not. Registered scopes come
   * first from the catalog; assignments whose scope is no longer registered are
   * appended so stale rows stay visible and can be unbound.
   */
  async list(): Promise<LlmScopeBindingResponseDto[]> {
    const assignments = await this.prisma.llmScopeAssignment.findMany({ include: { connection: true } });
    const byScope = new Map(assignments.map((assignment) => [assignment.scope, assignment]));
    const rows = new Map<string, LlmScopeBindingResponseDto>();

    for (const definition of this.catalog.list()) {
      rows.set(definition.scope, this.toResponse(definition.scope, definition.label, byScope.get(definition.scope)));
    }
    for (const assignment of assignments) {
      if (!rows.has(assignment.scope)) {
        rows.set(assignment.scope, this.toResponse(assignment.scope, assignment.scope, assignment));
      }
    }

    return [...rows.values()].sort((a, b) => a.scope.localeCompare(b.scope));
  }

  private toResponse(scope: string, label: string, assignment?: AssignmentWithConnection): LlmScopeBindingResponseDto {
    return {
      scope,
      label,
      connectionId: assignment?.connectionId ?? null,
      connectionName: assignment?.connection.name ?? null,
      connectionModel: assignment?.connection.model ?? null,
    };
  }
}
