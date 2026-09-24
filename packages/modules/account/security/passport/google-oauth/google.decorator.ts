import {SetMetadata} from '@nestjs/common';

// Use @GuardByGoogle() for google strategy authentication
export const IS_LOGGING_IN_GOOGLE_KEY = 'isLoggingInByGoogle';
export const GuardByGoogle = () => SetMetadata(IS_LOGGING_IN_GOOGLE_KEY, true);
