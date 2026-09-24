import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document, Schema as MongooseSchema} from 'mongoose';

@Schema({shardKey: {_id: 'hashed'}})
export class WebResource {
  @Prop() appId: string; // App ID (system identifier)
  @Prop({default: Date.now}) createTime: Date; // Visit time
  @Prop() url: string; // Page URL
  @Prop() fullUrl: string; // Full resource URL
  @Prop() speedType: number; // 1: normal, 2: slow
  @Prop({type: MongooseSchema.Types.Mixed}) resourceDatas: any; // All loaded resources JSON
  @Prop() name: string; // Resource name
  @Prop({default: 'GET'}) method: string; // Request method
  @Prop() type: string; // Resource type
  @Prop({default: 0}) duration: number; // Request duration (ms)
  @Prop({default: 0}) bodySize: number; // Response size (bytes)
  @Prop({default: 'http/1.1'}) nextHopProtocol: string; // Protocol
  @Prop() markPage: string; // Page mark (unified tag)
  @Prop() markUser: string; // User mark (session tag)
  @Prop() phone: string; // User phone
  @Prop() uid: string; // User ID
}
export type WebResourceDocument = WebResource & Document;
export const WebResourceSchema = SchemaFactory.createForClass(WebResource);
WebResourceSchema.index({speedType: 1, name: 1, createTime: -1});
WebResourceSchema.index({name: 1, createTime: -1});
WebResourceSchema.index({speedType: 1, url: 1});
