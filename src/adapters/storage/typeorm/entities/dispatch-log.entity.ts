import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DispatchStatus } from '../../../../core';

/**
 * TypeORM entity for DispatchLog
 */
@Entity('dispatch_logs')
@Index(['webhookLogId'])
@Index(['transactionId'])
@Index(['status'])
@Index(['attemptedAt'])
export class DispatchLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'webhook_log_id', nullable: true })
  webhookLogId: string | null;

  @Column({ name: 'transaction_id', nullable: true })
  transactionId: string | null;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'handler_name' })
  handlerName: string;

  @Column({
    type: 'enum',
    enum: DispatchStatus,
  })
  status: DispatchStatus;

  @Column({ name: 'attempted_at' })
  attemptedAt: Date;

  @Column({ name: 'completed_at', nullable: true })
  completedAt: Date;

  @Column({ name: 'duration_ms', nullable: true })
  durationMs: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ name: 'next_retry_at', nullable: true })
  nextRetryAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
