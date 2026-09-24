import {BadRequestException, ExecutionContext, Injectable} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {GuardType} from '../guard.types';

@Injectable()
export class GoogleAuthGuard extends AuthGuard(GuardType.GOOGLE) {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: BadRequestException, user: any) {
    if (err) throw new BadRequestException('Google authorization verification failed');
    return user;
  }
}
