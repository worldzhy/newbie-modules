import {ApiProperty} from '@nestjs/swagger';

export class FileEntity {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  name: string;

  @ApiProperty({type: String})
  type: string;

  @ApiProperty({
    type: Number,
    description: 'The size of the file in bytes, null for folders.',
  })
  size: number | null;

  @ApiProperty({type: String})
  s3Bucket: string;

  @ApiProperty({type: String})
  s3Key: string;

  @ApiProperty({type: Object})
  s3Response: any;

  @ApiProperty({type: String})
  parentId: string | null;

  @ApiProperty({type: String})
  createdAt: string;

  @ApiProperty({type: String})
  updatedAt: string;
}
