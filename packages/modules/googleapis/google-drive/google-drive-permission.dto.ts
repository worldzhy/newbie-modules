import {ApiProperty} from '@nestjs/swagger';
import {IsString, IsEmail, IsEnum, IsNumber} from 'class-validator';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {GoogleAccountRole} from '@microservices/googleapis/google-drive/google-drive.enum';
import {GoogleDrivePermissionEntity} from '@microservices/googleapis/google-drive/google-drive.entity';

export class ListGoogleDrivePermissionsRequestDto extends CommonListRequestDto {
  @ApiProperty({type: String, required: true, description: 'The file ID to list permissions for.'})
  @IsString()
  fileId: string;
}

export class ListGoogleDrivePermissionsResponseDto extends CommonListResponseDto {
  @ApiProperty({type: GoogleDrivePermissionEntity, isArray: true, description: 'The list of file permissions.'})
  declare records: GoogleDrivePermissionEntity[];
}

export class CreateGoogleDrivePermissionRequestDto {
  @ApiProperty({type: String, required: true, description: 'The ID of the file to share.'})
  @IsString()
  fileId: string;

  @ApiProperty({type: String, required: true, description: 'The email address to share the file with.'})
  @IsEmail()
  email: string;

  @ApiProperty({type: String, required: true, description: 'The role to assign to the user.'})
  @IsEnum(GoogleAccountRole)
  role: GoogleAccountRole;
}

export class CreateGoogleDrivePermissionResponseDto extends GoogleDrivePermissionEntity {}

export class GetGoogleDrivePermissionRequestDto {
  @ApiProperty({type: Number, required: true, description: 'The ID of the permission to get.'})
  @IsNumber()
  permissionId: number;
}
