/** Delete sensitive keys from an object */
export function expose<T>(item: T): Expose<T> {
  if (!item) return {} as T;

  const record = item as unknown as Record<string, unknown>;
  if (record.password) record.hasPassword = true;
  delete record.password;
  delete record.refreshToken;
  // API key secrets are stored hashed and must never be serialized to clients.
  delete record.secret;

  return item;
}

export type Expose<T> = Omit<
  Omit<Omit<Omit<Omit<Omit<T, "password">, "twoFactorSecret">, "token">, "emailSafe">, "subnet">,
  "secret"
>;
