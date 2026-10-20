import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { GoogleDriveFileService } from "@modules/googleapis/google-drive/google-drive-file.service";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiConsumes, ApiBody } from "@nestjs/swagger";
import {
  CreateGoogleDriveFileRequestDto,
  CreateGoogleDriveFileResponseDto,
  GetFilePathResponseDto,
  GetGoogleDriveFileRequestDto,
  ListGoogleDriveFilesRequestDto,
  ListGoogleDriveFilesResponseDto,
  RenameGoogleDriveFileRequestDto,
  RenameGoogleDriveFileResponseDto,
  UploadGoogleDriveFileBodyDto,
} from "./google-drive-file.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { Express, Response } from "express";

@ApiTags("Google Drive / File")
@ApiBearerAuth()
@Controller("google-drive/files")
export class GoogleDriveFileController {
  constructor(
    private readonly googleDriveFile: GoogleDriveFileService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.GoogleDriveFile)
  @ApiResponse({ type: ListGoogleDriveFilesResponseDto })
  async listFiles(@Body() body: ListGoogleDriveFilesRequestDto) {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.GoogleDriveFile,
      pagination: { page: body.page, pageSize: body.pageSize },
      findManyArgs: { where: { parentId: body.parentId ?? null } },
    });
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary", description: "The file to upload" },
        parentId: { type: "string", description: "The parent folder ID (optional)" },
      },
      required: ["file"],
    },
  })
  @ApiOperation({ summary: "Upload a file to Google Drive" })
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Body() body: UploadGoogleDriveFileBodyDto) {
    await this.googleDriveFile.uploadFile({ file, parentId: body.parentId });
  }

  @Post("folder")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.GoogleDriveFile)
  @ApiResponse({ type: CreateGoogleDriveFileResponseDto })
  async createFolder(@Body() body: CreateGoogleDriveFileRequestDto) {
    return await this.googleDriveFile.createFolder(body);
  }

  @Post("document")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.GoogleDriveFile)
  @ApiResponse({ type: CreateGoogleDriveFileResponseDto })
  async createDocument(@Body() body: CreateGoogleDriveFileRequestDto) {
    return await this.googleDriveFile.createDocument({
      name: body.name,
      parentId: body.parentId,
    });
  }

  @Post("spreadsheet")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.GoogleDriveFile)
  @ApiResponse({ type: CreateGoogleDriveFileResponseDto })
  async createSpreadsheet(@Body() body: CreateGoogleDriveFileRequestDto) {
    return await this.googleDriveFile.createSheet({
      name: body.name,
      parentId: body.parentId,
    });
  }

  @Patch(":fileId/rename")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.GoogleDriveFile)
  @ApiResponse({ type: RenameGoogleDriveFileResponseDto })
  async renameFile(@Param() params: GetGoogleDriveFileRequestDto, @Body() body: RenameGoogleDriveFileRequestDto) {
    return await this.googleDriveFile.renameFile({ fileId: params.fileId, name: body.name });
  }

  @Delete(":fileId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.GoogleDriveFile)
  @ApiOperation({ summary: "Delete a Google Drive file" })
  @ApiResponse({ type: CreateGoogleDriveFileResponseDto })
  async deleteFile(@Param() params: GetGoogleDriveFileRequestDto) {
    return await this.googleDriveFile.deleteFile(params.fileId);
  }

  @Get(":fileId/download")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.GoogleDriveFile)
  @ApiOperation({ summary: "Download a file from Google Drive via service account" })
  @ApiResponse({ status: 200, description: "File stream" })
  async downloadFile(@Param() params: GetGoogleDriveFileRequestDto, @Res() res: Response) {
    await this.googleDriveFile.downloadFile({ fileId: params.fileId, res });
  }

  @Get(":fileId/path")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.GoogleDriveFile)
  @ApiResponse({ type: GetFilePathResponseDto, isArray: true })
  async getFilePath(@Param() params: GetGoogleDriveFileRequestDto) {
    return await this.googleDriveFile.getFilePath(params.fileId);
  }

  /* End */
}
