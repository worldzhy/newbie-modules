import { Injectable, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  handleRequest(err: BadRequestException, user: any) {
    // console.log(err)
    if (err)
      throw new BadRequestException('Google authorization verification failed');
    return user;
  }
}
