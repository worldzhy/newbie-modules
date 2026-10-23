import { Global, Module } from "@nestjs/common";
import { PeopleEvaluationController } from "./people-evaluation.controller";
import { PeopleEvaluationService } from "./people-evaluation.service";

@Global()
@Module({
  controllers: [PeopleEvaluationController],
  providers: [PeopleEvaluationService],
  exports: [PeopleEvaluationService],
})
export class PeopleEvaluationModule {}
