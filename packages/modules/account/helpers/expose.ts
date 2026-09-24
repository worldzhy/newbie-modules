import {Session, User} from '@generated/prisma/client';

/** Delete sensitive keys from an object */
export function expose<T>(item: T): Expose<T> {
  if (!item) return {} as T;

  if ((item as any as Partial<User>).password) (item as any).hasPassword = true;
  delete (item as any as Partial<User>).password;
  delete (item as any as Partial<Session>).refreshToken;

  return item;
}

export type Expose<T> = Omit<Omit<Omit<Omit<Omit<T, 'password'>, 'twoFactorSecret'>, 'token'>, 'emailSafe'>, 'subnet'>;
