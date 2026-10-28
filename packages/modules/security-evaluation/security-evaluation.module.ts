import { Global, Module } from "@nestjs/common";
import { EvaluationModule } from "@modules/evaluation/evaluation.module";
import { criteriaProviderToken } from "@modules/evaluation/ports/criteria.provider";
import { evidenceProviderToken } from "@modules/evaluation/ports/evidence.provider";
import { judgmentPortToken } from "@modules/evaluation/ports/judgment.port";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationAssetSyncService } from "./assets/security-evaluation-asset-sync.service";
import { SecurityEvaluationCriteriaProvider } from "./criteria/security-evaluation-criteria.provider";
import { SecurityEvaluationCriteriaSeed } from "./criteria/security-evaluation-criteria.seed";
import { SecurityEvaluationCloudConfigEvidenceProvider } from "./evidence/security-evaluation-cloud-config-evidence.provider";
import { SecurityEvaluationEvidenceProvider } from "./evidence/security-evaluation-evidence.provider";
import { AwsSecurityBulletinsAdapter } from "./knowledge/adapters/aws-security-bulletins.adapter";
import { BleepingComputerAdapter } from "./knowledge/adapters/bleeping-computer.adapter";
import { CisaKevAdapter } from "./knowledge/adapters/cisa-kev.adapter";
import { FreeBufAdapter } from "./knowledge/adapters/freebuf.adapter";
import { GitHubSecurityAdvisoryAdapter } from "./knowledge/adapters/github-security-advisory.adapter";
import { GitHubSecurityBlogAdapter } from "./knowledge/adapters/github-security-blog.adapter";
import { TheHackerNewsAdapter } from "./knowledge/adapters/the-hacker-news.adapter";
import { SECURITY_EVALUATION_KNOWLEDGE_SOURCE_ADAPTERS } from "./knowledge/adapters/source-adapter.port";
import { SecurityEvaluationKnowledgeService } from "./knowledge/security-evaluation-knowledge.service";
import { SecurityEvaluationCloudConfigJudgment } from "./judgment/aws-config/security-evaluation-cloud-config.judgment";
import { SecurityEvaluationDependencyJudgment } from "./judgment/dependency/security-evaluation-dependency.judgment";
import { SecurityEvaluationOsvClient } from "./judgment/dependency/security-evaluation-osv.client";
import { SecurityEvaluationIntelJudgment } from "./judgment/intel/security-evaluation-intel.judgment";
import { SecurityEvaluationIntelMatchService } from "./judgment/intel/security-evaluation-intel-match.service";
import { SecurityEvaluationIntelModelScopeRegistration } from "./judgment/intel/security-evaluation-intel-model-scope";
import { SecurityEvaluationIntelReRanker } from "./judgment/intel/security-evaluation-intel-re-ranker";
import { SecurityEvaluationJudgmentService } from "./judgment/security-evaluation-judgment.service";
import { SecurityEvaluationReportService } from "./reporting/security-evaluation-report.service";
import { SecurityEvaluationController } from "./security-evaluation.controller";
import { SecurityEvaluationRunService } from "./security-evaluation-run.service";
import {
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "./security-evaluation.constants";

/**
 * SecurityEvaluationModule (ADR-022) — the security feature on the evaluation
 * skeleton (ADR-020), shipped as the second feature after work-evaluation.
 *
 * Slice 1 owns the asset inventory, the dependency criteria and the DEPENDENCY
 * judgment; slice 2 (ADR-027) adds the CLOUD_CONFIG mechanism: the CIS AWS
 * Foundations criteria for subject kind "aws-account", its evidence provider
 * and its rulebook judgment, dispatched by evaluationKey through the same judgment
 * service. INTEL arrives in a later slice with its own evaluationKey dispatch.
 *
 * The run lifecycle, result immutability, finding lifecycle and subject registry
 * belong to the skeleton; this module only implements the ports and the HTTP
 * surface. Port bindings use `useExisting` so the singletons are never
 * duplicated (the registry resolves the ports by token from the global
 * container).
 *
 * `SECURITY_EVALUATION_REPOSITORY_ACCESS` and
 * `SECURITY_EVALUATION_CLOUD_CONFIGURATION_ACCESS` are intentionally not bound
 * here: the host binds them (nightwatch uses its github and aws-identity
 * modules). An unbound port fails the run with a wiring error rather than
 * silently reporting a clean result.
 */
@Global()
@Module({
  imports: [EvaluationModule],
  controllers: [SecurityEvaluationController],
  providers: [
    SecurityEvaluationAssetService,
    SecurityEvaluationAssetSyncService,
    SecurityEvaluationCriteriaSeed,
    SecurityEvaluationCriteriaProvider,
    SecurityEvaluationEvidenceProvider,
    SecurityEvaluationCloudConfigEvidenceProvider,
    SecurityEvaluationOsvClient,
    SecurityEvaluationDependencyJudgment,
    SecurityEvaluationCloudConfigJudgment,
    SecurityEvaluationIntelModelScopeRegistration,
    SecurityEvaluationIntelReRanker,
    SecurityEvaluationIntelMatchService,
    SecurityEvaluationIntelJudgment,
    SecurityEvaluationJudgmentService,
    SecurityEvaluationRunService,
    SecurityEvaluationReportService,
    SecurityEvaluationKnowledgeService,
    // Knowledge source adapters (ADR-039): ported from threat-intelligence.
    GitHubSecurityAdvisoryAdapter,
    CisaKevAdapter,
    AwsSecurityBulletinsAdapter,
    GitHubSecurityBlogAdapter,
    FreeBufAdapter,
    TheHackerNewsAdapter,
    BleepingComputerAdapter,
    {
      provide: SECURITY_EVALUATION_KNOWLEDGE_SOURCE_ADAPTERS,
      useFactory: (
        ghsa: GitHubSecurityAdvisoryAdapter,
        cisa: CisaKevAdapter,
        aws: AwsSecurityBulletinsAdapter,
        ghblog: GitHubSecurityBlogAdapter,
        freebuf: FreeBufAdapter,
        thn: TheHackerNewsAdapter,
        bleeping: BleepingComputerAdapter,
      ) => [ghsa, cisa, aws, ghblog, freebuf, thn, bleeping],
      inject: [
        GitHubSecurityAdvisoryAdapter,
        CisaKevAdapter,
        AwsSecurityBulletinsAdapter,
        GitHubSecurityBlogAdapter,
        FreeBufAdapter,
        TheHackerNewsAdapter,
        BleepingComputerAdapter,
      ],
    },
    // Kind-scoped skeleton ports (ADR-020 D4). One judgment dispatcher serves
    // both kinds; the evaluationKey on the criteria version routes the mechanism.
    {
      provide: criteriaProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
      useExisting: SecurityEvaluationCriteriaProvider,
    },
    {
      provide: criteriaProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT),
      useExisting: SecurityEvaluationCriteriaProvider,
    },
    {
      provide: evidenceProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
      useExisting: SecurityEvaluationEvidenceProvider,
    },
    {
      provide: evidenceProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT),
      useExisting: SecurityEvaluationCloudConfigEvidenceProvider,
    },
    {
      provide: judgmentPortToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
      useExisting: SecurityEvaluationJudgmentService,
    },
    {
      provide: judgmentPortToken(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT),
      useExisting: SecurityEvaluationJudgmentService,
    },
  ],
  exports: [
    SecurityEvaluationAssetService,
    SecurityEvaluationAssetSyncService,
    SecurityEvaluationRunService,
    SecurityEvaluationReportService,
    SecurityEvaluationKnowledgeService,
    criteriaProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
    criteriaProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT),
    evidenceProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
    evidenceProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT),
    judgmentPortToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
    judgmentPortToken(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT),
  ],
})
export class SecurityEvaluationModule {}
