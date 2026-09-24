import {Injectable} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {GuardType} from '../guard.types';

@Injectable()
export class ApiKeyAuthGuard extends AuthGuard(GuardType.API_KEY) {}
