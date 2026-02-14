import { TransactionStatus, VerificationMethod } from '../enums';
import { Money } from '../value-objects/money.vo';

/**
 * Transaction domain model - the source of truth for payment state
 * Pure TypeScript class with no framework dependencies
 */
export class Transaction {
  constructor(
    public readonly id: string,
    public readonly applicationRef: string,
    public readonly provider: string,
    public status: TransactionStatus,
    public readonly money: Money,
    public providerRef: string | null = null,
    public verificationMethod: VerificationMethod = VerificationMethod.WEBHOOK_ONLY,
    public metadata: Record<string, any> = {},
    public readonly createdAt: Date = new Date(),
    public updatedAt: Date = new Date(),
    public providerCreatedAt: Date | null = null,
  ) {}

  /**
   * Get amount in smallest currency unit
   */
  get amount(): number {
    return this.money.amount;
  }

  /**
   * Get ISO currency code
   */
  get currency(): string {
    return this.money.currency;
  }

  /**
   * Check if transaction is in a settled state
   */
  isSettled(): boolean {
    return (
      this.status === TransactionStatus.SUCCESSFUL ||
      this.status === TransactionStatus.PARTIALLY_REFUNDED ||
      this.isTerminal()
    );
  }

  /**
   * Check if transaction is in a terminal state
   */
  isTerminal(): boolean {
    return [
      TransactionStatus.FAILED,
      TransactionStatus.ABANDONED,
      TransactionStatus.REFUNDED,
      TransactionStatus.RESOLVED_WON,
      TransactionStatus.RESOLVED_LOST,
    ].includes(this.status);
  }

  /**
   * Check if transaction can transition to a new status
   * (actual validation will be done by state machine)
   */
  canTransitionTo(newStatus: TransactionStatus): boolean {
    // Terminal states cannot transition
    if (this.isTerminal()) {
      return false;
    }
    // Detailed validation delegated to state machine
    return true;
  }

  /**
   * Update transaction status (should only be called by state machine)
   */
  updateStatus(
    newStatus: TransactionStatus,
    verificationMethod?: VerificationMethod,
  ): void {
    this.status = newStatus;
    this.updatedAt = new Date();
    if (verificationMethod) {
      this.verificationMethod = verificationMethod;
    }
  }

  /**
   * Link provider reference (typically when transitioning to processing)
   */
  linkProviderRef(providerRef: string): void {
    if (this.providerRef) {
      throw new Error('Provider reference already set');
    }
    this.providerRef = providerRef;
    this.updatedAt = new Date();
  }

  /**
   * Update verification method (when reconciling or verifying via API)
   */
  updateVerificationMethod(method: VerificationMethod): void {
    // Only upgrade verification confidence, never downgrade
    const confidenceLevels = {
      [VerificationMethod.WEBHOOK_ONLY]: 1,
      [VerificationMethod.API_VERIFIED]: 2,
      [VerificationMethod.RECONCILED]: 2,
    };

    if (confidenceLevels[method] > confidenceLevels[this.verificationMethod]) {
      this.verificationMethod = method;
      this.updatedAt = new Date();
    }
  }

  /**
   * Create a snapshot for audit logging
   */
  toAuditSnapshot(): Record<string, any> {
    return {
      id: this.id,
      applicationRef: this.applicationRef,
      providerRef: this.providerRef,
      provider: this.provider,
      status: this.status,
      amount: this.amount,
      currency: this.currency,
      verificationMethod: this.verificationMethod,
      metadata: this.metadata,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Convert to plain object for storage/serialization
   */
  toPlainObject(): Record<string, any> {
    return {
      id: this.id,
      applicationRef: this.applicationRef,
      providerRef: this.providerRef,
      provider: this.provider,
      status: this.status,
      amount: this.amount,
      currency: this.currency,
      verificationMethod: this.verificationMethod,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      providerCreatedAt: this.providerCreatedAt,
    };
  }

  /**
   * Create from plain object (for hydration from storage)
   */
  static fromPlainObject(data: Record<string, any>): Transaction {
    const money = new Money(data.amount, data.currency);
    return new Transaction(
      data.id,
      data.applicationRef,
      data.provider,
      data.status,
      money,
      data.providerRef,
      data.verificationMethod,
      data.metadata,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.providerCreatedAt ? new Date(data.providerCreatedAt) : null,
    );
  }
}