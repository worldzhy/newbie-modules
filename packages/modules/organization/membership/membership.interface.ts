import {MembershipRole} from '@generated/prisma/client';

export interface CreateMembershipInput {
  email: string;
  name?: string;
  role?: MembershipRole;
}
