/** Delete sensitive keys from an object */
export function expose<T>(item: T): Expose<T> {
  if (!item) return {} as T;

  const record = item as unknown as Record<string, unknown>;
  if (record.password) record.hasPassword = true;
  delete record.password;
  // Session rows carry live credentials: the access token, the current and
  // previous refresh-token hashes, and the plaintext of the freshest refresh
  // token held for the idempotency window. None may be serialized to clients.
  delete record.accessToken;
  delete record.refreshToken;
  delete record.refreshTokenHash;
  delete record.previousRefreshTokenHash;
  delete record.refreshTokenNext;
  // API key secrets are stored hashed and must never be serialized to clients.
  delete record.secret;
  // User secret columns: the active and pending TOTP secrets plus the WeChat
  // session key. Auth flows read them internally before expose() is called.
  delete record.twoFactorSecret;
  delete record.pendingTwoFactorSecret;
  delete record.wechatSessionKey;

  return item;
}

export type Expose<T> = Omit<
  T,
  | "password"
  | "twoFactorSecret"
  | "pendingTwoFactorSecret"
  | "wechatSessionKey"
  | "token"
  | "emailSafe"
  | "subnet"
  | "secret"
  | "accessToken"
  | "refreshToken"
  | "refreshTokenHash"
  | "previousRefreshTokenHash"
  | "refreshTokenNext"
>;
