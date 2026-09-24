import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';

@Schema()
export class System {
  @Prop() systemDomain: string; // System domain
  @Prop() projectId: string;
  @Prop() systemName: string; // System name
  @Prop() appId: string; // App ID
  @Prop({default: 'web'}) type: string; // App type: web / wx
  @Prop({type: [String], default: []}) userId: string[]; // Owner user IDs
  @Prop({default: Date.now}) createTime: Date; // Creation time
  @Prop({default: 0}) isUse: number; // Enable statistics: 0 yes, 1 no
  @Prop({default: 5}) slowPageTime: number; // Slow page threshold (s)
  @Prop({default: 2}) slowJsTime: number; // Slow JS threshold (s)
  @Prop({default: 2}) slowCssTime: number; // Slow CSS threshold (s)
  @Prop({default: 2}) slowImgTime: number; // Slow image threshold (s)
  @Prop({default: 2}) slowAjaxTime: number; // Slow AJAX threshold (s)
  @Prop({default: 0}) isStatisiPages: number; // Collect page perf: 0 yes, 1 no
  @Prop({default: 0}) isStatisiAjax: number; // Collect AJAX perf
  @Prop({default: 0}) isStatisiResource: number; // Collect resource perf
  @Prop({default: 0}) isStatisiSystem: number; // Store user system info
  @Prop({default: 0}) isStatisiError: number; // Report page errors
  @Prop({default: 0}) isDailyUse: number; // Send daily report
  @Prop({type: [String], default: []}) daliyList: string[]; // Daily report recipients
  @Prop({default: 0}) isHighestUse: number; // Send PV peak emails
  @Prop({default: 0}) isWarning: number; // Enable alerts (1 on, 0 off)
  @Prop({type: [String], default: []}) highestList: string[]; // PV peak recipients
}
export type SystemDocument = System & Document;
export const SystemSchema = SchemaFactory.createForClass(System);
SystemSchema.index({appId: -1, createTime: 1, systemDomain: -1, userId: -1});
