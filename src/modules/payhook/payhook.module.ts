import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PayHookModuleConfig,
  PayHookModuleAsyncConfig,
  defaultPayHookConfig,
} from './payhook.config';
import {
  StorageAdapter,
  PaymentProviderAdapter,
  EventDispatcher,
  TransactionStateMachine,
  WebhookProcessor,
  TransactionService,
  EventDispatcherImpl,
  MockStorageAdapter,
  TypeORMStorageAdapter,
  MockProviderAdapter,
  PaystackProviderAdapter,
  LoggingEventHandler,
  MetricsEventHandler,
  createDataSource,
} from '../../core';
import { WebhookController } from './controllers/webhook.controller';
import { TransactionController } from './controllers/transaction.controller';
import { HealthController } from './controllers/health.controller';
import { PayHookService } from './services/payhook.service';
import { ConfigurationService } from './services/configuration.service';
import { OutboxProcessor } from './services/outbox.processor';

/**
 * PayHook Module - Main NestJS Module
 *
 * Provides dependency injection and configuration for PayHook
 */
@Global()
@Module({})
export class PayHookModule {
  /**
   * Configure PayHook synchronously
   */
  static forRoot(config: PayHookModuleConfig): DynamicModule {
    const mergedConfig = { ...defaultPayHookConfig, ...config };

    const providers = this.createProviders(mergedConfig);
    const controllers = this.createControllers(mergedConfig);

    return {
      module: PayHookModule,
      providers: [
        {
          provide: 'PAYHOOK_CONFIG',
          useValue: mergedConfig,
        },
        ...providers,
      ],
      controllers,
      exports: [
        'PAYHOOK_CONFIG',
        StorageAdapter,
        TransactionService,
        PayHookService,
        WebhookProcessor,
        EventDispatcher,
      ],
    };
  }

  /**
   * Configure PayHook asynchronously
   */
  static forRootAsync(options: PayHookModuleAsyncConfig): DynamicModule {
    const providers = this.createAsyncProviders(options);

    return {
      module: PayHookModule,
      imports: options.imports || [],
      providers: [
        ...providers,
        ...this.createDynamicProviders(),
      ],
      controllers: [
        WebhookController,
        TransactionController,
        HealthController,
      ],
      exports: [
        'PAYHOOK_CONFIG',
        StorageAdapter,
        TransactionService,
        PayHookService,
        WebhookProcessor,
        EventDispatcher,
      ],
    };
  }

  /**
   * Create providers based on configuration
   */
  private static createProviders(config: PayHookModuleConfig): Provider[] {
    const providers: Provider[] = [];

    // Storage Adapter
    providers.push({
      provide: StorageAdapter,
      useFactory: async () => {
        switch (config.storage.type) {
          case 'mock':
            return new MockStorageAdapter();

          case 'typeorm':
            const dataSource = createDataSource(config.storage.options);
            await dataSource.initialize();
            return new TypeORMStorageAdapter(dataSource);

          case 'custom':
            if (!config.storage.adapter) {
              throw new Error('Custom storage adapter not provided');
            }
            return config.storage.adapter;

          default:
            throw new Error(`Unknown storage type: ${config.storage.type}`);
        }
      },
    });

    // Provider Adapters
    providers.push({
      provide: 'PROVIDER_ADAPTERS',
      useFactory: () => {
        const adapters = new Map<string, PaymentProviderAdapter>();

        for (const providerConfig of config.providers) {
          let adapter: PaymentProviderAdapter;

          if (typeof providerConfig.adapter === 'string') {
            switch (providerConfig.adapter) {
              case 'mock':
                adapter = new MockProviderAdapter();
                break;
              case 'paystack':
                adapter = new PaystackProviderAdapter();
                break;
              default:
                throw new Error(`Unknown provider adapter: ${providerConfig.adapter}`);
            }
          } else {
            adapter = providerConfig.adapter;
          }

          adapters.set(providerConfig.name, adapter);
        }

        return adapters;
      },
    });

    // Provider Secrets
    providers.push({
      provide: 'PROVIDER_SECRETS',
      useFactory: () => {
        const secrets = new Map<string, string[]>();

        for (const providerConfig of config.providers) {
          secrets.set(providerConfig.name, providerConfig.secrets);
        }

        return secrets;
      },
    });

    // Event Dispatcher
    providers.push({
      provide: EventDispatcher,
      useFactory: () => {
        const dispatcher = config.events?.dispatcher || new EventDispatcherImpl();

        // Add built-in handlers if enabled
        if (config.events?.enableLogging) {
          const loggingHandler = new LoggingEventHandler();
          dispatcher.onAll(loggingHandler.getHandler());
        }

        if (config.events?.enableMetrics) {
          const metricsHandler = new MetricsEventHandler();
          dispatcher.onAll(metricsHandler.getHandler());
        }

        // Add custom handlers
        if (config.events?.handlers) {
          for (const { eventType, handler } of config.events.handlers) {
            dispatcher.on(eventType, handler);
          }
        }

        return dispatcher;
      },
    });

    // State Machine
    providers.push({
      provide: TransactionStateMachine,
      useClass: TransactionStateMachine,
    });

    // Webhook Processor
    providers.push({
      provide: WebhookProcessor,
      useFactory: (
        storageAdapter: StorageAdapter,
        providerAdapters: Map<string, PaymentProviderAdapter>,
        secrets: Map<string, string[]>,
        eventDispatcher: EventDispatcher,
        stateMachine: TransactionStateMachine,
      ) => {
        // Merge secrets into config
        const configWithSecrets = {
          storageAdapter,
          providerAdapters,
          eventDispatcher,
          stateMachine,
          skipSignatureVerification: config.webhooks?.skipSignatureVerification,
          storeRawPayload: config.webhooks?.storeRawPayload,
          redactKeys: config.webhooks?.redactKeys,
          timeoutMs: config.webhooks?.timeoutMs,
          hooks: config.hooks,
        };

        // Create processor with secrets
        const processor = new WebhookProcessor(configWithSecrets);

        // Inject secrets (this would need to be added to WebhookProcessor)
        (processor as any).secrets = secrets;

        return processor;
      },
      inject: [
        StorageAdapter,
        'PROVIDER_ADAPTERS',
        'PROVIDER_SECRETS',
        EventDispatcher,
        TransactionStateMachine,
      ],
    });

    // Transaction Service
    providers.push({
      provide: TransactionService,
      useFactory: (
        storageAdapter: StorageAdapter,
        providerAdapters: Map<string, PaymentProviderAdapter>,
        stateMachine: TransactionStateMachine,
      ) => {
        return new TransactionService(storageAdapter, providerAdapters, stateMachine);
      },
      inject: [StorageAdapter, 'PROVIDER_ADAPTERS', TransactionStateMachine],
    });

    // PayHook Service (main service)
    providers.push({
      provide: PayHookService,
      useClass: PayHookService,
    });

    // Configuration Service
    providers.push({
      provide: ConfigurationService,
      useClass: ConfigurationService,
    });

    // Outbox Processor (if enabled)
    if (config.outbox?.enabled) {
      providers.push({
        provide: OutboxProcessor,
        useClass: OutboxProcessor,
      });
    }

    return providers;
  }

  /**
   * Create controllers based on configuration
   */
  private static createControllers(config: PayHookModuleConfig): any[] {
    const controllers = [
      WebhookController,
      TransactionController,
      HealthController,
    ];

    return controllers;
  }

  /**
   * Create async providers
   */
  private static createAsyncProviders(options: PayHookModuleAsyncConfig): Provider[] {
    return [
      {
        provide: 'PAYHOOK_CONFIG',
        useFactory: options.useFactory,
        inject: options.inject || [],
      },
    ];
  }

  /**
   * Create dynamic providers that depend on async config
   */
  private static createDynamicProviders(): Provider[] {
    return [
      {
        provide: StorageAdapter,
        useFactory: async (config: PayHookModuleConfig) => {
          const mergedConfig = { ...defaultPayHookConfig, ...config };

          switch (mergedConfig.storage.type) {
            case 'mock':
              return new MockStorageAdapter();

            case 'typeorm':
              const dataSource = createDataSource(mergedConfig.storage.options);
              await dataSource.initialize();
              return new TypeORMStorageAdapter(dataSource);

            case 'custom':
              if (!mergedConfig.storage.adapter) {
                throw new Error('Custom storage adapter not provided');
              }
              return mergedConfig.storage.adapter;

            default:
              throw new Error(`Unknown storage type: ${mergedConfig.storage.type}`);
          }
        },
        inject: ['PAYHOOK_CONFIG'],
      },
      {
        provide: 'PROVIDER_ADAPTERS',
        useFactory: (config: PayHookModuleConfig) => {
          const mergedConfig = { ...defaultPayHookConfig, ...config };
          const adapters = new Map<string, PaymentProviderAdapter>();

          for (const providerConfig of mergedConfig.providers) {
            let adapter: PaymentProviderAdapter;

            if (typeof providerConfig.adapter === 'string') {
              switch (providerConfig.adapter) {
                case 'mock':
                  adapter = new MockProviderAdapter();
                  break;
                case 'paystack':
                  adapter = new PaystackProviderAdapter();
                  break;
                default:
                  throw new Error(`Unknown provider adapter: ${providerConfig.adapter}`);
              }
            } else {
              adapter = providerConfig.adapter;
            }

            adapters.set(providerConfig.name, adapter);
          }

          return adapters;
        },
        inject: ['PAYHOOK_CONFIG'],
      },
      {
        provide: 'PROVIDER_SECRETS',
        useFactory: (config: PayHookModuleConfig) => {
          const mergedConfig = { ...defaultPayHookConfig, ...config };
          const secrets = new Map<string, string[]>();

          for (const providerConfig of mergedConfig.providers) {
            secrets.set(providerConfig.name, providerConfig.secrets);
          }

          return secrets;
        },
        inject: ['PAYHOOK_CONFIG'],
      },
      {
        provide: EventDispatcher,
        useFactory: (config: PayHookModuleConfig) => {
          const mergedConfig = { ...defaultPayHookConfig, ...config };
          const dispatcher = mergedConfig.events?.dispatcher || new EventDispatcherImpl();

          if (mergedConfig.events?.enableLogging) {
            const loggingHandler = new LoggingEventHandler();
            dispatcher.onAll(loggingHandler.getHandler());
          }

          if (mergedConfig.events?.enableMetrics) {
            const metricsHandler = new MetricsEventHandler();
            dispatcher.onAll(metricsHandler.getHandler());
          }

          if (mergedConfig.events?.handlers) {
            for (const { eventType, handler } of mergedConfig.events.handlers) {
              dispatcher.on(eventType, handler);
            }
          }

          return dispatcher;
        },
        inject: ['PAYHOOK_CONFIG'],
      },
      {
        provide: TransactionStateMachine,
        useClass: TransactionStateMachine,
      },
      {
        provide: WebhookProcessor,
        useFactory: (
          config: PayHookModuleConfig,
          storageAdapter: StorageAdapter,
          providerAdapters: Map<string, PaymentProviderAdapter>,
          secrets: Map<string, string[]>,
          eventDispatcher: EventDispatcher,
          stateMachine: TransactionStateMachine,
        ) => {
          const mergedConfig = { ...defaultPayHookConfig, ...config };

          const processorConfig = {
            storageAdapter,
            providerAdapters,
            eventDispatcher,
            stateMachine,
            skipSignatureVerification: mergedConfig.webhooks?.skipSignatureVerification,
            storeRawPayload: mergedConfig.webhooks?.storeRawPayload,
            redactKeys: mergedConfig.webhooks?.redactKeys,
            timeoutMs: mergedConfig.webhooks?.timeoutMs,
            hooks: mergedConfig.hooks,
          };

          const processor = new WebhookProcessor(processorConfig);
          (processor as any).secrets = secrets;

          return processor;
        },
        inject: [
          'PAYHOOK_CONFIG',
          StorageAdapter,
          'PROVIDER_ADAPTERS',
          'PROVIDER_SECRETS',
          EventDispatcher,
          TransactionStateMachine,
        ],
      },
      {
        provide: TransactionService,
        useFactory: (
          storageAdapter: StorageAdapter,
          providerAdapters: Map<string, PaymentProviderAdapter>,
          stateMachine: TransactionStateMachine,
        ) => {
          return new TransactionService(storageAdapter, providerAdapters, stateMachine);
        },
        inject: [StorageAdapter, 'PROVIDER_ADAPTERS', TransactionStateMachine],
      },
      {
        provide: PayHookService,
        useClass: PayHookService,
      },
      {
        provide: ConfigurationService,
        useClass: ConfigurationService,
      },
    ];
  }
}