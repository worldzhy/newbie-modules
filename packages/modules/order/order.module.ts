import {Global, Module} from '@nestjs/common';
import {OrderController} from './order.controller';
import {OrderService} from './order.service';
import {ProductController} from './product/product.controller';
import {WechatWorkflowOrderController} from './wechat-workflow/wechat-workflow.controller';

@Global()
@Module({
  controllers: [OrderController, ProductController, WechatWorkflowOrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
