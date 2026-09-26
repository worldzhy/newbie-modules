import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';

@Schema()
export class WebPvuvip {
  @Prop() appId: string; // App ID (system identifier)
  @Prop() pv: number; // PV count
  @Prop() uv: number; // UV count
  @Prop() ip: number; // IP count
  @Prop() ajax: number; // AJAX call count
  @Prop() bounce: string; // Bounce rate
  @Prop() depth: number; // Average visit depth
  @Prop() flow: number; // Total traffic cost
  @Prop({default: 1}) type: number; // 1: per-minute data, 2: per-day data
  @Prop({default: Date.now}) createTime: Date;
}
export type WebPvuvipDocument = WebPvuvip & Document;
export const WebPvuvipSchema = SchemaFactory.createForClass(WebPvuvip);
WebPvuvipSchema.index({type: 1, appId: 1, createTime: -1});
WebPvuvipSchema.index({createTime: -1});
