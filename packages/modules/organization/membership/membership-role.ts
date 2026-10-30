/**
 * Organization-internal role ranking.
 *
 * Membership routes previously had no authorization at all: any authenticated
 * user could add an OWNER to any organization, change roles or delete members.
 * The controller now requires the OrgMembership permission, and the service
 * additionally re-checks the caller's *organization* role so a caller can never
 * act on a role ranked above their own (an ADMIN must not mint or demote an
 * OWNER). Kept as a plain string map so it can be unit-tested without the
 * generated Prisma client.
 */
export type MembershipRoleValue = "OWNER" | "ADMIN" | "MEMBER";

export const MEMBERSHIP_ROLE_RANK: Record<MembershipRoleValue, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** Role required to manage any other membership in an organization. */
export const MEMBERSHIP_MANAGER_MIN_RANK: number = MEMBERSHIP_ROLE_RANK.ADMIN;

export function membershipRank(role: string): number {
  return MEMBERSHIP_ROLE_RANK[role as MembershipRoleValue] ?? 0;
}

/** True when `role` meets the minimum rank (e.g. ADMIN or OWNER). */
export function isMembershipManager(role: string): boolean {
  return membershipRank(role) >= MEMBERSHIP_MANAGER_MIN_RANK;
}

/** True when `role` is ranked strictly above `operatorRole`. */
export function isRoleAbove(role: string, operatorRole: string): boolean {
  return membershipRank(role) > membershipRank(operatorRole);
}
