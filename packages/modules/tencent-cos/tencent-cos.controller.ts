import {
  Get,
  Post,
  Body,
  Query,
  Controller,
  UploadedFile,
  ParseFilePipe,
  UseInterceptors,
  MaxFileSizeValidator,
} from "@nestjs/common";
import { TencentCosService } from "./tencent-cos.service";
import { Express } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags, ApiBearerAuth } from "@nestjs/swagger";

@ApiTags("Tencent COS")
@ApiBearerAuth()
@Controller("cos")
export class TencentCosController {
  constructor(private readonly cos: TencentCosService) {}

  @Post("")
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: Object })
  @ApiBody({
    description: "The 'file' is required in request body.",
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ): Promise<any> {
    const { mimetype } = file;
    let path = "";

    if (mimetype.includes("video")) {
      path = "video";
    }
    if (mimetype.includes("audio")) {
      path = "audio";
    }
    if (mimetype.includes("pdf")) {
      path = "pdf";
    }
    if (mimetype.includes("png") || mimetype.includes("jpg") || mimetype.includes("jpeg")) {
      path = "image";
    }
    return await this.cos.uploadFile({ file, path });
  }

  @Get("")
  @ApiOkResponse({ type: Object })
  async getFile(@Query("key") key: string) {
    return await this.cos.getObject(key);
  }

  @Post("getSignedDownloadUrl")
  @ApiOkResponse({ type: Object })
  async getFilePreview(@Body() body: { key: string }) {
    return await this.cos.getSignedDownloadUrl({ key: body.key });
  }

  @Post("delete")
  @ApiOkResponse({ type: Object })
  async deleteFile(@Body() { key }: { key: string }): Promise<any> {
    return await this.cos.deleteFile(key);
  }

  @Post("initMultipartUpload")
  @ApiCreatedResponse({ type: Object })
  async initMultipartUpload(@Body() body: { fileName: string }) {
    const path = process.env.STORE_PATH as string;
    const key = `${path}/large/${Date.now()}-${body.fileName}`;
    const { UploadId } = await this.cos.initMultipartUpload(key);

    return {
      key,
      uploadId: UploadId,
    };
  }

  @Post("uploadPart")
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: Object })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        chunk: { type: "string", format: "binary", description: "A single chunk of the uploaded file." },
        key: { type: "string", description: "The object key of the multipart upload." },
        uploadId: { type: "string", description: "The multipart upload ID." },
        partNumber: { type: "string", description: "The 1-based part number." },
      },
      required: ["chunk", "key", "uploadId", "partNumber"],
    },
  })
  @UseInterceptors(
    FileInterceptor("chunk", {
      limits: { fileSize: 1024 * 1024 * 10 },
    }),
  )
  async uploadPart(
    @UploadedFile()
    chunk: Express.Multer.File,
    @Body() body: { uploadId: string; key: string; partNumber: string },
  ) {
    const { key, uploadId, partNumber } = body;
    const { ETag } = await this.cos.uploadPart(key, uploadId, parseInt(partNumber), chunk.buffer);
    return {
      eTag: ETag,
      partNumber: partNumber,
    };
  }

  @Post("completeMultipartUpload")
  @ApiCreatedResponse({ type: Object })
  async completeMultipartUpload(
    @Body()
    body: {
      key: string;
      uploadId: string;
      parts: { PartNumber: number; ETag: string }[];
    },
  ) {
    const { key, uploadId, parts } = body;
    const { Location } = await this.cos.completeMultipartUpload(key, uploadId, parts);

    return {
      key,
      location: Location,
    };
  }

  /* End */
}
