import { Controller, Get, Inject, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { StorageAdapter, WebhookProcessor } from '../../../core';
import { STORAGE_ADAPTER, WEBHOOK_PROCESSOR } from '../constants';
import {
  ApiHealthCheck,
  ApiReadinessCheck,
  ApiServiceStatistics,
} from '../../../_shared/swagger/decorators';

/**
 * Health Controller
 * Using shared Swagger decorators for cleaner code and better maintainability
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(STORAGE_ADAPTER)
    private readonly storageAdapter: StorageAdapter,
    @Inject(WEBHOOK_PROCESSOR)
    private readonly webhookProcessor: WebhookProcessor,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiHealthCheck()
  async health(): Promise<{
    status: string;
    timestamp: Date;
    uptime: number;
  }> {
    return {
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  @ApiReadinessCheck()
  async readiness(): Promise<{
    status: string;
    checks: {
      database: boolean;
      pipeline: boolean;
    };
    details?: any;
  }> {
    const databaseHealthy = await this.storageAdapter.isHealthy();
    const pipelineStats = this.webhookProcessor.getStatistics();

    const allHealthy = databaseHealthy;

    return {
      status: allHealthy ? 'ready' : 'not_ready',
      checks: {
        database: databaseHealthy,
        pipeline: true, // Pipeline is always ready if instantiated
      },
      details: {
        pipeline: pipelineStats,
        database: databaseHealthy ? 'connected' : 'disconnected',
      },
    };
  }

  @Get('stats')
  @ApiServiceStatistics()
  async statistics(): Promise<any> {
    const storageStats = await this.storageAdapter.getStatistics();
    const pipelineStats = this.webhookProcessor.getStatistics();

    return {
      storage: storageStats,
      pipeline: pipelineStats,
      runtime: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node: process.version,
      },
    };
  }
}
