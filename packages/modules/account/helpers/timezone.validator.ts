import { registerDecorator, ValidationOptions } from "class-validator";

/**
 * IANA zone names are `Area/Location` identifiers (optionally `Etc/GMT+8`
 * style); offset identifiers such as `+08:00` are not portable across the
 * Intl implementations the frontend renders with, so they are refused here.
 */
const IANA_ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+/-]*$/;

/**
 * A display timezone is only useful if the runtime can format with it.
 * Probe with the same `Intl.DateTimeFormat` call the frontend uses when it
 * reads `NEXT_TIMEZONE` and falls back to UTC (ADR-077), so a value accepted
 * at the write boundary is always one the read path can honour.
 */
export function isIanaTimezone(value: string): boolean {
  if (!IANA_ZONE_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * DTO-level IANA timezone validation for account write paths. Absence is
 * valid (the field is optional); presence must name a zone the runtime knows.
 */
export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isIanaTimezone",
      target: object.constructor,
      propertyName,
      options: {
        message: "timezone must be an IANA time zone name, e.g. Asia/Shanghai",
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          return typeof value === "string" && isIanaTimezone(value);
        },
      },
    });
  };
}
