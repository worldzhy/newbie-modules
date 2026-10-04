import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';

@Schema()
export class System {
  @Prop() systemDomain: string; // System domain
  @Prop() projectId: string;
  @Prop() systemName: string; // System name
  @Prop() appId: string; // App ID
  @Prop({default: 'web'}) type: string; // App type: web
  @Prop({type: [String], default: []}) userId: string[]; // Owner user IDs
  @Prop({default: Date.now}) createTime: Date; // Creation time
  @Prop({type: Boolean, default: true}) statisticsEnabled: boolean; // Master statistics switch
  @Prop({default: 5}) slowPageTime: number; // Slow page threshold (s)
  @Prop({default: 2}) slowJsTime: number; // Slow JS threshold (s)
  @Prop({default: 2}) slowCssTime: number; // Slow CSS threshold (s)
  @Prop({default: 2}) slowImgTime: number; // Slow image threshold (s)
  @Prop({default: 2}) slowAjaxTime: number; // Slow AJAX threshold (s)
  @Prop({type: Boolean, default: true}) pagePerformanceEnabled: boolean; // Collect page performance
  @Prop({type: Boolean, default: true}) ajaxPerformanceEnabled: boolean; // Collect AJAX performance
  @Prop({type: Boolean, default: true}) resourcePerformanceEnabled: boolean; // Collect resource performance
  @Prop({type: Boolean, default: true}) browserEnvironmentEnabled: boolean; // Collect browser/OS/geo environment
  @Prop({type: Boolean, default: true}) errorReportingEnabled: boolean; // Report page errors
  @Prop({type: Boolean, default: true}) dailyReportEnabled: boolean; // Send daily report
  @Prop({type: [String], default: []}) dailyReportRecipients: string[]; // Daily report recipients
  @Prop({type: Boolean, default: true}) pvPeakReportEnabled: boolean; // Send PV peak report
  @Prop({type: Boolean, default: false}) alertsEnabled: boolean; // Enable threshold alerts
  @Prop({type: [String], default: []}) pvPeakRecipients: string[]; // PV peak report recipients
}
export type SystemDocument = System & Document;
export const SystemSchema = SchemaFactory.createForClass(System);
SystemSchema.index({appId: -1, createTime: 1, systemDomain: -1, userId: -1});
