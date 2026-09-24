import {Global, Module} from '@nestjs/common';
import {GoogleDriveFileController} from './google-drive/google-drive-file.controller';
import {GoogleDriveFileService} from './google-drive/google-drive-file.service';
import {GoogleDrivePermissionController} from './google-drive/google-drive-permission.controller';
import {GoogleDrivePermissionService} from './google-drive/google-drive-permission.service';
import {GoogleFormService} from './google-form.service';
import {GoogleSheetService} from './google-sheet.service';
import {GoogleTimezoneService} from './google-timezone.service';

@Global()
@Module({
  controllers: [GoogleDriveFileController, GoogleDrivePermissionController],
  providers: [
    GoogleDriveFileService,
    GoogleDrivePermissionService,
    GoogleFormService,
    GoogleSheetService,
    GoogleTimezoneService,
  ],
  exports: [
    GoogleDriveFileService,
    GoogleDrivePermissionService,
    GoogleFormService,
    GoogleSheetService,
    GoogleTimezoneService,
  ],
})
export class GoogleAPIsModule {}
