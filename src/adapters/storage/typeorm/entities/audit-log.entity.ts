import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AuditAction, TransactionStatus } from '../../../../core';
import { TransactionEntity } from './transaction.entity';

/**
 * TypeORM entity for AuditLog
 */
@Entity('audit_logs')
@Index(['transactionId'])
@Index(['action'])
@Index(['performedAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaction_id' })
  transactionId: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
  })
  action: AuditAction;

  @Column({ name: 'performed_by' })
  performedBy: string;

  @Column({ name: 'performed_at' })
  performedAt: Date;

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

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => TransactionEntity, (transaction) => transaction.auditLogs)
  @JoinColumn({ name: 'transaction_id' })
  transaction: TransactionEntity;
}
