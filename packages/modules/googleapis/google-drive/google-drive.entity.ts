import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class GoogleDriveFileEntity {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  type?: string | null;

  @ApiPropertyOptional({ type: Number })
  size?: number | null;

  @ApiPropertyOptional({ type: String })
  iconLink?: string | null;

  @ApiPropertyOptional({ type: String })
  webViewLink?: string | null;

  @ApiPropertyOptional({ type: String })
  webContentLink?: string | null;

  @ApiPropertyOptional({ type: String })
  parentId?: string | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class GoogleDrivePermissionEntity {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  permissionId!: string;

  @ApiProperty({ type: String })
  type!: string;

  @ApiProperty({ type: String })
  role!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;

  @ApiProperty({ type: String })
  fileId!: string;
}
