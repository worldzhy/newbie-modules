import { ProfileEntity } from "./llm/match-re-ranker";

/**
 * A project's security profile: the set of entities used for threat
 * intel matching. The host implements this port; this module never
 * references the host's Project entity directly.
 */
export interface ProjectSecurityProfile {
  projectId: string;
  /** Optional application-level granularity when the profile maps to one app. */
  applicationId?: string;
  entities: ProfileEntity[];
}

/**
 * Port implemented by the host to supply all project security profiles.
 * The host builds profiles from its project/application/dependency
 * models (see ADR-031 §4). An empty `entities` array means the project
 * has no usable profile; matches against it receive low confidence and
 * never trigger notifications.
 */
export interface ProjectSecurityProfilePort {
  listProfiles(): Promise<ProjectSecurityProfile[]>;
}

export const PROJECT_SECURITY_PROFILE_PORT = Symbol("ProjectSecurityProfilePort");
