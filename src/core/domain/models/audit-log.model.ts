import {
  TransactionStatus,
  TriggerType,
  ReconciliationResult,
  VerificationMethod,
} from '../enums';

/**
 * AuditLog domain model - append-only record of every state transition
 * Provides complete traceability of how transaction state evolved
 */
export class AuditLog {
  constructor(
    public readonly id: string,
    public readonly transactionId: string,
    public readonly fromStatus: TransactionStatus | null,
    public readonly toStatus: TransactionStatus,
    public readonly triggerType: TriggerType,
    public readonly createdAt: Date = new Date(),
    public readonly webhookLogId: string | null = null,
    public readonly reconciliationResult: ReconciliationResult | null = null,
    public readonly verificationMethod: VerificationMethod | null = null,
    public readonly metadata: Record<string, any> = {},
    public readonly actor: string | null = null,
    public readonly reason: string | null = null,
  ) {}

  /**
   * Alias properties for compatibility
   */
  get stateBefore(): TransactionStatus | null {
    return this.fromStatus;
  }

  get stateAfter(): TransactionStatus {
    return this.toStatus;
  }

  get performedAt(): Date {
    return this.createdAt;
  }

  /**
   * Check if this was an initial creation
   */
  isCreation(): boolean {
    return this.fromStatus === null;
  }

  /**
   * Check if this was triggered by a webhook
   */
  isWebhookTriggered(): boolean {
    return this.triggerType === TriggerType.WEBHOOK;
  }

  /**
   * Check if this was triggered by reconciliation
   */
  isReconciliationTriggered(): boolean {
    return this.triggerType === TriggerType.RECONCILIATION;
  }

  /**
   * Check if this was a late match
   */
  isLateMatch(): boolean {
    return this.triggerType === TriggerType.LATE_MATCH;
  }

  /**
   * Check if reconciliation confirmed the state
   */
  reconciliationConfirmed(): boolean {
    return this.reconciliationResult === ReconciliationResult.CONFIRMED;
  }

  /**
   * Check if reconciliation found divergence
   */
  reconciliationDiverged(): boolean {
    return this.reconciliationResult === ReconciliationResult.DIVERGENCE;
  }

  /**
   * Get a human-readable description of the transition
   */
  getDescription(): string {
    const from = this.fromStatus || 'creation';
    const trigger = this.triggerType.replace('_', ' ');
    let description = `Transitioned from ${from} to ${this.toStatus} via ${trigger}`;

    if (this.reconciliationResult) {
      description += ` (reconciliation: ${this.reconciliationResult})`;
    }

    if (this.actor) {
      description += ` by ${this.actor}`;
    }

    if (this.reason) {
      description += `: ${this.reason}`;
    }

    return description;
  }

  /**
   * Create an audit entry for transaction creation
   */
  static forCreation(
    id: string,
    transactionId: string,
    initialStatus: TransactionStatus,
    metadata: Record<string, any> = {},
  ): AuditLog {
    return new AuditLog(
      id,
      transactionId,
      null,
      initialStatus,
      TriggerType.MANUAL,
      new Date(),
      null,
      null,
      null,
      { ...metadata, action: 'creation' },
      'system',
      'Transaction created',
    );
  }

  /**
   * Create an audit entry for webhook-triggered transition
   */
  static forWebhookTransition(
    id: string,
    transactionId: string,
    fromStatus: TransactionStatus,
    toStatus: TransactionStatus,
    webhookLogId: string,
    verificationMethod: VerificationMethod = VerificationMethod.WEBHOOK_ONLY,
    metadata: Record<string, any> = {},
  ): AuditLog {
    return new AuditLog(
      id,
      transactionId,
      fromStatus,
      toStatus,
      TriggerType.WEBHOOK,
      new Date(),
      webhookLogId,
      null,
      verificationMethod,
      metadata,
      'webhook',
      'State updated from webhook',
    );
  }

  /**
   * Create an audit entry for reconciliation
   */
  static forReconciliation(
    id: string,
    transactionId: string,
    fromStatus: TransactionStatus,
    toStatus: TransactionStatus,
    result: ReconciliationResult,
    metadata: Record<string, any> = {},
  ): AuditLog {
    return new AuditLog(
      id,
      transactionId,
      fromStatus,
      toStatus,
      TriggerType.RECONCILIATION,
      new Date(),
      null,
      result,
      VerificationMethod.RECONCILED,
      metadata,
      'reconciliation',
      `Reconciliation result: ${result}`,
    );
  }

  /**
   * Create an audit entry for late-matched webhook
   */
  static forLateMatch(
    id: string,
    transactionId: string,
    fromStatus: TransactionStatus,
    toStatus: TransactionStatus,
    webhookLogId: string,
    metadata: Record<string, any> = {},
  ): AuditLog {
    return new AuditLog(
      id,
      transactionId,
      fromStatus,
      toStatus,
      TriggerType.LATE_MATCH,
      new Date(),
      webhookLogId,
      null,
      VerificationMethod.WEBHOOK_ONLY,
      metadata,
      'late_match',
      'Webhook matched after initial receipt',
    );
  }

  /**
   * Convert to plain object for storage/serialization
   */
  toPlainObject(): Record<string, any> {
    return {
      id: this.id,
      transactionId: this.transactionId,
      fromStatus: this.fromStatus,
      toStatus: this.toStatus,
      triggerType: this.triggerType,
      webhookLogId: this.webhookLogId,
      reconciliationResult: this.reconciliationResult,
      verificationMethod: this.verificationMethod,
      metadata: this.metadata,
      actor: this.actor,
      reason: this.reason,
      createdAt: this.createdAt,
    };
  }

  /**
   * Create from plain object (for hydration from storage)
   */
  static fromPlainObject(data: Record<string, any>): AuditLog {
    return new AuditLog(
      data.id,
      data.transactionId,
      data.fromStatus,
      data.toStatus,
      data.triggerType,
      new Date(data.createdAt),
      data.webhookLogId,
      data.reconciliationResult,
      data.verificationMethod,
      data.metadata,
      data.actor,
      data.reason,
    );
  }
}
