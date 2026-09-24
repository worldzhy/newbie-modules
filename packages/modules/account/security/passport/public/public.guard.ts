import {Injectable} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {GuardType} from '../guard.types';

@Injectable()
export class NoAuthGuard extends AuthGuard(GuardType.NONE) {}
