import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";

@Injectable()
export class GoogleTimezoneService {
  private readonly logger = new Logger(GoogleTimezoneService.name);
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Get time zone by address.
   * @param text Example: 'New York, NY', 'Atlanta, GA'
   * @returns
   */
  async search(address: string): Promise<string> {
    try {
      const placeResponse = await this.httpService.axiosRef.get(
        `https://maps.googleapis.com/maps/api/place/textsearch/json`,
        {
          params: {
            query: address,
            key: this.configService.getOrThrow<string>("modules.googleapis.credentials.apiKey"),
          },
        },
      );

      if (placeResponse.data.results && placeResponse.data.results.length > 0) {
        const place = placeResponse.data.results[0];

        const latLng = place.geometry.location.lat + "," + place.geometry.location.lng;
        const timezoneResponse = await this.httpService.axiosRef.get(
          `https://maps.googleapis.com/maps/api/timezone/json`,
          {
            params: {
              location: latLng,
              timestamp: 0,
              key: this.configService.getOrThrow<string>("modules.googleapis.credentials.apiKey"),
            },
          },
        );

        return timezoneResponse.data.timeZoneId as string;
      }
    } catch (error) {
      this.logger.error("timezone search failed", error instanceof Error ? error.message : String(error));
    }

    return "";
  }

  /* End */
}
