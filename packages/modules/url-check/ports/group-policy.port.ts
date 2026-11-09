/**
 * SPI port for the host's attach policy on url-check groups.
 *
 * The module treats groupId as an opaque owner reference (cross-schema FK to
 * the host's grouping entity). Whether a given group may own url-check
 * targets — which group types are eligible — is host domain policy and stays
 * out of the module. The host binds this port from its application layer;
 * the module fails to boot when the port is unbound (same fail-closed
 * convention as backend-monitor's application-ref resolver).
 */
export const urlCheckGroupPolicyToken = "URL_CHECK_GROUP_POLICY";

export interface UrlCheckGroupPolicy {
  /**
   * Assert that a group may own a new url-check target. Implementations throw
   * BadRequestException when the group is not eligible; existence is already
   * verified by the module before this hook runs.
   */
  assertAttachable(groupId: string): Promise<void>;
}
