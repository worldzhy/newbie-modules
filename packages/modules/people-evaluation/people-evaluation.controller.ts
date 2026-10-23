import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  CreatePeopleEvaluationPeriodDto,
  CreatePeopleEvaluationRubricVersionDto,
  PeopleEvaluationPeriodDto,
  ListPeopleEvaluationPeriodsQueryDto,
  RecordPeopleEvaluationEvidenceDto,
  PeopleEvaluationRubricVersionDto,
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
  @ApiResponse({ status: 200, type: PeopleEvaluationRubricVersionDto, nullable: true })
  findActiveRubric() {
    return this.peopleEvaluation.findActiveRubric();
  }

  @Post("rubrics")
  @ApiOperation({ summary: "Create and publish a new rubric version (ex ante anchor)" })
  @ApiResponse({ status: 201, type: PeopleEvaluationRubricVersionDto })
  createRubricVersion(@Body() body: CreatePeopleEvaluationRubricVersionDto) {
    return this.peopleEvaluation.createRubricVersion(body);
  }

  // --- Evaluation periods ------------------------------------------------

  @Get("periods")
  @ApiOperation({ summary: "List evaluation periods, optionally filtered by type" })
  @ApiResponse({ status: 200, type: [PeopleEvaluationPeriodDto] })
  listPeriods(@Query() query: ListPeopleEvaluationPeriodsQueryDto) {
    return this.peopleEvaluation.listPeriods(query.type);
  }

  @Get("periods/:id")
  @ApiOperation({ summary: "Get one evaluation period by id" })
  @ApiResponse({ status: 200, type: PeopleEvaluationPeriodDto })
  getPeriodById(@Param("id") id: string) {
    return this.peopleEvaluation.getPeriodById(id);
  }

  @Post("periods")
  @ApiOperation({ summary: "Create a new evaluation period pinned to an existing rubric version" })
  @ApiResponse({ status: 201, type: PeopleEvaluationPeriodDto })
  createPeriod(@Body() body: CreatePeopleEvaluationPeriodDto) {
    return this.peopleEvaluation.createPeriod(body);
  }

  // --- Evidence (pipeline hook) ------------------------------------------

  @Post("evidences")
  @ApiOperation({ summary: "Append one evidence row for an evaluatee in a collection period" })
  @ApiResponse({ status: 201 })
  recordEvidence(@Body() body: RecordPeopleEvaluationEvidenceDto) {
    return this.peopleEvaluation.recordEvidence(body);
  }
}
