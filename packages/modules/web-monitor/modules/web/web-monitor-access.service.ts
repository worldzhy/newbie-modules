import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { isValidAppKey } from "../../shared/utils";

/**
 * Resolves an appKey for management-side web-monitor queries.
 *
 * This module intentionally never trusts an appKey carried in a request —
 * the caller supplies projectId + applicationId (both UUIDs from the host
 * URL path) and we derive the appKey from the installation registry.
 *
 * Permission is resolved by the calling controller, which passes the caller's
 * visible project ids in. This service only validates the given project against
 * that already-resolved scope; it never sees a user id or a role.
 */
@Injectable()
export class WebMonitorAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the storage partition key for a management-side query.
   * Throws ForbiddenException when projectId is outside the caller's resolved
   * scope; throws NotFoundException when the installation is not enrolled for
   * the given projectId/applicationId pair.
   */
  async resolveAppKey(projectIds: string[], projectId: string, applicationId: string): Promise<string> {
    if (!projectIds.includes(projectId)) {
      throw new ForbiddenException("Caller is not a member of the target project");
    }

    const externalRef = `${projectId}/${applicationId}`;
    const installation = await this.prisma.webMonitorInstallation.findFirst({
      where: { externalRef },
    });
    if (!installation || !installation.appKey) {
      throw new NotFoundException(
        `No web-monitor installation enrolled for project ${projectId} / application ${applicationId}`,
      );
    }
    if (installation.revokedAt != null) {
      throw new ForbiddenException("Web-monitor installation is revoked");
    }

    return installation.appKey;
  }

  /**
   * Assertion helper — if something downstream ever needs to confirm a
   * resolved appKey still matches the partition-key format, call this.
   * The default path does not need it because we derive appKey from the
   * installation registry, which is the same generator that produces it.
   */
  assertAppKeyLike(value: unknown): string {
    if (!isValidAppKey(value)) {
      throw new ForbiddenException("Internal invariant: resolved appKey failed format check");
    }
    return value as string;
  }
}
