import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';

@Schema()
export class Email {
  @Prop() email: string; // Email address
  @Prop() name: string; // User name
  @Prop({type: Array, default: []}) systemIds: any[]; // Owned application IDs
  @Prop({default: Date.now}) createTime: Date; // Created time
}
export type EmailDocument = Email & Document;
export const EmailSchema = SchemaFactory.createForClass(Email);
EmailSchema.index({email: -1});
