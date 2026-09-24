import {Injectable, OnModuleDestroy} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import * as geolite2 from 'geolite2-redist';
import maxmind, {CityResponse, Reader} from 'maxmind';
import {LRUCache} from 'lru-cache';

@Injectable()
export class GeolocationService implements OnModuleDestroy {
  private reader: Reader<CityResponse> | null = null;
  private lru: LRUCache<string, Partial<CityResponse>>;

  constructor(private configService: ConfigService) {
    this.lru = new LRUCache({
      maxSize: this.configService.getOrThrow<number>(
        'microservices.saas.cache.geolocationLruSize'
      ),
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

  private async getSafeLocation(
    ipAddress: string
  ): Promise<Partial<CityResponse>> {
    try {
      return this.getUnsafeLocation(ipAddress);
    } catch (error) {
      return {};
    }
  }

  private async getUnsafeLocation(
    ipAddress: string
  ): Promise<Partial<CityResponse>> {
    if (!this.reader)
      this.reader = await geolite2.open<CityResponse>('GeoLite2-City', path =>
        maxmind.open<CityResponse>(path)
      );
    return this.reader.get(ipAddress) ?? {};
  }
}
