import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {generateRandomString, generateUuid} from '@devbie/newbie/utilities/random.util';
import {S3File} from '@generated/prisma/client';
import {extname} from 'path';
import {AwsS3Service} from './aws-s3.service';

const SYSTEM_FOLDER_PATH = '_system/';

@Injectable()
export class AwsS3FileService {
  private bucket: string;
  private region: string;
  private cdnHostname: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly s3: AwsS3Service
  ) {
    this.bucket = this.config.getOrThrow<string>('microservices.aws-s3.bucket');
    this.region = this.config.getOrThrow<string>('microservices.aws-s3.region');
    this.cdnHostname = this.config.get<string>('microservices.aws-s3.cdnHostname');
  }

  getSystemFolderPath() {
    return SYSTEM_FOLDER_PATH;
  }

  //*******************/
  //* File operations */
  //*******************/

  async syncFilesFromS3ToDatabase() {
    // [step 1] Check if the s3File table is empty.
    const count = await this.prisma.s3File.count();
    if (count > 0) {
      throw new Error('The s3File table is not empty. Please clear the table before syncing.');
    }

    // [step 2] Get all objects from S3 bucket.
    const objects = await this.s3.getObjectsRecursively({});

    // [step 3] Create records in the s3File table.
    const createManyInputs: {
      name: string;
      type: string;
      size?: number;
      s3Bucket: string;
      s3Key: string;
    }[] = [];

    for (const {s3Key, size} of objects) {
      const fileSize = size;
      let fileName = '';
      let fileType = '';

      if (s3Key.endsWith('/')) {
        fileName = s3Key.slice(0, -1).split('/').pop() || '';
        fileType = 'folder';
      } else {
        fileName = s3Key.split('/').pop() || '';
        fileType = s3Key.split('.').pop() || '';
      }

      createManyInputs.push({
        name: fileName,
        type: fileType,
        size: fileSize,
        s3Bucket: this.bucket,
        s3Key: s3Key,
      });
    }

    const files = await this.prisma.s3File.createManyAndReturn({
      data: createManyInputs,
      select: {id: true, s3Key: true},
    });

    // [step 4] Link parent-child relationships.
    const fileMap = new Map(files.map(file => [file.s3Key, file.id]));

    for (const {id, s3Key} of files) {
      let parts: string[];
      if (s3Key.endsWith('/')) {
        parts = s3Key.slice(0, -1).split('/');
      } else {
        parts = s3Key.split('/');
      }
      if (parts.length > 1) {
        const parentKey = parts.slice(0, -1).join('/') + '/';
        const parentId = fileMap.get(parentKey);
        if (parentId) {
          await this.prisma.s3File.update({
            where: {id: id},
            data: {parentId: parentId},
          });
        }
      }
    }
  }

  /** Create a folder in AWS S3, then create a record in the database. */
  async createOrGetFolder(params: {
    path: string; // The folder path, e.g. 'uploads', 'uploads/images'.
    parentId?: string; // The parent folder ID, if not provided, the folder will be created in the root directory.
  }) {
    let parentId = params.parentId;

    // Remove leading and trailing slashes from path
    params.path = params.path.replace(/^\/+|\/+$/g, '');

    // convert the path to a folder if it does not exist
    const folderNames = params.path.split('/');
    for (let i = 0; i < folderNames.length; i++) {
      if (folderNames[i].length === 0) {
        continue; // Skip empty folder names.
      }

      const existingFolder = await this.prisma.s3File.findFirst({
        where: {
          name: folderNames[i],
          type: 'folder',
          parentId: parentId,
        },
      });

      if (existingFolder) {
        parentId = existingFolder.id;
      } else {
        let s3Key: string;
        if (parentId) {
          s3Key = (await this.getFilePathString(parentId)) + '/' + folderNames[i] + '/';
        } else {
          s3Key = folderNames[i] + '/';
        }

        const output = await this.s3.putObject({key: s3Key});
        const folder = await this.prisma.s3File.create({
          data: {
            name: folderNames[i],
            type: 'folder',
            s3Bucket: this.bucket,
            s3Key: s3Key,
            s3Response: output as object,
            parentId: parentId,
          },
        });

        parentId = folder.id;
      }
    }
    return parentId; // The ID of the last folder created.
  }

  /**  Upload file to local server, then upload to AWS S3. */
  async uploadFile(params: {
    buffer: Buffer; // The file buffer.
    name?: string; // The file name, e.g. 'image.png', 'document.pdf'.
    type?: string; // The file type, e.g. 'image/png', 'application/pdf'.
    size?: number; // The file size in bytes.
    parentId?: string; // Do not use both `parentId` and `path` at the same time.
    path?: string; // The folder path to upload the file, e.g. "uploads", not including "/" at the end.
    overwrite?: boolean; // Whether to overwrite the existing file
  }) {
    // Validate parameters
    if (params.path && params.parentId) {
      throw new Error('Do not use both `parentId` and `path` at the same time.');
    }

    // Create or get the parent folder if path is provided.
    if (params.path) {
      params.parentId = await this.createOrGetFolder({
        path: params.path,
      });
    }

    // [step 1] Check if a file with the same name exists in the same folder.
    let existingFile: {id: string; s3Key: string} | null = null;
    let origionalName: string;
    if (params.name) {
      existingFile = await this.prisma.s3File.findFirst({
        where: {
          name: params.name,
          s3Bucket: this.bucket,
          parentId: params.parentId,
        },
        select: {id: true, s3Key: true},
      });
      origionalName = params.name;
    } else {
      origionalName = generateUuid();
    }

    // [step 2]  Generate s3Key and name based on whether the file exists and the overwrite option.
    let name: string;
    let s3Key: string;
    if (existingFile) {
      if (params.overwrite) {
        name = origionalName;
        s3Key = existingFile.s3Key;
      } else {
        const ext = extname(origionalName);
        const randomStr = await generateRandomString(6);

        name = ext === '' ? origionalName + randomStr : origionalName.slice(0, -ext.length) + randomStr + ext;

        if (params.parentId) {
          s3Key = (await this.getFilePathString(params.parentId)) + `/${name}`;
        } else {
          s3Key = name;
        }
      }
    } else {
      if (params.parentId) {
        name = origionalName;
        s3Key = (await this.getFilePathString(params.parentId)) + `/${name}`;
      } else {
        name = origionalName;
        s3Key = name;
      }
    }

    // [step 3] Upload file to S3.
    const output = await this.s3.putObject({
      key: s3Key,
      body: params.buffer,
    });

    // [step 4] Create or update a record in the database.
    if (existingFile && params.overwrite) {
      return await this.prisma.s3File.update({
        where: {id: existingFile.id},
        data: {
          type: params.type,
          size: params.size,
          s3Response: output as object,
        },
        select: {id: true, name: true},
      });
    } else {
      return await this.prisma.s3File.create({
        data: {
          name: name,
          type: params.type,
          size: params.size,
          s3Bucket: this.bucket,
          s3Key: s3Key,
          s3Response: output as object,
          parentId: params.parentId,
        },
        select: {id: true, name: true},
      });
    }
  }

  /** Upload a base64 string as a file to AWS S3. */
  async uploadBase64String(params: {
    parentId?: string;
    path?: string;
    base64: string;
    name?: string;
    overwrite?: boolean;
  }) {
    const {base64, ...others} = params;

    // Convert base64 to buffer
    const base64Data = base64.replace(/^data:([\w\/]+);base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Extract mimetype from base64 string
    const mimetypeMatch = base64.match(/^data:([\w\/]+);base64,/);
    const mimetype = mimetypeMatch ? mimetypeMatch[1] : '';

    return await this.uploadFile({
      buffer: buffer,
      type: mimetype,
      size: buffer.length,
      ...others,
    });
  }

  // Get object from AWS S3 by file ID.
  async getFileObject(fileId: string) {
    const file = await this.prisma.s3File.findFirstOrThrow({
      where: {id: fileId},
      select: {s3Bucket: true, s3Key: true},
    });

    return await this.s3.getObject({
      bucket: file.s3Bucket,
      key: file.s3Key,
    });
  }

  async getFileBuffer(fileId: string) {
    const object = await this.getFileObject(fileId);
    if (!object.Body) {
      throw new Error('File not found');
    }

    return Buffer.from((await object.Body.transformToByteArray()).buffer);
  }

  // Get the file path.
  async getFilePath(fileId: string) {
    const path: object[] = [];

    // [step 1] Get current file.
    const file = await this.prisma.s3File.findFirstOrThrow({
      where: {id: fileId},
      select: {id: true, name: true, type: true, parentId: true},
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

  async moveFileOrFolder(params: {
    fileId: string; // The file or folder ID to be moved.
    destinationParentId?: string; // The destination folder ID, if not provided, the file will be moved to the root directory.
  }) {
    // [step 1] Get the file or folder to be moved.
    const originalFile = await this.prisma.s3File.findFirstOrThrow({
      where: {id: params.fileId},
    });

    // [step 2] Copy the file or folder.
    if (originalFile.type === 'folder') {
      await this.copyFolder({
        folder: originalFile,
        destinationParentId: params.destinationParentId,
      });
    } else {
      await this.copySingleFile({
        file: originalFile,
        destinationParentId: params.destinationParentId,
      });
    }

    // [step 3] Delete the original folder in S3 recursively.
    await this.s3.deleteObjectRecursively({
      bucket: originalFile.s3Bucket,
      key: originalFile.s3Key,
    });

    // [step 4] Delete the original folder record in the database recursively.
    await this.deleteFileRecursively(originalFile.id);
  }

  // Delete a file in AWS S3, then delete the record in the database.
  async deleteFile(fileId: string) {
    const file = await this.prisma.s3File.findFirstOrThrow({
      where: {id: fileId},
    });

    try {
      await this.s3.deleteObjectRecursively({
        bucket: file.s3Bucket,
        key: file.s3Key,
      });
      await this.deleteFileRecursively(fileId);
    } catch (error) {
      // TODO (developer) - Handle exception
      throw error;
    }
  }

  //*******************************/
  //* Multipart upload operations */
  //*******************************/

  async createMultipartUpload(params: {name: string; type: string; size: number; parentId?: string; path?: string}) {
    // [step 1] Generate s3Key.
    const s3Key = await this.generateS3Key({
      name: params.name,
      parentId: params.parentId,
      path: params.path,
    });

    // [step 2] Create a record and initiate multipart upload.
    const uploadRsp = await this.s3.createMultipartUpload({
      key: s3Key,
      bucket: this.bucket,
    });

    // [step 3] Create a record.
    return await this.prisma.s3File.create({
      data: {
        name: params.name,
        type: params.type,
        size: params.size,
        s3Bucket: this.bucket,
        s3Key: s3Key,
        parentId: params.parentId,
        uploadId: uploadRsp.UploadId,
        uploadProgress: 0, // Initialize progress to 0
      },
    });
  }

  async uploadPart(params: {
    uploadId: string;
    uploadProgress: number;
    partNumber: number;
    body: Buffer | Uint8Array | Blob | string;
  }) {
    const file = await this.prisma.s3File.findFirstOrThrow({
      where: {uploadId: params.uploadId},
    });

    await this.prisma.s3File.update({
      where: {id: file.id},
      data: {uploadProgress: params.uploadProgress},
    });

    return await this.s3.uploadPart({
      bucket: file.s3Bucket,
      key: file.s3Key,
      ...params,
    });
  }

  async completeMultipartUpload(params: {uploadId: string; parts: {ETag: string; PartNumber: number}[]}) {
    const file = await this.prisma.s3File.findFirstOrThrow({
      where: {uploadId: params.uploadId},
    });

    const response = await this.s3.completeMultipartUpload({
      bucket: file.s3Bucket,
      key: file.s3Key,
      parts: params.parts,
      uploadId: params.uploadId,
    });

    return await this.prisma.s3File.update({
      where: {id: file.id},
      data: {
        s3Response: response as object,
        uploadProgress: 100, // Set progress to 100% after completion
      },
    });
  }

  async abortMultipartUpload(uploadId: string) {
    const file = await this.prisma.s3File.findFirstOrThrow({
      where: {uploadId},
      select: {s3Bucket: true, s3Key: true},
    });

    return await this.s3.abortMultipartUpload({
      bucket: file.s3Bucket,
      key: file.s3Key,
      uploadId,
    });
  }

  //*****************************/
  //* Get signed URL operations */
  //*****************************/

  /*
   * Create a file record in database and return a signed URL for uploading a file to AWS S3.
   * This URL can be used by the user to upload a file directly to S3.
   * The URL will expire after a certain period of time, which is defined in the AWS S3 configuration.
   * https://docs.aws.amazon.com/zh_cn/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
   */
  async getSignedUploadUrl(params: {
    name?: string;
    mimeType?: string;
    size?: number;
    encoding?: string;
    parentId?: string;
    path?: string;
  }) {
    const name = params.name || generateUuid();

    // [step 1] Generate s3Key.
    const s3Key = await this.generateS3Key({
      name: name,
      parentId: params.parentId,
      path: params.path,
    });

    // [step 2] Create a record.
    const file = await this.prisma.s3File.create({
      data: {
        name: name,
        type: params.mimeType,
        size: params.size,
        s3Bucket: this.bucket,
        s3Key: s3Key,
        parentId: params.parentId,
      },
    });

    // [step 3] Get a signed URL.
    const signedUploadUrl = await this.s3.getSignedUploadUrl({
      bucket: file.s3Bucket,
      key: file.s3Key,
      contentType: params.mimeType,
      contentEncoding: params.encoding,
    });

    return {fileId: file.id, signedUploadUrl};
  }

  /*
   * Get a signed URL for downloading a file from AWS S3.
   * This URL can be used by the user to download the file directly from S3.
   * The URL will expire after a certain period of time, which is defined in the AWS S3 configuration.
   * https://docs.aws.amazon.com/zh_cn/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
   */
  async getSignedDownloadUrl(fileId: string) {
    const file = await this.prisma.s3File.findFirst({
      where: {id: fileId},
      select: {s3Bucket: true, s3Key: true},
    });

    if (file) {
      return await this.s3.getSignedDownloadUrl({
        bucket: file.s3Bucket,
        key: file.s3Key,
      });
    } else {
      return null;
    }
  }

  //*********************/
  //* Private functions */
  //*********************/

  private async deleteFileRecursively(fileId: string) {
    // [step 1] Delete file.
    await this.prisma.s3File.delete({where: {id: fileId}});

    // [step 2] Delete files in the folder.
    const filesInFolder = await this.prisma.s3File.findMany({
      where: {parentId: fileId},
      select: {id: true},
    });

    for (let i = 0; i < filesInFolder.length; i++) {
      await this.deleteFileRecursively(filesInFolder[i].id);
    }
  }

  private async getFilePathString(fileId: string) {
    let path = '';

    // [step 1] Get current file.
    const file = await this.prisma.s3File.findFirstOrThrow({
      where: {id: fileId},
      select: {id: true, name: true, type: true, parentId: true},
    });
    path = file.name;

    // [step 2] Get parent file.
    if (file.parentId) {
      path = (await this.getFilePathString(file.parentId)) + '/' + path;
    } else {
      // Do nothing.
    }

    return path;
  }

  private async generateS3Key(params: {name: string; parentId?: string; path?: string}) {
    let s3Key: string;

    if (params.parentId) {
      s3Key = (await this.getFilePathString(params.parentId)) + `/${generateUuid()}${extname(params.name)}`;
    } else if (params.path) {
      s3Key = `${params.path}/${generateUuid()}${extname(params.name)}`;
    } else {
      s3Key = `${generateUuid()}${extname(params.name)}`;
    }

    return s3Key;
  }

  private async copySingleFile(params: {
    file: S3File; // The file to be moved.
    destinationParentId?: string; // The destination folder ID, if not provided, the file will be moved to the root directory.
  }) {
    // [step 1] Get the file.
    const file = params.file;
    const destinationParentId = params.destinationParentId || null;

    // [step 2] Check if a file with the same name exists in the destination folder.
    const existingFile = await this.prisma.s3File.findFirst({
      where: {
        name: file.name,
        s3Bucket: this.bucket,
        parentId: destinationParentId,
      },
      select: {id: true, s3Key: true},
    });

    // [step 3]  Generate destination s3Key and name based on whether the file exists and the overwrite option.
    if (existingFile) {
      const ext = extname(file.name);
      const randomStr = await generateRandomString(6);
      if (ext === '') {
        file.name += randomStr;
      } else {
        file.name = file.name.slice(0, -ext.length) + randomStr + ext;
      }
    } else {
      // Do nothing.
    }

    let destinationS3Key: string;
    if (destinationParentId) {
      destinationS3Key = (await this.getFilePathString(destinationParentId)) + `/${file.name}`;
    } else {
      destinationS3Key = file.name;
    }
    if (file.type === 'folder') {
      destinationS3Key += '/';
    }

    // [step 4] Copy the object in S3 and create a new record in the database.
    const s3CopyResponse = await this.s3.copyObject({
      bucket: this.bucket,
      sourceKey: encodeURIComponent(file.s3Key), // [issue] https://github.com/aws/aws-sdk-js-v3/issues/6596
      destinationKey: destinationS3Key,
    });

    return await this.prisma.s3File.create({
      data: {
        name: file.name,
        type: file.type,
        size: file.size,
        s3Bucket: file.s3Bucket,
        s3Key: destinationS3Key,
        s3Response: s3CopyResponse as object,
        parentId: destinationParentId,
      },
      select: {id: true, name: true},
    });
  }

  private async copyFolder(params: {
    folder: S3File; // The folder to be moved.
    destinationParentId?: string; // The destination folder ID, if not provided, the file will be moved to the root directory.
  }) {
    // [step 1] Copy the folder.
    const newFolder = await this.copySingleFile({
      file: params.folder,
      destinationParentId: params.destinationParentId,
    });

    // [step 2] Copy files in the folder.
    const filesInFolder = await this.prisma.s3File.findMany({
      where: {parentId: params.folder.id},
    });

    for (let i = 0; i < filesInFolder.length; i++) {
      const file = filesInFolder[i];

      if (file.type === 'folder') {
        await this.copyFolder({
          folder: file,
          destinationParentId: newFolder.id,
        });
      } else {
        await this.copySingleFile({
          file: file,
          destinationParentId: newFolder.id,
        });
      }
    }
  }
}
