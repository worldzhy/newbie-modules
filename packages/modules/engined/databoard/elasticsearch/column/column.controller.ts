import {Body, Controller, Delete, Get, Param, Patch, Post} from '@nestjs/common';
import {ApiBearerAuth, ApiBody, ApiTags} from '@nestjs/swagger';
import {ElasticsearchDataboardColumn, Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';

@ApiTags('Databoard - Elasticsearch')
@ApiBearerAuth()
@Controller('elasticsearch-databoard-columns')
export class ElasticsearchDataboardColumnController {
  constructor(private prisma: PrismaService) {}

  @Post('')
  @ApiBody({
    description: '',
    examples: {
      a: {
        summary: '1. Create',
        value: {
          name: 'databoard_column_01',
        },
      },
    },
  })
  async createElasticsearchDataboardColumn(
    @Body()
    body: Prisma.ElasticsearchDataboardColumnCreateInput
  ) {
    return await this.prisma.elasticsearchDataboardColumn.create({data: body});
  }

  @Get(':columnId')
  async getElasticsearchDataboardColumn(@Param('columnId') columnId: number): Promise<ElasticsearchDataboardColumn> {
    return await this.prisma.elasticsearchDataboardColumn.findUniqueOrThrow({
      where: {id: columnId},
    });
  }

  @Patch(':columnId')
  @ApiBody({
    description: 'Update column.',
    examples: {
      a: {
        summary: '1. Update name',
        value: {
          name: 'databoard-01',
        },
      },
    },
  })
  async updateElasticsearchDataboardColumn(
    @Param('columnId') columnId: number,
    @Body() body: Prisma.ElasticsearchDataboardColumnUpdateInput
  ): Promise<ElasticsearchDataboardColumn> {
    return await this.prisma.elasticsearchDataboardColumn.update({
      where: {id: columnId},
      data: body,
    });
  }

  @Delete(':columnId')
  async deleteElasticsearchDataboardColumn(@Param('columnId') columnId: number): Promise<ElasticsearchDataboardColumn> {
    return await this.prisma.elasticsearchDataboardColumn.delete({
      where: {id: columnId},
    });
  }

  /* End */
}
