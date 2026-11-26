import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { EvaluationFindingSeverity, EvaluationFindingStatus, EvaluationRunStatus } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

import {
  PENETRATION_TESTING_AUTHORIZATION_STATUSES,
  PENETRATION_TESTING_ENVIRONMENTS,
  PENETRATION_TESTING_EXECUTION_OUTCOMES,
  PENETRATION_TESTING_LEVELS,
  PENETRATION_TESTING_PATH_ROLES,
  PENETRATION_TESTING_TEST_OBJECT_KINDS,
  PENETRATION_TESTING_VERIFICATION_METHODS,
  type PenetrationTestingEnvironment,
  type PenetrationTestingExecutionOutcome,
  type PenetrationTestingLevel,
  type PenetrationTestingTestObjectKind,
} from "./penetration-testing.constants";

const MAX_DECLARED_PORTS = 64;

// --- Path params ---------------------------------------------------------

export class PenetrationTestingTargetParamsDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;
}

export class PenetrationTestingAuthorizationParamsDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  id!: string;
}

export class PenetrationTestingTestObjectParamsDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  id!: string;
}

export class PenetrationTestingRunParamsDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  runId!: string;
}

// --- Targets -------------------------------------------------------------

/**
 * Register (or refresh) one web target. Origin carries only scheme/host/port;
 * path-level scope belongs to `targetPaths`, keyed by a declared role.
 */
export class CreatePenetrationTestingTargetRequestDto {
  @ApiProperty({ description: "Origin the target is identified by, e.g. https://staging.example.com" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  origin!: string;

  @ApiPropertyOptional({ description: "Label shown in the console; defaults to the normalized origin" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiProperty({ enum: PENETRATION_TESTING_ENVIRONMENTS, description: "L4 is admitted only in NON_PRODUCTION" })
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_ENVIRONMENTS)
  environment!: PenetrationTestingEnvironment;

  @ApiPropertyOptional({
    type: Number,
    isArray: true,
    description: "Declared ports; empty means the scheme default",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DECLARED_PORTS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(65_535, { each: true })
  declaredPorts?: number[];

  @ApiPropertyOptional({
    type: Object,
    example: { entry: "/", "api.session": "/api/me" },
    description: `Path role → absolute path; roles: ${PENETRATION_TESTING_PATH_ROLES.join(", ")}`,
  })
  @IsOptional()
  @IsObject()
  targetPaths?: Record<string, string>;
}

/** Patch the declared material of an existing target; omitted fields keep their value. */
export class UpdatePenetrationTestingTargetRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ enum: PENETRATION_TESTING_ENVIRONMENTS })
  @IsOptional()
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_ENVIRONMENTS)
  environment?: PenetrationTestingEnvironment;

  @ApiPropertyOptional({ type: Number, isArray: true, description: "Replaces the declared port set when present" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DECLARED_PORTS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(65_535, { each: true })
  declaredPorts?: number[];

  @ApiPropertyOptional({
    type: Object,
    description: "Replaces the path role map when present; omitted roles are dropped",
  })
  @IsOptional()
  @IsObject()
  targetPaths?: Record<string, string>;
}

export class ListPenetrationTestingTargetsRequestDto {
  @ApiPropertyOptional({ enum: PENETRATION_TESTING_ENVIRONMENTS })
  @IsOptional()
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_ENVIRONMENTS)
  environment?: PenetrationTestingEnvironment;

  @ApiPropertyOptional({ description: "Filter by ownership-verification status" })
  @IsOptional()
  @IsString()
  verificationStatus?: string;

  @ApiPropertyOptional({ description: "Filter by the active flag" })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class PenetrationTestingTargetRegistrationResponseDto {
  @ApiProperty() subjectId!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ enum: PENETRATION_TESTING_ENVIRONMENTS }) environment!: PenetrationTestingEnvironment;
  @ApiProperty({ description: "PENDING | VERIFIED | FAILED | REVOKED" }) verificationStatus!: string;
  @ApiProperty({ description: "Publish this token to prove ownership; it is never returned by reads" })
  verificationToken!: string;
}

export class PenetrationTestingTargetMaterialResponseDto {
  @ApiProperty() subjectId!: string;
  @ApiProperty() origin!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: PENETRATION_TESTING_ENVIRONMENTS }) environment!: PenetrationTestingEnvironment;
  @ApiProperty({ type: Number, isArray: true }) ports!: number[];
  @ApiProperty({ type: Object }) targetPaths!: Record<string, string>;
  @ApiProperty({ description: "PENDING | VERIFIED | FAILED | REVOKED" }) verificationStatus!: string;
  @ApiPropertyOptional({ enum: PENETRATION_TESTING_VERIFICATION_METHODS, nullable: true })
  verificationMethod?: string | null;
  @ApiProperty() verificationFailureCount!: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) verifiedAt?: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) lastVerifiedAt?: Date | null;
  @ApiProperty() isActive!: boolean;
}

export class PenetrationTestingTargetListResponseDto {
  @ApiProperty({ type: PenetrationTestingTargetMaterialResponseDto, isArray: true })
  targets!: PenetrationTestingTargetMaterialResponseDto[];
}

export class PenetrationTestingVerificationChallengeResponseDto {
  @ApiProperty() subjectId!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ description: "Publish exactly this value at either placement" }) verificationToken!: string;
  @ApiProperty({ type: Object, description: "{ name, value } for the DNS TXT record" })
  dnsTxt!: { name: string; value: string };
  @ApiProperty({ type: Object, description: "{ url, body } for the well-known file" })
  wellKnown!: { url: string; body: string };
}

export class PenetrationTestingVerificationCheckResponseDto {
  @ApiProperty() subjectId!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ description: "PENDING | VERIFIED | FAILED | REVOKED" }) status!: string;
  @ApiPropertyOptional({ type: Date, nullable: true }) verifiedAt?: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) lastVerifiedAt?: Date | null;
  @ApiProperty() consecutiveFailures!: number;
}

// --- Authorizations ------------------------------------------------------

/**
 * Absolute window an L4 action may run in. `start`/`end` are ISO-8601 instants
 * (a time of day alone cannot be ordered against the wall clock); `timezone`
 * is a label for operators.
 */
export class PenetrationTestingMaintenanceWindowDto {
  @ApiProperty({ example: "2026-11-21T02:00:00+08:00", description: "Window start as an ISO-8601 instant" })
  @IsString()
  @IsISO8601()
  start!: string;

  @ApiProperty({ example: "2026-11-21T04:00:00+08:00", description: "Window end as an ISO-8601 instant" })
  @IsString()
  @IsISO8601()
  end!: string;

  @ApiProperty({ example: "Asia/Shanghai" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  timezone!: string;
}

/** Written authorization request; the requester is taken from the session, never the body. */
export class RequestPenetrationTestingAuthorizationRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ enum: PENETRATION_TESTING_LEVELS })
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_LEVELS)
  level!: PenetrationTestingLevel;

  @ApiProperty({ description: "Reference to the signed rules-of-engagement document" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  roeDocumentRef!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  scopeNote?: string;

  @ApiPropertyOptional({ type: Date, description: "Defaults to now" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  @ApiProperty({ type: Date })
  @Type(() => Date)
  @IsDate()
  validUntil!: Date;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: "Allowed target ranges; empty means public addresses only",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedCidrs?: string[];

  @ApiPropertyOptional({ type: String, format: "uuid", description: "L3 only" })
  @IsOptional()
  @IsUUID()
  findingId?: string;

  @ApiPropertyOptional({ description: "L3 only: the one attack class allowed" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  attackClass?: string;

  @ApiPropertyOptional({ type: PenetrationTestingMaintenanceWindowDto, description: "L4 only" })
  @IsOptional()
  @ValidateNested()
  @Type(() => PenetrationTestingMaintenanceWindowDto)
  maintenanceWindow?: PenetrationTestingMaintenanceWindowDto;
}

export class RevokePenetrationTestingAuthorizationRequestDto {
  @ApiProperty({ description: "Why the authorization is withdrawn; stored on the row" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  reason!: string;
}

export class ListPenetrationTestingAuthorizationsRequestDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ enum: PENETRATION_TESTING_LEVELS })
  @IsOptional()
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_LEVELS)
  level?: PenetrationTestingLevel;

  @ApiPropertyOptional({ enum: PENETRATION_TESTING_AUTHORIZATION_STATUSES })
  @IsOptional()
  @IsIn(PENETRATION_TESTING_AUTHORIZATION_STATUSES)
  status?: string;
}

export class PenetrationTestingAuthorizationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ enum: PENETRATION_TESTING_LEVELS }) level!: PenetrationTestingLevel;
  @ApiProperty({ enum: PENETRATION_TESTING_AUTHORIZATION_STATUSES }) status!: string;
  @ApiProperty() roeDocumentRef!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) scopeNote?: string | null;
  @ApiProperty() requestedBy!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) approvedBy?: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) approvedAt?: Date | null;
  @ApiProperty({ type: Date }) validFrom!: Date;
  @ApiProperty({ type: Date }) validUntil!: Date;
  @ApiProperty({ type: String, isArray: true }) allowedCidrs!: string[];
  @ApiPropertyOptional({ type: String, nullable: true }) findingId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) attackClass?: string | null;
  @ApiPropertyOptional({ type: PenetrationTestingMaintenanceWindowDto, nullable: true })
  maintenanceWindow?: PenetrationTestingMaintenanceWindowDto | null;
}

export class PenetrationTestingAuthorizationListResponseDto {
  @ApiProperty({ type: PenetrationTestingAuthorizationResponseDto, isArray: true })
  authorizations!: PenetrationTestingAuthorizationResponseDto[];
}

// --- L4 test objects -----------------------------------------------------

export class CreatePenetrationTestingTestObjectRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ enum: PENETRATION_TESTING_TEST_OBJECT_KINDS })
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_TEST_OBJECT_KINDS)
  kind!: PenetrationTestingTestObjectKind;

  @ApiProperty({ type: Object, description: 'Playbook scope, e.g. { table: "orders", id: "..." }' })
  @IsObject()
  locator!: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  cleanupLocator?: Record<string, unknown>;

  @ApiProperty({ description: "Must be true before a second operator can approve it" })
  @IsBoolean()
  disposable!: boolean;

  @ApiProperty({ type: Date })
  @Type(() => Date)
  @IsDate()
  expiresAt!: Date;
}

export class ListPenetrationTestingTestObjectsRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;
}

export class PenetrationTestingTestObjectResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ enum: PENETRATION_TESTING_TEST_OBJECT_KINDS }) kind!: PenetrationTestingTestObjectKind;
  @ApiProperty({ type: Object }) locator!: Record<string, unknown>;
  @ApiPropertyOptional({ type: Object, nullable: true }) cleanupLocator?: Record<string, unknown> | null;
  @ApiProperty() disposable!: boolean;
  @ApiProperty() createdBy!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) approvedBy?: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) approvedAt?: Date | null;
  @ApiProperty({ type: Date }) expiresAt!: Date;
}

export class PenetrationTestingTestObjectListResponseDto {
  @ApiProperty({ type: PenetrationTestingTestObjectResponseDto, isArray: true })
  testObjects!: PenetrationTestingTestObjectResponseDto[];
}

// --- Playbooks -----------------------------------------------------------

export class PenetrationTestingPlaybookResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() attackClass!: string;
  @ApiProperty({ enum: PENETRATION_TESTING_TEST_OBJECT_KINDS }) testObjectKind!: PenetrationTestingTestObjectKind;
  @ApiProperty() description!: string;
}

export class PenetrationTestingPlaybookListResponseDto {
  @ApiProperty({ type: PenetrationTestingPlaybookResponseDto, isArray: true })
  playbooks!: PenetrationTestingPlaybookResponseDto[];
}

// --- Runs ----------------------------------------------------------------

/**
 * Trigger one run. The gate reloads the target, authorization and L4 test
 * object from the database, so `judgmentConfig` is intent only; it must carry
 * `standardKey` (one of the module's four keys), and for L4 `playbookId` plus
 * `testObjectId`.
 */
export class StartPenetrationTestingRunRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ type: Object, description: "Opaque per-run feature config (ADR-023)" })
  @IsOptional()
  @IsObject()
  judgmentConfig?: Record<string, unknown>;
}

export class PenetrationTestingRunAcceptedResponseDto {
  @ApiProperty({ description: "The dispatched run; poll the run list for its row" })
  runId!: string;
}

export class ListPenetrationTestingRunsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ enum: EvaluationRunStatus })
  @IsOptional()
  @IsIn(Object.values(EvaluationRunStatus))
  @IsEnum(EvaluationRunStatus)
  status?: EvaluationRunStatus;
}

export class PenetrationTestingRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() ruleSetVersionId!: string;
  @ApiProperty({ description: 'Evaluation key of the run, e.g. "attack-surface"' }) standardKey!: string;
  @ApiProperty({ description: 'Criteria version label of the run, e.g. "v1"' }) ruleSetVersion!: string;
  @ApiProperty({ enum: EvaluationRunStatus }) status!: EvaluationRunStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) requestedBy?: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) judgmentConfig?: object | null;
  @ApiPropertyOptional({ type: String, nullable: true }) failureReason?: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) startedAt?: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) finishedAt?: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) createdAt?: Date | null;
}

export class ListPenetrationTestingRunsResponseDto extends CommonListResponseDto<PenetrationTestingRunResponseDto> {
  @ApiProperty({ type: PenetrationTestingRunResponseDto, isArray: true })
  declare records: PenetrationTestingRunResponseDto[];
}

// --- Findings / results (skeleton read models) ---------------------------

/**
 * Findings are shared with the other evaluation features, so a read must be
 * anchored on one subject: an unanchored list would mix this feature's findings
 * with security-evaluation's.
 */
export class ListPenetrationTestingFindingsRequestDto extends CommonListRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ description: 'Restrict to one key, e.g. "vulnerability-scan"' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  standardKey?: string;

  @ApiPropertyOptional({ enum: EvaluationFindingStatus })
  @IsOptional()
  @IsIn(Object.values(EvaluationFindingStatus))
  @IsEnum(EvaluationFindingStatus)
  status?: EvaluationFindingStatus;

  @ApiPropertyOptional({ enum: EvaluationFindingSeverity })
  @IsOptional()
  @IsIn(Object.values(EvaluationFindingSeverity))
  @IsEnum(EvaluationFindingSeverity)
  severity?: EvaluationFindingSeverity;
}

export class PenetrationTestingFindingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() standardKey!: string;
  @ApiProperty() fingerprint!: string;
  @ApiProperty() criterionKey!: string;
  @ApiProperty({ enum: EvaluationFindingSeverity }) severity!: EvaluationFindingSeverity;
  @ApiProperty({ enum: EvaluationFindingStatus }) status!: EvaluationFindingStatus;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) metadata?: object | null;
  @ApiPropertyOptional({ type: String, nullable: true }) firstSeenRunId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lastSeenRunId?: string | null;
  @ApiProperty({ type: Date }) firstSeenAt!: Date;
  @ApiProperty({ type: Date }) lastSeenAt!: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) resolvedAt?: Date | null;
}

export class ListPenetrationTestingFindingsResponseDto extends CommonListResponseDto<PenetrationTestingFindingResponseDto> {
  @ApiProperty({ type: PenetrationTestingFindingResponseDto, isArray: true })
  declare records: PenetrationTestingFindingResponseDto[];
}

export class ListPenetrationTestingResultsRequestDto extends CommonListRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  ruleSetVersionId?: string;
}

export class PenetrationTestingResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() runId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() ruleSetVersionId!: string;
  @ApiProperty({ type: Object }) coverageStats!: object;
  @ApiProperty({ type: Object, isArray: true }) verdicts!: object[];
  @ApiPropertyOptional({ type: String, nullable: true }) summary?: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) metadata?: object | null;
  @ApiProperty() manifestHash!: string;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class ListPenetrationTestingResultsResponseDto extends CommonListResponseDto<PenetrationTestingResultResponseDto> {
  @ApiProperty({ type: PenetrationTestingResultResponseDto, isArray: true })
  declare records: PenetrationTestingResultResponseDto[];
}

// --- Executions (audit trail, ADR-075 §3) --------------------------------

export class PenetrationTestingExecutionParamsDto {
  @ApiProperty({ description: "The execution's auditId (correlation id)", type: String })
  @IsString()
  @IsNotEmpty()
  auditId!: string;
}

export class ListPenetrationTestingExecutionsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, format: "uuid", description: "Anchor on one subject" })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ type: String, format: "uuid", description: "Filter to one skeleton run" })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ enum: PENETRATION_TESTING_LEVELS })
  @IsOptional()
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_LEVELS)
  level?: PenetrationTestingLevel;

  @ApiPropertyOptional({ enum: PENETRATION_TESTING_EXECUTION_OUTCOMES })
  @IsOptional()
  @Type(() => String)
  @IsIn(PENETRATION_TESTING_EXECUTION_OUTCOMES)
  outcome?: PenetrationTestingExecutionOutcome;
}

export class PenetrationTestingExecutionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "Correlation id matching the run's judgmentConfig.auditId" }) auditId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) runId?: string | null;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ enum: PENETRATION_TESTING_LEVELS }) level!: PenetrationTestingLevel;
  @ApiProperty() standardKey!: string;
  @ApiProperty() authorizationId!: string;
  @ApiProperty({ type: Object, description: "Addresses the execution declared it would touch" }) snapshot!: object;
  @ApiProperty() outcome!: string;
  @ApiProperty() requestCount!: number;
  @ApiProperty({ type: Date }) startedAt!: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) finishedAt?: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) killedAt?: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) killReason?: string | null;
}

export class ListPenetrationTestingExecutionsResponseDto extends CommonListResponseDto<PenetrationTestingExecutionResponseDto> {
  @ApiProperty({ type: PenetrationTestingExecutionResponseDto, isArray: true })
  declare records: PenetrationTestingExecutionResponseDto[];
}

// --- Run stop ------------------------------------------------------------

export class StopPenetrationTestingRunRequestDto {
  @ApiPropertyOptional({ description: "Why the run is being stopped; stored on the run row's failureReason" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
