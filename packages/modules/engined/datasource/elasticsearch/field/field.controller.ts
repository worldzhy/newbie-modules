import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ElasticsearchDatasourceIndexField, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@ApiTags("Datasource - Elasticsearch")
@ApiBearerAuth()
@Controller("elasticsearch-datasource-index-fields")
export class ElasticsearchDatasourceIndexFieldController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("")
  @ApiBody({
    description: "The 'name' is required in request body.",
    examples: {
      a: {
        summary: "1. Create field",
        value: {
          indexId: "1",
          name: "example_index_field_name",
        },
      },
    },
  })
  @ApiCreatedResponse()
  async createElasticsearchDatasourceIndexField(
    @Body() body: Prisma.ElasticsearchDatasourceIndexFieldUncheckedCreateInput,
  ): Promise<ElasticsearchDatasourceIndexField> {
    return await this.prisma.elasticsearchDatasourceIndexField.create({
      data: body,
    });
  }

  @Get("")
  @ApiOkResponse()
  async getElasticsearchDatasourceIndexFields(@Query("page") _page: number, @Query("pageSize") _pageSize: number) {}

  @Get(":indexId")
  @ApiOkResponse()
  async getElasticsearchDatasourceIndexField(
    @Param("indexId") indexId: number,
  ): Promise<ElasticsearchDatasourceIndexField | null> {
    return await this.prisma.elasticsearchDatasourceIndexField.findUnique({
      where: { id: indexId },
    });
  }

  @Patch(":indexId")
  @ApiOkResponse()
  async updateElasticsearchDatasourceIndexField(
    @Param("indexId") indexId: number,
    @Body() body: Prisma.ElasticsearchDatasourceIndexFieldUpdateInput,
  ): Promise<ElasticsearchDatasourceIndexField> {
    return await this.prisma.elasticsearchDatasourceIndexField.update({
      where: { id: indexId },
      data: body,
    });
  }

  @Delete(":indexId")
  @ApiOkResponse()
  async deleteElasticsearchDatasourceIndexField(
    @Param("indexId") indexId: number,
  ): Promise<ElasticsearchDatasourceIndexField> {
    return await this.prisma.elasticsearchDatasourceIndexField.delete({
      where: { id: indexId },
    });
  }

  /* End */
}
