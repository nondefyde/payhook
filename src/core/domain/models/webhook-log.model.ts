import { ProcessingStatus } from '../enums';

/**
 * WebhookLog domain model - append-only record of every webhook received
 * Stores both valid and invalid webhooks for complete auditability
 */
export class WebhookLog {
  constructor(
    public readonly id: string,
    public readonly provider: string,
    public readonly providerEventId: string,
    public readonly eventType: string,
    public rawPayload: Record<string, any>,
    public readonly signatureValid: boolean,
    public processingStatus: ProcessingStatus,
    public readonly receivedAt: Date = new Date(),
    public transactionId: string | null = null,
    public normalizedEvent: string | null = null,
    public errorMessage: string | null = null,
    public headers: Record<string, string> = {},
    public processingDurationMs: number | null = null,
  ) {}

  /**
   * Get metadata (for compatibility)
   */
  get metadata(): Record<string, any> {
    return {
      normalizedEvent: this.normalizedEvent
        ? JSON.parse(this.normalizedEvent)
        : null,
      providerEventId: this.providerEventId,
      eventType: this.eventType,
    };
  }

  /**
   * Check if webhook was successfully processed
   */
  wasProcessed(): boolean {
    return this.processingStatus === ProcessingStatus.PROCESSED;
  }

  /**
   * Check if webhook is unmatched (no linked transaction)
   */
  isUnmatched(): boolean {
    return this.processingStatus === ProcessingStatus.UNMATCHED;
  }

  /**
   * Check if webhook failed verification
   */
  failedVerification(): boolean {
    return this.processingStatus === ProcessingStatus.SIGNATURE_FAILED;
  }

  /**
   * Check if webhook is a duplicate
   */
  isDuplicate(): boolean {
    return this.processingStatus === ProcessingStatus.DUPLICATE;
  }

  /**
   * Link to a transaction (for late matching)
   */
  linkToTransaction(transactionId: string): void {
    if (this.transactionId) {
      throw new Error('Webhook already linked to a transaction');
    }
    this.transactionId = transactionId;
  }

  /**
   * Mark as processed with a transaction
   */
  markAsProcessed(transactionId: string, normalizedEvent?: string): void {
    this.transactionId = transactionId;
    this.processingStatus = ProcessingStatus.PROCESSED;
    if (normalizedEvent) {
      this.normalizedEvent = normalizedEvent;
    }
  }

  /**
   * Mark as duplicate
   */
  markAsDuplicate(): void {
    this.processingStatus = ProcessingStatus.DUPLICATE;
  }

  /**
   * Mark as unmatched
   */
  markAsUnmatched(normalizedEvent?: string): void {
    this.processingStatus = ProcessingStatus.UNMATCHED;
    if (normalizedEvent) {
      this.normalizedEvent = normalizedEvent;
    }
  }

  /**
   * Mark as failed with error
   */
  markAsFailed(status: ProcessingStatus, errorMessage: string): void {
    this.processingStatus = status;
    this.errorMessage = errorMessage;
  }

  /**
   * Set processing duration
   */
  setProcessingDuration(startTime: Date): void {
    this.processingDurationMs = Date.now() - startTime.getTime();
  }

  /**
   * Get idempotency key for deduplication
   */
  getIdempotencyKey(): string {
    return `${this.provider}:${this.providerEventId}`;
  }

  /**
   * Redact sensitive fields from raw payload
   */
  redactSensitiveData(redactKeys: string[]): void {
    const redact = (obj: any, keys: string[]): any => {
      if (!obj || typeof obj !== 'object') return obj;

      const result = Array.isArray(obj) ? [...obj] : { ...obj };

      for (const key in result) {
        if (keys.includes(key)) {
          result[key] = '[REDACTED]';
        } else if (typeof result[key] === 'object') {
          result[key] = redact(result[key], keys);
        }
      }

      return result;
    };

    this.rawPayload = redact(this.rawPayload, redactKeys);
  }

  /**
   * Convert to plain object for storage/serialization
   */
  toPlainObject(): Record<string, any> {
    return {
      id: this.id,
      provider: this.provider,
      providerEventId: this.providerEventId,
      transactionId: this.transactionId,
      eventType: this.eventType,
      normalizedEvent: this.normalizedEvent,
      rawPayload: this.rawPayload,
      signatureValid: this.signatureValid,
      processingStatus: this.processingStatus,
      errorMessage: this.errorMessage,
      headers: this.headers,
      processingDurationMs: this.processingDurationMs,
      receivedAt: this.receivedAt,
    };
  }

  /**
   * Create from plain object (for hydration from storage)
   */
  static fromPlainObject(data: Record<string, any>): WebhookLog {
    return new WebhookLog(
      data.id,
      data.provider,
      data.providerEventId,
      data.eventType,
      data.rawPayload,
      data.signatureValid,
      data.processingStatus,
      new Date(data.receivedAt),
      data.transactionId,
      data.normalizedEvent,
      data.errorMessage,
      data.headers,
      data.processingDurationMs,
    );
  }
}
