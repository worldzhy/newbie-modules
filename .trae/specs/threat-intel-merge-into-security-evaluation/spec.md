# Threat-Intelligence Merge into Security-Evaluation - PRD

## Overview
- **Summary**: Merge the `threat-intelligence` module's collect + match capability into `security-evaluation` as its `knowledge/` (collection) and `judgment/intel/` (matching) subdomains. Decommission the standalone `threat-intelligence` module.
- **Purpose**: Eliminate the duplicated intel pipeline (ADR-022's "two matching systems" tax) and place knowledge acquisition + intel judgment inside the security-evaluation bounded context where they belong.
- **Target Users**: Registry module maintainers; nightwatch-backend host assemblers.

## Goals
- `security-evaluation` owns the full intel pipeline: source adapters, knowledge item dedup/retention, hard-recall + LLM re-rank matching, and INTEL judgment producing `EvaluationFinding`.
- Standalone `threat-intelligence` module is removed (code + schema + host bindings).
- ADR-018 guardrails preserved verbatim (hard recall first, LLM only when severity >= medium or signalTags present, `unavailable` does not write negative cache, temperature=0 + forced JSON).
- No host concept leaks into registry (`scopeType`/`scopeId` stay generic).

## Non-Goals
- Redesigning the matching algorithm (B3 protocol reused as-is).
- Changing the 7 source adapters' fetch logic.
- Frontend UI for INTEL findings (deferred to slice 4).
- Activating host cron schedules (host decision, out of scope).
- Multi-axis report aggregation (slice 4).

## Background & Context
- ADR-022 originally decided four modules coexist with "two matching systems" as an accepted cost. Now that security-evaluation has proven viable (DEPENDENCY + CLOUD_CONFIG shipped), the coexistence tax is unjustified.
- ADR-018 (threat-intelligence collect + organize下沉 registry) delivered 7 adapters + matching pipeline + re-ranker + `ThreatIntelligenceItem`/`ThreatIntelligenceMatch` tables + `ScopeEntitiesProvider` port.
- threat-intelligence match scope is generic (`scopeType`/`scopeId`, no FK); host currently injects `scopeType="project"`.
- Existing security-evaluation: DEPENDENCY (OSV) + CLOUD_CONFIG (CIS + aws-custom) judgments, Asset/AssetFact, unified finding lifecycle.

## Functional Requirements
- **FR-1**: `security-evaluation/knowledge/` contains 7 source adapters (GHSA, CISA KEV, AWS Bulletins, GitHub Security Blog, FreeBuf, THN, BleepingComputer) producing `SecurityEvaluationKnowledgeItem` rows.
- **FR-2**: `SecurityEvaluationKnowledgeItem` table exists in `module/security-evaluation` schema with same fields as former `ThreatIntelligenceItem` (source, externalId, title, severity, signalTags, rawPayload, fetchedAt, lastSeenAt, dedup key `[source, externalId]`).
- **FR-3**: `security-evaluation/judgment/intel/` contains the matching pipeline (hard entity recall + LLM structured re-rank) ported from threat-intelligence `matching/`.
- **FR-4**: INTEL judgment produces `EvaluationFinding` (family `threat-intel-relevance`), with `metadata = { knowledgeItemId, matchedEntity, confidence, evidence, verdictSource }`. No separate match table.
- **FR-5**: `ScopeEntitiesProvider` port is re-homed under `security-evaluation` (renamed `SecurityEvaluationScopeEntitiesProvider`), contract unchanged.
- **FR-6**: `threat-intelligence` module directory, schema, and host bindings (ScopeEntitiesProvider impl, notification templates, scheduled job) are removed.
- **FR-7**: ADR-018 guardrails preserved: hard recall produces `confidence=high`; LLM only介入 when no hard hit AND (severity >= medium OR signalTags non-empty); `semanticMatch` alone never passes; `unavailable` does not write negative cache.
- **FR-8**: INTEL criteria seed: family `threat-intel-relevance`, one ASSERTION criterion `criterionKey=threat-exposure`.

## Non-Functional Requirements
- **NFR-1**: Registry has zero cross-schema reads (security-evaluation reads only its own schema).
- **NFR-2**: No host concept (`project`, `application`) appears in registry code.
- **NFR-3**: Behavior-level tests cover INTEL finding lifecycle (open on relevant match, resolved on non-relevant re-evaluation, suppression preserved).

## Constraints
- **Technical**: Unshipped system — no migration files; `prisma db push` only. Data can be discarded.
- **Technical**: Code repository English-only (comments, README, commits). Exception: `.trae/` and `worldzhy-knowledge`.
- **Dependencies**: security-evaluation `moduleDependencies` gains `llm` (already declared for slice 3).
- **Business**: threat-intelligence module decommission is approved direction (user confirmed 2026-10-27).

## Assumptions
- Host `ProjectSecurityProfileService` will be re-bound to `SecurityEvaluationScopeEntitiesProvider` with no change to its entity-building logic.
- Host notification templates currently listening to `threat-intelligence.match-created` will be re-pointed to evaluation finding lifecycle events filtered by `family=threat-intel-relevance`.
- The 7 adapters require no modification beyond import path changes.

## Acceptance Criteria

### AC-1: Knowledge subdomain exists with all 7 adapters
- **Type**: `rule`
- **Given**: A fresh `npm run build` of newbie-modules
- **When**: Inspecting `packages/modules/security-evaluation/knowledge/adapters/`
- **Then**: All 7 adapter files exist and compile
- **Pass Condition**: `ls` shows 7 adapter .ts files; `tsc --noEmit` exits 0
- **Evidence**: Build output + directory listing

### AC-2: SecurityEvaluationKnowledgeItem table in module schema
- **Type**: `rule`
- **Given**: `prisma/schema.prisma` of security-evaluation
- **When**: Reading the schema
- **Then**: `SecurityEvaluationKnowledgeItem` model exists in `module/security-evaluation` schema with dedup key `[source, externalId]`
- **Pass Condition**: Schema grep confirms model + @@unique + @@schema
- **Evidence**: Schema file content

### AC-3: INTEL judgment produces EvaluationFinding
- **Type**: `rule`
- **Given**: An INTEL run with a relevant match
- **When**: Judgment executes
- **Then**: An `EvaluationFinding` row is created with `family=threat-intel-relevance` and metadata containing `knowledgeItemId`, `matchedEntity`, `confidence`
- **Pass Condition**: DB query returns the finding with correct metadata
- **Evidence**: E2E run output + DB query

### AC-4: No standalone threat-intelligence module
- **Type**: `rule`
- **Given**: newbie-modules repo
- **When**: Checking `packages/modules/`
- **Then**: No `threat-intelligence/` directory exists; no `module/threat-intelligence` schema in any prisma fragment
- **Pass Condition**: `ls packages/modules/ | grep threat` returns nothing; schema grep returns nothing
- **Evidence**: Directory listing + schema grep

### AC-5: ADR-018 guardrails preserved
- **Type**: `rule`
- **Given**: INTEL matching code
- **When**: Reviewing re-ranker invocation logic
- **Then**: Hard recall runs first; LLM only called when no hard hit AND (severity >= medium OR signalTags non-empty); `unavailable` path skips negative cache write
- **Pass Condition**: Code inspection confirms all three guardrails
- **Evidence**: Code review of intel-match.service.ts

### AC-6: ScopeEntitiesProvider re-homed
- **Type**: `rule`
- **Given**: security-evaluation module
- **When**: Searching for `ScopeEntitiesProvider`
- **Then**: Port interface exists under `security-evaluation/`; no import from `@modules/threat-intelligence`
- **Pass Condition**: Grep confirms port location and no cross-module import
- **Evidence**: Grep output

### AC-7: Registry has no cross-schema reads
- **Type**: `rule`
- **Given**: security-evaluation source
- **When**: Searching for `module/threat-intelligence` or `ThreatIntelligence` in security-evaluation code
- **Then**: No references found
- **Pass Condition**: Grep returns zero matches in `packages/modules/security-evaluation/`
- **Evidence**: Grep output

### AC-8: INTEL finding lifecycle behavior test passes
- **Type**: `rule`
- **Given**: Behavior test suite
- **When**: Running INTEL finding lifecycle tests
- **Then**: Tests pass for: relevant match → finding open; non-relevant re-evaluation → finding resolved; manually suppressed finding stays suppressed on re-run
- **Pass Condition**: Test runner exits 0
- **Evidence**: Test output

## Open Questions
- [ ] None — direction confirmed by user (2026-10-27).
