import {SetMetadata} from '@nestjs/common';

// Use @GuardByProfile() for custom.profile strategy authentication
export const IS_LOGGING_IN_APIKEY_KEY = 'isLoggingInByApiKey';
export const GuardByApiKey = () => SetMetadata(IS_LOGGING_IN_APIKEY_KEY, true);
