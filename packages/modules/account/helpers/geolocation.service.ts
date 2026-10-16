import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync } from "node:fs";
import path from "node:path";
import geolite2, { GeoIpDbName } from "geolite2-redist";
import maxmind, { CityResponse, Reader } from "maxmind";
import { LRUCache } from "lru-cache";

@Injectable()
export class GeolocationService implements OnModuleDestroy {
  private reader: Reader<CityResponse> | null;
  private openFailed = false;
  private lru: LRUCache<string, Partial<CityResponse>>;
  private readonly logger = new Logger(GeolocationService.name);

  constructor(private config: ConfigService) {
    // The configured size is the maximum number of cached entries.
    this.lru = new LRUCache({
      max: this.config.getOrThrow<number>("modules.account.cache.geolocationLruSize"),
    });
  }

  onModuleDestroy() {
    if (this.reader) this.reader = null;
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
      if (!this.reader) {
        this.reader = await this.openReader();
      }
      return this.reader?.get(ipAddress) ?? {};
    } catch (error) {
      this.logger.error("getSafeLocation failed", error instanceof Error ? error.message : String(error));
      return {};
    }
  }

  /**
   * Open the GeoLite city database. Prefer the locally cached copy opened
   * directly with maxmind: geolite2.open() spawns a background auto-updater
   * whose network failures surface as unhandled rejections and can kill the
   * whole process (the update endpoint is unreachable in this deployment).
   * Fall back to the managed open only when no cached copy exists yet.
   */
  private async openReader(): Promise<Reader<CityResponse> | null> {
    if (this.openFailed) return null;

    const cachedDatabasePath = this.getCachedDatabasePath();
    if (cachedDatabasePath && existsSync(cachedDatabasePath)) {
      return await maxmind.open<CityResponse>(cachedDatabasePath);
    }

    // geolite2.open() downloads the database and spawns a background
    // auto-updater before resolving. On hosts where the package directory is
    // not writable or the download endpoint is slow, that stalls every
    // request that resolves geolocation (login included) for minutes. Bound
    // the attempt; the losing promise carries a catch so the eventual
    // rejection stays handled, and stop retrying after the first failure.
    const openPromise = geolite2
      .open(GeoIpDbName.City, (databasePath) => maxmind.open<CityResponse>(databasePath))
      .catch((error) => {
        this.logger.error(`GeoLite database is unavailable: ${String(error)}`);
        return null;
      });
    const raced = await Promise.race([
      openPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (!raced) {
      this.openFailed = true;
      return null;
    }
    return raced;
  }

  private getCachedDatabasePath(): string | null {
    try {
      // The package's exports map blocks direct access to package.json, so
      // resolve the entry point (<root>/dist/index.js) and walk to the dbs
      // directory from there.
      const entryPath = require.resolve("geolite2-redist");
      return path.join(path.dirname(entryPath), "..", "dbs", "GeoLite2-City.mmdb");
    } catch {
      return null;
    }
  }
}
