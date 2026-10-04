import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Response DTO for a web-monitor System document (MongoDB).
 * Mirrors the fields defined in models/mongo/system.schema.ts.
 */
export class WebMonitorSystemResponseDto {
  @ApiProperty({ type: String, description: "MongoDB document ID" })
  _id: string;

  @ApiProperty({ type: String, description: "System domain" })
  systemDomain: string;

  @ApiProperty({ type: String, description: "Owning Nightwatch project ID" })
  projectId: string;

  @ApiProperty({ type: String, description: "System display name" })
  systemName: string;

  @ApiPropertyOptional({ type: String, description: "Legacy sub type (only in old documents)" })
  subType?: string;

  @ApiPropertyOptional({ type: String, description: "Legacy common name (only in old documents)" })
  systemCommonName?: string;

  @ApiProperty({ type: String, description: "Unique application ID used by the SDK" })
  appId: string;

  @ApiProperty({ type: String, description: "Application type: web / wx" })
  type: string;

  @ApiProperty({ type: String, isArray: true, description: "Owner user IDs" })
  userId: string[];

  @ApiProperty({ type: String, description: "Creation time" })
  createTime: string;

  @ApiProperty({ type: Number, description: "Slow page threshold (seconds)" })
  slowPageTime: number;

  @ApiProperty({ type: Number, description: "Slow first-paint threshold (seconds)" })
  slowWhiteTime: number;

  @ApiProperty({ type: Number, description: "Slow JS threshold (seconds)" })
  slowJsTime: number;

  @ApiProperty({ type: Number, description: "Slow CSS threshold (seconds)" })
  slowCssTime: number;

  @ApiProperty({ type: Number, description: "Slow image threshold (seconds)" })
  slowImgTime: number;

  @ApiProperty({ type: Number, description: "Slow AJAX threshold (seconds)" })
  slowAjaxTime: number;
}
