import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { assertAppKey } from "../../shared/utils";

/**
 * Controller-side gate for management queries.
 *
 * The module never trusts an appKey blindly: controllers resolve the caller's
 * visible appKeys through the host port, then pass both the resolved scope and
 * the requested key here. This service only compares them — it never sees a
 * user id, a role, or a project id, and it performs no lookup of its own, so a
 * miss cannot be told apart from a key that does not exist.
 */
@Injectable()
export class FrontendMonitorAccessService {
  /**
   * Validate the requested appKey and assert it is inside the resolved scope.
   * Malformed input is a 400 (a shape error, not an existence signal); anything
   * outside the scope — including an empty scope or a revoked installation,
   * which never enters the scope — is a uniform 403.
   */
  assertVisibleAppKey(visibleAppKeys: string[], requested: unknown): string {
    if (typeof requested !== "string" || !requested) {
      throw new BadRequestException("appKey is required");
    }
    const appKey = assertAppKey(requested);
    if (!visibleAppKeys.includes(appKey)) {
      throw new ForbiddenException("appKey is outside the caller's visible scope");
    }
    return appKey;
  }
}
