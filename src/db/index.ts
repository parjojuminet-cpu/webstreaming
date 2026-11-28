import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

const TRANSIENT_SQL_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (Cloud SQL waking up from scale-to-zero)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

const NON_RETRYABLE_SQL_CODES = new Set([
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '42P01', // undefined_table
  '42703', // undefined_column
  '42601', // syntax_error
  '42501', // insufficient_privilege
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23502', // not_null_violation
  '22P02', // invalid_text_representation
]);

export function isTransientSqlConnectionError(err: unknown): boolean {
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor; depth += 1) {
    if (typeof cursor === 'object' && cursor !== null) {
      const rec = cursor as {
        code?: unknown;
        errno?: unknown;
        message?: unknown;
        cause?: unknown;
      };
      const code = typeof rec.code === 'string' ? rec.code : '';
      if (NON_RETRYABLE_SQL_CODES.has(code)) {
        return false;
      }
      if (TRANSIENT_SQL_CODES.has(code)) {
        return true;
      }
      const msg = typeof rec.message === 'string' ? rec.message.toLowerCase() : '';
      if (
        msg.includes('connection terminated unexpectedly') ||
        msg.includes('connection terminated') ||
        msg.includes('client has encountered a connection error') ||
        msg.includes('timeout exceeded when trying to connect') ||
        msg.includes('terminating connection due to administrator command') ||
        msg.includes('the database system is starting up') ||
        msg.includes('socket hang up') ||
        msg.includes('econnreset')
      ) {
        return true;
      }
      cursor = rec.cause;
    } else {
      break;
    }
  }
  return false;
}

export async function withSqlRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientSqlConnectionError(error)) {
        throw error;
      }
      const jitterMs = Math.floor(Math.random() * 250);
      const delayMs = 500 * Math.pow(2, attempt - 1) + jitterMs;
      console.warn(
        `[SQL retry ${attempt}/${maxAttempts - 1}] ${operationName} hit transient connection drop; retrying in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export function isSqlConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      process.env.POSTGRES_URL?.trim() ||
      process.env.SQL_HOST?.trim()
  );
}

export const createPool = () => {
  if (!global._postgresPool) {
    const connectionString =
      process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();

    const sharedPoolOptions = {
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
      allowExitOnIdle: false,
    };

    if (connectionString) {
      const isLocal =
        connectionString.includes('localhost') ||
        connectionString.includes('127.0.0.1');
      global._postgresPool = new Pool({
        connectionString,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        ...sharedPoolOptions,
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        ...sharedPoolOptions,
      });
    }

    global._postgresPool.on('error', (err) => {
      if (isTransientSqlConnectionError(err)) {
        console.warn('SQL pool idle client closed after disconnect:', err.message);
        return;
      }
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
