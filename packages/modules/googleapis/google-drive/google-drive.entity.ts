import {ApiProperty} from '@nestjs/swagger';

export class GoogleDriveFileEntity {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  name: string;

  @ApiProperty({type: String})
  type?: string | null;

  @ApiProperty({type: Number})
  size?: number | null;

  @ApiProperty({type: String})
  iconLink?: string | null;

  @ApiProperty({type: String})
  webViewLink?: string | null;

  @ApiProperty({type: String})
  webContentLink?: string | null;

  @ApiProperty({type: String})
  parentId?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}

export class GoogleDrivePermissionEntity {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  permissionId: string;

  @ApiProperty({type: String})
  type: string;

  @ApiProperty({type: String})
  role: String;

  @ApiProperty({type: String})
  email: string;

  @ApiProperty({type: String})
  createdAt: string;

  @ApiProperty({type: String})
  updatedAt: string;

  @ApiProperty({type: String})
  fileId: string;
}
