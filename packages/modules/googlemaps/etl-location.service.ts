import {Injectable} from '@nestjs/common';
import {isEmpty} from 'lodash';
import {GooglePlacesService} from './google-places.service';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {normalize} from './states-normalize';
import {google} from '@googlemaps/places/build/protos/protos';
import {GoogleAddressTypeAliases, CA_States, US_States} from './google-places.constants';

enum ELocationType {
  Establishment = 'establishment',
  Mailing = 'mailing',
  Business = 'business',
  Personal = 'personal',
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private googlePlacesService: GooglePlacesService
  ) {}

  async locationSearchForETL(params: {
    type: ELocationType;
    originText: string | null;
    state: string;
    zip?: string | null;
    zip4?: string | null;
    city?: string | null;
    country?: string | null;
    streetAddress1?: string | null;
    streetAddress2?: string | null;
    county?: string | null;
    locationEState?: string | null;
    skip?: boolean | null;
  }) {
    const {originText, state, type, skip} = params;
    const defaultLocation = {
      ...params,
      placeId: null,
      exJSON: {
        originText,
        isValidGoogleAddr: false,
        googleMapResult: this.IdeDefaultFormattedAddress(params),
      },
    };
    if (skip) return defaultLocation;
    const placeId = await this.getPlaceIdFromText(originText, state, type);
    if (!placeId) return defaultLocation;
    const place = await this.googlePlacesService.getPlaceDetail(placeId);
    if (!place) return defaultLocation;
    if (!place.addressComponents || place.addressComponents.length === 0) return defaultLocation;
    const mappingResult = this.getPlaceDetailObj(place.addressComponents);
    const {
      country,
      zip,
      // state,
      city,
      zip4,
      county,
      streetAddress1,
      streetAddress2,
    } = mappingResult;
    const streetAddressAuto = {
      mapped: streetAddress2,
      manual: '',
      used: streetAddress2,
    };
    return {
      type,
      city,
      county,
      zip,
      zip4,
      state: type === 'establishment' ? state : mappingResult.state,
      country,
      streetAddress1,
      streetAddress2: streetAddressAuto.used,
      placeId,
      exJSON: {
        isValidGoogleAddr: true,
        googleMapResult: place,
        originText,
        mappingResult,
        streetAddressAuto,
      },
    };
  }

  private async getPlaceIdFromText(addrText: string | null, state: string, type: ELocationType): Promise<string> {
    // only state filter
    if (!addrText || state?.toLowerCase() === addrText.toLowerCase()) return '';
    // pobox filter
    const POBOX_REGX = /^(P\s*O\s*BOX|PO\s*BOX|POBOX|P\.O\.\s*BOX|P\/O\s*BOX)/i;
    if (POBOX_REGX.test(addrText)) return '';
    const predictions = await this.prisma.googlePlacePrediction.findMany({
      where: {input: addrText},
    });

    if (isEmpty(predictions)) return '';
    // const similarityCompare = (a, b) => (JaroWinklerDistance(addrText, b['description'] || '', { ignoreCase: true }) - JaroWinklerDistance(addrText, a['description'] || '', { ignoreCase: true }));

    const rWithState =
      type !== 'establishment'
        ? predictions[0]
        : predictions.find((v: any) => {
            const terms = (v.structuredFormat as any)?.mainText || v.text;
            if (!terms) return false;
            const termsArray = Array.isArray(terms) ? terms : [terms];
            for (let i = 0; i < termsArray.length; i++) {
              const term = termsArray[i];
              let tValue = typeof term === 'string' ? term : term?.value;
              tValue = tValue?.toLowerCase();
              try {
                tValue = normalize(tValue)?.toLowerCase();
              } catch (error) {}
              const sValue = state?.toLowerCase();
              let $state = state;
              try {
                $state = normalize(state) || state;
              } catch (error) {
                $state = state;
              }
              const nsValue = $state?.toLowerCase();
              if (tValue === sValue || tValue === nsValue) {
                return true;
              }
            }
          });
    if (!rWithState) return '';
    return (rWithState as any).placeId;
  }

  private getPlaceDetailObj(addressComponents: google.maps.places.v1.Place.IAddressComponent[]) {
    const addressObj = {
      route: '',
      country: '',
      state: '',
      county: '',
      city: '',
      streetAddress1: '',
      streetAddress2: '',
      streetNumber: '',
      zip: '',
      zip4: '',
    };

    addressComponents.forEach(component => {
      GoogleAddressTypeAliases.some(typeAlias => {
        if (component.types?.includes(typeAlias.type)) {
          if (typeAlias.alias === 'zip' && component.shortText) {
            component.shortText = component.shortText.padStart(5, '0');
          }
          if (['city', 'route'].includes(typeAlias.alias)) {
            addressObj[typeAlias.alias] = component.longText;
          } else {
            addressObj[typeAlias.alias] = component.shortText;
          }
          return true;
        }
        return false;
      });
    });
    if (!addressObj.city) {
      const targetComponent = addressComponents.find((addressObj: any) => addressObj.types.includes('sublocality'));
      if (typeof targetComponent?.longText === 'string') {
        addressObj.city = targetComponent?.longText;
      }
    }
    addressObj.streetAddress1 = `${addressObj.streetNumber ? `${addressObj.streetNumber} ` : ''}${addressObj.route}`;
    addressObj.streetAddress1 = addressObj.streetAddress1 ? addressObj.streetAddress1.trim() : '';
    if (addressObj.country === 'PR') {
      addressObj.state = 'PR';
      addressObj.country = 'US';
    }
    // addressObj.streetAddress1 = `${addressObj.street_number ? `${addressObj.street_number} ` : ''}${addressObj.route}${addressObj.city ? `, ${addressObj.city}` : ''}`;
    // addressObj.streetAddress1 = addressObj.streetAddress1 ? addressObj.streetAddress1.trim()?.replace(/^,|,$/g, '')?.trim() : '';
    return addressObj;
  }

  private IdeDefaultFormattedAddress(location) {
    if (location?.skip && location?.city) {
      return {
        formatted_address: `${location.city}, ${location.state} ${this.getLocationCountryBySate(location.state)}`,
      };
    }
    return {
      formatted_address: `${location.state} ${this.getLocationCountryBySate(location.state)}`,
    };
  }

  private getLocationCountryBySate(state: string) {
    let country = '';
    if (US_States.includes(state)) {
      country = 'US';
    } else if (CA_States.includes(state)) {
      country = 'CA';
    }
    return country;
  }
}
