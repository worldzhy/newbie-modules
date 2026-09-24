import {Global, Module} from '@nestjs/common';
import {MongooseModule} from '@nestjs/mongoose';
import {ConfigModule, ConfigService} from '@nestjs/config';
import {MongoModelRegistry} from './mongo-model.registry';

/**
 * Shared MongoDB infrastructure module.
 *
 * Owns the single Mongoose connection for the whole application so that any
 * microservice can consume MongoDB without creating its own connection.
 * Business modules keep their own schemas and collection naming rules, and
 * consume the connection either via MongooseModule.forFeature / @InjectModel
 * or through the exported MongoModelRegistry for runtime (dynamic collection)
 * models.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const uri = config.get<string>('microservices.mongo.uri');
        if (!uri) {
          // Fail fast instead of falling back to an implicit database: the
          // connection is shared by multiple business microservices, so a
          // guessed default URI would make every model land in the wrong db.
          throw new Error(
            'MONGO_URL is not configured. Set it to the MongoDB connection URI, e.g. mongodb://127.0.0.1:27017/<database>'
          );
        }
        return {uri};
      },
      inject: [ConfigService],
    }),
  ],
  // Business-agnostic dynamic model factory, available to every consumer
  // without importing extra modules.
  providers: [MongoModelRegistry],
  exports: [MongoModelRegistry],
})
export class MongoModule {}
