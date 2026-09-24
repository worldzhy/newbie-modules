import {DynamicModule, Global, Module} from '@nestjs/common';
import {ConfigModule, ConfigService} from '@nestjs/config';
import {CacheModule} from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';
import Keyv from 'keyv';
import {CacheableMemory} from 'cacheable';
import MicroservicesConfiguration from '../microservices.config';

@Global()
@Module({
  imports: getModules(),
})
export class NewbieCacheModule {}

function getModules(): (DynamicModule | Promise<DynamicModule>)[] {
  const modules: (DynamicModule | Promise<DynamicModule>)[] = [ConfigModule.forRoot({load: [MicroservicesConfiguration], isGlobal: true})];

  if (process.env.REDIS_HOST) {
    modules.push(
      CacheModule.registerAsync({
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => {
          const ttl = configService.get('microservices.cache.redis.ttl');
          const host = configService.get('microservices.cache.redis.host');
          const port = configService.get('microservices.cache.redis.port');
          const user = configService.get('microservices.cache.redis.user');
          const password = configService.get('microservices.cache.redis.password');

          const uri =
            user && password
              ? 'redis://' + user + ':' + password + '@' + host + ':' + port
              : 'redis://' + host + ':' + port;

          return {stores: [new KeyvRedis(uri, {throwOnConnectError: true})]};
        },
        inject: [ConfigService],
        isGlobal: true,
      })
    );
  } else {
    modules.push(
      CacheModule.registerAsync({
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => {
          const ttl = configService.get('microservices.cache.memory.ttl'); // milliseconds
          const lruSize = configService.get('microservices.cache.memory.lruSize');

          return {stores: [new Keyv({store: new CacheableMemory({ttl, lruSize})})]};
        },
        inject: [ConfigService],
        isGlobal: true,
      })
    );
  }

  return modules;
}
