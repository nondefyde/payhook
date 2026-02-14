import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import {
  TransactionStatus,
  TriggerType,
  ReconciliationResult,
  VerificationMethod,
  AuditAction,
} from '../../../../core';
import { TransactionEntity } from './transaction.entity';

/**
 * TypeORM entity for AuditLog
 */
@Entity('audit_logs')
@Index(['transactionId'])
@Index(['triggerType'])
@Index(['createdAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaction_id' })
  transactionId: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    name: 'from_status',
    nullable: true,
  })
  fromStatus: TransactionStatus | null;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    name: 'to_status',
  })
  toStatus: TransactionStatus;

  @Column({
    type: 'enum',
    enum: TriggerType,
    name: 'trigger_type',
  })
  triggerType: TriggerType;

  @Column({ name: 'webhook_log_id', nullable: true })
  webhookLogId: string | null;

  @Column({
    type: 'enum',
    enum: ReconciliationResult,
    name: 'reconciliation_result',
    nullable: true,
  })
  reconciliationResult: ReconciliationResult | null;

  @Column({
    type: 'enum',
    enum: VerificationMethod,
    name: 'verification_method',
    nullable: true,
  })
  verificationMethod: VerificationMethod | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @Column({ nullable: true })
  actor: string | null;

  @Column({ nullable: true })
  reason: string | null;

  @Column({ nullable: true })
  action: AuditAction | null;

  @Column({ nullable: true, name: 'performed_by' })
  performedBy: string | null;

  @Column({ nullable: true, name: 'performed_at' })
  performedAt: Date | null;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    name: 'state_before',
    nullable: true,
  })
  stateBefore: TransactionStatus | null;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    name: 'state_after',
    nullable: true,
  })
  stateAfter: TransactionStatus | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => TransactionEntity, (transaction) => transaction.auditLogs)
  @JoinColumn({ name: 'transaction_id' })
  transaction: TransactionEntity;
}
