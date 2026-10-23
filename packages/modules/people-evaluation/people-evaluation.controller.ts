import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  CreateEvaluationPeriodDto,
  CreateRubricVersionDto,
  EvaluationPeriodDto,
  ListPeriodsQueryDto,
  RecordEvidenceDto,
  RubricVersionDto,
} from "./people-evaluation.dto";
import { PeopleEvaluationService } from "./people-evaluation.service";

@ApiTags("People Evaluation")
@ApiBearerAuth()
@Controller()
export class PeopleEvaluationController {
  constructor(private readonly peopleEvaluation: PeopleEvaluationService) {}

  // --- Rubric versions ---------------------------------------------------

  @Get("people-rubrics/active")
  @ApiOperation({ summary: "Find the currently active rubric version, or null" })
  @ApiResponse({ status: 200, type: RubricVersionDto, nullable: true })
  findActiveRubric() {
    return this.peopleEvaluation.findActiveRubric();
  }

  @Post("people-rubrics")
  @ApiOperation({ summary: "Create and publish a new rubric version (ex ante anchor)" })
  @ApiResponse({ status: 201, type: RubricVersionDto })
  createRubricVersion(@Body() body: CreateRubricVersionDto) {
    return this.peopleEvaluation.createRubricVersion(body);
  }

  // --- Evaluation periods ------------------------------------------------

  @Get("people-evaluation-periods")
  @ApiOperation({ summary: "List evaluation periods, optionally filtered by type" })
  @ApiResponse({ status: 200, type: [EvaluationPeriodDto] })
  listPeriods(@Query() query: ListPeriodsQueryDto) {
    return this.peopleEvaluation.listPeriods(query.type);
  }

  @Get("people-evaluation-periods/:id")
  @ApiOperation({ summary: "Get one evaluation period by id" })
  @ApiResponse({ status: 200, type: EvaluationPeriodDto })
  getPeriod(@Param("id") id: string) {
    return this.peopleEvaluation.getPeriod(id);
  }

  @Post("people-evaluation-periods")
  @ApiOperation({ summary: "Create a new evaluation period pinned to an existing rubric version" })
  @ApiResponse({ status: 201, type: EvaluationPeriodDto })
  createPeriod(@Body() body: CreateEvaluationPeriodDto) {
    return this.peopleEvaluation.createPeriod(body);
  }

  // --- Evidence (pipeline hook) ------------------------------------------

  @Post("people-evidences")
  @ApiOperation({ summary: "Append one evidence row for an evaluatee in a collection period" })
  @ApiResponse({ status: 201 })
  recordEvidence(@Body() body: RecordEvidenceDto) {
    return this.peopleEvaluation.recordEvidence(body);
  }
}
