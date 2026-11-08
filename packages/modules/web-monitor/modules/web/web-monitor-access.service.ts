import { Inject, Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { PROJECT_VISIBLE_IDS_RESOLVER, ProjectVisibleIdsResolver } from "../../shared/project-visible-ids.port";
import { isValidAppKey } from "../../shared/utils";

/**
 * Resolves an appKey for management-side web-monitor queries and enforces
 * that the caller has membership in the target project.
 *
 * This module intentionally never trusts an appKey carried in a request —
 * the caller supplies projectId + applicationId (both UUIDs from the host
 * URL path) and we derive the appKey from the installation registry, then
 * confirm the current user is a member of the project before returning it.
 */
@Injectable()
export class WebMonitorAccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROJECT_VISIBLE_IDS_RESOLVER)
    private readonly projectVisibility: ProjectVisibleIdsResolver,
  ) {}

  /**
   * Resolve the storage partition key for a management-side query.
   * Throws NotFoundException when the installation is not enrolled for the
   * given projectId/applicationId pair; throws ForbiddenException when the
   * caller has no access to projectId.
   */
  async resolveAppKey(projectId: string, applicationId: string, currentUserId: string): Promise<string> {
    // 1. Membership gate — the host port resolves the caller's projects.
    const projectIds = await this.projectVisibility.visibleProjectIds(currentUserId);
    if (!projectIds.includes(projectId)) {
      throw new ForbiddenException("Caller is not a member of the target project");
    }

    // 2. Installation lookup by the host-mapping tag.
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
