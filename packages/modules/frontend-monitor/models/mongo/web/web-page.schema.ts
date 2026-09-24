import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document, Schema as MongooseSchema} from 'mongoose';

@Schema({shardKey: {_id: 'hashed'}})
export class WebPage {
  @Prop() appId: string; // App ID
  @Prop({default: Date.now}) createTime: Date; // Visit time
  @Prop() url: string; // URL domain
  @Prop() fullUrl: string; // Full URL
  @Prop() preUrl: string; // Referrer URL
  @Prop() speedType: number; // 1: normal, 2: slow
  @Prop() isFirstIn: boolean; // true: first in session, false: not first
  @Prop() markPage: string; // Page mark
  @Prop() markUser: string; // User mark
  @Prop() loadTime: number; // Full load time (ms)
  @Prop() dnsTime: number; // DNS time (ms)
  @Prop() tcpTime: number; // TCP connect time (ms)
  @Prop() domTime: number; // DOM build time (ms)
  @Prop({type: [MongooseSchema.Types.Mixed], default: []}) resourceList: any[]; // Resource performance list
  @Prop() totalResSize: number; // Total resource size
  @Prop() whiteTime: number; // First paint (ms)
  @Prop() redirectTime: number; // Redirect time
  @Prop() unloadTime: number; // Unload time
  @Prop() requestTime: number; // Request time
  @Prop() analysisDomTime: number; // DOM parsing time
  @Prop() readyTime: number; // Page ready time
  @Prop() screenWidth: number; // Screen width
  @Prop() screenHeight: number; // Screen height
}
export type WebPageDocument = WebPage & Document;
export const WebPageSchema = SchemaFactory.createForClass(WebPage);
WebPageSchema.index({speedType: 1, isFirstIn: 1, url: 1, createTime: -1});
WebPageSchema.index({createTime: -1});
