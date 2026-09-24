import {Module, Global} from '@nestjs/common';
import {ShortcutGroupController} from './shortcut-group.controller';
import {ShortcutItemController} from './shortcut-item.controller';

@Global()
@Module({
  controllers: [ShortcutGroupController, ShortcutItemController],
})
export class ShortcutModule {}
