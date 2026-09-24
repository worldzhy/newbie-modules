import postgres from 'postgres';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean | object;
}

export class Database {
  public sql: postgres.Sql;

  constructor(
    config: DatabaseConfig = {
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT!),
      user: process.env.DB_USER!,
      password: process.env.DB_PWD!,
      database: process.env.DB_NAME!,
      ssl: process.env.DB_SSL === 'true' ? {rejectUnauthorized: false} : false,
    }
  ) {
    this.sql = postgres({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  async close() {
    await this.sql.end();
  }

  async query(strings: TemplateStringsArray, ...values: any[]) {
    return await this.sql(strings, ...values);
  }
}
