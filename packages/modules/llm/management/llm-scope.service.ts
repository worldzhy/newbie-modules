import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/**
 * Consumer-scope to LLM connection binding (ADR-006). One scope binds to
 * exactly one connection; a connection can serve many scopes. Changing a
 * binding takes effect on the next consumer call — no restart needed.
 */
@Injectable()
export class LlmScopeService {
  private readonly logger = new Logger(LlmScopeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async bind(scope: string, connectionId: string): Promise<void> {
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
    this.logger.log(`LLM scope "${scope}" bound to connection ${connectionId} (${connection.provider}/${connection.model})`);
  }

  async unbind(scope: string): Promise<void> {
    const assignment = await this.prisma.llmScopeAssignment.findUnique({ where: { scope } });
    if (!assignment) {
      throw new NotFoundException(`No connection bound to scope "${scope}".`);
    }
    await this.prisma.llmScopeAssignment.delete({ where: { scope } });
    this.logger.log(`LLM scope "${scope}" unbound from connection ${assignment.connectionId}`);
  }

  async list(): Promise<Array<{ scope: string; connectionId: string; connectionName: string; connectionModel: string }>> {
    const assignments = await this.prisma.llmScopeAssignment.findMany({
      include: { connection: true },
      orderBy: { scope: "asc" },
    });
    return assignments.map((a) => ({
      scope: a.scope,
      connectionId: a.connectionId,
      connectionName: (a.connection as { name: string }).name,
      connectionModel: (a.connection as { model: string }).model,
    }));
  }
}
