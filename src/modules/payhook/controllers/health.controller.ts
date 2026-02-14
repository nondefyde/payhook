import {
  Controller,
  Get,
  Inject,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StorageAdapter, WebhookProcessor } from '../../../core';

/**
 * Health Controller
 *
 * Provides health checks and statistics
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(StorageAdapter)
    private readonly storageAdapter: StorageAdapter,
    @Inject(WebhookProcessor)
    private readonly webhookProcessor: WebhookProcessor,
  ) {}

  /**
   * Basic health check
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Basic health check' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
  })
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

  /**
   * Detailed health check including dependencies
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check with dependency status' })
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

  /**
   * Get service statistics
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get service statistics' })
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