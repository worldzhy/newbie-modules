import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import type {
  EvaluationCoverageBucket,
  EvaluationCriteriaVersionRef,
  EvaluationEvidenceItem,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationAssetService } from "../assets/security-evaluation-asset.service";
import {
  CloudConfigurationAccess,
  CloudConfigurationFailure,
  securityEvaluationCloudConfigurationAccessToken,
} from "../ports/cloud-configuration-access.port";
import { cloudConfigEvidenceId } from "../judgment/cloud-config/security-evaluation-cloud-config.identity";
import { SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK } from "../judgment/cloud-config/security-evaluation-cloud-config.rulebook";

/**
 * SecurityEvaluationCloudConfigEvidenceProvider — evidence collection for
 * subject kind "cloud-account" (ADR-027 D1/D6).
 *
 * The host port yields raw facts plus per-fact-type failures. Facts become
 * asset-fact rows and manifest items verbatim; failures become skipped-bucket
 * entries keyed by the criteria that depended on the missing facts. A subject
 * whose facts cannot be collected at all is a failed run, not a clean one.
 */
@Injectable()
export class SecurityEvaluationCloudConfigEvidenceProvider implements EvidenceProvider {
  constructor(
    private readonly assets: SecurityEvaluationAssetService,
    @Optional()
    @Inject(securityEvaluationCloudConfigurationAccessToken)
    private readonly cloudConfigurationAccess?: CloudConfigurationAccess,
  ) {}

  async collect(
    subject: EvaluationSubjectRef,
    _criteriaVersion: EvaluationCriteriaVersionRef,
  ): Promise<EvidenceCollection> {
    const access = this.cloudConfigurationAccess;
    if (!access) {
      throw new Error(
        "No CloudConfigurationAccess is bound to SECURITY_EVALUATION_CLOUD_CONFIGURATION_ACCESS; the host must bind the port before running cloud-account evaluations.",
      );
    }

    const asset = await this.assets.ensureAsset(subject);
    const observedAt = new Date();
    const collection = await access.collectFacts(subject);

    if (collection.facts.length === 0 && collection.failures.length > 0) {
      throw new BadRequestException(
        `No cloud configuration facts could be collected for ${subject.displayName}: ${collection.failures
          .map((failure) => `${failure.factType} (${failure.reason})`)
          .join("; ")}.`,
      );
    }

    await this.assets.upsertFacts(
      asset.id,
      collection.facts.map((fact) => ({ factType: fact.factType, factKey: fact.factKey, value: fact.value })),
      observedAt,
    );
    await this.assets.touchObserved(asset.id, observedAt);

    const items = collection.facts.map((fact): EvaluationEvidenceItem => {
      const region = typeof fact.value.region === "string" ? fact.value.region : null;
      return {
        id: cloudConfigEvidenceId(fact.factType, fact.factKey),
        layer: "fact",
        source: "cloud-account",
        summary: `${fact.factType} ${fact.factKey}${region ? ` (${region})` : ""}`,
        observedAt,
        payload: { factType: fact.factType, ...fact.value },
      };
    });

    return {
      items,
      declaredUnlinked: { total: 0 },
      skipped: this.computeSkipped(collection.failures),
    };
  }

  /**
   * Map collection failures onto the criteria that needed the missing facts:
   * account-level failures skip the whole control (`<criterionKey>`),
   * resource-level failures skip one resource of it (`<criterionKey>:<factKey>`).
   */
  private computeSkipped(failures: readonly CloudConfigurationFailure[]): EvaluationCoverageBucket {
    const items = new Set<string>();
    const notes: string[] = [];
    for (const failure of failures) {
      const affected = SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.filter((entry) =>
        entry.requiredFactTypes.includes(failure.factType),
      );
      for (const entry of affected) {
        items.add(failure.factKey ? `${entry.criterionKey}:${failure.factKey}` : entry.criterionKey);
      }
      notes.push(
        `${failure.factType}${failure.factKey ? ` (${failure.factKey})` : ""} could not be collected: ${failure.reason}`,
      );
    }
    if (items.size === 0) return { total: 0 };
    return { total: items.size, items: [...items], note: notes.join("; ") };
  }
}
