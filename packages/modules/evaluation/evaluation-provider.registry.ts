import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";

import { CriteriaProvider, criteriaProviderToken } from "./ports/criteria.provider";
import { EvidenceProvider, evidenceProviderToken } from "./ports/evidence.provider";
import { JudgmentPort, judgmentPortToken } from "./ports/judgment.port";
import { SubjectProvider, subjectProviderToken } from "./ports/subject.provider";

/**
 * Resolves the four evaluation ports by token (ADR-020 D4). Bindings live in
 * the modules that implement them — this module only ever looks them up, so it
 * carries no compile-time dependency on any feature or on the host.
 *
 * A missing binding is a wiring error, not a runtime condition: features must
 * bind every port for the subject kinds they register.
 */
@Injectable()
export class EvaluationProviderRegistry {
  constructor(private readonly moduleRef: ModuleRef) {}

  getSubjectProvider(): SubjectProvider {
    return this.get<SubjectProvider>(subjectProviderToken, "SubjectProvider (evaluation)");
  }

  getCriteriaProvider(kind: string): CriteriaProvider {
    return this.get<CriteriaProvider>(
      criteriaProviderToken(kind),
      `CriteriaProvider for subject kind "${kind}" (bind ${criteriaProviderToken(kind)})`,
    );
  }

  getEvidenceProvider(kind: string): EvidenceProvider {
    return this.get<EvidenceProvider>(
      evidenceProviderToken(kind),
      `EvidenceProvider for subject kind "${kind}" (bind ${evidenceProviderToken(kind)})`,
    );
  }

  getJudgmentPort(kind: string): JudgmentPort {
    return this.get<JudgmentPort>(
      judgmentPortToken(kind),
      `JudgmentPort for subject kind "${kind}" (bind ${judgmentPortToken(kind)})`,
    );
  }

  private get<T>(token: string, description: string): T {
    try {
      return this.moduleRef.get<T>(token, { strict: false });
    } catch {
      throw new Error(`${description} is not bound in the Nest container`);
    }
  }
}
