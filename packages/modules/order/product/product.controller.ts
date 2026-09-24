import {Body, Controller, Delete, Get, Param, Patch, Post, Query} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiResponse} from '@nestjs/swagger';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Prisma} from '@generated/prisma/client';
import {
  CreateProductRequestDto,
  CreateProductResponseDto,
  ListProductsRequestDto,
  ListProductsResponseDto,
  UpdateProductRequestDto,
  UpdateProductResponseDto,
} from './product.dto';

@ApiTags('Order Management / Product')
@ApiBearerAuth()
@Controller('products')
export class ProductController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('')
  @ApiResponse({type: CreateProductResponseDto})
  async createProduct(@Body() body: CreateProductRequestDto) {
    return await this.prisma.product.create({data: body});
  }

  @Get('')
  @ApiResponse({type: ListProductsResponseDto})
  async getProducts(@Query() query: ListProductsRequestDto) {
    const {name, ...pagination} = query;

    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Product,
      pagination: pagination,
      findManyArgs: {
        where: name ? {name: {contains: name}} : undefined,
        orderBy: {createdAt: 'desc'},
      },
    });
  }

  @Get(':id')
  async getProductById(@Param('id') id: number) {
    return await this.prisma.product.findUnique({where: {id}});
  }

  @Patch(':id')
  @ApiResponse({type: UpdateProductResponseDto})
  async updateProduct(@Param('id') id: number, @Body() body: UpdateProductRequestDto) {
    return await this.prisma.product.update({
      where: {id},
      data: body,
    });
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: number) {
    return await this.prisma.product.delete({
      where: {id},
    });
  }

  /* End */
}
