import {Injectable} from '@nestjs/common';
import {InjectConnection} from '@nestjs/mongoose';
import {Connection, Model, Schema as MongooseSchema} from 'mongoose';

/**
 * Business-agnostic lazy Mongoose model registry.
 *
 * The shared connection alone is not enough for features that create models
 * at runtime (for example per-appId / per-tenant collections). Registering
 * the same model name twice on one connection throws OverwriteModelError, so
 * consumers must resolve dynamic models through this registry instead of
 * calling connection.model() directly.
 *
 * Business schemas and collection naming rules stay in the consuming
 * microservice; this service only owns the register-once mechanism.
 */
@Injectable()
export class MongoModelRegistry {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Return the model already registered under `name`, or register it once on
   * the shared default connection.
   *
   * @param name Model name, unique within the connection (Mongoose also uses
   *   it to derive the default collection name).
   * @param schema Schema definition owned by the business module.
   * @param collection Optional explicit collection name, for cases where the
   *   default pluralized model name is not desired.
   */
  getOrCreateModel<T = any>(name: string, schema: MongooseSchema, collection?: string): Model<T> {
    const existing = this.connection.models[name] as Model<T> | undefined;
    if (existing) {
      return existing;
    }
    return this.connection.model<T>(name, schema, collection);
  }
}
