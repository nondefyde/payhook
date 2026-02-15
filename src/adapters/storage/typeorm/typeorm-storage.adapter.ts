import {
  DataSource,
  Repository,
  EntityManager,
  SelectQueryBuilder,
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
  TransactionFilter,
  WebhookFilter,
  UnmatchedFilter,
  Pagination,
  PaginatedResult,
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

  async listTransactions(
    filter: TransactionFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<Transaction>> {
    const qb = this.transactionRepo.createQueryBuilder('t');

    if (filter.status) {
      qb.andWhere('t.status = :status', { status: filter.status });
    }
    if (filter.provider) {
      qb.andWhere('t.provider = :provider', { provider: filter.provider });
    }
    if (filter.fromDate) {
      qb.andWhere('t.created_at >= :fromDate', { fromDate: filter.fromDate });
    }
    if (filter.toDate) {
      qb.andWhere('t.created_at <= :toDate', { toDate: filter.toDate });
    }
    if (filter.minAmount !== undefined) {
      qb.andWhere('t.amount >= :minAmount', { minAmount: filter.minAmount });
    }
    if (filter.maxAmount !== undefined) {
      qb.andWhere('t.amount <= :maxAmount', { maxAmount: filter.maxAmount });
    }
    if (filter.currency) {
      qb.andWhere('t.currency = :currency', { currency: filter.currency });
    }

    const total = await qb.getCount();

    qb.orderBy('t.created_at', 'DESC');
    qb.skip((pagination.page - 1) * pagination.limit);
    qb.take(pagination.limit);

    const entities = await qb.getMany();
    const items = entities.map((e) => this.mapTransactionEntityToDomain(e));

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  async findStaleTransactions(
    olderThanMinutes: number,
    limit?: number,
  ): Promise<Transaction[]> {
    const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const qb = this.transactionRepo.createQueryBuilder('t');
    qb.andWhere('t.status = :status', { status: TransactionStatus.PROCESSING });
    qb.andWhere('t.updated_at < :cutoff', { cutoff: cutoffTime });
    qb.orderBy('t.updated_at', 'ASC');

    if (limit) {
      qb.limit(limit);
    }

    const entities = await qb.getMany();
    return entities.map((e) => this.mapTransactionEntityToDomain(e));
  }

  async lockTransactionForUpdate(id: string): Promise<Transaction | null> {
    const entity = await this.transactionRepo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    return entity ? this.mapTransactionEntityToDomain(entity) : null;
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
    status: any,
    errorMessage?: string,
  ): Promise<WebhookLog> {
    await this.webhookLogRepo.update(id, {
      processingStatus: status,
      errorMessage: errorMessage || undefined,
    });

    const entity = await this.webhookLogRepo.findOneOrFail({ where: { id } });
    return this.mapWebhookLogEntityToDomain(entity);
  }

  async linkWebhookToTransaction(
    webhookLogId: string,
    transactionId: string,
  ): Promise<void> {
    await this.webhookLogRepo.update(webhookLogId, {
      transactionId,
    });
  }

  async findWebhookLog(id: string): Promise<WebhookLog | null> {
    const entity = await this.webhookLogRepo.findOne({ where: { id } });
    return entity ? this.mapWebhookLogEntityToDomain(entity) : null;
  }

  async findWebhookLogByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookLog | null> {
    const entity = await this.webhookLogRepo.findOne({
      where: {
        provider,
        providerEventId,
      },
    });
    return entity ? this.mapWebhookLogEntityToDomain(entity) : null;
  }

  async updateWebhookLog(
    id: string,
    updates: Partial<WebhookLog>,
  ): Promise<WebhookLog> {
    const updateData: any = {};

    if (updates.transactionId !== undefined) {
      updateData.transactionId = updates.transactionId;
    }
    if (updates.processingStatus !== undefined) {
      updateData.processingStatus = updates.processingStatus;
    }
    if (updates.errorMessage !== undefined) {
      updateData.errorMessage = updates.errorMessage;
    }
    if (
      updates.processingDurationMs !== undefined &&
      updates.processingDurationMs !== null
    ) {
      updateData.processingDurationMs = updates.processingDurationMs;
    }

    await this.webhookLogRepo.update(id, updateData);

    const entity = await this.webhookLogRepo.findOneOrFail({ where: { id } });
    return this.mapWebhookLogEntityToDomain(entity);
  }

  async listUnmatchedWebhooks(
    filter: UnmatchedFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<WebhookLog>> {
    const qb = this.webhookLogRepo.createQueryBuilder('w');

    // Unmatched webhooks have no transaction ID
    qb.andWhere('w.transaction_id IS NULL');

    if (filter.provider) {
      qb.andWhere('w.provider = :provider', { provider: filter.provider });
    }
    if (filter.eventType) {
      qb.andWhere('w.event_type = :eventType', { eventType: filter.eventType });
    }
    if (filter.fromDate) {
      qb.andWhere('w.received_at >= :fromDate', { fromDate: filter.fromDate });
    }
    if (filter.toDate) {
      qb.andWhere('w.received_at <= :toDate', { toDate: filter.toDate });
    }

    const total = await qb.getCount();

    qb.orderBy('w.received_at', 'DESC');
    qb.skip((pagination.page - 1) * pagination.limit);
    qb.take(pagination.limit);

    const entities = await qb.getMany();
    const items = entities.map((e) => this.mapWebhookLogEntityToDomain(e));

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  async listWebhookLogs(
    filter: WebhookFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<WebhookLog>> {
    const qb = this.webhookLogRepo.createQueryBuilder('w');

    if (filter.provider) {
      qb.andWhere('w.provider = :provider', { provider: filter.provider });
    }
    if (filter.processingStatus) {
      qb.andWhere('w.processing_status = :status', {
        status: filter.processingStatus,
      });
    }
    if (filter.transactionId) {
      qb.andWhere('w.transaction_id = :txnId', { txnId: filter.transactionId });
    }
    if (filter.fromDate) {
      qb.andWhere('w.received_at >= :fromDate', { fromDate: filter.fromDate });
    }
    if (filter.toDate) {
      qb.andWhere('w.received_at <= :toDate', { toDate: filter.toDate });
    }

    const total = await qb.getCount();

    qb.orderBy('w.received_at', 'DESC');
    qb.skip((pagination.page - 1) * pagination.limit);
    qb.take(pagination.limit);

    const entities = await qb.getMany();
    const items = entities.map((e) => this.mapWebhookLogEntityToDomain(e));

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
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
      performedBy: dto.performedBy || dto.actor,
      performedAt: dto.performedAt,
      fromStatus: dto.fromStatus ?? dto.stateBefore,
      toStatus: dto.toStatus ?? dto.stateAfter,
      stateBefore: dto.stateBefore ?? dto.fromStatus,
      stateAfter: dto.stateAfter ?? dto.toStatus,
      triggerType: dto.triggerType,
      webhookLogId: dto.webhookLogId,
      reconciliationResult: dto.reconciliationResult,
      verificationMethod: dto.verificationMethod,
      actor: dto.actor || dto.performedBy,
      reason: dto.reason,
      metadata: dto.metadata || {},
    });

    const saved = await this.auditLogRepo.save(entity);
    return this.mapAuditLogEntityToDomain(saved);
  }

  async getAuditLogs(transactionId: string): Promise<AuditLog[]>;
  async getAuditLogs(query: AuditLogQuery): Promise<AuditLog[]>;
  async getAuditLogs(
    transactionIdOrQuery: string | AuditLogQuery,
  ): Promise<AuditLog[]> {
    const qb = this.auditLogRepo.createQueryBuilder('a');

    // Handle both string (transactionId) and AuditLogQuery
    if (typeof transactionIdOrQuery === 'string') {
      qb.andWhere('a.transaction_id = :txnId', { txnId: transactionIdOrQuery });
    } else {
      const query = transactionIdOrQuery;
      if (query.transactionId) {
        qb.andWhere('a.transaction_id = :txnId', {
          txnId: query.transactionId,
        });
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
    }

    qb.orderBy('a.performed_at', 'ASC');

    const entities = await qb.getMany();
    return entities.map((e) => this.mapAuditLogEntityToDomain(e));
  }

  async getAuditTrail(transactionId: string): Promise<AuditLog[]> {
    const qb = this.auditLogRepo.createQueryBuilder('a');
    qb.andWhere('a.transaction_id = :txnId', { txnId: transactionId });
    qb.orderBy('a.performed_at', 'ASC');

    const entities = await qb.getMany();
    return entities.map((e) => this.mapAuditLogEntityToDomain(e));
  }

  async listAuditLogs(
    fromDate: Date,
    toDate: Date,
    pagination: Pagination,
  ): Promise<PaginatedResult<AuditLog>> {
    const qb = this.auditLogRepo.createQueryBuilder('a');

    qb.andWhere('a.created_at >= :fromDate', { fromDate });
    qb.andWhere('a.created_at <= :toDate', { toDate });

    const total = await qb.getCount();

    qb.orderBy('a.created_at', 'DESC');
    qb.skip((pagination.page - 1) * pagination.limit);
    qb.take(pagination.limit);

    const entities = await qb.getMany();
    const items = entities.map((e) => this.mapAuditLogEntityToDomain(e));

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
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
      status: dto.status as any, // Cast to DispatchStatus enum
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

  async getDispatchLogs(transactionId: string): Promise<DispatchLog[]>;
  async getDispatchLogs(query: DispatchLogQuery): Promise<DispatchLog[]>;
  async getDispatchLogs(
    transactionIdOrQuery: string | DispatchLogQuery,
  ): Promise<DispatchLog[]> {
    const qb = this.dispatchLogRepo.createQueryBuilder('d');

    // Handle both string (transactionId) and DispatchLogQuery
    if (typeof transactionIdOrQuery === 'string') {
      qb.andWhere('d.transaction_id = :tId', { tId: transactionIdOrQuery });
    } else {
      const query = transactionIdOrQuery;
      if (query.webhookLogId) {
        qb.andWhere('d.webhook_log_id = :wId', { wId: query.webhookLogId });
      }
      if (query.transactionId) {
        qb.andWhere('d.transaction_id = :tId', { tId: query.transactionId });
      }
      if (query.status) {
        qb.andWhere('d.status = :status', { status: query.status });
      }
    }

    qb.orderBy('d.attempted_at', 'DESC');

    const entities = await qb.getMany();
    return entities.map((e) => this.mapDispatchLogEntityToDomain(e));
  }

  async findFailedDispatches(
    limit?: number,
    maxRetries?: number,
  ): Promise<DispatchLog[]> {
    const qb = this.dispatchLogRepo.createQueryBuilder('d');

    qb.andWhere('d.status = :status', { status: 'failed' });

    if (maxRetries !== undefined) {
      qb.andWhere('d.retry_count < :maxRetries', { maxRetries });
    }

    // Only get dispatches that are ready for retry
    qb.andWhere('(d.next_retry_at IS NULL OR d.next_retry_at <= :now)', {
      now: new Date(),
    });

    qb.orderBy('d.attempted_at', 'ASC');

    if (limit) {
      qb.limit(limit);
    }

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

  async markOutboxEventProcessed(id: string): Promise<OutboxEvent> {
    await this.outboxEventRepo.update(id, {
      status: 'delivered',
      processedAt: new Date(),
    });

    const entity = await this.outboxEventRepo.findOneOrFail({ where: { id } });
    return this.mapOutboxEventEntityToDomain(entity);
  }

  async markOutboxEventFailed(
    id: string,
    errorMessage: string,
  ): Promise<OutboxEvent> {
    const entity = await this.outboxEventRepo.findOneOrFail({ where: { id } });

    const retryCount = entity.retryCount + 1;
    const status = retryCount >= entity.maxRetries ? 'dead_letter' : 'failed';

    // Exponential backoff for retry
    const nextRetry = new Date(Date.now() + Math.pow(2, retryCount) * 60000);

    await this.outboxEventRepo.update(id, {
      status,
      retryCount,
      error: errorMessage,
      scheduledFor: status === 'failed' ? nextRetry : undefined,
    });

    const updated = await this.outboxEventRepo.findOneOrFail({ where: { id } });
    return this.mapOutboxEventEntityToDomain(updated);
  }

  async listPendingOutboxEvents(limit?: number): Promise<OutboxEvent[]> {
    const qb = this.outboxEventRepo.createQueryBuilder('o');

    qb.andWhere('o.status = :status', { status: 'pending' });
    qb.andWhere('o.scheduled_for <= :now', { now: new Date() });
    qb.orderBy('o.scheduled_for', 'ASC');

    if (limit) {
      qb.limit(limit);
    }

    const entities = await qb.getMany();
    return entities.map((e) => this.mapOutboxEventEntityToDomain(e));
  }

  async findStaleOutboxEvents(
    olderThanMinutes: number,
    limit?: number,
  ): Promise<OutboxEvent[]> {
    const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const qb = this.outboxEventRepo.createQueryBuilder('o');
    qb.andWhere('o.status IN (:...statuses)', {
      statuses: ['pending', 'failed'],
    });
    qb.andWhere('o.created_at < :cutoff', { cutoff: cutoffTime });
    qb.orderBy('o.created_at', 'ASC');

    if (limit) {
      qb.limit(limit);
    }

    const entities = await qb.getMany();
    return entities.map((e) => this.mapOutboxEventEntityToDomain(e));
  }

  /**
   * Retention & Cleanup
   */

  async purgeExpiredWebhookLogs(olderThan: Date): Promise<number> {
    const result = await this.webhookLogRepo
      .createQueryBuilder()
      .delete()
      .where('received_at < :olderThan', { olderThan })
      .execute();

    return result.affected || 0;
  }

  async purgeExpiredDispatchLogs(olderThan: Date): Promise<number> {
    const result = await this.dispatchLogRepo
      .createQueryBuilder()
      .delete()
      .where('created_at < :olderThan', { olderThan })
      .execute();

    return result.affected || 0;
  }

  async purgeProcessedOutboxEvents(olderThan: Date): Promise<number> {
    const result = await this.outboxEventRepo
      .createQueryBuilder()
      .delete()
      .where('status = :status', { status: 'delivered' })
      .andWhere('processed_at < :olderThan', { olderThan })
      .execute();

    return result.affected || 0;
  }

  /**
   * Transaction Support
   */

  async beginTransaction(): Promise<any> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    return queryRunner;
  }

  async commitTransaction(txn: any): Promise<void> {
    const queryRunner = txn;
    await queryRunner.commitTransaction();
    await queryRunner.release();
  }

  async rollbackTransaction(txn: any): Promise<void> {
    const queryRunner = txn;
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  }

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
    transactionCount: number;
    webhookLogCount: number;
    auditLogCount: number;
    dispatchLogCount: number;
    outboxEventCount: number;
  }> {
    const [
      transactionCount,
      webhookLogCount,
      auditLogCount,
      dispatchLogCount,
      outboxEventCount,
    ] = await Promise.all([
      this.transactionRepo.count(),
      this.webhookLogRepo.count(),
      this.auditLogRepo.count(),
      this.dispatchLogRepo.count(),
      this.outboxEventRepo.count(),
    ]);

    return {
      transactionCount,
      webhookLogCount,
      auditLogCount,
      dispatchLogCount,
      outboxEventCount,
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
    // Convert Buffer to Record<string, any> if needed
    let rawPayload: Record<string, any> = {};
    if (entity.rawPayload) {
      try {
        rawPayload = JSON.parse(entity.rawPayload.toString());
      } catch {
        rawPayload = { raw: entity.rawPayload.toString() };
      }
    }

    return new WebhookLog(
      entity.id,
      entity.provider,
      entity.providerEventId,
      entity.eventType,
      rawPayload,
      entity.signatureValid,
      entity.processingStatus,
      entity.receivedAt,
      entity.transactionId,
      entity.metadata?.normalizedEvent || null, // Extract normalized event from metadata
      entity.errorMessage || null,
      entity.headers,
      entity.processingDurationMs || null,
    );
  }

  private mapAuditLogEntityToDomain(entity: AuditLogEntity): AuditLog {
    return new AuditLog(
      entity.id,
      entity.transactionId,
      entity.fromStatus ?? entity.stateBefore, // Use fromStatus (DB column) first
      entity.toStatus ?? entity.stateAfter, // Use toStatus (DB column) first
      entity.triggerType,
      entity.createdAt,
      entity.webhookLogId,
      entity.reconciliationResult,
      entity.verificationMethod,
      entity.action
        ? { ...entity.metadata, action: entity.action }
        : entity.metadata, // Include action in metadata
      entity.actor ?? entity.performedBy, // Use actor (DB column) first
      entity.reason,
    );
  }

  private mapDispatchLogEntityToDomain(entity: DispatchLogEntity): DispatchLog {
    return new DispatchLog(
      entity.id,
      entity.transactionId || '',
      entity.eventType as any,
      entity.handlerName,
      entity.status,
      entity.metadata?.isReplay || false, // Extract isReplay from metadata
      entity.attemptedAt,
      entity.error || null,
      entity.durationMs || null,
      entity.metadata?.payload || {}, // Extract payload from metadata
      entity.retryCount,
      entity.metadata,
    );
  }

  private mapOutboxEventEntityToDomain(entity: OutboxEventEntity): OutboxEvent {
    // Map from entity status string to OutboxStatus enum
    let status: any = 'pending';
    if (entity.status === 'delivered') {
      status = 'processed';
    } else if (entity.status === 'failed' || entity.status === 'dead_letter') {
      status = 'failed';
    }

    return new OutboxEvent(
      entity.id,
      entity.aggregateId, // transactionId
      entity.eventType as any,
      entity.payload,
      status,
      entity.createdAt,
      entity.processedAt || null,
      entity.retryCount,
      entity.scheduledFor, // lastAttemptAt
      entity.error || null,
      entity.metadata,
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
