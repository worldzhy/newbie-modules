import {Get, Body, Post, Param, Patch, Query, Delete, Controller, UploadedFile, UseInterceptors} from '@nestjs/common';
import {ApiTags, ApiResponse, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody} from '@nestjs/swagger';
import {
  CreateFileRequestDto,
  CreateFileResponseDto,
  CreateFolderRequestDto,
  ListFilePathsResDto,
  ListFilesRequestDto,
  ListFilesResponseDto,
  RenameFileRequestDto,
  UploadBase64RequestDto,
  UploadFileRequestDto,
  CreateMultipartUploadResponseDto,
  CreateMultipartUploadRequestDto,
  UploadPartRequestDto,
  UploadPartResponseDto,
  CompleteMultipartUploadRequestDto,
  AbortMultipartUploadRequestDto,
  RenameFileResponseDto,
  MoveFileRequestDto,
  GetSignedUploadUrlResponseDto,
} from './aws-s3-file.dto';
import {FileEntity} from './aws-s3-file.entity';
import {Prisma} from '@generated/prisma/client';
import {AwsS3FileService} from './aws-s3-file.service';
import {FileInterceptor} from '@nestjs/platform-express';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';

@ApiTags('AWS / S3')
@ApiBearerAuth()
@Controller('aws-s3/files')
export class AwsS3FileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3File: AwsS3FileService
  ) {}

  //*******************/
  //* File operations */
  //*******************/

  @Get('sync')
  @ApiOperation({summary: 'Sync files from S3 to database'})
  @ApiResponse({type: String})
  async syncFiles() {
    await this.s3File.syncFilesFromS3ToDatabase();
  }

  @Get('')
  @ApiResponse({
    type: ListFilesResponseDto,
  })
  async listFiles(@Query() query: ListFilesRequestDto) {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.S3File,
      pagination: {page: query.page, pageSize: query.pageSize},
      findManyArgs: {
        where: {parentId: query.parentId ?? null},
        orderBy: {name: 'asc'},
      },
    });
  }

  @Post('folders')
  @ApiOperation({
    summary: 'Create a folder in AWS S3',
    description: 'Create a folder in AWS S3',
  })
  @ApiResponse({type: FileEntity})
  async createFolder(@Body() body: CreateFolderRequestDto) {
    return await this.s3File.createOrGetFolder({
      path: body.name,
      parentId: body.parentId,
    });
  }

  @Get(':fileId/path')
  @ApiResponse({
    type: ListFilePathsResDto,
    isArray: true,
  })
  async getFilePath(@Param('fileId') fileId: string) {
    return await this.s3File.getFilePath(fileId);
  }

  @Patch(':fileId/rename')
  @ApiResponse({type: RenameFileResponseDto})
  async renameFile(@Param('fileId') fileId: string, @Body() body: RenameFileRequestDto) {
    return await this.prisma.s3File.update({
      where: {id: fileId},
      data: {name: body.name},
    });
  }

  @Patch(':fileId/move')
  @ApiOperation({summary: 'Move a file or folder to another folder'})
  @ApiResponse({type: FileEntity})
  async moveFile(@Param('fileId') fileId: string, @Body() body: MoveFileRequestDto) {
    return await this.s3File.moveFileOrFolder({
      fileId,
      destinationParentId: body.destinationParentId,
    });
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete a file or folder'})
  @ApiResponse({type: FileEntity})
  async deleteFile(@Param('id') id: string) {
    return await this.s3File.deleteFile(id);
  }

  //**********************/
  //* Use signed URL     */
  //**********************/

  /** It would be better if the business layer reimplements this interface */
  @Post('signedUploadUrl')
  @ApiResponse({type: GetSignedUploadUrlResponseDto})
  async getSignedUploadUrl(@Body() body: CreateFileRequestDto) {
    // Specify a folder for the specific scenario
    // const folderId = await this.s3File.createOrGetFolder({
    //   path: this.s3File.getSystemFolderPath() + 'avatars' + '/' + userId,
    // });

    return await this.s3File.getSignedUploadUrl(body);
  }

  @Get('signedDownloadUrl')
  @ApiOperation({summary: 'Get a signed download URL for a file'})
  @ApiResponse({type: GetSignedUploadUrlResponseDto})
  async getSignedDownloadUrl(@Query('fileId') fileId: string) {
    return await this.s3File.getSignedDownloadUrl(fileId);
  }

  //**********************/
  //* Upload actual file */
  //**********************/

  @Post('upload')
  @UseInterceptors(FileInterceptor('file')) // Receive file
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {type: 'string', format: 'binary', description: 'The file to upload'},
        parentId: {type: 'string', description: 'The parent folder ID (do not use with path)'},
        path: {type: 'string', description: 'The folder path, e.g. "uploads" (do not use with parentId)'},
        overwrite: {type: 'string', description: 'Whether to overwrite an existing file ("true"/"false")'},
      },
      required: ['file'],
    },
  })
  @ApiOperation({summary: 'Upload a file to S3'})
  @ApiResponse({type: CreateFileResponseDto})
  async uploadFile(@Body() body: UploadFileRequestDto, @UploadedFile() file: Express.Multer.File) {
    return await this.s3File.uploadFile({
      buffer: file.buffer,
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      ...body,
    });
  }

  @Post('upload-base64')
  async uploadBase64String(@Body() body: UploadBase64RequestDto) {
    return await this.s3File.uploadBase64String(body);
  }

  //*******************************/
  //* Multipart upload operations */
  //*******************************/

  @Post('create-multipart')
  @ApiResponse({type: CreateMultipartUploadResponseDto})
  async createMultipartUpload(@Body() body: CreateMultipartUploadRequestDto) {
    return await this.s3File.createMultipartUpload(body);
  }

  @Post('upload-part')
  @ApiResponse({type: UploadPartResponseDto})
  @UseInterceptors(FileInterceptor('chunk', {limits: {fileSize: 6 * 1024 * 1024}}))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        chunk: {type: 'string', format: 'binary', description: 'A single chunk of the file (max 6MB)'},
        uploadId: {type: 'string', description: 'The multipart upload ID from create-multipart'},
        uploadProgress: {type: 'string', description: 'Current upload progress percentage (0-100)'},
        partNumber: {type: 'string', description: 'The 1-based part number'},
      },
      required: ['chunk', 'uploadId', 'uploadProgress', 'partNumber'],
    },
  })
  @ApiOperation({summary: 'Upload a single part of a multipart upload'})
  async uploadPart(@Body() body: UploadPartRequestDto, @UploadedFile() chunk: Express.Multer.File) {
    return await this.s3File.uploadPart({body: chunk.buffer, ...body});
  }

  @Post('complete-multipart')
  @ApiOperation({summary: 'Complete a multipart upload'})
  @ApiResponse({type: FileEntity})
  async completeMultipartUpload(@Body() body: CompleteMultipartUploadRequestDto) {
    return await this.s3File.completeMultipartUpload(body);
  }

  @Post('abort-multipart')
  @ApiOperation({summary: 'Abort a multipart upload'})
  @ApiResponse({type: Object})
  async abortMultipartUpload(@Body() body: AbortMultipartUploadRequestDto) {
    return await this.s3File.abortMultipartUpload(body.uploadId);
  }

  /* End */
}
