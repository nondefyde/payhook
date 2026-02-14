/**
 * PayHook Webhook Processing Pipeline
 *
 * The 7-layer trust boundary that processes incoming webhooks:
 * 1. Inbound - Capture raw body and headers
 * 2. Verification - Validate webhook signature
 * 3. Normalization - Map to unified schema
 * 4. Persist Claim - Store webhook log
 * 5. Deduplication - Check for duplicates
 * 6. State Engine - Apply state transitions
 * 7. Dispatch - Emit normalized events
 */

// Main processor
export { WebhookProcessor } from './webhook-processor';

// Pipeline types
export * from './types';

// Individual stages (for testing or custom pipelines)
export { VerificationStage } from './stages/verification.stage';
export { NormalizationStage } from './stages/normalization.stage';
export { PersistClaimStage } from './stages/persist-claim.stage';
export { DeduplicationStage } from './stages/deduplication.stage';
export { StateEngineStage } from './stages/state-engine.stage';
export { DispatchStage } from './stages/dispatch.stage';
