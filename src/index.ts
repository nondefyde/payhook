/**
 * PayHook - Transaction Truth Engine
 *
 * A database and provider agnostic library for converting payment webhooks
 * into verified, deduplicated, normalized transaction facts.
 */

// Export all core components
export * from './core';

// Export testing utilities from _shared
export { MockWebhookFactory, WebhookScenarios } from './_shared/testing/mock-webhook-factory';
export type { WebhookOptions, WebhookPayload } from './_shared/testing/mock-webhook-factory';

// Export adapters
export * from './adapters/storage/mock';
export * from './adapters/storage/typeorm';
export * from './adapters/providers/mock';
export * from './adapters/providers/paystack';
