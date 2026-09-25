import {ApiProperty} from '@nestjs/swagger';
import {IsString, IsOptional} from 'class-validator';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {GoogleDriveFileEntity} from '@modules/googleapis/google-drive/google-drive.entity';

export class ListGoogleDriveFilesRequestDto extends CommonListRequestDto {
  @ApiProperty({type: String, required: false, description: 'The parent folder ID to list files for.'})
  @IsOptional()
  @IsString()
  parentId?: string;
}
export class ListGoogleDriveFilesResponseDto extends CommonListResponseDto {
  @ApiProperty({type: GoogleDriveFileEntity, isArray: true, description: 'The list of files.'})
  declare records: GoogleDriveFileEntity[];
}

export class CreateGoogleDriveFileRequestDto {
  @ApiProperty({type: String, required: true, description: 'The name of the file to create.'})
  @IsString()
  name: string;

  @ApiProperty({type: String, required: false, description: 'The ID of the parent folder to create the file in.'})
  @IsOptional()
  @IsString()
  parentId?: string;
}
export class CreateGoogleDriveFileResponseDto extends GoogleDriveFileEntity {}

/** Body DTO for the Google Drive file upload (multipart/form-data). parentId is optional. */
export class UploadGoogleDriveFileBodyDto {
  @ApiProperty({type: String, required: false, description: 'The parent folder ID to upload the file to.'})
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class RenameGoogleDriveFileRequestDto {
  @ApiProperty({type: String, required: true, description: 'The new name of the file.'})
  @IsString()
  name: string;
}
export class RenameGoogleDriveFileResponseDto extends GoogleDriveFileEntity {}

export class GetGoogleDriveFileRequestDto {
  @ApiProperty({type: String, required: true, description: 'The ID of the file to get the path for.'})
  @IsString()
  fileId: string;
}

/**
 * A single node in a file path breadcrumb. Local-cached nodes carry the full
 * GoogleDriveFileEntity, while cloud-fallback nodes only have id/name/type/parentId.
 * All fields beyond id and name are optional to cover both cases.
 */
export class GetFilePathResponseDto {
  @ApiProperty({type: String, description: 'The file/folder ID.'})
  id: string;

  @ApiProperty({type: String, description: 'The file/folder name.'})
  name: string;

  @ApiProperty({type: String, required: false, description: 'The MIME type of the file.'})
  type?: string | null;

  @ApiProperty({type: String, required: false, description: 'The parent folder ID, null if at the root.'})
  parentId?: string | null;
}
