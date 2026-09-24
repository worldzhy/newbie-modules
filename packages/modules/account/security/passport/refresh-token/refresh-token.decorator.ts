import {SetMetadata} from '@nestjs/common';

// Use @GuardByRefreshToken() for refresh endpoint authentication
export const IS_REFRESHING_ACCESS_TOKEN_KEY = 'isRefreshingAccessToken';
export const GuardByRefreshToken = () => SetMetadata(IS_REFRESHING_ACCESS_TOKEN_KEY, true);
