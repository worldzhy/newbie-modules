import {Injectable, InternalServerErrorException} from '@nestjs/common';
import {Readable} from 'stream';
import {auth, drive, drive_v3} from '@googleapis/drive';
import {ConfigService} from '@nestjs/config';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {GoogleFileType, GoogleMimeType} from './google-drive.enum';

/**
 * Minimal file shape needed to render a cloud-drive breadcrumb path.
 * Live Drive API lookups cannot provide the local createdAt/updatedAt columns.
 */
type FilePathNode = {
  id: string;
  name: string;
  type?: string | null;
  parentId: string | null;
};

/**
 * Note: In this service, assume "files" means both files and folders.
 * Folders are files that only contain metadata and can be used to organize files in Drive.
 */
@Injectable()
export class GoogleDriveFileService {
  private client: drive_v3.Drive;
  // Service accounts have NO storage quota. All files must live inside a
  // shared drive, so this ID is mandatory. Fail fast on startup if it is
  // missing — otherwise every upload would fail with 403 storageQuotaExceeded.
  private googleSharedDriveId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    // Create a new JWT client using the key file downloaded from the Google Developer Console.
    const authObj = new auth.GoogleAuth({
      keyFile: this.config.getOrThrow<string>('microservices.googleapis.credentials.serviceAccount'),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    this.client = drive({version: 'v3', auth: authObj});
    this.googleSharedDriveId = this.config.getOrThrow<string>('microservices.googleapis.googleSharedDriveId');
  }

  async getFile(name: string) {
    const file = await this.prisma.googleDriveFile.findFirst({where: {name}});
    if (file) {
      const response = await this.client.files.get({fileId: file.id, supportsAllDrives: true});
      console.log(response);
    }

    return file;
  }

  async createFolder(params: {name: string; parentId?: string}) {
    try {
      return await this.createFile({
        name: params.name,
        type: GoogleFileType.Folder,
        parentId: params.parentId,
      });
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  async createDocument(params: {name: string; parentId?: string}) {
    try {
      return await this.createFile({
        name: params.name,
        type: GoogleFileType.Document,
        parentId: params.parentId,
      });
    } catch (error) {
      throw error;
    }
  }

  async createSheet(params: {name: string; parentId?: string}) {
    try {
      return await this.createFile({
        name: params.name,
        type: GoogleFileType.Sheet,
        parentId: params.parentId,
      });
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  /**
   * Note: If you're deleting a folder, all descendants owned by the user are also deleted.
   * https://developers.google.com/drive/api/guides/delete
   */
  async deleteFile(fileId: string) {
    try {
      const response = await this.client.files.delete({fileId, supportsAllDrives: true});
      if (response.status >= 200 && response.status < 300) {
        await this.deleteFileRecursively(fileId);
      } else {
        throw new InternalServerErrorException('Delete google file failed.');
      }
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  /**
   * Download a file from Google Drive using the service account and stream
   * the raw bytes to the HTTP response. This avoids redirecting users to the
   * Google Drive web UI (which would require per-user access permissions).
   */
  async downloadFile(params: {fileId: string; res: any}) {
    const {fileId, res} = params;
    try {
      // Fetch file metadata for name and size.
      const metadata = await this.client.files.get({
        fileId,
        fields: 'name, size, mimeType',
        supportsAllDrives: true,
      });

      // Set response headers for file download.
      const fileName = metadata.data.name || 'download';
      const fileSize = metadata.data.size ? parseInt(metadata.data.size) : undefined;
      res.setHeader('Content-Type', metadata.data.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      if (fileSize) {
        res.setHeader('Content-Length', fileSize);
      }

      // Download the file content via the Drive API and pipe to response.
      const downloadStream = await this.client.files.get(
        {fileId, alt: 'media', supportsAllDrives: true},
        {responseType: 'stream'}
      );
      downloadStream.data.pipe(res);
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  async renameFile(params: {fileId: string; name: string}) {
    try {
      const response = await this.client.files.update({
        fileId: params.fileId,
        requestBody: {name: params.name},
        supportsAllDrives: true,
      });

      if (response.status >= 200 && response.status < 300) {
        return await this.prisma.googleDriveFile.update({
          where: {id: params.fileId},
          data: {name: params.name},
        });
      } else {
        throw new InternalServerErrorException('Rename google file failed.');
      }
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  async uploadFile(params: {file: Express.Multer.File; parentId?: string}) {
    try {
      // Create google file. Use file.buffer (not file.stream) because Multer
      // has already consumed the stream by the time the handler runs; reading
      // a ended stream would upload 0 bytes. Readable.from re-creates a
      // fresh stream from the in-memory buffer.
      //
      // `driveId` + `supportsAllDrives` are mandatory: service accounts have
      // no personal storage quota, so the file MUST be created inside a
      // shared drive. Without `driveId`, the API defaults to the service
      // account's root and returns 403 storageQuotaExceeded.
      const file = await this.client.files.create({
        uploadType: 'multipart',
        media: {body: Readable.from(params.file.buffer)},
        requestBody: {
          name: params.file.originalname,
          parents: params.parentId ? [params.parentId] : [this.googleSharedDriveId],
        },
        fields: 'id, name, mimeType, size, iconLink, webViewLink, webContentLink',
        supportsAllDrives: true,
      });
      if (!file.data.id) {
        throw new InternalServerErrorException('Create google file failed.');
      }

      // Save to database. The create response already includes size and links
      // thanks to the `fields` parameter, so no separate files.get is needed.
      return await this.prisma.googleDriveFile.create({
        data: {
          id: file.data.id,
          name: params.file.originalname,
          type: file.data.mimeType,
          size: file.data.size ? parseInt(file.data.size) : undefined,
          iconLink: file.data.iconLink,
          webViewLink: file.data.webViewLink,
          webContentLink: file.data.webContentLink,
          parentId: params.parentId,
        },
      });
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  private async createFile(params: {name: string; type: GoogleFileType; parentId?: string}) {
    try {
      // Create google file. Always place it inside the shared drive: service
      // accounts have no personal storage quota, so omitting `parents` (or
      // pointing outside a shared drive) would fail with 403.
      const file = await this.client.files.create({
        requestBody: {
          mimeType: GoogleMimeType[params.type],
          name: params.name,
          parents: params.parentId ? [params.parentId] : [this.googleSharedDriveId],
        },
        fields: 'id, name, mimeType, size, iconLink, webViewLink, webContentLink',
        supportsAllDrives: true,
      });
      if (!file.data.id) {
        throw new InternalServerErrorException('Create google file failed.');
      }

      // Save to database. The create response already includes size and links
      // thanks to the `fields` parameter, so no separate files.get is needed.
      return await this.prisma.googleDriveFile.create({
        data: {
          id: file.data.id,
          name: params.name,
          type: params.type,
          size: file.data.size ? parseInt(file.data.size) : undefined,
          iconLink: file.data.iconLink,
          webViewLink: file.data.webViewLink,
          webContentLink: file.data.webContentLink,
          parentId: params.parentId,
        },
      });
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  /**
   * Build the ancestor path of a file (the file itself first, root last).
   *
   * The local table only caches files created or renamed through this system,
   * while the file list is read live from the Google Drive API. To keep
   * breadcrumbs working for pre-existing folders (empty local table), every
   * ancestor missing locally is fetched on demand from the Drive API.
   * The walk stops gracefully when a file no longer exists on Drive.
   */
  async getFilePath(fileId: string): Promise<FilePathNode[]> {
    const path: FilePathNode[] = [];
    const visited = new Set<string>(); // Guard against unexpected parent cycles.
    let currentId: string | null = fileId;

    while (currentId) {
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);

      // Prefer the local cache, fall back to live Google Drive metadata.
      const localFile = await this.prisma.googleDriveFile.findUnique({
        where: {id: currentId},
      });
      if (localFile) {
        path.push(localFile);
        currentId = localFile.parentId;
        continue;
      }

      const cloudFile = await this.getFileFromCloud(currentId);
      if (!cloudFile) {
        // File was deleted on Drive (or is the shared-drive root): stop here.
        break;
      }
      path.push(cloudFile);
      currentId = cloudFile.parentId;
    }

    return path;
  }

  /**
   * Fetch minimal metadata of a single file directly from Google Drive.
   * Returns null when the file no longer exists on Drive instead of throwing.
   */
  private async getFileFromCloud(fileId: string): Promise<FilePathNode | null> {
    try {
      const response = await this.client.files.get({
        fileId,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: true,
      });
      const file = response.data;
      if (!file.id) {
        return null;
      }
      return {
        id: file.id,
        name: file.name ?? '',
        type: file.mimeType ?? null,
        parentId: file.parents && file.parents.length > 0 ? file.parents[0] : null,
      };
    } catch (error) {
      // A 404 means the file (or shared-drive root id) is not retrievable as a file.
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Remove directories and their contents recursively
   */
  async deleteFileRecursively(fileId: string) {
    // [step 1] Delete file.
    await this.prisma.googleDriveFile.delete({where: {id: fileId}});

    // [step 2] Delete files in the folder.
    const filesInFolder = await this.prisma.googleDriveFile.findMany({
      where: {parentId: fileId},
      select: {id: true},
    });

    for (let i = 0; i < filesInFolder.length; i++) {
      await this.deleteFileRecursively(filesInFolder[i].id);
    }
  }

  private async listFilesOnCloud(params: {parentId?: string}) {
    // supported syntax - https://developers.google.com/drive/api/guides/search-files
    const q = params.parentId ? `'${params.parentId}' in parents` : `'root' in parents`;

    try {
      const response = await this.client.files.list({q});
      return response.data;
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  private async searchFilesOnCloud(params: {name: string}) {
    // supported syntax - https://developers.google.com/drive/api/guides/search-files
    const q = params.name ? `name contains '${params.name}'` : undefined;

    try {
      const response = await this.client.files.list({q});
      return response.data;
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  /* End */
}
