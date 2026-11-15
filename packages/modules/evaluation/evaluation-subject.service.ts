import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationSubjectDescriptor, EvaluationSubjectRef } from "./ports/evaluation.contracts";

export interface ListEvaluationSubjectsInput {
  kind: string;
  /** Omitted lists every subject of the kind. */
  subjectKey?: string;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationSubjectService — the subject registry (ADR-020 D1, ADR-068).
 *
 * Identity is `(kind, subjectKey)`. The skeleton stores what the host submits
 * and never enumerates or interprets it: no host entity leaks in here.
 */
@Injectable()
export class EvaluationSubjectService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent: the same natural key always resolves to the same row.
   *
   * `client` lets a feature compose subject creation into its own transaction
   * (e.g. registering an asset and its per-kind record atomically) without
   * duplicating the upsert semantics.
   */
  async getOrCreateSubject(descriptor: EvaluationSubjectDescriptor, client?: Prisma.TransactionClient) {
    return (client ?? this.prisma).evaluationSubject.upsert({
      where: {
        kind_subjectKey: {
          kind: descriptor.kind,
          subjectKey: descriptor.subjectKey,
        },
      },
      create: {
        kind: descriptor.kind,
        subjectKey: descriptor.subjectKey,
        displayName: descriptor.displayName,
        metadata: descriptor.metadata as Prisma.InputJsonValue | undefined,
        credentialRef: descriptor.credentialRef ?? null,
      },
      update: {
        displayName: descriptor.displayName,
        metadata: descriptor.metadata as Prisma.InputJsonValue | undefined,
        // A re-registration refreshes the pointer (the credential it names may
        // have been recreated); a submission that omits it never clears the
        // stored value.
        ...(descriptor.credentialRef !== undefined ? { credentialRef: descriptor.credentialRef } : {}),
      },
    });
  }

  async getSubject(id: string) {
    const subject = await this.prisma.evaluationSubject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException(`Evaluation subject ${id} not found`);
    return subject;
  }

  async listSubjects(query: ListEvaluationSubjectsInput) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EvaluationSubject,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          kind: query.kind,
          ...(query.subjectKey ? { subjectKey: query.subjectKey } : {}),
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      },
    });
  }
}

/** Detach a stored subject from Prisma for the ports. */
export function toSubjectRef(subject: {
  id: string;
  kind: string;
  subjectKey: string;
  displayName: string;
  credentialRef?: string | null;
}): EvaluationSubjectRef {
  return {
    id: subject.id,
    kind: subject.kind,
    subjectKey: subject.subjectKey,
    displayName: subject.displayName,
    credentialRef: subject.credentialRef ?? null,
  };
}
