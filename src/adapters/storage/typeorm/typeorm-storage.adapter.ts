import {
  DataSource,
  Repository,
  EntityManager,
  QueryRunner,
  SelectQueryBuilder,
  In,
  IsNull,
  Not,
  LessThan,
  MoreThan,
  Between,
} from 'typeorm';
import {
  StorageAdapter,
  Transaction,
  WebhookLog,
  AuditLog,
  DispatchLog,
  OutboxEvent,
  CreateTransactionDto,
  UpdateTransactionDto,
  MarkAsProcessingDto,
  CreateWebhookLogDto,
  CreateAuditLogDto,
  CreateDispatchLogDto,
  CreateOutboxEventDto,
  TransactionQuery,
  WebhookQuery,
  AuditLogQuery,
  DispatchLogQuery,
  OutboxQuery,
  TransactionStatus,
  ProcessingStatus,
  Money,
  VerificationMethod,
} from '../../../core';
import {
  TransactionEntity,
  WebhookLogEntity,
  AuditLogEntity,
  DispatchLogEntity,
  OutboxEventEntity,
} from './entities';

/**
 * TypeORM implementation of StorageAdapter for PostgreSQL
 */
export class TypeORMStorageAdapter implements StorageAdapter {
  private transactionRepo: Repository<TransactionEntity>;
  private webhookLogRepo: Repository<WebhookLogEntity>;
  private auditLogRepo: Repository<AuditLogEntity>;
  private dispatchLogRepo: Repository<DispatchLogEntity>;
  private outboxEventRepo: Repository<OutboxEventEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.transactionRepo = dataSource.getRepository(TransactionEntity);
    this.webhookLogRepo = dataSource.getRepository(WebhookLogEntity);
    this.auditLogRepo = dataSource.getRepository(AuditLogEntity);
    this.dispatchLogRepo = dataSource.getRepository(DispatchLogEntity);
    this.outboxEventRepo = dataSource.getRepository(OutboxEventEntity);
  }

  /**
   * Transaction Management
   */

  async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
    const entity = this.transactionRepo.create({
      applicationRef: dto.applicationRef,
      provider: dto.provider,
      amount: dto.amount,
      currency: dto.currency,
      status: TransactionStatus.PENDING,
      verificationMethod: VerificationMethod.WEBHOOK_ONLY,
      metadata: dto.metadata || {},
    });

    const saved = await this.transactionRepo.save(entity);
    return this.mapTransactionEntityToDomain(saved);
  }

  async updateTransaction(
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<Transaction> {
    await this.transactionRepo.update(id, {
      metadata: dto.metadata,
      updatedAt: new Date(),
    });

    const entity = await this.transactionRepo.findOneOrFail({ where: { id } });
    return this.mapTransactionEntityToDomain(entity);
  }

  async updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    auditEntry: CreateAuditLogDto,
  ): Promise<Transaction> {
    return await this.withTransaction(async (manager) => {
      // Use pessimistic locking to prevent concurrent updates
      const entity = await manager.findOne(TransactionEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entity) {
        throw new Error(`Transaction not found: ${id}`);
      }

      // Update transaction status
      entity.status = status;
      entity.updatedAt = new Date();
      const updated = await manager.save(entity);

      // Create audit log
      const auditEntity = manager.create(AuditLogEntity, auditEntry);
      await manager.save(auditEntity);

      return this.mapTransactionEntityToDomain(updated);
    });
  }

  async markAsProcessing(
    id: string,
    dto: MarkAsProcessingDto,
    auditEntry: CreateAuditLogDto,
  ): Promise<Transaction> {
    return await this.withTransaction(async (manager) => {
      const entity = await manager.findOne(TransactionEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entity) {
        throw new Error(`Transaction not found: ${id}`);
      }

      // Update transaction
      entity.status = TransactionStatus.PROCESSING;
      entity.providerRef = dto.providerRef;
      entity.verificationMethod =
        dto.verificationMethod || VerificationMethod.WEBHOOK_ONLY;
      entity.updatedAt = new Date();
      const updated = await manager.save(entity);

      // Create audit log
      const auditEntity = manager.create(AuditLogEntity, auditEntry);
      await manager.save(auditEntity);

      return this.mapTransactionEntityToDomain(updated);
    });
  }

  async linkProviderRef(id: string, providerRef: string): Promise<void> {
    await this.transactionRepo.update(id, {
      providerRef,
      updatedAt: new Date(),
    });
  }

  async findTransaction(query: TransactionQuery): Promise<Transaction | null> {
    const qb = this.transactionRepo.createQueryBuilder('t');

    if (query.id) {
      qb.andWhere('t.id = :id', { id: query.id });
    }
    if (query.applicationRef) {
      qb.andWhere('t.application_ref = :appRef', {
        appRef: query.applicationRef,
      });
    }
    if (query.provider) {
      qb.andWhere('t.provider = :provider', { provider: query.provider });
    }
    if (query.providerRef) {
      qb.andWhere('t.provider_ref = :providerRef', {
        providerRef: query.providerRef,
      });
    }
    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }

    const entity = await qb.getOne();
    return entity ? this.mapTransactionEntityToDomain(entity) : null;
  }

  async findTransactions(
    query: TransactionQuery,
    options?: { limit?: number; offset?: number },
  ): Promise<Transaction[]> {
    const qb = this.transactionRepo.createQueryBuilder('t');

    this.applyTransactionQuery(qb, query);

    if (options?.limit) {
      qb.limit(options.limit);
    }
    if (options?.offset) {
      qb.offset(options.offset);
    }

    qb.orderBy('t.created_at', 'DESC');

    const entities = await qb.getMany();
    return entities.map((e) => this.mapTransactionEntityToDomain(e));
  }

  async countTransactions(query: TransactionQuery): Promise<number> {
    const qb = this.transactionRepo.createQueryBuilder('t');
    this.applyTransactionQuery(qb, query);
    return await qb.getCount();
  }

  /**
   * Webhook Log Management
   */

  async createWebhookLog(dto: CreateWebhookLogDto): Promise<WebhookLog> {
    const entity = this.webhookLogRepo.create({
      provider: dto.provider,
      eventType: dto.eventType,
      providerEventId: dto.providerEventId,
      rawPayload: dto.rawPayload,
      headers: dto.headers || {},
      signatureValid: dto.signatureValid,
      processingStatus: dto.processingStatus,
      processingDurationMs: dto.processingDurationMs,
      receivedAt: dto.receivedAt,
      transactionId: dto.transactionId,
      metadata: dto.metadata || {},
    });

    const saved = await this.webhookLogRepo.save(entity);
    return this.mapWebhookLogEntityToDomain(saved);
  }

  async updateWebhookLogStatus(
    id: string,
    status: ProcessingStatus,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.webhookLogRepo.update(id, {
      processingStatus: status,
      metadata: metadata
        ? () => `metadata || '${JSON.stringify(metadata)}'::jsonb`
        : undefined,
    });
  }

  async linkWebhookToTransaction(
    webhookLogId: string,
    transactionId: string,
  ): Promise<void> {
    await this.webhookLogRepo.update(webhookLogId, {
      transactionId,
    });
  }

  async findWebhookLogs(query: WebhookQuery): Promise<WebhookLog[]> {
    const qb = this.webhookLogRepo.createQueryBuilder('w');

    if (query.id) {
      qb.andWhere('w.id = :id', { id: query.id });
    }
    if (query.provider) {
      qb.andWhere('w.provider = :provider', { provider: query.provider });
    }
    if (query.providerEventId) {
      qb.andWhere('w.provider_event_id = :eventId', {
        eventId: query.providerEventId,
      });
    }
    if (query.transactionId) {
      qb.andWhere('w.transaction_id = :txnId', { txnId: query.transactionId });
    }
    if (query.processingStatus) {
      qb.andWhere('w.processing_status = :status', {
        status: query.processingStatus,
      });
    }
    if (query.receivedAfter) {
      qb.andWhere('w.received_at > :after', { after: query.receivedAfter });
    }
    if (query.receivedBefore) {
      qb.andWhere('w.received_at < :before', { before: query.receivedBefore });
    }

    qb.orderBy('w.received_at', 'DESC');

    const entities = await qb.getMany();
    return entities.map((e) => this.mapWebhookLogEntityToDomain(e));
  }

  async countWebhookLogs(query: WebhookQuery): Promise<number> {
    const qb = this.webhookLogRepo.createQueryBuilder('w');
    // Apply same query conditions
    return await qb.getCount();
  }

  /**
   * Audit Log Management
   */

  async createAuditLog(dto: CreateAuditLogDto): Promise<AuditLog> {
    const entity = this.auditLogRepo.create({
      transactionId: dto.transactionId,
      action: dto.action,
      performedBy: dto.performedBy,
      performedAt: dto.performedAt,
      stateBefore: dto.stateBefore,
      stateAfter: dto.stateAfter,
      metadata: dto.metadata || {},
    });

    const saved = await this.auditLogRepo.save(entity);
    return this.mapAuditLogEntityToDomain(saved);
  }

  async getAuditLogs(query: AuditLogQuery): Promise<AuditLog[]> {
    const qb = this.auditLogRepo.createQueryBuilder('a');

    if (query.transactionId) {
      qb.andWhere('a.transaction_id = :txnId', { txnId: query.transactionId });
    }
    if (query.action) {
      qb.andWhere('a.action = :action', { action: query.action });
    }
    if (query.performedBy) {
      qb.andWhere('a.performed_by = :by', { by: query.performedBy });
    }
    if (query.performedAfter) {
      qb.andWhere('a.performed_at > :after', { after: query.performedAfter });
    }
    if (query.performedBefore) {
      qb.andWhere('a.performed_at < :before', {
        before: query.performedBefore,
      });
    }

    qb.orderBy('a.performed_at', 'ASC');

    const entities = await qb.getMany();
    return entities.map((e) => this.mapAuditLogEntityToDomain(e));
  }

  /**
   * Dispatch Log Management
   */

  async createDispatchLog(dto: CreateDispatchLogDto): Promise<DispatchLog> {
    const entity = this.dispatchLogRepo.create({
      webhookLogId: dto.webhookLogId,
      transactionId: dto.transactionId,
      eventType: dto.eventType,
      handlerName: dto.handlerName,
      status: dto.status,
      attemptedAt: dto.attemptedAt,
      completedAt: dto.completedAt,
      durationMs: dto.durationMs,
      error: dto.error,
      retryCount: dto.retryCount || 0,
      nextRetryAt: dto.nextRetryAt,
      metadata: dto.metadata || {},
    });

    const saved = await this.dispatchLogRepo.save(entity);
    return this.mapDispatchLogEntityToDomain(saved);
  }

  async getDispatchLogs(query: DispatchLogQuery): Promise<DispatchLog[]> {
    const qb = this.dispatchLogRepo.createQueryBuilder('d');

    if (query.webhookLogId) {
      qb.andWhere('d.webhook_log_id = :wId', { wId: query.webhookLogId });
    }
    if (query.transactionId) {
      qb.andWhere('d.transaction_id = :tId', { tId: query.transactionId });
    }
    if (query.status) {
      qb.andWhere('d.status = :status', { status: query.status });
    }

    qb.orderBy('d.attempted_at', 'DESC');

    const entities = await qb.getMany();
    return entities.map((e) => this.mapDispatchLogEntityToDomain(e));
  }

  /**
   * Outbox Event Management
   */

  async createOutboxEvent(dto: CreateOutboxEventDto): Promise<OutboxEvent> {
    const entity = this.outboxEventRepo.create({
      eventType: dto.eventType,
      aggregateId: dto.aggregateId,
      aggregateType: dto.aggregateType,
      payload: dto.payload,
      status: 'pending',
      scheduledFor: dto.scheduledFor || new Date(),
      metadata: dto.metadata || {},
    });

    const saved = await this.outboxEventRepo.save(entity);
    return this.mapOutboxEventEntityToDomain(saved);
  }

  async getOutboxEvents(query: OutboxQuery): Promise<OutboxEvent[]> {
    const qb = this.outboxEventRepo.createQueryBuilder('o');

    if (query.status) {
      qb.andWhere('o.status = :status', { status: query.status });
    }
    if (query.aggregateId) {
      qb.andWhere('o.aggregate_id = :aggId', { aggId: query.aggregateId });
    }
    if (query.scheduledBefore) {
      qb.andWhere('o.scheduled_for < :before', {
        before: query.scheduledBefore,
      });
    }

    qb.orderBy('o.scheduled_for', 'ASC');
    qb.limit(query.limit || 100);

    const entities = await qb.getMany();
    return entities.map((e) => this.mapOutboxEventEntityToDomain(e));
  }

  async markOutboxEventProcessed(id: string): Promise<void> {
    await this.outboxEventRepo.update(id, {
      status: 'delivered',
      processedAt: new Date(),
    });
  }

  async markOutboxEventFailed(id: string, error: string): Promise<void> {
    const entity = await this.outboxEventRepo.findOneOrFail({ where: { id } });

    const retryCount = entity.retryCount + 1;
    const status = retryCount >= entity.maxRetries ? 'dead_letter' : 'failed';

    // Exponential backoff for retry
    const nextRetry = new Date(Date.now() + Math.pow(2, retryCount) * 60000);

    await this.outboxEventRepo.update(id, {
      status,
      retryCount,
      error,
      scheduledFor: status === 'failed' ? nextRetry : undefined,
    });
  }

  /**
   * Transaction Support
   */

  async withTransaction<T>(
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await callback(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Health Check
   */

  async isHealthy(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async getStatistics(): Promise<{
    totalTransactions: number;
    totalWebhooks: number;
    totalAuditLogs: number;
  }> {
    const [totalTransactions, totalWebhooks, totalAuditLogs] =
      await Promise.all([
        this.transactionRepo.count(),
        this.webhookLogRepo.count(),
        this.auditLogRepo.count(),
      ]);

    return {
      totalTransactions,
      totalWebhooks,
      totalAuditLogs,
    };
  }

  /**
   * Private Mapping Methods
   */

  private mapTransactionEntityToDomain(entity: TransactionEntity): Transaction {
    return new Transaction(
      entity.id,
      entity.applicationRef,
      entity.provider,
      entity.status,
      new Money(Number(entity.amount), entity.currency),
      entity.providerRef,
      entity.verificationMethod,
      entity.metadata,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private mapWebhookLogEntityToDomain(entity: WebhookLogEntity): WebhookLog {
    return new WebhookLog(
      entity.id,
      entity.provider,
      entity.eventType,
      entity.providerEventId,
      entity.rawPayload,
      entity.headers,
      entity.signatureValid,
      entity.processingStatus,
      entity.processingDurationMs || 0,
      entity.receivedAt,
      entity.transactionId,
      entity.metadata,
      entity.createdAt,
    );
  }

  private mapAuditLogEntityToDomain(entity: AuditLogEntity): AuditLog {
    return new AuditLog(
      entity.id,
      entity.transactionId,
      entity.action,
      entity.performedBy,
      entity.performedAt,
      entity.stateBefore,
      entity.stateAfter,
      entity.metadata,
      entity.createdAt,
    );
  }

  private mapDispatchLogEntityToDomain(entity: DispatchLogEntity): DispatchLog {
    return new DispatchLog(
      entity.id,
      entity.webhookLogId,
      entity.transactionId,
      entity.eventType,
      entity.handlerName,
      entity.status,
      entity.attemptedAt,
      entity.completedAt || undefined,
      entity.durationMs || undefined,
      entity.error || undefined,
      entity.retryCount,
      entity.nextRetryAt || undefined,
      entity.metadata,
      entity.createdAt,
    );
  }

  private mapOutboxEventEntityToDomain(entity: OutboxEventEntity): OutboxEvent {
    return new OutboxEvent(
      entity.id,
      entity.eventType,
      entity.aggregateId,
      entity.aggregateType,
      entity.payload,
      entity.status as any,
      entity.retryCount,
      entity.maxRetries,
      entity.scheduledFor,
      entity.processedAt || undefined,
      entity.error || undefined,
      entity.metadata,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private applyTransactionQuery(
    qb: SelectQueryBuilder<TransactionEntity>,
    query: TransactionQuery,
  ): void {
    if (query.id) {
      qb.andWhere('t.id = :id', { id: query.id });
    }
    if (query.applicationRef) {
      qb.andWhere('t.application_ref = :appRef', {
        appRef: query.applicationRef,
      });
    }
    if (query.provider) {
      qb.andWhere('t.provider = :provider', { provider: query.provider });
    }
    if (query.providerRef) {
      qb.andWhere('t.provider_ref = :providerRef', {
        providerRef: query.providerRef,
      });
    }
    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }
    if (query.createdAfter) {
      qb.andWhere('t.created_at > :after', { after: query.createdAfter });
    }
    if (query.createdBefore) {
      qb.andWhere('t.created_at < :before', { before: query.createdBefore });
    }
  }
}
