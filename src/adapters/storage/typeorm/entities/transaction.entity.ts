import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
  VersionColumn,
} from 'typeorm';
import { TransactionStatus, VerificationMethod } from '../../../../core';
import { WebhookLogEntity } from './webhook-log.entity';
import { AuditLogEntity } from './audit-log.entity';

/**
 * TypeORM entity for Transaction
 */
@Entity('transactions')
@Index(['applicationRef'], { unique: true })
@Index(['provider', 'providerRef'])
@Index(['status'])
@Index(['createdAt'])
export class TransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'application_ref', unique: true })
  applicationRef: string;

  @Column()
  provider: string;

  @Column({ name: 'provider_ref', nullable: true })
  providerRef: string | null;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: 'bigint' })
  amount: number;

  @Column({ length: 3 })
  currency: string;

  @Column({
    type: 'enum',
    enum: VerificationMethod,
    default: VerificationMethod.WEBHOOK_ONLY,
    name: 'verification_method',
  })
  verificationMethod: VerificationMethod;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @VersionColumn({ name: 'version' })
  version: number;

  // Relations
  @OneToMany(() => WebhookLogEntity, (webhook) => webhook.transaction)
  webhookLogs: WebhookLogEntity[];

  @OneToMany(() => AuditLogEntity, (audit) => audit.transaction)
  auditLogs: AuditLogEntity[];
}
