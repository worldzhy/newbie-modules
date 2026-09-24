import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';

@Schema({shardKey: {_id: 'hashed'}})
export class WebEnvironment {
  @Prop() appId: string; // App ID
  @Prop({default: Date.now}) createTime: Date; // Visit time
  @Prop() url: string; // Page URL
  @Prop() markPage: string; // Page mark
  @Prop() markUser: string; // User mark
  @Prop() markUv: string; // UV mark
  @Prop() markDevice: string; // Device mark
  @Prop() browser: string; // Browser name
  @Prop() browserVersion: string; // Browser version
  @Prop() system: string; // OS
  @Prop() systemVersion: string; // OS version
  @Prop() ip: string; // Visitor IP
  @Prop() county: string; // Country
  @Prop() province: string; // Province
  @Prop() city: string; // City
  @Prop() phone: string; // User phone
  @Prop() uid: string; // User ID
}
export type WebEnvironmentDocument = WebEnvironment & Document;
export const WebEnvironmentSchema = SchemaFactory.createForClass(WebEnvironment);
WebEnvironmentSchema.index({createTime: -1});
WebEnvironmentSchema.index({markPage: -1});
WebEnvironmentSchema.index({markUser: -1});
