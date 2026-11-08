/**
 * Host-provided project visibility port.
 *
 * web-monitor stores its sites in Mongo, but which projects a caller may see is
 * a host concept (project membership). The module owns no membership table, so
 * the host supplies this port and the module scopes every user-facing site
 * query to the returned IDs. The host binds the port at assembly time.
 */
export const PROJECT_VISIBLE_IDS_RESOLVER = "PROJECT_VISIBLE_IDS_RESOLVER";

export interface ProjectVisibleIdsResolver {
  /** Project IDs the user is a member of. Empty means "no projects". */
  visibleProjectIds(userId: string): Promise<string[]>;
}
