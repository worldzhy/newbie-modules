import type {Request as NestRequest} from '@nestjs/common';
import type {Request as ExpressRequest} from 'express';

export interface WechatAccessTokenParsed {
  userId: string;
  sessionId?: number;
  wechatOpenId: string;
}

type CombinedRequest = ExpressRequest & typeof NestRequest;
export interface WechatUserRequest extends CombinedRequest {
  user: WechatAccessTokenParsed;
}
