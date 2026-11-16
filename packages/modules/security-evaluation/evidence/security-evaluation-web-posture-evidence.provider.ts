import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import type {
  EvaluationCoverageBucket,
  EvaluationEvidenceItem,
  EvaluationRuleSetVersionRef,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationWebOriginService } from "../assets/security-evaluation-web-origin.service";
import { SECURITY_EVALUATION_WEB_POSTURE_MAX_HTTP_REQUESTS } from "../security-evaluation.constants";
import {
  SECURITY_EVALUATION_WEB_PROBE_ACCESS,
  type WebHttpObserveRequest,
  type WebProbeAccess,
} from "../ports/web-probe.access";

const HTML_ROLE = "html";
const API_SESSION_ROLE = "api.session";

/**
 * SecurityEvaluationWebPostureEvidenceProvider — evidence collection for
 * subject kind "web-origin" (ADR-066 §3).
 *
 * The host port is the collector's downstream dependency, never a direct run
 * input: this provider resolves the asset's configured path roles and observes
 * the origin through `WebProbeAccess`. An unbound port fails the run with a
 * wiring error — reporting an empty collection as success would claim the
 * origin is clean on evidence nobody collected.
 *
 * The budget is one HTML request, at most one API session request, and one TLS
 * handshake. A missing `api.session` role is not a failure: the criteria that
 * depend on it are skipped and the skip is reported, never silently dropped.
 */
@Injectable()
export class SecurityEvaluationWebPostureEvidenceProvider implements EvidenceProvider {
  constructor(
    private readonly webOrigins: SecurityEvaluationWebOriginService,
    @Optional()
    @Inject(SECURITY_EVALUATION_WEB_PROBE_ACCESS)
    private readonly probe?: WebProbeAccess | null,
  ) {}

  async collect(
    subject: EvaluationSubjectRef,
    _ruleSetVersion: EvaluationRuleSetVersionRef,
  ): Promise<EvidenceCollection> {
    const probe = this.probe;
    if (!probe) {
      throw new Error("SECURITY_EVALUATION_WEB_PROBE_ACCESS is not bound; web-posture requires the host adapter.");
    }

    const origin = subject.subjectKey;
    requireHttpsOrigin(origin);

    const targetPaths = await this.webOrigins.pathRoles(subject.id);
    const requests: WebHttpObserveRequest[] = [{ origin, role: HTML_ROLE, path: "/" }];
    const apiSessionPath = targetPaths[API_SESSION_ROLE];
    if (apiSessionPath) {
      requests.push({ origin, role: API_SESSION_ROLE, path: apiSessionPath });
    }

    const observedAt = new Date();
    const items: EvaluationEvidenceItem[] = [];
    for (const request of requests.slice(0, SECURITY_EVALUATION_WEB_POSTURE_MAX_HTTP_REQUESTS)) {
      const observation = await probe.observeHttp(request);
      items.push({
        id: `http:${request.role}`,
        layer: "web",
        source: "web-origin",
        summary: `${request.role} ${observation.status} ${observation.finalUrl}`,
        observedAt,
        payload: { origin, observation },
      });
    }

    const tls = await probe.observeTls(origin);
    items.push({
      id: "tls:origin",
      layer: "web",
      source: "web-origin",
      summary: `TLS handshake ${origin}`,
      observedAt,
      payload: { origin, observation: tls },
    });

    return {
      items,
      declaredUnlinked: { total: 0 },
      skipped: this.computeSkipped(Boolean(apiSessionPath)),
    };
  }

  /**
   * The API header criteria need the `api.session` role; without it they were
   * not judged, and the bucket says so instead of counting them as clean.
   */
  private computeSkipped(hasApiSession: boolean): EvaluationCoverageBucket {
    if (hasApiSession) return { total: 0 };
    return {
      total: 1,
      bySource: { "web-origin": 1 },
      note: "api.session path role is not configured; API header criteria were skipped.",
      items: ["http:api.session"],
    };
  }
}

/** Only https origins are probed: header and TLS posture over plaintext does not exist. */
function requireHttpsOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new BadRequestException(`Web origin '${origin}' is not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    throw new BadRequestException(`Web origin '${origin}' must use https; web-posture does not probe plaintext.`);
  }
}
