import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

@Schema()
export class System {
  @Prop() systemDomain: string; // System domain
  @Prop() projectId: string;
  @Prop() systemName: string; // System name
  @Prop() appId: string; // App ID
  @Prop({ default: "web" }) type: string; // App type: web
  @Prop({ type: [String], default: [] }) userId: string[]; // Owner user IDs
  @Prop({ default: Date.now }) createTime: Date; // Creation time
  @Prop({ default: 5 }) slowPageTime: number; // Slow page threshold (s)
  @Prop({ default: 2 }) slowWhiteTime: number; // Slow first-paint threshold (s)
  @Prop({ default: 2 }) slowJsTime: number; // Slow JS threshold (s)
  @Prop({ default: 2 }) slowCssTime: number; // Slow CSS threshold (s)
  @Prop({ default: 2 }) slowImgTime: number; // Slow image threshold (s)
  @Prop({ default: 2 }) slowAjaxTime: number; // Slow AJAX threshold (s)
}
export type SystemDocument = System & Document;
export const SystemSchema = SchemaFactory.createForClass(System);
SystemSchema.index({ appId: -1, createTime: 1, systemDomain: -1, userId: -1 });
