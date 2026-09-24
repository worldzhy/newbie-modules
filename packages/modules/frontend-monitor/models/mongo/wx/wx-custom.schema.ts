import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document, Schema as MongooseSchema} from 'mongoose';

@Schema({shardKey: {_id: 'hashed'}})
export class WxCustom {
  @Prop() appId: string; // App ID
  @Prop({default: Date.now}) createTime: Date; // Created time
  @Prop() markPage: string; // Page mark
  @Prop() markUser: string; // User mark
  @Prop() path: string; // Path
  @Prop() customName: string; // Custom name for grouping
  @Prop() customContent: string; // Custom info (stringified object)
  @Prop({type: MongooseSchema.Types.Mixed}) customFilter: any; // Custom filter defined by biz
  @Prop() phone: string; // User phone
  @Prop() uid: string; // User ID
}
export type WxCustomDocument = WxCustom & Document;
export const WxCustomSchema = SchemaFactory.createForClass(WxCustom);
WxCustomSchema.index({createTime: -1});

@Schema({shardKey: {_id: 'hashed'}})
export class WxCustomFilter {
  @Prop() appId: string; // App ID
  @Prop({default: Date.now}) createTime: Date; // Created time
  @Prop() filterKey: string; // Filter key
  @Prop() filterDesc: string; // Filter description
}
export type WxCustomFilterDocument = WxCustomFilter & Document;
export const WxCustomFilterSchema = SchemaFactory.createForClass(WxCustomFilter);
