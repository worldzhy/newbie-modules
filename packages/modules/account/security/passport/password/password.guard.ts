import {Injectable} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {GuardType} from '../guard.types';

@Injectable()
export class PasswordAuthGuard extends AuthGuard(GuardType.PASSWORD) {}
