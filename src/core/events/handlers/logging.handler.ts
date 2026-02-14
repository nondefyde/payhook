import { SimpleEventHandler } from '../../interfaces';

/**
 * Logging event handler
 * Logs all events for debugging and monitoring
 */
export class LoggingEventHandler {
  constructor(
    private readonly logger: {
      info: (message: string, data?: any) => void;
      error: (message: string, error?: any) => void;
    } = console,
    private readonly logLevel: 'verbose' | 'normal' | 'minimal' = 'normal',
  ) {}

  /**
   * Create the event handler function
   */
  getHandler(): SimpleEventHandler {
    return async (eventType: string, payload: any) => {
      try {
        const logData = this.prepareLogData(eventType, payload);

        this.logger.info(`[PayHook Event] ${eventType}`, logData);
      } catch (error) {
        this.logger.error(
          `[PayHook Event Error] Failed to log event ${eventType}`,
          error,
        );
      }
    };
  }

  /**
   * Prepare log data based on log level
   */
  private prepareLogData(eventType: string, payload: any): any {
    switch (this.logLevel) {
      case 'verbose':
        // Log everything
        return {
          timestamp: new Date().toISOString(),
          eventType,
          payload,
        };

      case 'minimal':
        // Log only essential data
        return {
          timestamp: new Date().toISOString(),
          eventType,
          transactionId: payload.transaction?.id,
          webhookId: payload.webhook?.id,
        };

      case 'normal':
      default:
        // Log moderate amount of data
        return {
          timestamp: new Date().toISOString(),
          eventType,
          transactionId: payload.transaction?.id,
          transactionStatus: payload.transaction?.status,
          webhookId: payload.webhook?.id,
          provider: payload.webhook?.provider,
          normalizedEventType: payload.normalized?.eventType,
        };
    }
  }
}
