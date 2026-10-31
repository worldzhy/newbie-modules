import { Injectable } from "@nestjs/common";
import { EvaluationSubjectService, toSubjectRef } from "@modules/evaluation/evaluation-subject.service";
import type { EvaluationScope } from "@modules/evaluation/ports/evaluation.contracts";

import { SECURITY_EVALUATION_SUBJECT_KINDS } from "../security-evaluation.constants";
import { SecurityEvaluationAssetService } from "./security-evaluation-asset.service";

export interface SyncSecurityEvaluationAssetsResult {
  subjects: number;
}

/**
 * SecurityEvaluationAssetSyncService — host-driven subject sync plus asset
 * materialisation.
 *
 * The skeleton enumerates nothing on its own, so the host asks it to sync a
 * scope; every subject the host declares gets its asset row here. Sync is
 * upsert-only: disappearing assets keep their rows and findings, and removal
 * semantics are a later decision (ADR-022 leaves retirement open).
 */
@Injectable()
export class SecurityEvaluationAssetSyncService {
  constructor(
    private readonly subjects: EvaluationSubjectService,
    private readonly assets: SecurityEvaluationAssetService,
  ) {}

  async sync(scope: EvaluationScope): Promise<SyncSecurityEvaluationAssetsResult> {
    let subjectCount = 0;
    for (const kind of SECURITY_EVALUATION_SUBJECT_KINDS) {
      const synced = await this.subjects.syncSubjects({ ...scope, kind });
      subjectCount += synced.length;
      await this.assets.getOrCreateAssets(synced.map(toSubjectRef));
    }
    return { subjects: subjectCount };
  }
}
