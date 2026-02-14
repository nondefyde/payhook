import { DataSource, DataSourceOptions } from 'typeorm';
import {
  TransactionEntity,
  WebhookLogEntity,
  AuditLogEntity,
  DispatchLogEntity,
  OutboxEventEntity,
} from './entities';

/**
 * TypeORM configuration for PayHook
 */
export const createTypeORMConfig = (
  options?: Partial<DataSourceOptions>,
): DataSourceOptions => {
  const defaultConfig: DataSourceOptions = {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'payhook',
    password: process.env.DB_PASSWORD || 'payhook',
    database: process.env.DB_NAME || 'payhook',
    entities: [
      TransactionEntity,
      WebhookLogEntity,
      AuditLogEntity,
      DispatchLogEntity,
      OutboxEventEntity,
    ],
    synchronize: process.env.NODE_ENV === 'development',
    logging: process.env.DB_LOGGING === 'true',
    migrations: ['src/adapters/storage/typeorm/migrations/*.ts'],
    subscribers: [],
    // Connection pool settings
    extra: {
      max: parseInt(process.env.DB_POOL_SIZE || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    },
  };

  return {
    ...defaultConfig,
    ...options,
  } as DataSourceOptions;
};

/**
 * Create TypeORM DataSource
 */
export const createDataSource = (
  options?: Partial<DataSourceOptions>,
): DataSource => {
  return new DataSource(createTypeORMConfig(options));
};

/**
 * Default DataSource for CLI migrations
 */
export const AppDataSource = createDataSource();
