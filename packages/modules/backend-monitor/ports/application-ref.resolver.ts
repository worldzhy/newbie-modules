/**
 * SPI port mapping an installation's opaque externalRef to the host's
 * application identity, stamped as `application_id` on ClickHouse rows.
 *
 * Like the sibling installation modules (heartbeat, health, module-hub), the
 * module treats externalRef as an opaque platform-owned tag and never parses
 * it. The mapping convention belongs to the host, which binds this port from
 * its application layer; the module fails to boot when the port is unbound.
 */
export const monitorApplicationRefResolverToken = "BACKEND_MONITOR_APPLICATION_REF_RESOLVER";

export interface MonitorApplicationRefResolver {
  /**
   * Resolve the application id for an externalRef, or null when the ref has
   * no application mapping (the report token is then rejected on ingest).
   * The returned id must be a UUID string: values land in the ClickHouse
   * `application_id UUID` column.
   */
  resolveApplicationId(externalRef: string): string | null;
}
