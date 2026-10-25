import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationProviderRegistry } from "./evaluation-provider.registry";
import { EvaluationScope, EvaluationSubjectDescriptor, EvaluationSubjectRef } from "./ports/evaluation.contracts";

export interface ListEvaluationSubjectsInput {
  kind: string;
  scopeType: string;
  scopeId: string;
}

export interface SyncEvaluationSubjectsInput extends EvaluationScope {
  kind: string;
}

/**
 * EvaluationSubjectService — the subject registry (ADR-020 D1).
 *
 * Identity is `(kind, scopeType, scopeId, subjectKey)`. The skeleton stores the
 * coordinate and never interprets it: `scopeId` carries no foreign key, so no
 * host entity leaks in here.
 */
@Injectable()
export class EvaluationSubjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: EvaluationProviderRegistry,
  ) {}

  /** Idempotent: the same natural key always resolves to the same row. */
  async ensureSubject(descriptor: EvaluationSubjectDescriptor) {
    return this.prisma.evaluationSubject.upsert({
      where: {
        kind_scopeType_scopeId_subjectKey: {
          kind: descriptor.kind,
          scopeType: descriptor.scopeType,
          scopeId: descriptor.scopeId,
          subjectKey: descriptor.subjectKey,
        },
      },
      create: {
        kind: descriptor.kind,
        scopeType: descriptor.scopeType,
        scopeId: descriptor.scopeId,
        subjectKey: descriptor.subjectKey,
        displayName: descriptor.displayName,
        metadata: descriptor.metadata as Prisma.InputJsonValue | undefined,
      },
      update: {
        displayName: descriptor.displayName,
        metadata: descriptor.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async ensureSubjects(descriptors: readonly EvaluationSubjectDescriptor[]) {
    return Promise.all(descriptors.map((descriptor) => this.ensureSubject(descriptor)));
  }

  /**
   * Host-driven subject sync: ask the host what exists in a scope, then make
   * the local registry agree. The skeleton never enumerates on its own because
   * it has no access to host identity.
   */
  async syncSubjects(input: SyncEvaluationSubjectsInput) {
    const provider = this.providers.getSubjectProvider();
    const descriptors = await provider.listSubjects({ scopeType: input.scopeType, scopeId: input.scopeId }, input.kind);
    return this.ensureSubjects(descriptors);
  }

  async getSubject(id: string) {
    const subject = await this.prisma.evaluationSubject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException(`Evaluation subject ${id} not found`);
    return subject;
  }

  async listSubjects(query: ListEvaluationSubjectsInput) {
    return this.prisma.evaluationSubject.findMany({
      where: { kind: query.kind, scopeType: query.scopeType, scopeId: query.scopeId },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
  }
}

/** Detach a stored subject from Prisma for the ports. */
export function toSubjectRef(subject: {
  id: string;
  kind: string;
  scopeType: string;
  scopeId: string;
  subjectKey: string;
  displayName: string;
}): EvaluationSubjectRef {
  return {
    id: subject.id,
    kind: subject.kind,
    scopeType: subject.scopeType,
    scopeId: subject.scopeId,
    subjectKey: subject.subjectKey,
    displayName: subject.displayName,
  };
}
