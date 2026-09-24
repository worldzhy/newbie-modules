import {Body, Controller, Delete, Get, Param, Post, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {AwsSesSuppressionListService} from './suppression-list.service';
import {AddSuppressedDestinationRequestDto, ListSuppressionDestinationsRequestDto} from './suppression-list.dto';

@ApiTags('AWS SES Suppression List')
@Controller('aws-ses/suppression-list')
export class AwsSesSuppressionListController {
  constructor(private readonly suppressionListService: AwsSesSuppressionListService) {}

  @Post('')
  @ApiOperation({summary: 'Add a suppressed destination'})
  @ApiResponse({type: Object})
  async addSuppressedDestination(@Body() body: AddSuppressedDestinationRequestDto) {
    return await this.suppressionListService.addSuppressedDestination(body);
  }

  @Get('')
  @ApiOperation({summary: 'List suppressed destinations'})
  @ApiResponse({type: Object})
  async listSuppressedDestinations(@Query() query: ListSuppressionDestinationsRequestDto) {
    return await this.suppressionListService.listSuppressedDestinations(query);
  }

  @Get(':emailAddress')
  @ApiOperation({summary: 'Get a suppressed destination'})
  @ApiResponse({type: Object})
  async getSuppressedDestination(@Param('emailAddress') emailAddress: string) {
    return await this.suppressionListService.getSuppressedDestination(emailAddress);
  }

  @Delete(':emailAddress')
  @ApiOperation({summary: 'Delete a suppressed destination'})
  @ApiResponse({type: Object})
  async deleteSuppressedDestination(@Param('emailAddress') emailAddress: string) {
    return await this.suppressionListService.deleteSuppressedDestination(emailAddress);
  }

  /* End */
}
