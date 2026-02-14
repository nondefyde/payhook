import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * TypeORM entity for OutboxEvent
 */
@Entity('outbox_events')
@Index(['status', 'scheduledFor'])
@Index(['aggregateId', 'aggregateType'])
@Index(['eventType'])
@Index(['createdAt'])
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'aggregate_id' })
  aggregateId: string;

  @Column({ name: 'aggregate_type' })
  aggregateType: string;

  @Column({ type: 'jsonb' })
  payload: any;

  @Column({
    type: 'enum',
    enum: ['pending', 'processing', 'delivered', 'failed', 'dead_letter'],
    default: 'pending',
  })
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'dead_letter';

  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ name: 'max_retries', default: 3 })
  maxRetries: number;

  @Column({ name: 'scheduled_for', default: () => 'CURRENT_TIMESTAMP' })
  scheduledFor: Date;

  @Column({ name: 'processed_at', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
