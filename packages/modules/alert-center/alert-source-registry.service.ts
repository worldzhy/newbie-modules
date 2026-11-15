import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DEFAULT_REPEAT_MINUTES } from "./alert-center.constants";

/**
 * Shape a consumer passes when registering one alert source at startup. The
 * registry is the single source of truth for a source's display name and its
 * default rhythm; the `AlertSource` table only stores operator overrides.
 */
export interface AlertDefinitionDeclaration {
  /** Stable key of one lifecycle family inside the source, e.g. "risk-spike". */
  key: string;
  /** Human-readable name shown in the source settings surface. */
  displayName: string;
  /**
   * Rhythm this definition pins in code. When set, the source-level override
   * does not govern it, so the settings surface must show it as fixed.
   */
  repeatMinutes?: number;
}

export interface AlertSourceDeclaration {
  /** Stable key, e.g. "url-check" / "heartbeat" / "cloudwatch". */
  key: string;
  /** Human-readable name shown in the source settings surface. */
  displayName: string;
  /** Reminder rhythm in minutes; defaults to DEFAULT_REPEAT_MINUTES. */
  defaultRepeatMinutes?: number;
  /**
   * Lifecycle families this source emits. One source often owns several (one
   * producer declares a family per alert key shape); the settings surface lists
   * them so an operator sees what a source actually raises.
   */
  definitions?: AlertDefinitionDeclaration[];
}

export type RegisteredAlertDefinition = Required<Omit<AlertDefinitionDeclaration, "repeatMinutes">> & {
  repeatMinutes: number | null;
};

export type RegisteredAlertSource = Omit<AlertSourceDeclaration, "definitions"> & {
  defaultRepeatMinutes: number;
  definitions: RegisteredAlertDefinition[];
};

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
    const definitions = (declaration.definitions ?? []).map((definition) => {
      if (
        definition.repeatMinutes !== undefined &&
        (!Number.isInteger(definition.repeatMinutes) || definition.repeatMinutes <= 0)
      ) {
        throw new Error(
          `Invalid repeatMinutes for ${declaration.key}/${definition.key}: ${definition.repeatMinutes}. Must be a positive integer.`,
        );
      }
      return { ...definition, repeatMinutes: definition.repeatMinutes ?? null };
    });
    if (new Set(definitions.map((definition) => definition.key)).size !== definitions.length) {
      throw new Error(`Duplicate alert definition key in source: ${declaration.key}`);
    }
    this.sources.set(declaration.key, {
      key: declaration.key,
      displayName: declaration.displayName,
      defaultRepeatMinutes: repeatMinutes,
      definitions,
    });
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
