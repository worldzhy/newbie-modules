import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { existsSync } from "node:fs";
import path from "node:path";
import maxmind, { CityResponse, Reader } from "maxmind";
import { LRUCache } from "lru-cache";

/// Maximum number of cached IP geolocation entries (ADR-033: a tuning knob
/// nobody tuned stays code, not environment surface).
const GEOLOCATION_LRU_SIZE = 100;

/// City database baked into the production image by the `geoip` build stage
/// (deploy/geoip), filtered to CN/US. It is read as a plain file: no
/// download, no auto-updater and nothing written under node_modules at
/// runtime. Local runs simply have no database and geolocation stays empty.
const GEOLOCATION_DATABASE_PATH = path.join(process.cwd(), "geoip", "dbip-city-lite-cn-us.mmdb");

@Injectable()
export class GeolocationService implements OnModuleDestroy {
  private readonly logger = new Logger(GeolocationService.name);
  private reader: Reader<CityResponse> | null = null;
  private openAttempted = false;
  private lru: LRUCache<string, Partial<CityResponse>>;

  constructor() {
    this.lru = new LRUCache({ max: GEOLOCATION_LRU_SIZE });
  }

  onModuleDestroy() {
    this.reader = null;
  }

  /** Get the geolocation from an IP address */
  async getLocation(ipAddress: string): Promise<Partial<CityResponse>> {
    if (this.lru.has(ipAddress)) return this.lru.get(ipAddress) ?? {};
    const result = await this.getSafeLocation(ipAddress);
    this.lru.set(ipAddress, result);
    return result;
  }

  private async getSafeLocation(ipAddress: string): Promise<Partial<CityResponse>> {
    try {
      const reader = await this.getReader();
      return reader?.get(ipAddress) ?? {};
    } catch (error) {
      this.logger.error(`Failed to resolve geolocation: ${String(error)}`);
      return {};
    }
  }

  /**
   * Open the bundled database once. A missing or unreadable file is logged a
   * single time and remembered: geolocation is an audit nicety, it must never
   * add latency or log noise to the request that triggered it.
   */
  private async getReader(): Promise<Reader<CityResponse> | null> {
    if (this.reader) return this.reader;
    if (this.openAttempted) return null;
    this.openAttempted = true;

    if (!existsSync(GEOLOCATION_DATABASE_PATH)) {
      this.logger.warn(`GeoIP database not found at ${GEOLOCATION_DATABASE_PATH}; geolocation is disabled`);
      return null;
    }

    try {
      this.reader = await maxmind.open<CityResponse>(GEOLOCATION_DATABASE_PATH);
      return this.reader;
    } catch (error) {
      this.logger.error(`Failed to open GeoIP database at ${GEOLOCATION_DATABASE_PATH}: ${String(error)}`);
      return null;
    }
  }
}
