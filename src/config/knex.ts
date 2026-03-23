import knex from 'knex';
import path from 'path';

const client = process.env.DATABASE_CLIENT || 'sqlite3';

const config: knex.Knex.Config = client === 'sqlite3'
  ? {
      client: 'better-sqlite3',
      connection: {
        filename: path.resolve(process.cwd(), process.env.DATABASE_URL || './dev.db'),
      },
      useNullAsDefault: true,
      migrations: {
        directory: path.resolve(__dirname, '../db/migrations'),
        extension: 'ts',
      },
      seeds: {
        directory: path.resolve(__dirname, '../db/seeds'),
        extension: 'ts',
      },
    }
  : {
      client: client === 'pg' ? 'postgresql' : 'mysql2',
      connection: process.env.DATABASE_URL,
      migrations: {
        directory: path.resolve(__dirname, '../db/migrations'),
      },
      seeds: {
        directory: path.resolve(__dirname, '../db/seeds'),
      },
    };

const db = knex(config);

export default db;
export { config as knexConfig };
