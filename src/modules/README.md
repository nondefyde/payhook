# Modules Layer

## Overview

The `modules` directory contains NestJS modules that package PayHook's functionality for use in NestJS applications. This layer provides dependency injection, HTTP controllers, decorators, and middleware that make PayHook easy to integrate into any NestJS project.

## Philosophy

The modules layer follows NestJS best practices:
- **Modular Architecture**: Each module encapsulates related functionality
- **Dependency Injection**: All dependencies wired through NestJS DI container
- **Decorator-Based**: Leverages NestJS decorators for clean code
- **Configurable**: Supports both static and async configuration
- **Extensible**: Easy to add custom functionality

## Directory Structure

```
modules/
├── payhook/                    # Main PayHook module
│   ├── controllers/           # HTTP endpoints
│   ├── services/             # NestJS services
│   ├── decorators/           # Custom decorators
│   ├── interceptors/         # Request/response interceptors
│   ├── middleware/           # Optional security middleware
│   ├── payhook.module.ts     # Module definition
│   ├── payhook.config.ts     # Configuration schema
│   └── index.ts              # Public API exports
└── README.md
```

## PayHook Module (`/payhook`)

The main module that integrates all PayHook functionality into NestJS applications.

### Module Structure

```typescript
@Module({})
export class PayHookModule {
  // Static configuration
  static forRoot(config: PayHookModuleConfig): DynamicModule {
    return {
      module: PayHookModule,
      global: true,
      imports: [],
      controllers: [
        WebhookController,
        TransactionController,
        HealthController
      ],
      providers: [
        // Core services
        {
          provide: TransactionService,
          useFactory: (storage, stateMachine, dispatcher) => {
            return new TransactionService(storage, stateMachine, dispatcher);
          },
          inject: [StorageAdapter, TransactionStateMachine, EventDispatcher]
        },
        // Adapters
        {
          provide: StorageAdapter,
          useFactory: () => config.storageAdapter
        },
        {
          provide: 'PAYMENT_PROVIDERS',
          useFactory: () => config.providers
        },
        // Configuration
        {
          provide: 'PAYHOOK_CONFIG',
          useValue: config
        }
      ],
      exports: [
        TransactionService,
        WebhookProcessor,
        EventDispatcher
      ]
    };
  }

  // Async configuration
  static forRootAsync(options: PayHookModuleAsyncConfig): DynamicModule {
    return {
      module: PayHookModule,
      global: true,
      imports: options.imports || [],
      controllers: [
        WebhookController,
        TransactionController,
        HealthController
      ],
      providers: [
        {
          provide: 'PAYHOOK_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject || []
        },
        // ... rest of providers
      ]
    };
  }
}
```

### Configuration

#### Configuration Schema (`payhook.config.ts`)

```typescript
export interface PayHookModuleConfig {
  // Required: Storage implementation
  storageAdapter: StorageAdapter;

  // Required: Payment providers
  providers: Map<string, PaymentProviderAdapter>;

  // Optional: Event configuration
  events?: {
    dispatcher?: EventDispatcher;
    handlers?: EventHandlerConfig[];
    enableOutbox?: boolean;
    outboxPollingInterval?: number;
  };

  // Optional: Security settings
  security?: {
    enableRateLimiting?: boolean;
    rateLimitPoints?: number;
    rateLimitDuration?: number;
    enableIpAllowlist?: boolean;
    allowedIps?: string[];
    maxBodySize?: number;
  };

  // Optional: Performance settings
  performance?: {
    enableCaching?: boolean;
    cacheTtl?: number;
    connectionPoolSize?: number;
    queryTimeout?: number;
  };

  // Optional: Monitoring
  monitoring?: {
    enableMetrics?: boolean;
    enableTracing?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    customLogger?: LoggerService;
  };

  // Optional: Debug mode
  debug?: boolean;
}
```

#### Basic Configuration

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { PayHookModule } from 'payhook-core';
import { TypeORMStorageAdapter } from 'payhook-core/adapters';
import { PaystackProviderAdapter } from 'payhook-core/adapters';

@Module({
  imports: [
    PayHookModule.forRoot({
      // Storage configuration
      storageAdapter: new TypeORMStorageAdapter(dataSource),

      // Provider configuration
      providers: new Map([
        ['paystack', new PaystackProviderAdapter({
          keys: {
            secretKey: process.env.PAYSTACK_SECRET_KEY
          }
        })],
        ['stripe', new StripeProviderAdapter({
          keys: {
            secretKey: process.env.STRIPE_SECRET_KEY
          }
        })]
      ]),

      // Event handlers
      events: {
        handlers: [
          {
            eventType: NormalizedEventType.PAYMENT_SUCCESSFUL,
            handler: async (event) => {
              await emailService.sendConfirmation(event);
            }
          }
        ]
      },

      // Enable debug mode
      debug: process.env.NODE_ENV === 'development'
    })
  ]
})
export class AppModule {}
```

#### Async Configuration

```typescript
@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        // ... database config
      }),
      inject: [ConfigService]
    }),
    PayHookModule.forRootAsync({
      imports: [ConfigModule, TypeOrmModule],
      useFactory: async (
        config: ConfigService,
        dataSource: DataSource
      ) => ({
        storageAdapter: new TypeORMStorageAdapter(dataSource),
        providers: new Map([
          ['paystack', new PaystackProviderAdapter({
            keys: {
              secretKey: config.get('PAYSTACK_SECRET_KEY')
            }
          })]
        ]),
        security: {
          enableRateLimiting: config.get('ENABLE_RATE_LIMIT'),
          rateLimitPoints: config.get('RATE_LIMIT_POINTS')
        }
      }),
      inject: [ConfigService, DataSource]
    })
  ]
})
export class AppModule {}
```

### Controllers (`/controllers`)

HTTP endpoints for webhook reception and transaction management.

#### Webhook Controller

Handles incoming webhooks from payment providers:

```typescript
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhookProcessor: WebhookProcessor,
    @Inject('PAYHOOK_CONFIG') private readonly config: any
  ) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(RawBodyInterceptor)
  @ApiWebhookEndpoint()
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() rawBody: Buffer,
    @Headers() headers: Record<string, string>
  ): Promise<WebhookResponseDto> {
    const result = await this.webhookProcessor.processWebhook(
      provider.toLowerCase(),
      rawBody,
      headers
    );

    return this.formatResponse(result);
  }
}
```

**Endpoints:**
- `POST /webhooks/:provider` - Receive webhooks
- `POST /webhooks/custom/:path/:provider` - Custom webhook paths

#### Transaction Controller

Query and manage transactions:

```typescript
@ApiTags('Transactions')
@Controller('transactions')
export class TransactionController {
  constructor(
    private readonly transactionService: TransactionService
  ) {}

  @Post()
  @ApiCreateTransaction()
  async createTransaction(
    @Body() dto: CreateTransactionDto
  ): Promise<Transaction> {
    return await this.transactionService.createTransaction(dto);
  }

  @Get(':id')
  @ApiGetTransaction()
  async getTransaction(
    @Param('id') id: string,
    @Query() query: TransactionQueryDto
  ): Promise<Transaction> {
    return await this.transactionService.getTransaction(id, query);
  }

  @Put(':id/processing')
  @ApiMarkAsProcessing()
  async markAsProcessing(
    @Param('id') id: string,
    @Body() dto: MarkAsProcessingDto
  ): Promise<Transaction> {
    return await this.transactionService.markAsProcessing(id, dto);
  }

  @Post(':id/reconcile')
  @ApiReconcileTransaction()
  async reconcile(
    @Param('id') id: string,
    @Body() dto: ReconcileTransactionDto
  ): Promise<ReconciliationResult> {
    return await this.transactionService.reconcile(id, dto);
  }
}
```

**Endpoints:**
- `POST /transactions` - Create transaction
- `GET /transactions/:id` - Get transaction
- `GET /transactions` - List transactions
- `PUT /transactions/:id/processing` - Mark as processing
- `POST /transactions/:id/reconcile` - Reconcile with provider
- `GET /transactions/:id/audit-trail` - Get audit history
- `GET /transactions/:id/webhooks` - Get related webhooks

#### Health Controller

Health checks and monitoring:

```typescript
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly webhookProcessor: WebhookProcessor
  ) {}

  @Get()
  @ApiHealthCheck()
  async health(): Promise<HealthResponse> {
    return {
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime()
    };
  }

  @Get('ready')
  @ApiReadinessCheck()
  async readiness(): Promise<ReadinessResponse> {
    const databaseHealthy = await this.storageAdapter.isHealthy();

    return {
      status: databaseHealthy ? 'ready' : 'not_ready',
      checks: {
        database: databaseHealthy,
        pipeline: true
      }
    };
  }

  @Get('stats')
  @ApiServiceStatistics()
  async statistics(): Promise<StatisticsResponse> {
    return {
      storage: await this.storageAdapter.getStatistics(),
      pipeline: this.webhookProcessor.getStatistics()
    };
  }
}
```

### Services (`/services`)

NestJS services that wrap core functionality.

#### PayHook Service

Main service facade:

```typescript
@Injectable()
export class PayHookService {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly webhookProcessor: WebhookProcessor,
    private readonly eventDispatcher: EventDispatcher,
    @Inject('PAYHOOK_CONFIG') private readonly config: PayHookModuleConfig
  ) {}

  // Transaction management
  async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
    return this.transactionService.createTransaction(dto);
  }

  // Webhook processing
  async processWebhook(
    provider: string,
    body: Buffer,
    headers: Record<string, string>
  ): Promise<ProcessingResult> {
    return this.webhookProcessor.processWebhook(provider, body, headers);
  }

  // Event handling
  onPaymentSuccessful(
    handler: (event: PaymentEvent) => Promise<void>
  ): void {
    this.eventDispatcher.register(
      NormalizedEventType.PAYMENT_SUCCESSFUL,
      handler
    );
  }

  // Statistics
  async getStatistics(): Promise<Statistics> {
    return {
      transactions: await this.transactionService.getStatistics(),
      webhooks: this.webhookProcessor.getStatistics()
    };
  }
}
```

#### Configuration Service

Manages runtime configuration:

```typescript
@Injectable()
export class ConfigurationService {
  private readonly config: PayHookModuleConfig;

  constructor(@Inject('PAYHOOK_CONFIG') config: PayHookModuleConfig) {
    this.config = this.validateConfig(config);
  }

  getProvider(name: string): PaymentProviderAdapter {
    const provider = this.config.providers.get(name);
    if (!provider) {
      throw new Error(`Provider ${name} not configured`);
    }
    return provider;
  }

  isDebugMode(): boolean {
    return this.config.debug || false;
  }

  getRateLimitConfig(): RateLimitConfig {
    return {
      enabled: this.config.security?.enableRateLimiting || false,
      points: this.config.security?.rateLimitPoints || 100,
      duration: this.config.security?.rateLimitDuration || 60
    };
  }
}
```

#### Outbox Processor

Handles reliable event delivery:

```typescript
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private processingInterval: NodeJS.Timer;

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly eventDispatcher: EventDispatcher,
    @Inject('PAYHOOK_CONFIG') private readonly config: PayHookModuleConfig
  ) {}

  onModuleInit() {
    if (this.config.events?.enableOutbox) {
      this.startProcessing();
    }
  }

  onModuleDestroy() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
  }

  private startProcessing() {
    const interval = this.config.events?.outboxPollingInterval || 5000;

    this.processingInterval = setInterval(async () => {
      await this.processOutboxEvents();
    }, interval);
  }

  private async processOutboxEvents() {
    const events = await this.storageAdapter.getUnprocessedOutboxEvents(10);

    for (const event of events) {
      try {
        await this.eventDispatcher.dispatch(event.payload);
        await this.storageAdapter.markOutboxEventProcessed(event.id);
      } catch (error) {
        await this.storageAdapter.markOutboxEventFailed(
          event.id,
          error.message
        );
      }
    }
  }
}
```

### Decorators (`/decorators`)

Custom decorators for cleaner code.

#### Webhook Decorators

```typescript
// Decorator to extract webhook data
export const WebhookData = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return {
      provider: request.params.provider,
      body: request.body,
      headers: request.headers
    };
  }
);

// Decorator for webhook event handlers
export function OnPaymentEvent(eventType: NormalizedEventType) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('payment:event', eventType, target, propertyKey);
    return descriptor;
  };
}

// Usage in a service
@Injectable()
export class PaymentHandlerService {
  @OnPaymentEvent(NormalizedEventType.PAYMENT_SUCCESSFUL)
  async handlePaymentSuccess(event: PaymentEvent) {
    // Handle successful payment
  }

  @OnPaymentEvent(NormalizedEventType.REFUND_SUCCESSFUL)
  async handleRefundSuccess(event: PaymentEvent) {
    // Handle successful refund
  }
}
```

### Interceptors (`/interceptors`)

Request/response transformation.

#### Raw Body Interceptor

Preserves raw body for signature verification:

```typescript
@Injectable()
export class RawBodyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Already have raw body from middleware
    if (request.rawBody) {
      return next.handle();
    }

    // Collect raw body
    return new Observable(observer => {
      const chunks: Buffer[] = [];

      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      request.on('end', () => {
        request.body = Buffer.concat(chunks);
        request.rawBody = request.body;

        next.handle().subscribe({
          next: (data) => observer.next(data),
          error: (err) => observer.error(err),
          complete: () => observer.complete()
        });
      });
    });
  }
}
```

### Middleware (`/middleware`)

Optional security middleware.

#### Rate Limiting Guard

```typescript
@Injectable()
export class PayHookRateLimitGuard implements CanActivate {
  private rateLimiter: Map<string, RateLimitEntry> = new Map();

  constructor(
    @Inject('PAYHOOK_CONFIG') private readonly config: PayHookModuleConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.security?.enableRateLimiting) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const key = this.getKey(request);

    const entry = this.rateLimiter.get(key) || {
      points: 0,
      resetAt: Date.now() + this.config.security.rateLimitDuration * 1000
    };

    if (Date.now() > entry.resetAt) {
      entry.points = 0;
      entry.resetAt = Date.now() + this.config.security.rateLimitDuration * 1000;
    }

    if (entry.points >= this.config.security.rateLimitPoints) {
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    entry.points++;
    this.rateLimiter.set(key, entry);

    return true;
  }

  private getKey(request: Request): string {
    return request.ip || 'unknown';
  }
}
```

#### IP Allowlist Guard

```typescript
@Injectable()
export class PayHookIpAllowlistGuard implements CanActivate {
  constructor(
    @Inject('PAYHOOK_CONFIG') private readonly config: PayHookModuleConfig
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.security?.enableIpAllowlist) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const clientIp = this.getClientIp(request);

    if (!this.config.security.allowedIps?.includes(clientIp)) {
      throw new ForbiddenException('IP not allowed');
    }

    return true;
  }

  private getClientIp(request: Request): string {
    return request.headers['x-forwarded-for']?.split(',')[0] ||
           request.ip ||
           'unknown';
  }
}
```

## Usage Examples

### Basic Setup

```typescript
// 1. Import PayHook module
import { PayHookModule } from 'payhook-core';

// 2. Configure storage
const storageAdapter = new TypeORMStorageAdapter(dataSource);

// 3. Configure providers
const providers = new Map([
  ['paystack', new PaystackProviderAdapter({
    keys: { secretKey: 'sk_live_xxxxx' }
  })]
]);

// 4. Register module
@Module({
  imports: [
    PayHookModule.forRoot({
      storageAdapter,
      providers
    })
  ]
})
export class AppModule {}
```

### Using the Service

```typescript
@Injectable()
export class OrderService {
  constructor(
    private readonly payHookService: PayHookService
  ) {}

  async createOrder(dto: CreateOrderDto) {
    // Create order in your system
    const order = await this.orderRepository.create(dto);

    // Register transaction with PayHook
    const transaction = await this.payHookService.createTransaction({
      applicationRef: order.id,
      provider: 'paystack',
      amount: Money.fromMajorUnits(order.total, 'USD'),
      metadata: {
        orderId: order.id,
        customerId: order.customerId
      }
    });

    return { order, transaction };
  }
}
```

### Handling Events

```typescript
@Injectable()
export class PaymentEventHandler implements OnModuleInit {
  constructor(
    private readonly payHookService: PayHookService,
    private readonly emailService: EmailService,
    private readonly inventoryService: InventoryService
  ) {}

  onModuleInit() {
    // Register event handlers
    this.payHookService.onPaymentSuccessful(
      this.handlePaymentSuccess.bind(this)
    );

    this.payHookService.onRefundSuccessful(
      this.handleRefundSuccess.bind(this)
    );
  }

  private async handlePaymentSuccess(event: PaymentEvent) {
    // Send confirmation email
    await this.emailService.sendPaymentConfirmation(
      event.payload.metadata.customerEmail,
      event.transactionId
    );

    // Update inventory
    await this.inventoryService.reduceStock(
      event.payload.metadata.orderId
    );

    // Generate invoice
    await this.invoiceService.generate(event.transactionId);
  }

  private async handleRefundSuccess(event: PaymentEvent) {
    // Send refund notification
    await this.emailService.sendRefundNotification(
      event.payload.metadata.customerEmail,
      event.payload.amount
    );

    // Restore inventory
    await this.inventoryService.restoreStock(
      event.payload.metadata.orderId
    );
  }
}
```

### Custom Webhook Path

```typescript
@Module({
  imports: [
    PayHookModule.forRoot({
      // ... other config
      webhookPaths: {
        paystack: '/api/payments/paystack/webhook',
        stripe: '/api/payments/stripe/webhook'
      }
    })
  ]
})
export class AppModule {}
```

### With Security Middleware

```typescript
@Module({
  imports: [
    PayHookModule.forRoot({
      // ... other config
      security: {
        enableRateLimiting: true,
        rateLimitPoints: 10,
        rateLimitDuration: 60, // 10 requests per minute
        enableIpAllowlist: true,
        allowedIps: [
          '52.31.139.75',    // Paystack IP
          '52.49.173.169',   // Paystack IP
          '52.214.14.220'    // Paystack IP
        ],
        maxBodySize: 1024 * 1024 // 1MB
      }
    })
  ]
})
export class AppModule {}
```

## Testing

### Unit Testing

```typescript
describe('PayHookService', () => {
  let service: PayHookService;
  let mockTransactionService: jest.Mocked<TransactionService>;
  let mockWebhookProcessor: jest.Mocked<WebhookProcessor>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PayHookService,
        {
          provide: TransactionService,
          useValue: createMock<TransactionService>()
        },
        {
          provide: WebhookProcessor,
          useValue: createMock<WebhookProcessor>()
        },
        {
          provide: 'PAYHOOK_CONFIG',
          useValue: { debug: true }
        }
      ]
    }).compile();

    service = module.get<PayHookService>(PayHookService);
    mockTransactionService = module.get(TransactionService);
    mockWebhookProcessor = module.get(WebhookProcessor);
  });

  describe('createTransaction', () => {
    it('should create a transaction', async () => {
      const dto = {
        applicationRef: 'order_123',
        provider: 'paystack',
        amount: Money.fromMajorUnits(100, 'USD')
      };

      const expected = new Transaction({ ...dto, id: 'tx_123' });
      mockTransactionService.createTransaction.mockResolvedValue(expected);

      const result = await service.createTransaction(dto);

      expect(result).toEqual(expected);
      expect(mockTransactionService.createTransaction).toHaveBeenCalledWith(dto);
    });
  });
});
```

### Integration Testing

```typescript
describe('Webhook Controller (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        PayHookModule.forRoot({
          storageAdapter: new MockStorageAdapter(),
          providers: new Map([
            ['paystack', new MockProviderAdapter()]
          ])
        })
      ]
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /webhooks/:provider', () => {
    it('should process valid webhook', async () => {
      const webhook = {
        event: 'charge.success',
        data: {
          reference: 'ref_123',
          amount: 10000,
          currency: 'NGN'
        }
      };

      const signature = generateSignature(webhook, 'test_secret');

      return request(app.getHttpServer())
        .post('/webhooks/paystack')
        .set('x-paystack-signature', signature)
        .send(webhook)
        .expect(200)
        .expect(res => {
          expect(res.body.success).toBe(true);
          expect(res.body.message).toBe('Webhook processed successfully');
        });
    });

    it('should reject invalid signature', async () => {
      return request(app.getHttpServer())
        .post('/webhooks/paystack')
        .set('x-paystack-signature', 'invalid')
        .send({ event: 'charge.success' })
        .expect(200)
        .expect(res => {
          expect(res.body.success).toBe(false);
        });
    });
  });
});
```

## Performance Optimization

### Caching

```typescript
@Module({
  imports: [
    CacheModule.register({
      store: redisStore,
      ttl: 30 // seconds
    }),
    PayHookModule.forRoot({
      // ... config
      performance: {
        enableCaching: true,
        cacheTtl: 30
      }
    })
  ]
})
export class AppModule {}
```

### Connection Pooling

```typescript
PayHookModule.forRoot({
  // ... config
  performance: {
    connectionPoolSize: 20,
    queryTimeout: 5000
  }
})
```

### Async Event Processing

```typescript
PayHookModule.forRoot({
  events: {
    enableOutbox: true,
    outboxPollingInterval: 5000, // Check every 5 seconds
    handlers: [
      {
        eventType: NormalizedEventType.PAYMENT_SUCCESSFUL,
        handler: async (event) => {
          // Long-running process
        },
        async: true // Process in background
      }
    ]
  }
})
```

## Monitoring

### Metrics

```typescript
@Module({
  imports: [
    PrometheusModule.register(),
    PayHookModule.forRoot({
      // ... config
      monitoring: {
        enableMetrics: true
      }
    })
  ]
})
export class AppModule {}

// Exposed metrics:
// - payhook_webhooks_received_total
// - payhook_webhooks_processed_total
// - payhook_webhooks_failed_total
// - payhook_transaction_state_changes_total
// - payhook_processing_duration_seconds
```

### Custom Logger

```typescript
class CustomLogger implements LoggerService {
  log(message: string, context?: string) {
    // Send to logging service
  }

  error(message: string, trace?: string, context?: string) {
    // Send to error tracking
  }
}

PayHookModule.forRoot({
  // ... config
  monitoring: {
    customLogger: new CustomLogger()
  }
})
```

## Troubleshooting

### Common Issues

**1. Module Not Found**
```
Error: Nest can't resolve dependencies of TransactionService
```
Solution: Ensure PayHookModule is imported in your AppModule

**2. Provider Not Configured**
```
Error: Provider 'stripe' not configured
```
Solution: Add provider to configuration map

**3. Database Connection Failed**
```
Error: Storage adapter is not healthy
```
Solution: Check database connection settings

**4. Webhook Signature Failed**
```
Processing status: INVALID
```
Solution: Verify webhook secret configuration

## Best Practices

### 1. Use Async Configuration
```typescript
PayHookModule.forRootAsync({
  useFactory: async (config: ConfigService) => ({
    // Load configuration from environment
  })
})
```

### 2. Enable Security Features
```typescript
security: {
  enableRateLimiting: true,
  enableIpAllowlist: true,
  maxBodySize: 1024 * 1024
}
```

### 3. Set Up Monitoring
```typescript
monitoring: {
  enableMetrics: true,
  enableTracing: true,
  logLevel: 'info'
}
```

### 4. Use Event Handlers
```typescript
events: {
  handlers: [
    // Register handlers for business logic
  ]
}
```

### 5. Test Thoroughly
- Unit test services
- Integration test controllers
- E2E test webhook flow

## API Reference

### Module Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| storageAdapter | StorageAdapter | Yes | Database implementation |
| providers | Map<string, PaymentProviderAdapter> | Yes | Payment providers |
| events | EventConfig | No | Event configuration |
| security | SecurityConfig | No | Security settings |
| performance | PerformanceConfig | No | Performance tuning |
| monitoring | MonitoringConfig | No | Monitoring setup |
| debug | boolean | No | Debug mode |

### Exported Services

| Service | Description |
|---------|-------------|
| PayHookService | Main service facade |
| TransactionService | Transaction management |
| WebhookProcessor | Webhook processing |
| EventDispatcher | Event handling |
| ConfigurationService | Configuration access |

### Decorators

| Decorator | Description |
|-----------|-------------|
| @OnPaymentEvent() | Mark method as event handler |
| @WebhookData() | Extract webhook data from request |

## Contributing

To extend the module:

1. **Add Features**: Extend services or add new ones
2. **Write Tests**: Unit and integration tests required
3. **Document**: Update README with new features
4. **Submit PR**: With examples and test coverage

The modules layer makes PayHook production-ready for NestJS applications!