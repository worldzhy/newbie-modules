import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsEmail, IsEnum, IsNumber } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { GoogleAccountRole } from "@modules/googleapis/google-drive/google-drive.enum";
import { GoogleDrivePermissionEntity } from "@modules/googleapis/google-drive/google-drive.entity";

export class ListGoogleDrivePermissionsRequestDto extends CommonListRequestDto {
  @ApiProperty({ type: String, description: "The file ID to list permissions for." })
  @IsString()
  fileId!: string;
}

export class ListGoogleDrivePermissionsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: GoogleDrivePermissionEntity, isArray: true, description: "The list of file permissions." })
  declare records: GoogleDrivePermissionEntity[];
}

export class CreateGoogleDrivePermissionRequestDto {
  @ApiProperty({ type: String, description: "The ID of the file to share." })
  @IsString()
  fileId!: string;

  @ApiProperty({ type: String, description: "The email address to share the file with." })
  @IsEmail()
  email!: string;

  @ApiProperty({
    enum: GoogleAccountRole,
    enumName: "GoogleAccountRole",
    description: "The role to assign to the user.",
  })
  @IsEnum(GoogleAccountRole)
  role!: GoogleAccountRole;
}

export class CreateGoogleDrivePermissionResponseDto extends GoogleDrivePermissionEntity {}

export class GetGoogleDrivePermissionRequestDto {
  @ApiProperty({ type: Number, description: "The ID of the permission to get." })
  @IsNumber()
  permissionId!: number;
}
