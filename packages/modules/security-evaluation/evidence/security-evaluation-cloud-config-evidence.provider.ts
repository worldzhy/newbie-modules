import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import type {
  EvaluationCoverageBucket,
  EvaluationRuleSetVersionRef,
  EvaluationEvidenceItem,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationAssetService } from "../assets/security-evaluation-asset.service";
import {
  CloudConfigurationAccess,
  CloudConfigurationFailure,
  securityEvaluationCloudConfigurationAccessToken,
} from "../ports/cloud-configuration-access.port";
import { cloudConfigEvidenceId } from "../judgment/aws-config/security-evaluation-cloud-config.identity";
import { SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK } from "../judgment/aws-config/security-evaluation-cloud-config.rulebook";

/**
 * SecurityEvaluationCloudConfigEvidenceProvider — evidence collection for
 * subject kind "aws-account" (ADR-027 D1/D6).
 *
 * The host port yields raw knowledge items plus per-type failures. Items
 * become asset knowledge rows and manifest items verbatim; failures become
 * skipped-bucket entries keyed by the criteria that depended on the missing
 * knowledge. A subject whose knowledge cannot be collected at all is a failed
 * run, not a clean one.
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
    ruleSetVersion: EvaluationRuleSetVersionRef,
  ): Promise<EvidenceCollection> {
    const access = this.cloudConfigurationAccess;
    if (!access) {
      throw new Error(
        "No CloudConfigurationAccess is bound to SECURITY_EVALUATION_CLOUD_CONFIGURATION_ACCESS; the host must bind the port before running aws-account evaluations.",
      );
    }

    const asset = await this.assets.ensureAsset(subject);
    const observedAt = new Date();
    const collection = await access.collect(subject);

    if (collection.items.length === 0 && collection.failures.length > 0) {
      throw new BadRequestException(
        `No cloud configuration knowledge could be collected for ${subject.displayName}: ${collection.failures
          .map((failure) => `${failure.type} (${failure.reason})`)
          .join("; ")}.`,
      );
    }

    await this.assets.upsertAwsConfigKnowledgeItems(
      asset.id,
      collection.items.map((item) => ({ type: item.type, key: item.key, value: item.value })),
      observedAt,
    );
    await this.assets.touchObserved(asset.id, observedAt);

    const items = collection.items.map((item): EvaluationEvidenceItem => {
      const region = typeof item.value.region === "string" ? item.value.region : null;
      return {
        id: cloudConfigEvidenceId(item.type, item.key),
        layer: "knowledge",
        source: "aws-account",
        summary: `${item.type} ${item.key}${region ? ` (${region})` : ""}`,
        observedAt,
        payload: { type: item.type, ...item.value },
      };
    });

    return {
      items,
      declaredUnlinked: { total: 0 },
      skipped: this.computeSkipped(collection.failures, ruleSetVersion.evaluationKey),
    };
  }

  /**
   * Map collection failures onto the criteria of the run's evaluationKey that
   * needed the missing knowledge: account-level failures skip the whole control
   * (`<criterionKey>`), resource-level failures skip one resource of it
   * (`<criterionKey>:<key>`).
   */
  private computeSkipped(
    failures: readonly CloudConfigurationFailure[],
    evaluationKey: string,
  ): EvaluationCoverageBucket {
    const items = new Set<string>();
    const notes: string[] = [];
    const entries = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter((entry) => entry.evaluationKey === evaluationKey);
    for (const failure of failures) {
      const affected = entries.filter((entry) => entry.requiredKnowledgeTypes.includes(failure.type));
      for (const entry of affected) {
        items.add(failure.key ? `${entry.criterionKey}:${failure.key}` : entry.criterionKey);
      }
      notes.push(`${failure.type}${failure.key ? ` (${failure.key})` : ""} could not be collected: ${failure.reason}`);
    }
    if (items.size === 0) return { total: 0 };
    return { total: items.size, items: [...items], note: notes.join("; ") };
  }
}
