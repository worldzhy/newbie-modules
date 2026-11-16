import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationSubjectDescriptor, EvaluationSubjectRef } from "./ports/evaluation.contracts";

export interface ListEvaluationSubjectsInput {
  subjectType: string;
  kind: string;
  /** Omitted lists every subject of the kind. */
  subjectKey?: string;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationSubjectService — the subject registry (ADR-020 D1, ADR-068,
 * ADR-069).
 *
 * Identity is `(subjectType, kind, subjectKey)`. The skeleton stores what the
 * host submits and never enumerates or interprets it: no host entity leaks in
 * here.
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
        subjectType_kind_subjectKey: {
          subjectType: descriptor.subjectType,
          kind: descriptor.kind,
          subjectKey: descriptor.subjectKey,
        },
      },
      create: {
        subjectType: descriptor.subjectType,
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

  /**
   * Strict creation: an existing `(subjectType, kind, subjectKey)` is a conflict
   * carrying the existing id, never a silent upsert (ADR-072 D1).
   *
   * `client` lets a feature create the subject and its per-kind record in one
   * transaction, exactly like `getOrCreateSubject`.
   */
  async createSubject(descriptor: EvaluationSubjectDescriptor, client?: Prisma.TransactionClient) {
    const prisma = client ?? this.prisma;
    const key = {
      subjectType: descriptor.subjectType,
      kind: descriptor.kind,
      subjectKey: descriptor.subjectKey,
    };
    const where = { subjectType_kind_subjectKey: key };
    const existing = await prisma.evaluationSubject.findUnique({ where, select: { id: true } });
    if (existing) throw subjectConflict(key, existing.id);

    try {
      return await prisma.evaluationSubject.create({
        data: {
          ...key,
          displayName: descriptor.displayName,
          metadata: descriptor.metadata as Prisma.InputJsonValue | undefined,
          credentialRef: descriptor.credentialRef ?? null,
        },
      });
    } catch (error) {
      // A concurrent creation lost the unique-key race: the outcome is the same
      // conflict, and the id still comes from the row that won. Read outside the
      // failed transaction, which is already aborted on a real database.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.prisma.evaluationSubject.findUnique({ where, select: { id: true } });
        if (winner) throw subjectConflict(key, winner.id);
      }
      throw error;
    }
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
          subjectType: query.subjectType,
          kind: query.kind,
          ...(query.subjectKey ? { subjectKey: query.subjectKey } : {}),
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      },
    });
  }
}

/** Conflict body of a strict creation: the caller can read or update the existing subject (ADR-072 D1). */
function subjectConflict(
  key: { subjectType: string; kind: string; subjectKey: string },
  subjectId: string,
): ConflictException {
  return new ConflictException({
    message: `Subject (${key.subjectType}, ${key.kind}, ${key.subjectKey}) already exists.`,
    subjectId,
  });
}

/** Detach a stored subject from Prisma for the ports. */
export function toSubjectRef(subject: {
  id: string;
  subjectType: string;
  kind: string;
  subjectKey: string;
  displayName: string;
  credentialRef?: string | null;
}): EvaluationSubjectRef {
  return {
    id: subject.id,
    subjectType: subject.subjectType,
    kind: subject.kind,
    subjectKey: subject.subjectKey,
    displayName: subject.displayName,
    credentialRef: subject.credentialRef ?? null,
  };
}
