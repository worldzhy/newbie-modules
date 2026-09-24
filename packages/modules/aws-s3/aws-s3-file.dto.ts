import {ApiProperty} from '@nestjs/swagger';
import {IsArray, IsNumber, IsString, MinLength, IsOptional} from 'class-validator';
import {Type} from 'class-transformer';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {FileEntity} from './aws-s3-file.entity';

export class GetSignedUploadUrlResponseDto {
  @ApiProperty({type: String})
  fileId: string;

  @ApiProperty({type: String})
  signedUploadUrl: string;
}

export class CreateFileResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  name: string;

  @ApiProperty({type: String, required: false})
  type: string;

  @ApiProperty({type: Number, required: false})
  size: number;

  @ApiProperty({type: String})
  s3Bucket: string;

  @ApiProperty({type: String})
  s3Key: string;

  @ApiProperty({type: String, required: false})
  parentId: string;

  @ApiProperty({type: String, required: false})
  uploadId: string;

  @ApiProperty({type: Number})
  uploadProgress: number;
}

export class ListFilesRequestDto extends CommonListRequestDto {
  @ApiProperty({
    type: String,
    required: false,
    description: 'The folder ID to list files in, if not provided, lists root files.',
  })
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class ListFilesResponseDto extends CommonListResponseDto {
  @ApiProperty({
    type: FileEntity,
    isArray: true,
    description: 'The last update timestamp.',
  })
  declare records: FileEntity[];
}

export class CreateFolderRequestDto {
  @ApiProperty({
    type: String,
    required: true,
    description: 'The name of the folder to create.',
  })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'The parent folder ID to create the folder in.',
  })
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class CreateFileRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  name: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  type: string;

  @ApiProperty({type: Number, required: true})
  @Type(() => Number)
  @IsNumber()
  size: number;

  @ApiProperty({type: String, required: false})
  @IsOptional()
  @IsString()
  encoding?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'The folder ID to create the file in, do not use both `parentId` and `path` at the same time.',
  })
  @IsOptional()
  @IsString()
  parentId?: string; // Do not use both `parentId` and `path`

  @ApiProperty({
    type: String,
    required: false,
    description: 'The folder path to upload the file, e.g. "uploads", not including "/" at the end.',
  })
  @IsOptional()
  @IsString()
  path?: string;
}

export class RenameFileRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  name: string;
}

export class RenameFileResponseDto extends CreateFileResponseDto {}

export class MoveFileRequestDto {
  @ApiProperty({
    type: String,
    required: false,
    description: `The destination folder ID to move the file or folder to. If not provided, moves to root folder.`,
  })
  @IsOptional()
  @IsString()
  destinationParentId?: string;
}

export class ListFilePathsResDto {
  @ApiProperty({
    type: String,
  })
  @IsString()
  id: string;

  @ApiProperty({
    type: String,
  })
  @IsString()
  name: string;

  @ApiProperty({
    type: String,
  })
  @IsString()
  type: string;
  @ApiProperty({
    type: String,
  })
  @IsString()
  parentId: string;
}

//***************/
//* Upload DTOs */
//***************/

export class UploadFileRequestDto {
  @ApiProperty({
    type: String,
    required: false,
    description: 'The parent folder ID to upload the file to, do not use both `parentId` and `path` at the same time.',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'The folder path to upload the file, e.g. "uploads", not including "/" at the end.',
  })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiProperty({
    type: Boolean,
    required: false,
    description: `1. This option will only take effect when 'name' is provided.
     2. Default to false, do not overwrite the existing file.
     3. If overwrite is true, the existing file with the same name in the same folder will be overwritten.`,
  })
  @IsOptional()
  overwrite?: boolean;
}

export class UploadBase64RequestDto {
  @ApiProperty({
    type: String,
    required: false,
    description: 'The parent folder ID to upload the file to, do not use both `parentId` and `path` at the same time.',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'The folder path to upload the file, e.g. "uploads", not including "/" at the end.',
  })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiProperty({
    type: String,
    required: true,
    description: 'Base64 encoded file data.',
  })
  @IsString()
  base64: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'If not set, a random name will be generated.',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    type: Boolean,
    required: false,
    description: `1. This option will only take effect when 'name' is provided.
     2. Default to false, do not overwrite the existing file.
     3. If overwrite is true, the existing file with the same name in the same folder will be overwritten.`,
  })
  @IsOptional()
  overwrite?: boolean;
}

//*************************/
//* Multipart upload DTOs */
//*************************/
class UploadPartInfo {
  @ApiProperty({type: String, required: true})
  @IsString()
  ETag: string;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  @Type(() => Number)
  PartNumber: number;
}

export class CreateMultipartUploadRequestDto extends CreateFileRequestDto {}

export class CreateMultipartUploadResponseDto extends CreateFileResponseDto {}

export class UploadPartRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  uploadId: string;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  @Type(() => Number)
  uploadProgress: number;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  @Type(() => Number)
  partNumber: number;
}

export class UploadPartResponseDto {
  @ApiProperty({type: String})
  ETag: string;

  @ApiProperty({type: Number})
  PartNumber: number;
}

export class CompleteMultipartUploadRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  uploadId: string;

  @ApiProperty({
    type: [UploadPartInfo],
    required: true,
  })
  @IsArray()
  parts: UploadPartInfo[];
}

export class AbortMultipartUploadRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  uploadId: string;
}
