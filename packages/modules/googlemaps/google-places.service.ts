import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {google} from '@googlemaps/places/build/protos/protos';
import {PlacesClient} from '@googlemaps/places';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';

/**
 * API introduction
 * https://developers.google.com/maps/documentation/places/web-service/op-overview
 *
 */

@Injectable()
export class GooglePlacesService {
  private client: PlacesClient;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    this.client = new PlacesClient({
      apiKey: this.config.getOrThrow<string>(
        'modules.googlemaps.credentials.apiKey'
      ),
    });
  }

  async searchText(text: string) {
    return await this.client.searchText({
      textQuery: text,
    });
  }

  /*
   * Autocomplete Places
   * - https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
   *
   * Note: Autocomplete (New) returns five total predictions, either as placePredictions, queryPredictions,
   * or a combination, depending on the request. If the request does not set includeQueryPredictions,
   * the response includes up to five placePredictions. If the request sets includeQueryPredictions,
   * the response includes up to five predictions in a combination of placePredictions and queryPredictions.
   */
  async getPlaceIdsByText(input: string) {
    // Check if the input is already cached
    const records = await this.prisma.googlePlacePrediction.findMany({
      where: {input},
    });
    if (records.length > 0) {
      return records.map(record => record.placeId);
    }

    // If not cached, perform the autocomplete search
    const result = await this.client.autocompletePlaces({input: input});
    const suggestions = result[0].suggestions;
    if (
      suggestions === undefined ||
      suggestions === null ||
      suggestions.length === 0
    ) {
      return [];
    }

    // Extract place IDs from the suggestions
    const placeIds: string[] = [];
    const places: {
      input: string;
      placeId: string;
      text?: object;
      structuredFormat?: object;
      types?: string[];
      distanceMeters?: number;
    }[] = [];

    for (let i = 0; i < suggestions.length; i++) {
      const suggestion = suggestions[i];
      if (suggestion.placePrediction) {
        const placeId = suggestion.placePrediction.placeId;
        if (placeId) {
          placeIds.push(placeId);
          places.push({
            input,
            placeId,
            text: suggestion.placePrediction.text ?? undefined,
            structuredFormat:
              suggestion.placePrediction.structuredFormat ?? undefined,
            types: suggestion.placePrediction.types ?? undefined,
            distanceMeters:
              suggestion.placePrediction.distanceMeters ?? undefined,
          });
        }
      }
    }

    // Store the results in the database
    if (places.length > 0) {
      await this.prisma.googlePlacePrediction.createMany({
        data: places,
        skipDuplicates: true,
      });
    }

    // Return the list of place IDs
    return placeIds;
  }

  async getPlaceDetail(placeId: string) {
    // Check if the place detail is already cached
    const record = await this.prisma.googlePlaceDetail.findUnique({
      where: {placeId},
    });
    if (record) {
      return record.place as google.maps.places.v1.IPlace;
    }

    // If not cached, fetch the place detail from Google Places API
    const result = await this.client.getPlace(
      {name: `places/${placeId}`},
      {
        otherArgs: {
          headers: {
            'X-Goog-FieldMask': [
              'places.addressComponents',
              'places.adrFormatAddress',
              'places.businessStatus',
              'places.formattedAddress',
              'places.id',
              'places.name',
              'places.plusCode',
              'places.types',
              'places.utcOffsetMinutes',
              'places.websiteUri',
            ],
          },
        },
      }
    );

    // Store the result in the database
    if (result[0].id) {
      await this.prisma.googlePlaceDetail.create({
        data: {
          placeId,
          place: result[0] as object,
        },
      });
      return result[0];
    } else {
      return null;
    }
  }

  /* End */
}
