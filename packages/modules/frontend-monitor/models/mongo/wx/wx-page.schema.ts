import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document, Schema as MongooseSchema} from 'mongoose';

@Schema({shardKey: {_id: 'hashed'}})
export class WxPage {
  @Prop() appId: string; // App ID
  @Prop({default: Date.now}) createTime: Date; // Created time
  @Prop() path: string; // Current path
  @Prop({type: MongooseSchema.Types.Mixed}) options: any; // Path params
  @Prop() markPage: string; // Page mark
  @Prop() markUser: string; // User mark
  @Prop() markUv: string; // UV mark
  @Prop() markDevice: string; // Device mark
  @Prop() net: string; // Network type
  @Prop() ip: string; // User IP
  @Prop() county: string; // Country
  @Prop() province: string; // Province
  @Prop() city: string; // City
  @Prop() brand: string; // Device brand
  @Prop() model: string; // Device model
  @Prop() screenWidth: string; // Screen width
  @Prop() screenHeight: string; // Screen height
  @Prop() language: string; // WeChat language
  @Prop() version: string; // WeChat version
  @Prop() system: string; // OS version
  @Prop() platform: string; // Platform
  @Prop() sdkVersion: string; // Base library version
  @Prop() phone: string; // User phone
  @Prop() uid: string; // User ID
}
export type WxPageDocument = WxPage & Document;
export const WxPageSchema = SchemaFactory.createForClass(WxPage);
WxPageSchema.index({createTime: -1});
WxPageSchema.index({markPage: -1});
WxPageSchema.index({markUser: -1});
