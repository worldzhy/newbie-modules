import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import {
  CreatePeopleEvaluationPeriodRequestDto,
  CreatePeopleEvaluationRubricVersionRequestDto,
  CreatePeopleEvaluationPeriodResponseDto,
  ListPeopleEvaluationPeriodsRequestDto,
  ListPeopleEvaluationPeriodsResponseDto,
  UpdatePeopleEvaluationPeriodStatusRequestDto,
  CreatePeopleEvaluationRubricVersionResponseDto,
} from "./people-evaluation.dto";
import { PeopleEvaluationService } from "./people-evaluation.service";

/**
 * People-evaluation administration surface.
 *
 * All routes are system-level (the evaluation is cross-project and keyed by
 * user, not by project): the identity provider grants them to the supervisor
 * role via `*:Manage`. Evidence is intentionally NOT exposed over HTTP —
 * collection runners write it directly, so there is no route through which a
 * caller could forge evidence for another evaluatee.
 */
@ApiTags("People Evaluation")
@ApiBearerAuth()
@Controller("people")
export class PeopleEvaluationController {
  constructor(private readonly peopleEvaluation: PeopleEvaluationService) {}

  // --- Rubric versions ---------------------------------------------------

  @Get("rubrics/active")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationRubricVersion)
  @ApiOperation({ summary: "Find the currently active rubric version, or null" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationRubricVersionResponseDto, nullable: true })
  findActiveRubric() {
    return this.peopleEvaluation.findActiveRubric();
  }

  @Post("rubrics")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationRubricVersion)
  @ApiOperation({ summary: "Create and publish a new rubric version (ex ante anchor)" })
  @ApiResponse({ status: 201, type: CreatePeopleEvaluationRubricVersionResponseDto })
  createRubricVersion(@Body() body: CreatePeopleEvaluationRubricVersionRequestDto) {
    return this.peopleEvaluation.createRubricVersion(body);
  }

  // --- Evaluation periods ------------------------------------------------

  @Get("periods")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "List evaluation periods, optionally filtered by type" })
  @ApiResponse({ status: 200, type: ListPeopleEvaluationPeriodsResponseDto })
  listPeriods(@Query() query: ListPeopleEvaluationPeriodsRequestDto) {
    return this.peopleEvaluation.listPeriods(query);
  }

  @Get("periods/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Get one evaluation period by id" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationPeriodResponseDto })
  getPeriodById(@Param("id") id: string) {
    return this.peopleEvaluation.getPeriodById(id);
  }

  @Post("periods")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Create a new evaluation period pinned to an existing rubric version" })
  @ApiResponse({ status: 201, type: CreatePeopleEvaluationPeriodResponseDto })
  createPeriod(@Body() body: CreatePeopleEvaluationPeriodRequestDto) {
    return this.peopleEvaluation.createPeriod(body);
  }

  @Patch("periods/:id/status")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Advance a period through UPCOMING → ACTIVE → CLOSED" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationPeriodResponseDto })
  transitionPeriodStatus(@Param("id") id: string, @Body() body: UpdatePeopleEvaluationPeriodStatusRequestDto) {
    return this.peopleEvaluation.transitionPeriodStatus(id, body.status);
  }
}
