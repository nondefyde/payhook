/**
 * PayHook - Transaction Truth Engine
 *
 * A database and provider agnostic library for converting payment webhooks
 * into verified, deduplicated, normalized transaction facts.
 */

// Export all core components
export * from './core';

// Export testing utilities
export * from './testing';

// Export adapters
export * from './adapters/storage/mock';
export * from './adapters/storage/typeorm';
export * from './adapters/providers/mock';
export * from './adapters/providers/paystack';

// Export NestJS module
export * from './modules/payhook';