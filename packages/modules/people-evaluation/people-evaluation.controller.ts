import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  CreatePeopleEvaluationPeriodRequestDto,
  CreatePeopleEvaluationRubricVersionRequestDto,
  CreatePeopleEvaluationPeriodResponseDto,
  ListPeopleEvaluationPeriodsRequestDto,
  ListPeopleEvaluationPeriodsResponseDto,
  RecordPeopleEvaluationEvidenceRequestDto,
  CreatePeopleEvaluationRubricVersionResponseDto,
} from "./people-evaluation.dto";
import { PeopleEvaluationService } from "./people-evaluation.service";

@ApiTags("People Evaluation")
@ApiBearerAuth()
@Controller("people")
export class PeopleEvaluationController {
  constructor(private readonly peopleEvaluation: PeopleEvaluationService) {}

  // --- Rubric versions ---------------------------------------------------

  @Get("rubrics/active")
  @ApiOperation({ summary: "Find the currently active rubric version, or null" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationRubricVersionResponseDto, nullable: true })
  findActiveRubric() {
    return this.peopleEvaluation.findActiveRubric();
  }

  @Post("rubrics")
  @ApiOperation({ summary: "Create and publish a new rubric version (ex ante anchor)" })
  @ApiResponse({ status: 201, type: CreatePeopleEvaluationRubricVersionResponseDto })
  createRubricVersion(@Body() body: CreatePeopleEvaluationRubricVersionRequestDto) {
    return this.peopleEvaluation.createRubricVersion(body);
  }

  // --- Evaluation periods ------------------------------------------------

  @Get("periods")
  @ApiOperation({ summary: "List evaluation periods, optionally filtered by type" })
  @ApiResponse({ status: 200, type: ListPeopleEvaluationPeriodsResponseDto })
  listPeriods(@Query() query: ListPeopleEvaluationPeriodsRequestDto) {
    return this.peopleEvaluation.listPeriods(query.type);
  }

  @Get("periods/:id")
  @ApiOperation({ summary: "Get one evaluation period by id" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationPeriodResponseDto })
  getPeriodById(@Param("id") id: string) {
    return this.peopleEvaluation.getPeriodById(id);
  }

  @Post("periods")
  @ApiOperation({ summary: "Create a new evaluation period pinned to an existing rubric version" })
  @ApiResponse({ status: 201, type: CreatePeopleEvaluationPeriodResponseDto })
  createPeriod(@Body() body: CreatePeopleEvaluationPeriodRequestDto) {
    return this.peopleEvaluation.createPeriod(body);
  }

  // --- Evidence (pipeline hook) ------------------------------------------

  @Post("evidences")
  @ApiOperation({ summary: "Append one evidence row for an evaluatee in a collection period" })
  @ApiResponse({ status: 201 })
  recordEvidence(@Body() body: RecordPeopleEvaluationEvidenceRequestDto) {
    return this.peopleEvaluation.recordEvidence(body);
  }
}
