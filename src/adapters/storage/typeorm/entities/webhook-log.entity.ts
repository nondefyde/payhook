import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProcessingStatus } from '../../../../core';
import { TransactionEntity } from './transaction.entity';

/**
 * TypeORM entity for WebhookLog
 */
@Entity('webhook_logs')
@Index(['provider', 'providerEventId'], { unique: true })
@Index(['transactionId'])
@Index(['processingStatus'])
@Index(['receivedAt'])
export class WebhookLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  provider: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'provider_event_id' })
  providerEventId: string;

  @Column({ type: 'bytea', nullable: true, name: 'raw_payload' })
  rawPayload: Buffer | null;

  @Column({ type: 'jsonb', default: {} })
  headers: Record<string, string>;

  @Column({ name: 'signature_valid', default: false })
  signatureValid: boolean;

  @Column({
    type: 'enum',
    enum: ProcessingStatus,
    name: 'processing_status',
  })
  processingStatus: ProcessingStatus;

  @Column({ name: 'processing_duration_ms', nullable: true })
  processingDurationMs: number;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ name: 'received_at' })
  receivedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @Column({ name: 'transaction_id', nullable: true })
  transactionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(
    () => TransactionEntity,
    (transaction) => transaction.webhookLogs,
    {
      nullable: true,
    },
  )
  @JoinColumn({ name: 'transaction_id' })
  transaction: TransactionEntity | null;
}
