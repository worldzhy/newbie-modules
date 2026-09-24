import {Injectable, OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit {
  private client!: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const raw = this.configService.get('microservices.frontend-monitor.redis');
    const cfg = (() => {
      if (typeof raw === 'string') {
        const [host, port, password, db] = raw.split(':');
        return {
          host: host || '127.0.0.1',
          port: port ? Number(port) : 6379,
          password: password || '',
          db: db ? Number(db) : 1,
        };
      }
      return raw || {host: '127.0.0.1', port: 6379, password: '', db: 1};
    })();
    this.client = new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      db: cfg.db,
    });
    this.client.connect().catch(err => {
      console.error('Redis connect error:', err?.message || err);
    });
  }

  getClient() {
    return this.client;
  }

  async set(...args: any[]) {
    return (this.client as any).set(...args);
  }
  async get(key: string) {
    return this.client.get(key);
  }
  async del(key: string | string[]) {
    return this.client.del(key as any);
  }
  async llen(key: string) {
    return this.client.llen(key);
  }
  async lpush(key: string, value: string) {
    return this.client.lpush(key, value);
  }
  async incr(key: string) {
    return this.client.incr(key);
  }
  async rpop(key: string) {
    return this.client.rpop(key);
  }
}
