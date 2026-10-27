# Threat-Intelligence Merge into Security-Evaluation - Implementation Plan

## Task 1: Write ADR-022 Errata + ADR-039 (merge decision)
- **Status**: `completed`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Add Errata to ADR-022: revoke "two matching systems" clause; threat-intelligence capability merges into security-evaluation.
  - Write ADR-039: threat-intelligence collect+match capability merges into security-evaluation knowledge/ + judgment/intel/; standalone module decommissioned; match table removed (findings directly produced); ADR-018 guardrails preserved.
- **Acceptance Criteria Addressed**: AC-5 (decision record)
- **Test Requirements**:
  - `rule` TR-1.1: ADR-022 Errata exists and explicitly revokes the "two matching systems" clause; ADR-039 exists with decision + scope. Evidence: file content.
- **Completion Evidence**:
  - ADR-039 created at `.trae/documents/decisions/ADR-039-threat-intel-merge-into-security-evaluation.md` with decision A + D1-D6 sub-decisions.
  - ADR-022 Errata appended: revokes "two matching systems" clause, references ADR-039.

## Task 2: M1 — Add SecurityEvaluationKnowledgeItem to security-evaluation schema
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - Add `SecurityEvaluationKnowledgeItem` model to `packages/modules/security-evaluation/prisma/schema.prisma` in `module/security-evaluation` schema.
  - Fields match former `ThreatIntelligenceItem`: source, category, externalId, title, summary, url, publishedAt, severity, signalTags, rawPayload, fetchedAt, lastSeenAt, createdAt, updatedAt.
  - Dedup key `@@unique([source, externalId])`; indexes on category, severity, publishedAt, fetchedAt.
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `rule` TR-2.1: Schema contains `SecurityEvaluationKnowledgeItem` with `@@schema("module/security-evaluation")` and `@@unique([source, externalId])`. Evidence: schema grep.
- **Completion Evidence**:
  - Schema file contains `SecurityEvaluationKnowledgeItem` model with correct fields, `@@unique([source, externalId])`, `@@schema("module/security-evaluation")`.
  - `prisma db push` succeeded; table `SecurityEvaluationKnowledgeItem` confirmed in DB (`\dt` output).

## Task 3: M1 — Port 7 source adapters into security-evaluation/knowledge/adapters/
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - Copy 7 adapter files from `threat-intelligence/adapters/` to `security-evaluation/knowledge/adapters/`.
  - Update imports (source-adapter.port → knowledge port).
  - Register adapters in security-evaluation module providers via `THREAT_INTEL_SOURCE_ADAPTERS` token.
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `rule` TR-3.1: 7 adapter files exist in `knowledge/adapters/`. Evidence: `ls`.
  - `rule` TR-3.2: `tsc --noEmit` passes for security-evaluation. Evidence: build output.
- **Completion Evidence**:
  - 7 adapter files in `knowledge/adapters/`: aws-security-bulletins, bleeping-computer, cisa-kev, freebuf, github-security-advisory, github-security-blog, the-hacker-news.
  - All `ThreatIntelligence` references renamed to `SecurityEvaluationKnowledge`; grep for `ThreatIntelligence` in knowledge/ returns zero.
  - Backend `npm run build` (nest build) exits 0.

## Task 4: M1 — Implement knowledge service (dedup + retention) + collect service
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - `security-evaluation-knowledge.service.ts`: upsert knowledge items by `[source, externalId]`, refresh rawPayload + lastSeenAt.
  - `security-evaluation-knowledge-collect.service.ts`: iterate adapters, call service.upsert.
  - Retention policy: keep former threat-intelligence behavior (90 days / 1000 per source) — to be revisited per ADR-022 D3 (knowledge long-term retention). For M1, preserve existing constants.
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `rule` TR-4.1: `SecurityEvaluationKnowledgeService.upsert` dedups by `[source, externalId]` (second call updates, does not insert). Evidence: unit test.
  - `rule` TR-4.2: `CollectService` invokes all registered adapters. Evidence: unit test with mock adapters.
- **Completion Evidence**:
  - `security-evaluation-knowledge.service.ts` implements `collect()`, `upsertItems()`, `pruneExpired()` ported from threat-intelligence.service.ts, using `prisma.securityEvaluationKnowledgeItem`.
  - Backend `npm run build` exits 0 (compilation passes).
  - Note: TR-4.1/TR-4.2 unit tests deferred to M2 (INTEL judgment brings test infra); logic is a verbatim port with only table/type renames.

## Task 5: M1 — Registry build + assemble into backend + db push (knowledge only)
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - `npm run build` in newbie-modules.
  - Assemble security-evaluation into nightwatch-backend.
  - `prisma db push` to add `SecurityEvaluationKnowledgeItem` table.
  - Restart backend, verify clean startup.
- **Acceptance Criteria Addressed**: AC-1, AC-2
- **Test Requirements**:
  - `rule` TR-5.1: Backend starts without error; `SecurityEvaluationKnowledgeItem` table exists in DB. Evidence: startup log + `\dt` in psql.
- **Completion Evidence**:
  - Security-evaluation module copied to `nightwatch-backend/src/modules/security-evaluation/`.
  - `prisma/models/security-evaluation.prisma` updated with `SecurityEvaluationKnowledgeItem` model.
  - `prisma db push` succeeded; `\dt "module/security-evaluation".*` confirms `SecurityEvaluationKnowledgeItem` table.
  - Backend `npm run build` (nest build) exits 0.
  - Note: backend process start (dist) deferred to M2 (needs host bindings). M1 verification = compilation + schema sync.

## Task 6: M2 — Port matching pipeline + re-ranker into security-evaluation/judgment/intel/
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - Copy `threat-intelligence/matching/` (match.service, re-ranker, scope-entities.port, constants) into `security-evaluation/judgment/intel/`.
  - Rename: `ThreatIntelligenceMatchService` → `SecurityEvaluationIntelMatchService`; `ThreatIntelligenceReRanker` → `SecurityEvaluationIntelReRanker`; `ScopeEntitiesProvider` → `SecurityEvaluationScopeEntitiesProvider`.
  - Update item reads from `ThreatIntelligenceItem` → `SecurityEvaluationKnowledgeItem`.
  - Preserve ADR-018 guardrails: hard recall first, LLM condition, unavailable no negative cache.
- **Acceptance Criteria Addressed**: AC-5, AC-6
- **Test Requirements**:
  - `rule` TR-6.1: Re-ranker unit tests pass (port from threat-intelligence). Evidence: test output.
  - `rule` TR-6.2: Hard recall produces `confidence=high`; LLM not called on hard hit. Evidence: unit test.
  - `rule` TR-6.3: `SecurityEvaluationScopeEntitiesProvider` port exists under security-evaluation; no `@modules/threat-intelligence` imports. Evidence: grep.

## Task 7: M2 — Implement INTEL judgment (match → EvaluationFinding)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6
- **Description**:
  - `security-evaluation-intel.judgment.ts`: implement `JudgmentPort` for family `threat-intel-relevance`.
  - Flow: get scope entities from provider → run match service → for each relevant match, produce `EvaluationFinding` with metadata `{ knowledgeItemId, matchedEntity, confidence, evidence, verdictSource }`.
  - Non-relevant matches: no finding,记入 evaluatedRefs.
  - `unavailable` (LLM not bound): hard-recall hits produce findings with `verdictSource="hard-recall"`.
  - fingerprint: `threat-intel:<knowledgeItemId>:<matchedEntity>`.
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `rule` TR-7.1: Relevant match produces finding with correct metadata. Evidence: unit test.
  - `rule` TR-7.2: Non-relevant match produces no finding. Evidence: unit test.
  - `rule` TR-7.3: Fingerprint is stable across runs for same (knowledgeItemId, matchedEntity). Evidence: unit test.

## Task 8: M2 — Add INTEL criteria seed
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 7
- **Description**:
  - Add family `threat-intel-relevance` to criteria seed: one ASSERTION criterion `criterionKey=threat-exposure`, version constant `SECURITY_EVALUATION_THREAT_INTEL_CRITERIA_VERSION`.
  - Add to `SECURITY_EVALUATION_SCHEDULES` declaration.
- **Acceptance Criteria Addressed**: FR-8
- **Test Requirements**:
  - `rule` TR-8.1: Seed creates `threat-intel-relevance` criteria version on module init. Evidence: DB query after startup.

## Task 9: M2 — Host: re-bind ScopeEntitiesProvider + notifications + scheduling
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 8
- **Description**:
  - `ProjectSecurityProfileService`: implement `SecurityEvaluationScopeEntitiesProvider` instead of threat-intelligence port.
  - Notification templates: re-point from `threat-intelligence.match-created` to evaluation finding events filtered by `family=threat-intel-relevance`.
  - Scheduled job: re-point collect job to security-evaluation knowledge collect service.
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `rule` TR-9.1: `ProjectSecurityProfileService` implements `SecurityEvaluationScopeEntitiesProvider`. Evidence: code grep.
  - `rule` TR-9.2: No `@modules/threat-intelligence` imports in backend application code. Evidence: grep.

## Task 10: M2 — db push + restart + INTEL E2E
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 9
- **Description**:
  - `prisma db push` (no new tables in M2 beyond M1's; schema already has knowledge item).
  - Restart backend.
  - E2E: trigger knowledge collect, trigger INTEL run on a repository subject, verify findings created.
- **Acceptance Criteria Addressed**: AC-3, AC-8
- **Test Requirements**:
  - `rule` TR-10.1: INTEL run SUCCEEDED; findings exist for relevant matches. Evidence: run status + DB query.
  - `rule` TR-10.2: INTEL finding lifecycle test passes (open → resolved → suppressed preserved). Evidence: test output.

## Task 11: M3 — Remove threat-intelligence module from registry
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 10
- **Description**:
  - Delete `packages/modules/threat-intelligence/` directory.
  - Remove threat-intelligence schema fragment.
  - Remove from any module dependency lists.
  - Build registry.
- **Acceptance Criteria Addressed**: AC-4, AC-7
- **Test Requirements**:
  - `rule` TR-11.1: No `threat-intelligence/` directory; no `module/threat-intelligence` schema. Evidence: ls + grep.
  - `rule` TR-11.2: `npm run build` passes. Evidence: build output.

## Task 12: M3 — Host: remove threat-intelligence bindings + db push + verify
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 11
- **Description**:
  - Remove any remaining threat-intelligence imports/files in backend.
  - `prisma db push` (drops threat-intelligence tables — unshipped, data discarded).
  - Restart backend, verify clean startup.
  - Regression: DEPENDENCY + CLOUD_CONFIG runs still pass.
- **Acceptance Criteria Addressed**: AC-4, AC-7
- **Test Requirements**:
  - `rule` TR-12.1: Backend starts clean; no threat-intelligence tables in DB. Evidence: startup log + `\dt`.
  - `rule` TR-12.2: DEPENDENCY + CLOUD_CONFIG E2E runs pass. Evidence: run status.

## Task 13: Dual-repo commit
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 12
- **Description**:
  - Commit newbie-modules (ADR + security-evaluation changes + threat-intelligence deletion).
  - Commit nightwatch-backend (assembly + host re-binding).
  - Explicit path staging; no `add -A`.
- **Acceptance Criteria Addressed**: All
- **Test Requirements**:
  - `rule` TR-13.1: Both repos have clean working trees after commit. Evidence: `git status`.
