/**
 * Host-provided project visibility port.
 *
 * web-monitor stores its sites in Mongo, but which projects a caller may see is
 * a host concept (project membership). The module owns no membership table, so
 * the host supplies this port and **controllers** scope every user-facing site
 * query to the returned IDs. Services receive the resolved ids as plain
 * arguments and never see a user id. The host binds the port at assembly time;
 * a missing binding fails at startup rather than silently widening the scope.
 */
export const PROJECT_VISIBLE_IDS_RESOLVER = "PROJECT_VISIBLE_IDS_RESOLVER";

export interface ProjectVisibleIdsResolver {
  /** Project IDs the caller is a member of. Empty means "no projects". */
  visibleProjectIds(userId: string): Promise<string[]>;
}
