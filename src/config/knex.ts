import knex from 'knex';
import path from 'path';
import * as dotenv from 'dotenv';

// Pastikan .env diload khusus saat file ini di-execute standalone
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const client = process.env.DATABASE_CLIENT || 'sqlite3';

const config: knex.Knex.Config = client === 'sqlite3'
  ? {
      client: 'sqlite3',
      connection: {
        filename: path.resolve(process.cwd(), process.env.DATABASE_URL || './dev.sqlite'),
      },
      useNullAsDefault: true,
      migrations: {
        directory: path.resolve(__dirname, '../db/migrations'),
        extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
      },
      seeds: {
        directory: path.resolve(__dirname, '../db/seeds'),
        extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
      },
    }
  : {
      client: client === 'pg' ? 'postgresql' : 'mysql2',
      connection: process.env.DATABASE_URL,
      migrations: {
        directory: path.resolve(__dirname, '../db/migrations'),
        extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
      },
      seeds: {
        directory: path.resolve(__dirname, '../db/seeds'),
        extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
      },
    };

const db = knex(config);

export default db;
export { config as knexConfig };
