export enum GuardType {
  JWT = "jwt",
  PASSWORD = "local.password",
  VERIFICATION_CODE = "local.verification-code",
  NONE = "custom.no-auth",
  API_KEY = "custom.api-key",
  REFRESH_TOKEN = "custom.refresh-token",
  GOOGLE = "google",
}
