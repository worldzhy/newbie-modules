import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';

@Schema()
export class DayReportNum {
  @Prop() appId: string; // App ID
  @Prop({default: ''}) type: string; // App type: web / wx
  @Prop({default: Date.now}) dayTime: Date; // Target day time
  @Prop({default: Date.now}) createTime: Date; // Record created time
  @Prop({default: 0}) num: number; // Report count
}
export type DayReportNumDocument = DayReportNum & Document;
export const DayReportNumSchema = SchemaFactory.createForClass(DayReportNum);
DayReportNumSchema.index({appId: 1, dayTime: -1});
