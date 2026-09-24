import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

export class MessageBotChannelGroupEntity {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  name: string;

  @ApiPropertyOptional({type: String})
  description?: string | null;

  @ApiProperty({type: Number})
  sort: number;

  @ApiPropertyOptional({type: String})
  parentId?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}
