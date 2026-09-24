import {ApiProperty} from '@nestjs/swagger';

export class ShortcutGroupEntity {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  name: string;

  @ApiProperty({type: String})
  description: string;

  @ApiProperty({type: Number})
  sort: number;

  @ApiProperty({type: Number})
  parentId: number;

  @ApiProperty({type: String})
  status: string;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}

export class ShortcutItemEntity {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  label: string;

  @ApiProperty({type: String})
  content: string;

  @ApiProperty({type: String})
  description: string;

  @ApiProperty({type: String})
  type: string;

  @ApiProperty({type: Number})
  sort: number;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({type: Number})
  groupId: number;
}
