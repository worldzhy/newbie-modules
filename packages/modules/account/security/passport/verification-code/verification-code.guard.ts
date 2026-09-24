import {Injectable} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {GuardType} from '../guard.types';

@Injectable()
export class VerificationCodeAuthGuard extends AuthGuard(GuardType.VERIFICATION_CODE) {}
