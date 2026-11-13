import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DEFAULT_REPEAT_MINUTES } from "./alert-center.constants";

/**
 * Shape a consumer passes when registering one alert source at startup. The
 * registry is the single source of truth for a source's display name and its
 * default rhythm; the `AlertSource` table only stores operator overrides.
 */
export interface AlertSourceDeclaration {
  /** Stable key, e.g. "url-check" / "heartbeat" / "cloudwatch". */
  key: string;
  /** Human-readable name shown in the source settings surface. */
  displayName: string;
  /** Reminder rhythm in minutes; defaults to DEFAULT_REPEAT_MINUTES. */
  defaultRepeatMinutes?: number;
}

export type RegisteredAlertSource = AlertSourceDeclaration & { defaultRepeatMinutes: number };

/**
 * In-process registry of alert sources (ADR-065 §2). Sources are code, not
 * data: `raise()` and `resolve()` reject an unregistered key, so a typo or a
 * forgotten registration surfaces at the call site instead of growing a ghost
 * source in the database.
 */
@Injectable()
export class AlertSourceRegistryService {
  private readonly logger = new Logger(AlertSourceRegistryService.name);
  private readonly sources = new Map<string, RegisteredAlertSource>();

  register(declaration: AlertSourceDeclaration): void {
    if (this.sources.has(declaration.key)) {
      throw new Error(`Alert source is already registered: ${declaration.key}`);
    }
    const repeatMinutes = declaration.defaultRepeatMinutes ?? DEFAULT_REPEAT_MINUTES;
    if (!Number.isInteger(repeatMinutes) || repeatMinutes <= 0) {
      throw new Error(
        `Invalid defaultRepeatMinutes for ${declaration.key}: ${repeatMinutes}. Must be a positive integer.`,
      );
    }
    this.sources.set(declaration.key, { ...declaration, defaultRepeatMinutes: repeatMinutes });
    this.logger.log(`Alert source registered: ${declaration.key}`);
  }

  /** The declaration of one source, or a 400 when the caller used an unknown key. */
  require(key: string): RegisteredAlertSource {
    const declaration = this.sources.get(key);
    if (!declaration) {
      throw new BadRequestException(`Alert source is not registered: ${key}`);
    }
    return declaration;
  }

  getAll(): RegisteredAlertSource[] {
    return [...this.sources.values()];
  }
}
