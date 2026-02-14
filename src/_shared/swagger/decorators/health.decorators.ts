import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Swagger decorator for basic health check
 */
export const ApiHealthCheck = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Basic health check',
      description: 'Returns service health status and uptime',
    }),
    ApiResponse({
      status: 200,
      description: 'Service is healthy',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'healthy' },
          timestamp: { type: 'string', format: 'date-time' },
          uptime: { type: 'number', description: 'Uptime in seconds' },
        },
      },
    }),
  );
};

/**
 * Swagger decorator for readiness check
 */
export const ApiReadinessCheck = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Readiness check with dependency status',
      description:
        'Checks if service and all dependencies are ready to handle requests',
    }),
    ApiResponse({
      status: 200,
      description: 'Service readiness status',
      schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['ready', 'not_ready'],
            example: 'ready',
          },
          checks: {
            type: 'object',
            properties: {
              database: { type: 'boolean', example: true },
              pipeline: { type: 'boolean', example: true },
            },
          },
          details: {
            type: 'object',
            properties: {
              database: { type: 'string', example: 'connected' },
              pipeline: {
                type: 'object',
                properties: {
                  stages: { type: 'array', items: { type: 'string' } },
                  configuration: { type: 'object' },
                },
              },
            },
          },
        },
      },
    }),
  );
};

/**
 * Swagger decorator for service statistics
 */
export const ApiServiceStatistics = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Get service statistics',
      description:
        'Returns comprehensive statistics about service usage and performance',
    }),
    ApiResponse({
      status: 200,
      description: 'Service statistics',
      schema: {
        type: 'object',
        properties: {
          storage: {
            type: 'object',
            properties: {
              transactionCount: { type: 'number' },
              webhookLogCount: { type: 'number' },
              auditLogCount: { type: 'number' },
              dispatchLogCount: { type: 'number' },
              outboxEventCount: { type: 'number' },
            },
          },
          pipeline: {
            type: 'object',
            properties: {
              stages: { type: 'array', items: { type: 'string' } },
              configuration: {
                type: 'object',
                properties: {
                  skipVerification: { type: 'boolean' },
                  storeRawPayload: { type: 'boolean' },
                  useOutbox: { type: 'boolean' },
                  timeoutMs: { type: 'number' },
                },
              },
            },
          },
          runtime: {
            type: 'object',
            properties: {
              uptime: { type: 'number' },
              memory: {
                type: 'object',
                properties: {
                  rss: { type: 'number' },
                  heapTotal: { type: 'number' },
                  heapUsed: { type: 'number' },
                  external: { type: 'number' },
                },
              },
              node: { type: 'string', example: 'v18.12.0' },
            },
          },
        },
      },
    }),
  );
};
