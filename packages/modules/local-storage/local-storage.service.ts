import { Injectable, StreamableFile } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Express } from "express";
import { createReadStream } from "fs";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { assertSafeFileName, resolveStoragePath } from "./storage-path";

/**
 * Note: In this service, assume "files" means both files and folders.
 * Folders are files that only contain metadata and can be used to organize files in Drive.
 */
@Injectable()
export class LocalStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createFolder(params: { name: string; parentId?: string }) {
    // A folder name is a single path segment; reject separators/traversal.
    assertSafeFileName(params.name);
    return await this.prisma.localFile.create({
      data: {
        name: params.name,
        type: "Folder",
        parentId: params.parentId,
      },
    });
  }

  async uploadFile(params: { file: Express.Multer.File; parentId?: string }) {
    assertSafeFileName(params.file.filename);
    return await this.prisma.localFile.create({
      data: {
        name: params.file.filename,
        originalName: params.file.originalname,
        type: params.file.mimetype,
        size: params.file.size,
        parentId: params.parentId,
      },
    });
  }

  /**
   * Remove directories and their contents recursively
   */
  async deleteFileRecursively(fileId: string) {
    // [step 1] Delete file.
    await this.prisma.localFile.delete({ where: { id: fileId } });

    // [step 2] Delete files in the folder.
    const filesInFolder = await this.prisma.localFile.findMany({
      where: { parentId: fileId },
      select: { id: true },
    });

    for (let i = 0; i < filesInFolder.length; i++) {
      await this.deleteFileRecursively(filesInFolder[i].id);
    }
  }

  async renameFile(params: { fileId: string; name: string }) {
    assertSafeFileName(params.name);
    return await this.prisma.localFile.update({
      where: { id: params.fileId },
      data: { name: params.name },
    });
  }

  async downloadFile(fileId: string) {
    // [step 1] Ensure the file exists (throws 404-equivalent when missing).
    await this.prisma.localFile.findUniqueOrThrow({
      where: { id: fileId },
      select: { id: true },
    });

    // [step 2] Resolve the on-disk path. The segment list already contains the
    // file's own name, so it must not be appended a second time; every segment
    // is validated and the result is confined to the storage root.
    const segments = await this.getFilePathSegments(fileId);
    const storageRoot = this.config.getOrThrow<string>("storage.local.path");
    const filePath = resolveStoragePath(storageRoot, segments);

    const stream = createReadStream(filePath);
    return new StreamableFile(stream);
  }

  async getFilePath(fileId: string) {
    const path: object[] = [];

    // [step 1] Get current file.
    const file = await this.prisma.localFile.findFirstOrThrow({
      where: { id: fileId },
      select: { id: true, name: true, type: true, parentId: true },
    });
    path.push(file);

    // [step 2] Get parent file.
    if (file.parentId) {
      path.push(...(await this.getFilePath(file.parentId)));
    } else {
      // Do nothing.
    }

    return path;
  }

  /** Full name chain from the storage root down to the file itself. */
  private async getFilePathSegments(fileId: string): Promise<string[]> {
    const file = await this.prisma.localFile.findFirstOrThrow({
      where: { id: fileId },
      select: { id: true, name: true, type: true, parentId: true },
    });
    const parentSegments = file.parentId ? await this.getFilePathSegments(file.parentId) : [];
    return [...parentSegments, file.name];
  }

  /* End */
}
