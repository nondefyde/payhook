# PayHook v0.1.0 — Acceptance Criteria

**Derived from PRD v0.5.0**

| Field   | Value               |
| ------- | ------------------- |
| Author  | Emmanuel Okafor     |
| Date    | February 2026       |
| Status  | Draft               |

Each criterion is written as a testable statement. A criterion passes only when the described behaviour is demonstrably true in code (unit test, integration test, or manual verification as noted).

---

## 1. Module Setup & DX

### AC-1.1 Installation & Registration

- [ ] `npm install @payhook/core` installs successfully with zero peer-dependency errors on Node 18+.
- [ ] `PayHookModule.forRoot({ providers, typeorm })` registers all core services, controllers, and entities in a NestJS application.
- [ ] The module auto-registers a webhook controller at `POST /webhooks/:provider`.
- [ ] The module accepts a `migrations: 'auto' | 'manual'` option. When `auto`, migrations run on module init. When `manual`, migration files are exported for the host to include in its own pipeline.

### AC-1.2 Time to First Truth

- [ ] A developer with an existing NestJS + TypeORM app can go from `npm install` to receiving a verified `payment.successful` event in under 10 minutes, following the setup guide.

### AC-1.3 Package Exports

- [ ] `import { PayHookModule, TransactionService } from '@payhook/core'` resolves correctly.
- [ ] `import { MockProviderAdapter, MockWebhookFactory } from '@payhook/core/testing'` resolves correctly.
- [ ] `import { PayHookRateLimitGuard, PayHookBodySizeGuard, PayHookIpGuard } from '@payhook/core/middleware'` resolves correctly.
- [ ] Production bundles that do not import `/testing` or `/middleware` contain zero code from those subpaths (tree-shakeable).

---

## 2. Processing Pipeline

### AC-2.1 Inbound Layer

- [ ] The webhook controller accepts `POST /webhooks/:provider` with a raw body.
- [ ] The raw body is preserved as a `Buffer` — no JSON re-stringification occurs before signature verification.
- [ ] An unknown `:provider` value returns `404` and no webhook log is created.

### AC-2.2 Signature Verification

- [ ] Every inbound webhook is signature-verified using the provider adapter's `verifySignature()` method.
- [ ] Signature verification cannot be disabled via configuration.
- [ ] Signature comparison uses a constant-time algorithm (e.g., `crypto.timingSafeEqual`).
- [ ] A webhook with an invalid signature is persisted to the webhook log with `signature_valid=false` and `processing_status=signature_failed`.
- [ ] A webhook with an invalid signature never triggers a state transition or event dispatch.

### AC-2.3 Normalization

- [ ] A webhook that passes signature verification but fails normalization is persisted with `processing_status=normalization_failed` and `normalized_event=null`.
- [ ] The raw payload is still stored even when normalization fails.
- [ ] A normalization failure never triggers a state transition or event dispatch.

### AC-2.4 Persistence

- [ ] Every inbound webhook — valid or invalid — results in exactly one row in the webhook log table.
- [ ] The `raw_payload` field contains the exact body as received (subject to redaction config).

### AC-2.5 Deduplication

- [ ] A duplicate webhook (same `provider` + `provider_event_id`) is persisted with `processing_status=duplicate`.
- [ ] A duplicate webhook never triggers a state transition or event dispatch.
- [ ] The unique constraint `(provider, provider_event_id)` is enforced at the database level.

### AC-2.6 State Engine

- [ ] Only transitions defined in the state machine (PRD §5.2) are accepted.
- [ ] An invalid transition attempt is persisted in the webhook log with `processing_status=transition_rejected`.
- [ ] An invalid transition attempt creates an audit log entry recording the rejection.
- [ ] No direct writes to the `status` column are possible outside the state engine.

### AC-2.7 Dispatch

- [ ] Event handlers decorated with `@OnPaymentEvent(eventType)` are invoked only after the state transition and audit entry have been committed to the database.
- [ ] A handler that throws an exception does not roll back or alter the transaction state or audit trail.
- [ ] A handler failure is recorded in the dispatch log with `status=failed` and `error_message` populated.
- [ ] A successful handler execution is recorded in the dispatch log with `status=success`.

---

## 3. Claim Fate Classification

- [ ] Every webhook receives exactly one of these fates: `processed`, `duplicate`, `signature_failed`, `normalization_failed`, `unmatched`, `transition_rejected`, `parse_error`.
- [ ] No webhook is silently dropped — there is no code path where an inbound POST results in zero database writes.
- [ ] A payload that cannot be parsed at all (e.g., invalid JSON) is persisted with `processing_status=parse_error`.

---

## 4. Transaction State Machine

### AC-4.1 Valid Transitions

- [ ] `pending → processing` via `markAsProcessing()`.
- [ ] `processing → successful` via verified webhook or provider verification.
- [ ] `processing → failed` via verified webhook or provider verification.
- [ ] `processing → abandoned` via host-triggered reconciliation or manual action.
- [ ] `successful → refunded` via refund webhook (full).
- [ ] `successful → partially_refunded` via refund webhook (partial).
- [ ] `successful → disputed` via dispute webhook.
- [ ] `disputed → resolved_won` via dispute resolution webhook.
- [ ] `disputed → resolved_lost` via dispute resolution webhook.

### AC-4.2 Terminal States

- [ ] `failed` is terminal. No transition out of `failed` is accepted.
- [ ] `abandoned` is terminal. No transition out of `abandoned` is accepted.
- [ ] `refunded` is terminal.
- [ ] `resolved_won` is terminal.
- [ ] `resolved_lost` is terminal.

### AC-4.3 Atomic `markAsProcessing()`

- [ ] `markAsProcessing(id, { providerRef })` atomically sets `provider_ref`, transitions status to `processing`, and writes an audit entry — all in one database transaction.
- [ ] If the transaction is not in `pending` state, `markAsProcessing()` rejects with an error and makes no changes.
- [ ] After `markAsProcessing()`, querying the transaction returns `status=processing` and `providerRef` set.

### AC-4.4 No Oscillation

- [ ] A failed payment that is retried by the user requires a new `createTransaction()` call. Attempting to transition a `failed` transaction back to `processing` is rejected.

---

## 5. Query-First Public API

### AC-5.1 `createTransaction(dto)`

- [ ] Creates a transaction in `pending` state.
- [ ] `application_ref` must be unique. A duplicate returns an error.
- [ ] `provider_ref` is null on creation.
- [ ] Returns the created transaction with all fields populated.

### AC-5.2 `getTransaction(ref)`

- [ ] Accepts either `applicationRef` or `providerRef` as lookup key.
- [ ] Returns the full `TransactionResponse` including `verificationMethod` and `isSettled`.
- [ ] Returns `null` or throws `NotFoundException` when no transaction matches.

### AC-5.3 `getAuditTrail(ref)`

- [ ] Returns all audit entries for a transaction in chronological order.
- [ ] Each entry includes `from_status`, `to_status`, `trigger_type`, and `created_at`.

### AC-5.4 `listTransactionsByStatus(status, pagination)`

- [ ] Returns paginated transactions filtered by the given status.
- [ ] Pagination includes `total`, `page`, `pageSize`, and `items`.

### AC-5.5 `isSettled(ref)`

- [ ] Returns `true` for terminal states: `failed`, `abandoned`, `refunded`, `partially_refunded`, `resolved_won`, `resolved_lost`.
- [ ] Returns `false` for non-terminal states: `pending`, `processing`, `successful`, `disputed`.

### AC-5.6 `scanStaleTransactions(olderThanMinutes)`

- [ ] Returns an array of `applicationRef` values for transactions in `processing` state where `updated_at` is older than the given threshold.
- [ ] Does not modify any state. The host decides what to do with the results.

---

## 6. Reconciliation

### AC-6.1 `reconcile(ref)`

- [ ] Calls the provider adapter's `verifyWithProvider()` method.
- [ ] If states match: creates an audit entry with `trigger_type=reconciliation` and `reconciliation_result=confirmed`. No state change.
- [ ] If provider is ahead: applies the missing transition, creates an audit entry with `reconciliation_result=advanced`, updates `verification_method=reconciled`.
- [ ] If provider is behind: creates an audit entry with `reconciliation_result=divergence`. No state change. Returns divergence details.
- [ ] If provider is unreachable: creates an audit entry with `reconciliation_result=error`. No state change. Returns error details.
- [ ] Reconciliation never rolls back state. A transaction can only move forward.

### AC-6.2 Reconciliation Audit

- [ ] Every `reconcile()` call produces exactly one audit entry, regardless of outcome.

---

## 7. Replay & Outbox

### AC-7.1 `replayEvents(ref)`

- [ ] Fetches the full audit trail for the transaction.
- [ ] Re-dispatches normalized events in chronological order.
- [ ] Each replay dispatch is recorded in the dispatch log with `is_replay=true`.
- [ ] Replay does not create new audit entries or modify transaction state.

### AC-7.2 Outbox Mode

- [ ] When `outbox: { enabled: true }`, every dispatched event is written to the `outbox_events` table within the same database transaction as the state change.
- [ ] When `outbox: { enabled: false }` (default), no outbox table is written to.
- [ ] `listPendingOutbox(pagination)` returns outbox entries with `status=pending`.
- [ ] `markOutboxProcessed(id)` sets the entry to `status=processed` and populates `processed_at`.

---

## 8. Unmatched Webhooks

### AC-8.1 Persistence

- [ ] A webhook that passes verification and normalization but matches no transaction is persisted with `processing_status=unmatched` and `transaction_id=null`.
- [ ] No state transition or event dispatch occurs for unmatched webhooks.

### AC-8.2 `linkUnmatchedWebhook(webhookLogId, transactionId)`

- [ ] If the webhook log is not `unmatched`, returns an error.
- [ ] If the transaction does not exist, returns `not_found`.
- [ ] If the transition is valid: applies it, writes an audit entry with `trigger_type=late_match`, updates the webhook log's `transaction_id`, dispatches the event.
- [ ] If the transition is invalid (transaction already advanced past): returns `transition_rejected`, makes no changes.

### AC-8.3 `listUnmatchedWebhooks(provider?, pagination)`

- [ ] Returns paginated webhook log entries with `processing_status=unmatched`.
- [ ] Optionally filterable by provider.

---

## 9. Concurrency & Integrity

### AC-9.1 Row-Level Locking

- [ ] When applying a state transition, a `SELECT ... FOR UPDATE` lock is acquired on the transaction row.
- [ ] Two concurrent webhooks targeting the same transaction do not both succeed in applying a transition. One is classified as `duplicate` or `transition_rejected`.

### AC-9.2 Atomic Writes

- [ ] State transition + audit entry are written in a single database transaction. If the audit write fails, the state change rolls back.
- [ ] `markAsProcessing()` sets `provider_ref` + status + audit entry atomically.
- [ ] `linkUnmatchedWebhook()` updates webhook log + applies transition + writes audit atomically.
- [ ] When outbox is enabled, the outbox write is included in the same transaction.

### AC-9.3 Unique Constraints

- [ ] `application_ref` has a unique constraint on the transactions table.
- [ ] `provider_ref` has a partial unique constraint (unique where not null) on the transactions table.
- [ ] `(provider, provider_event_id)` has a unique constraint on the webhook logs table.
- [ ] Violating any of these constraints returns a clear error, not an unhandled exception.

---

## 10. Data Model

### AC-10.1 Transactions Table

- [ ] Contains all fields defined in PRD §9.1: `id`, `application_ref`, `provider_ref`, `provider`, `status`, `amount`, `currency`, `verification_method`, `metadata`, `created_at`, `updated_at`, `provider_created_at`.
- [ ] `provider_ref` is nullable.
- [ ] `status` is an enum matching the state machine states.
- [ ] `verification_method` is an enum: `webhook_only`, `api_verified`, `reconciled`.

### AC-10.2 Webhook Logs Table

- [ ] Contains all fields defined in PRD §9.2.
- [ ] `transaction_id` is nullable (for unmatched webhooks).
- [ ] `normalized_event` is nullable (for normalization failures).
- [ ] `processing_status` is an enum matching the 7 claim fates.

### AC-10.3 Audit Logs Table

- [ ] Contains all fields defined in PRD §9.3.
- [ ] `trigger_type` includes: `webhook`, `api_verification`, `reconciliation`, `late_match`, `manual`.
- [ ] `reconciliation_result` is nullable (only populated for reconciliation entries).
- [ ] Audit logs are append-only. No update or delete operations exist on this table.

### AC-10.4 Dispatch Logs Table

- [ ] Contains all fields defined in PRD §9.4.
- [ ] `is_replay` boolean distinguishes replay dispatches from original dispatches.

### AC-10.5 Outbox Events Table (Optional)

- [ ] Table is only created when `outbox: { enabled: true }`.
- [ ] Contains fields defined in PRD §6.4.

---

## 11. Normalized Event Contract

### AC-11.1 Schema Stability

- [ ] Every normalized event contains the required fields: `eventType`, `providerRef`, `amount`, `currency`, `providerEventId`.
- [ ] Optional fields (`applicationRef`, `providerTimestamp`, `customerEmail`, `providerMetadata`) are present only when the provider supplies them; otherwise `undefined`.

### AC-11.2 Event Types

- [ ] The following event types are supported: `payment.successful`, `payment.failed`, `payment.abandoned`, `refund.successful`, `refund.failed`, `refund.pending`, `charge.disputed`, `dispute.resolved`.
- [ ] No other event types are dispatched to consumers.

### AC-11.3 `providerMetadata`

- [ ] Provider-specific data that does not map to standard fields is placed in `providerMetadata`.
- [ ] `providerMetadata` has no schema guarantee — it varies by provider.

---

## 12. Verification Confidence

### AC-12.1 `verification_method` Tracking

- [ ] A transaction whose state was set by a webhook alone has `verification_method=webhook_only`.
- [ ] A transaction whose state was confirmed by calling the provider's API has `verification_method=api_verified`.
- [ ] A transaction whose state was set or confirmed via `reconcile()` has `verification_method=reconciled`.

### AC-12.2 `getTransaction()` Response

- [ ] The response includes `verificationMethod` as a string enum.
- [ ] The response includes `isSettled` as a boolean.
- [ ] The response shape matches the `TransactionResponse` interface defined in PRD §10.2.

---

## 13. Paystack Provider Adapter

### AC-13.1 Signature Verification

- [ ] Verifies Paystack webhook signatures using HMAC-SHA512 with the configured secret.
- [ ] Uses constant-time comparison.
- [ ] Supports multi-secret rotation (tries each secret in order).

### AC-13.2 Normalization

- [ ] Maps Paystack `charge.success` to `payment.successful`.
- [ ] Maps Paystack refund events to `refund.successful` / `refund.failed` as appropriate.
- [ ] Maps Paystack dispute events to `charge.disputed` / `dispute.resolved` as appropriate.
- [ ] Extracts `providerRef` (Paystack transaction reference) and `applicationRef` (Paystack metadata reference) correctly.
- [ ] Places unmapped Paystack-specific fields in `providerMetadata`.

### AC-13.3 Idempotency Key Extraction

- [ ] Extracts a unique idempotency key from each Paystack webhook event.

### AC-13.4 Provider Verification

- [ ] `verifyWithProvider(providerRef)` calls `GET /transaction/verify/:reference` on the Paystack API.
- [ ] Returns the provider's transaction status in a normalized format.
- [ ] Handles API errors gracefully (returns error result, does not throw unhandled).

---

## 14. Mock Provider Adapter

- [ ] Implements the full `PaymentProviderAdapter` interface.
- [ ] Generates valid signatures using a deterministic test secret.
- [ ] `MockWebhookFactory` can generate payloads for all normalized event types: `payment.successful`, `payment.failed`, `refund.successful`, `charge.disputed`, `dispute.resolved`.
- [ ] Mock webhooks pass the full processing pipeline when sent to `POST /webhooks/mock`.
- [ ] The mock adapter is only available via `@payhook/core/testing` — it is not registered in production configurations.

---

## 15. Observability

### AC-15.1 Structured Logging

- [ ] All log entries related to webhook processing include `transaction_id`, `application_ref`, `provider_ref`, `provider_event_id` where applicable.
- [ ] Signature failures are logged at `error` level.
- [ ] Transition rejections are logged at `warn` level.
- [ ] Successful transitions are logged at `log` level.
- [ ] Secrets are never included in log output.

### AC-15.2 Lifecycle Hooks

- [ ] `onWebhookFate` hook is called for every inbound webhook with `{ provider, processingStatus, eventType, latencyMs }`.
- [ ] `onTransition` hook is called for every state transition with `{ provider, fromStatus, toStatus, triggerType, transactionId }`.
- [ ] `onDispatchResult` hook is called for every dispatch attempt with `{ eventType, handlerName, status, isReplay, errorMessage? }`.
- [ ] `onReconciliation` hook is called for every reconcile attempt with `{ provider, applicationRef, result, latencyMs }`.
- [ ] All hooks are optional. If not configured, no error is thrown.
- [ ] A hook that throws does not affect pipeline correctness or transaction state.

---

## 16. Security

### AC-16.1 Secret Rotation

- [ ] The `secrets` config accepts an array of strings.
- [ ] During rotation, a webhook signed with the old secret still verifies successfully.
- [ ] The adapter tries secrets in order and stops at the first match.

### AC-16.2 Middleware Helpers

- [ ] `PayHookRateLimitGuard` rejects requests exceeding the configured rate with `429`.
- [ ] `PayHookBodySizeGuard` rejects payloads exceeding the configured size with `413`.
- [ ] `PayHookIpGuard` rejects requests from IPs not in the configured allowlist with `403`.
- [ ] All middleware helpers are opt-in — not applying them does not break PayHook.

---

## 17. Data Retention & Redaction

### AC-17.1 `storeRawPayload`

- [ ] When `storeRawPayload: true` (default), the full raw body is stored in the webhook log.
- [ ] When `storeRawPayload: false`, the `raw_payload` field is set to `null` and only the normalized event is stored.

### AC-17.2 `redactKeys`

- [ ] Configured key paths (e.g., `customer.email`) are replaced with `[REDACTED]` in the stored `raw_payload`.
- [ ] Redaction runs after normalization — normalized fields are extracted before redaction occurs.
- [ ] Redaction does not affect signature verification (which uses the original raw body).

### AC-17.3 `purgeExpiredLogs(config)`

- [ ] Deletes webhook log entries older than `webhookLogDays`.
- [ ] Deletes dispatch log entries older than `dispatchLogDays`.
- [ ] Returns a count of deleted records: `{ webhookLogsDeleted, dispatchLogsDeleted }`.
- [ ] Does not delete audit logs or transactions.
- [ ] Does not run automatically — the host must call it.

---

## 18. Storage Adapter (TypeORM)

- [ ] Implements the full `StorageAdapter` interface.
- [ ] Works with both Postgres and MySQL via the host's existing TypeORM datasource.
- [ ] `updateTransactionStatus()` writes the state change and audit entry in a single database transaction.
- [ ] `SELECT ... FOR UPDATE` is used when reading a transaction for state transition.
- [ ] All unique constraints are enforced at the database level (not just application level).
- [ ] Migration files are provided and correctly create all required tables, indexes, and constraints.

---

## 19. Adapter Contracts

### AC-19.1 Payment Provider Adapter Interface

- [ ] Any class implementing `PaymentProviderAdapter` can be registered and used without modifying PayHook core code (except adding to the provider registry).
- [ ] The interface requires: `providerName`, `verifySignature()`, `normalize()`, `extractIdempotencyKey()`, `extractReferences()`.
- [ ] `verifyWithProvider()` is optional.

### AC-19.2 Storage Adapter Interface

- [ ] Any class implementing `StorageAdapter` can replace the TypeORM adapter without modifying core logic.
- [ ] The interface includes all methods defined in PRD §18.2.

---

## 20. Library Boundary Compliance

These criteria verify PayHook stays within its library responsibility boundary.

- [ ] PayHook does not start any background processes, timers, or scheduled tasks.
- [ ] PayHook does not open any network ports beyond what the host NestJS app provides.
- [ ] PayHook does not manage message queues, job runners, or broker connections.
- [ ] PayHook does not ship or require a metrics server, dashboard, or tracing backend.
- [ ] All "host-triggered" methods (`reconcile`, `scanStaleTransactions`, `purgeExpiredLogs`, `replayEvents`) are passive — they execute only when called by the host.
- [ ] The outbox table is written to but never polled by PayHook.

---

## 21. Performance

- [ ] Webhook processing pipeline (inbound → state transition committed) completes in under 100ms at p50, excluding database write latency.
- [ ] The pipeline does not make external HTTP calls during normal webhook processing (provider verification only occurs during explicit `reconcile()` calls).

---

## 22. Error Handling

- [ ] A provider adapter that throws during `normalize()` results in `normalization_failed` fate, not an unhandled exception.
- [ ] A provider adapter that throws during `verifySignature()` results in `signature_failed` fate, not an unhandled exception.
- [ ] A database connection failure during webhook processing returns `500` to the provider and logs the error — it does not crash the host process.
- [ ] A handler that throws during dispatch does not affect other handlers registered for the same event.
