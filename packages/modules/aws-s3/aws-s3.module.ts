import {Global, Module} from '@nestjs/common';
import {AwsS3Service} from './aws-s3.service';
import {AwsS3FileService} from './aws-s3-file.service';
import {AwsS3FileController} from './aws-s3-file.controller';

@Global()
@Module({
  controllers: [AwsS3FileController],
  providers: [AwsS3Service, AwsS3FileService],
  exports: [AwsS3Service, AwsS3FileService],
})
export class AwsS3Module {}
