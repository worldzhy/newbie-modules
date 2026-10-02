import { registerDecorator, ValidationOptions } from "class-validator";
import { verifyPassword } from "./validator";

/**
 * Shared message so every password field fails with identical, actionable
 * feedback. Keep in sync with the frontend checklist rules.
 */
export const PASSWORD_RULE_MESSAGE =
  "Password must be at least 8 characters and include at least one lowercase letter, one uppercase letter, one number, and one symbol.";

/**
 * DTO-level password complexity validation. Rules mirror
 * `verifyPassword` (validator.isStrongPassword defaults): minLength 8,
 * minLowercase 1, minUppercase 1, minNumbers 1, minSymbols 1. The Prisma
 * user extension remains the last line of defense for non-DTO write paths.
 */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isStrongPassword",
      target: object.constructor,
      propertyName,
      options: { message: PASSWORD_RULE_MESSAGE, ...validationOptions },
      validator: {
        validate(value: unknown) {
          // Optional fields: absence is valid; presence must be strong.
          if (value === undefined || value === null) return true;
          return typeof value === "string" && verifyPassword(value);
        },
      },
    });
  };
}
