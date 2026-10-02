import {Injectable, OnModuleDestroy} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import geolite2, {GeoIpDbName} from 'geolite2-redist';
import maxmind, {CityResponse, Reader} from 'maxmind';
import {LRUCache} from 'lru-cache';

@Injectable()
export class GeolocationService implements OnModuleDestroy {
  private reader: Reader<CityResponse> | null;
  private lru: LRUCache<string, Partial<CityResponse>>;

  constructor(private config: ConfigService) {
    // The configured size is the maximum number of cached entries.
    this.lru = new LRUCache({
      max: this.config.getOrThrow<number>('modules.account.cache.geolocationLruSize'),
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
        this.reader = await geolite2.open(GeoIpDbName.City, path => maxmind.open<CityResponse>(path));
      }
      return this.reader.get(ipAddress) ?? {};
    } catch (error) {
      console.error(error);
      return {};
    }
  }
}
