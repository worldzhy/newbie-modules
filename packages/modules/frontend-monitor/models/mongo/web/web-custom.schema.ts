import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema } from "mongoose";

@Schema({ shardKey: { _id: "hashed" } })
export class WebCustom {
  @Prop() appKey!: string; // App ID
  @Prop({ default: Date.now }) createTime!: Date; // Created time
  @Prop() markPage!: string; // Page mark
  @Prop() markUser!: string; // User mark
  @Prop() path!: string; // Path
  @Prop() customName!: string; // Custom name for grouping
  @Prop() customContent!: string; // Custom info (stringified object)
  @Prop({ type: MongooseSchema.Types.Mixed }) customFilter!: Record<string, unknown>; // Custom filter defined by biz
  @Prop() phone!: string; // User phone
  @Prop() uid!: string; // User ID
}
export type WebCustomDocument = WebCustom & Document;
export const WebCustomSchema = SchemaFactory.createForClass(WebCustom);
WebCustomSchema.index({ createTime: -1 });
// 90-day retention, matching the ClickHouse and backend tables (ADR-044).
WebCustomSchema.index({ createTime: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

@Schema({ shardKey: { _id: "hashed" } })
export class WebCustomFilter {
  @Prop() appKey!: string; // App ID
  @Prop({ default: Date.now }) createTime!: Date; // Created time
  @Prop() filterKey!: string; // Filter key
  @Prop() filterDesc!: string; // Filter description
}
export type WebCustomFilterDocument = WebCustomFilter & Document;
export const WebCustomFilterSchema = SchemaFactory.createForClass(WebCustomFilter);
