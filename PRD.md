# PayHook — Product Requirements Document (AI-Ready Trust Layer)

**Transaction Truth Engine — Drop-in NestJS Library for Verified Payment State**

| Field   | Value               |
| ------- | ------------------- |
| Version | 0.5.0               |
| Author  | Emmanuel Okafor     |
| Date    | February 2026       |
| License | MIT                 |
| Status  | Draft               |

---

## 1. Executive Summary

PayHook is a **transaction truth engine** delivered as a drop-in NestJS library (`@payhook/core`). It converts payment provider webhooks — which are unverified claims — into **verified, deduplicated, normalized, queryable facts** with an **append-only audit trail**.

Webhooks are treated as **claims, not truth**. PayHook verifies those claims, constrains them through a state machine, and exposes a query-first interface that is safe for both human operators and autonomous AI agents to act on.

PayHook exists to answer one critical question safely:

> **"Is this payment truly successful (and provable), so a human or AI can act on it?"**

### What PayHook Is

- A **trust boundary** between payment providers and downstream systems
- A **state machine** that owns transaction truth, not "webhook handling"
- A **query-first** interface for applications and AI agents
- A **verification-aware** system that exposes confidence metadata alongside state
- A **library** that runs inside your NestJS application — not a hosted service

### What PayHook Is NOT

- Not a payment initiation SDK
- Not a checkout UI
- Not subscriptions/billing
- Not payout/settlement tracking
- Not an AI agent framework
- Not a hosted platform, message broker, or background job runner

### Target Users

- **Backend teams (NestJS)** who want correctness-first payment state + audit
- **AI/automation teams** who need a safe, deterministic interface (no raw webhooks)
- **Open-source contributors** who add providers/storage via stable adapter contracts

### MVP Deliverable

A small but production-usable library that:

- **never exposes unverified events**
- provides **deterministic transaction status** with verification metadata
- provides **auditability independent of handler success**
- provides **replayability and outbox interfaces** — host app owns delivery guarantees
- supports **Paystack + TypeORM** first (Stripe post-MVP)
- includes a **mock provider adapter** for local development and testing

---

## 2. Library Responsibility Boundary

PayHook is a library that runs inside the host application's process. This section defines what PayHook guarantees versus what belongs to the host.

### PayHook Guarantees

| Concern                      | Guarantee                                                                 |
| ---------------------------- | ------------------------------------------------------------------------- |
| **State correctness**        | Transitions are state-machine validated; invalid transitions are rejected  |
| **Auditability**             | Every transition has an audit entry; every webhook has a fate              |
| **Idempotency**              | Duplicate webhooks never cause duplicate transitions or dispatches         |
| **Atomic persistence**       | State change + audit entry written in a single DB transaction              |
| **Dispatch-after-commit**    | Event handlers only fire after truth is persisted                          |
| **Replayability**            | All events can be re-dispatched from stored audit trail                    |
| **Normalization**            | Provider differences are invisible to downstream consumers                 |
| **Verification metadata**    | Every transaction exposes how its state was established                    |

### Host Application Responsibilities

| Concern                         | Why It's Not PayHook's Job                                             |
| ------------------------------- | ---------------------------------------------------------------------- |
| **Event delivery retries**      | PayHook dispatches events synchronously. Retry policies (BullMQ, Temporal, cron) are host infrastructure decisions. PayHook provides the outbox table and replay interface. |
| **Background reconciliation**   | PayHook provides `reconcile(ref)` and `scanStaleTransactions()`. The host decides when and how to call them (cron job, queue worker, manual trigger). |
| **Retention cleanup execution** | PayHook provides `purgeExpiredLogs()`. The host schedules it.           |
| **Rate limiting**               | PayHook ships optional NestJS middleware helpers. The host decides whether to use them or its own. |
| **Request size limits**         | Same as above — PayHook provides helpers, host applies them.            |
| **Encryption at rest**          | Database and infrastructure responsibility.                             |
| **Monitoring/alerting**         | PayHook emits structured logs and lifecycle hooks. The host wires them to its observability stack. |

**Design principle:** PayHook provides the *interfaces and data* that enable these concerns. It never starts background processes, opens ports, or manages infrastructure.

---

## 3. Problem Statement

### 3.1 The Real Problem

Webhook-driven payments are not "events," they are **claims** made by external systems. Claims can be duplicated, delayed, spoofed, or incomplete depending on the provider.

For AI systems, this is dangerous:

- Agents can double-process
- Agents can act on unverified claims
- Agents can't reliably reconcile "truth" from provider differences
- Agents have no way to assess *confidence* in a given transaction state

### 3.2 Pain Points

- **Provider asymmetry** (success-only vs state-change webhooks)
- **No deterministic truth layer** (teams treat raw webhooks as truth)
- **Incomplete audit trails** (missing failed verifications, duplicates, invalid transitions)
- **Unsafe automation** (agents act on noise instead of verified facts)
- **Reconciliation complexity** ("did money come in?" requires stitching multiple sources)
- **No local testability** (developers can't test webhook flows without live provider accounts)

### 3.3 PayHook's Solution

PayHook makes webhooks merely **one input** to a transaction truth engine.

**Downstream consumers (humans + AI) do not handle raw webhooks.** They interact with PayHook's **query + normalized event interface**, which is:

- Signature verified
- Deduplicated
- State-machine constrained
- Audited before side effects
- Annotated with verification confidence metadata

---

## 4. Product Principles (Non-Negotiable)

1. **Query-first, not webhook-first** — Primary API is `getTransaction()` / `getAuditTrail()` / status queries.

2. **Audit before action** — A webhook is persisted and linked before any handler runs.

3. **Idempotency by default** — Duplicate webhook deliveries never cause double transitions or double dispatch.

4. **State machine is the source of truth** — Invalid transitions are rejected and logged. No transition can exist without a corresponding audit entry.

5. **Provider asymmetry is invisible downstream** — PayHook normalizes events so consumers see a consistent set.

6. **AI-safe by construction** — The system must remain correct even if handlers fail or consumers behave badly. Verification metadata enables risk-weighted decision-making.

7. **Every claim has a fate** — No webhook is silently dropped. Every inbound payload is classified and logged.

8. **Library, not platform** — PayHook provides correctness primitives and data interfaces. Infrastructure decisions (queues, schedulers, monitoring) belong to the host application.

---

## 5. System Architecture

### 5.1 Processing Pipeline (Trust Boundary)

| Layer | Name          | Responsibility                                                              |
| ----- | ------------- | --------------------------------------------------------------------------- |
| 1     | Inbound       | Receive raw POST, select provider adapter (by route), preserve raw body     |
| 2     | Verification  | Validate signature + optional replay protections; log failures              |
| 3     | Normalization | Map raw payload → PayHook unified schema; log normalization failures        |
| 4     | Persist Claim | Store raw webhook + normalized summary (append-only)                        |
| 5     | Deduplication | Check idempotency key; mark duplicates; do not re-process                   |
| 6     | State Engine  | Apply validated state transition; reject invalid transitions                |
| 7     | Dispatch      | Emit normalized events to handlers; write to outbox (if enabled); failures do not alter truth |

#### 5.1.1 Claim Fate Classification

Every inbound webhook receives one of the following processing outcomes. No webhook is silently dropped.

| Fate                    | Description                                                    | Stored In               |
| ----------------------- | -------------------------------------------------------------- | ----------------------- |
| `processed`             | Full pipeline completed; state transition applied              | Webhook log + Audit log |
| `duplicate`             | Valid claim but idempotency key already seen                   | Webhook log             |
| `signature_failed`      | Signature verification failed                                  | Webhook log             |
| `normalization_failed`  | Signature valid but payload could not be mapped to schema      | Webhook log             |
| `unmatched`             | Valid and normalized but no matching transaction found          | Webhook log             |
| `transition_rejected`   | Valid claim but state machine rejected the transition           | Webhook log + Audit log |
| `parse_error`           | Raw body could not be parsed at all                            | Webhook log             |

### 5.2 Transaction State Machine (MVP)

**Design goal:** small, universal, and provider-agnostic.

```
                          ┌──────────────┐
                          │   pending    │
                          └──────┬───────┘
                                 │ markAsProcessing()
                          ┌──────▼───────┐
                     ┌────│  processing  │────┐
                     │    └──────┬───────┘    │
                     │           │            │
              ┌──────▼──┐ ┌─────▼────┐ ┌─────▼─────┐
              │  failed  │ │successful│ │ abandoned  │
              └─────────┘ └────┬─────┘ └───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼────────┐ ┌────▼──────────┐ ┌───▼────┐
     │partially_refunded│ │   refunded    │ │disputed│
     └─────────────────┘ └───────────────┘ └───┬────┘
                                                │
                                    ┌───────────┼───────────┐
                                    │                       │
                             ┌──────▼──────┐        ┌──────▼──────┐
                             │resolved_won │        │resolved_lost│
                             └─────────────┘        └─────────────┘
```

| From         | To                   | Trigger                                       |
| ------------ | -------------------- | --------------------------------------------- |
| `pending`    | `processing`         | `markAsProcessing()` (atomic, single call)    |
| `processing` | `successful`         | Verified webhook / verified provider status    |
| `processing` | `failed`             | Verified webhook / verified provider status    |
| `processing` | `abandoned`          | Timeout + verification (host-triggered)        |
| `successful` | `refunded`           | Refund webhook (full)                          |
| `successful` | `partially_refunded` | Refund webhook (partial)                       |
| `successful` | `disputed`           | Dispute webhook                                |
| `disputed`   | `resolved_won`       | Dispute resolved in merchant favor             |
| `disputed`   | `resolved_lost`      | Dispute resolved in customer favor             |

#### 5.2.1 Explicit Design Decisions

- **`failed` is terminal.** There is no `failed → processing` retry path. If a payment fails and the user retries, a *new* transaction must be created. This prevents ambiguous audit trails.
- **`pending → processing` is atomic.** `createTransaction()` creates in `pending`. `markAsProcessing(id, { providerRef })` atomically transitions to `processing` and links the provider reference. No intermediate state exists.
- **`abandoned` is host-triggered.** PayHook provides `scanStaleTransactions(olderThanMinutes)` which returns refs. The host decides when to call it and whether to reconcile or abandon.
- **Adding states requires maintainer review.**

---

## 6. Core Product Surface (AI-Ready)

### 6.1 Query-First Public API (Primary)

| Method                                          | Description                                                    |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `createTransaction(dto)`                        | Create a new transaction in `pending` state                     |
| `markAsProcessing(id, { providerRef })`         | Atomically link provider ref and transition to `processing`     |
| `getTransaction(applicationRef \| providerRef)` | Get current transaction state + verification metadata           |
| `getAuditTrail(applicationRef \| id)`           | Get full append-only history of state changes                   |
| `listTransactionsByStatus(status, pagination)`  | Filter transactions by current state                            |
| `isSettled(applicationRef \| providerRef)`      | Boolean convenience: is this transaction in a terminal state?   |
| `reconcile(applicationRef \| providerRef)`      | Manual reconciliation trigger (see §6.3)                        |
| `replayEvents(applicationRef \| id)`            | Re-dispatch all events for a transaction from audit trail       |
| `scanStaleTransactions(olderThanMinutes)`        | Returns refs of `processing` transactions past threshold        |
| `linkUnmatchedWebhook(webhookLogId, txnId)`     | Retroactively link an unmatched webhook (see §7)                |
| `listUnmatchedWebhooks(provider?, pagination)`  | List unmatched webhook logs for review                          |
| `purgeExpiredLogs(config)`                       | Delete webhook/dispatch logs past retention window              |

### 6.2 Event Interface (Secondary)

For systems that need real-time reactions:

- `@OnPaymentEvent('payment.successful')`
- `@OnPaymentEvent('payment.failed')`
- `@OnPaymentEvent('payment.abandoned')`
- `@OnPaymentEvent('refund.successful')`
- `@OnPaymentEvent('refund.failed')`
- `@OnPaymentEvent('charge.disputed')`
- `@OnPaymentEvent('dispute.resolved')`

**Dispatch invariant:** Event dispatch only occurs after:

1. Signature verified
2. Persisted to webhook log
3. Deduplicated
4. State transition accepted and audit entry committed

### 6.3 Reconciliation (Manual, Host-Triggered)

Reconciliation answers: "PayHook's state says X — does the provider agree?"

#### Reconcile Flow

```
reconcile(ref) called by host app
    │
    ▼
Fetch current PayHook state
    │
    ▼
Call provider verification API
    │
    ▼
Compare PayHook state vs provider state
    │
    ├── States match → Log audit entry (type: reconciliation_confirmed)
    │
    ├── Provider ahead → Apply missing transition + audit entry (trigger: reconciliation)
    │
    ├── Provider behind → Log audit entry (type: reconciliation_divergence)
    │   → Do NOT roll back; return divergence details to caller
    │
    └── Provider unreachable → Log audit entry (type: reconciliation_error)
        → Return error to caller; no state change
```

#### Reconciliation Rules

- Reconciliation **can advance** forward but **never rolls back** state.
- Every attempt is logged as an audit entry regardless of outcome.
- Response includes `result`: `confirmed | advanced | divergence | error`.
- PayHook does not schedule reconciliation. The host app calls `reconcile()` when it chooses — via cron, queue worker, admin action, or AI agent decision.

#### Stale Transaction Helper

For host apps that want to build a reconciliation scheduler:

```typescript
// Returns refs of transactions stuck in 'processing' longer than threshold
const stale = await payhook.scanStaleTransactions(30); // minutes

// Host decides what to do
for (const ref of stale) {
  await payhook.reconcile(ref);
}
```

### 6.4 Replay & Outbox (Event Recovery)

Handler execution is decoupled from truth. When a handler fails, the transaction state remains intact. PayHook provides two mechanisms for recovery:

#### Replay

```typescript
// Re-dispatch all events for a transaction in chronological order
await payhook.replayEvents('app-ref-001');
```

- Fetches the full audit trail
- Re-dispatches normalized events in order
- Each replay is logged in the dispatch log with `is_replay=true`
- Handlers must be idempotent — replay may re-deliver already-handled events

#### Outbox Mode (Optional)

When enabled, PayHook writes every dispatched event to an `outbox_events` table alongside the state transition (same DB transaction). The host app processes the outbox with its own infrastructure.

```typescript
PayHookModule.forRoot({
  outbox: { enabled: true },
  // ...
});
```

| Field              | Type        | Description                                      |
| ------------------ | ----------- | ------------------------------------------------ |
| `id`               | UUID        | Outbox entry identifier                           |
| `transaction_id`   | UUID        | Link to transaction                               |
| `event_type`       | string      | Normalized event type                              |
| `payload`          | jsonb       | Serialized event payload                           |
| `status`           | enum        | `pending`, `processed`, `failed`                   |
| `created_at`       | timestamp   | When the entry was written                         |
| `processed_at`     | timestamp (nullable) | When the host marked it processed           |

The host app is responsible for:

- Polling or listening on the outbox table
- Marking entries as `processed` after handling
- Implementing retry logic for `failed` entries

**PayHook provides:** `markOutboxProcessed(id)` and `listPendingOutbox(pagination)`.

**PayHook does not provide:** queue workers, background pollers, or retry schedulers.

---

## 7. Unmatched Webhooks Policy

Provider webhooks can arrive before the application creates a transaction (race condition).

### 7.1 On Receipt

An unmatched webhook is:

- Persisted with `processing_status=unmatched` and `transaction_id=null`
- Raw payload and normalized event both preserved
- No state transition or dispatch occurs

### 7.2 Late Matching

```typescript
const result = await payhook.linkUnmatchedWebhook(webhookLogId, transactionId);
// result: { status: 'linked' | 'transition_rejected' | 'not_found' }
```

This method:

1. Validates the webhook log entry exists and is `unmatched`
2. Validates the transaction exists
3. Re-runs the state engine as if the webhook just arrived
4. If valid: applies transition, writes audit entry (`trigger_type=late_match`), dispatches event
5. If invalid: rejects and returns `transition_rejected`

### 7.3 Discovery

`listUnmatchedWebhooks(provider?, pagination)` returns unmatched logs for review or automated matching by the host app.

### 7.4 Retention

Unmatched webhooks follow the same retention policy as all webhook logs.

---

## 8. Concurrency & Integrity

### 8.1 Unique Constraints

| Constraint                                  | Scope              | Notes                                              |
| ------------------------------------------- | ------------------ | -------------------------------------------------- |
| `application_ref` unique                    | Transactions       | Always set on creation; never null                  |
| `provider_ref` unique (where not null)      | Transactions       | Null in `pending`; set on `markAsProcessing()`. Partial unique index excludes nulls. |
| `(provider, provider_event_id)` unique      | Webhook logs       | Enforces idempotency at DB level                    |

### 8.2 Row-Level Locking

When applying a state transition:

```sql
SELECT * FROM transactions WHERE id = $1 FOR UPDATE;
```

Prevents concurrent webhooks from racing through the state engine.

### 8.3 Atomic Writes

These operations occur within a single database transaction:

- State transition + audit entry
- `markAsProcessing()` — sets `provider_ref` + transitions + writes audit
- `linkUnmatchedWebhook()` — updates webhook log + applies transition + writes audit
- Outbox write (when enabled) — included in the same transaction as the state change

Dispatch always occurs **after** the database transaction commits.

### 8.4 Idempotency Under Concurrency

If two identical webhooks arrive simultaneously:

1. Both pass signature verification
2. Both attempt to insert into webhook log with the same `(provider, provider_event_id)`
3. Unique constraint causes one to fail
4. The failing insert is caught and classified as `duplicate`
5. Only one proceeds through the state engine

---

## 9. Data Model (Truth + Proof)

### 9.1 Transactions (Truth / Current State)

| Field                 | Type                  | Description                                                                |
| --------------------- | --------------------- | -------------------------------------------------------------------------- |
| `id`                  | UUID                  | Internal identifier                                                         |
| `application_ref`     | string                | Developer's reference (indexed, unique)                                     |
| `provider_ref`        | string (nullable)     | Provider's reference (indexed, unique where not null)                       |
| `provider`            | string                | Provider identifier (e.g., `paystack`)                                      |
| `status`              | enum                  | State-machine controlled                                                    |
| `amount`              | integer               | Amount in smallest currency unit                                            |
| `currency`            | string                | ISO 4217 currency code                                                      |
| `verification_method` | enum                  | `webhook_only`, `api_verified`, `reconciled`                                |
| `metadata`            | jsonb                 | Developer-defined metadata                                                  |
| `created_at`          | timestamp             | When PayHook created the record                                             |
| `updated_at`          | timestamp             | Last state change time                                                      |
| `provider_created_at` | timestamp (nullable)  | When the provider reports the transaction started                           |

### 9.2 Webhook Logs (Claims / Proof)

Append-only record of every inbound claim.

| Field                | Type              | Description                                                   |
| -------------------- | ----------------- | ------------------------------------------------------------- |
| `id`                 | UUID              | Log entry identifier                                           |
| `provider`           | string            | Provider identifier                                            |
| `provider_event_id`  | string            | Provider's event/idempotency key                               |
| `transaction_id`     | UUID (nullable)   | Link to transaction (null if unmatched)                        |
| `event_type`         | string            | Raw provider event type                                        |
| `normalized_event`   | string (nullable) | PayHook normalized event (null if normalization failed)        |
| `raw_payload`        | jsonb             | Full raw webhook body as received (subject to redaction config)|
| `signature_valid`    | boolean           | Whether signature verification passed                          |
| `processing_status`  | enum              | Claim fate (see §5.1.1)                                        |
| `received_at`        | timestamp         | When PayHook received the webhook                              |

**Guarantee:** Every inbound webhook gets a row regardless of validity.

### 9.3 Audit Logs (State Proof)

Append-only record of every transition and reconciliation.

| Field                    | Type              | Description                                                    |
| ------------------------ | ----------------- | -------------------------------------------------------------- |
| `id`                     | UUID              | Audit entry identifier                                          |
| `transaction_id`         | UUID              | Link to transaction                                             |
| `from_status`            | enum              | Previous state                                                  |
| `to_status`              | enum              | New state                                                       |
| `trigger_type`           | enum              | `webhook`, `api_verification`, `reconciliation`, `late_match`, `manual` |
| `webhook_log_id`         | UUID (nullable)   | Link to triggering webhook                                      |
| `reconciliation_result`  | enum (nullable)   | `confirmed`, `advanced`, `divergence`, `error`                  |
| `metadata`               | jsonb             | Additional context                                              |
| `created_at`             | timestamp         | When the audit entry was created                                |

**Guarantee:** A state transition without an audit entry is impossible.

### 9.4 Dispatch Logs (Delivery Proof)

| Field              | Type                 | Description                                      |
| ------------------ | -------------------- | ------------------------------------------------ |
| `id`               | UUID                 | Log entry identifier                              |
| `transaction_id`   | UUID                 | Link to transaction                               |
| `event_type`       | string               | Normalized event type dispatched                   |
| `handler_name`     | string               | Registered handler identifier                      |
| `status`           | enum                 | `success`, `failed`, `skipped`                     |
| `is_replay`        | boolean              | Whether this was a replay dispatch                 |
| `error_message`    | text (nullable)      | Error details on failure                           |
| `dispatched_at`    | timestamp            | When dispatch was attempted                        |

### 9.5 Outbox Events (Optional)

Only created when `outbox: { enabled: true }`. See §6.4 for schema.

---

## 10. Verification Confidence & AI Metadata

### 10.1 Verification Methods

| Method          | Confidence | Description                                          |
| --------------- | ---------- | ---------------------------------------------------- |
| `webhook_only`  | Standard   | State derived from a verified webhook alone           |
| `api_verified`  | High       | State confirmed by calling the provider's verify API  |
| `reconciled`    | High       | State confirmed or advanced via reconciliation flow   |

### 10.2 `getTransaction()` Response Shape

```typescript
interface TransactionResponse {
  id: string;
  applicationRef: string;
  providerRef: string | null;
  provider: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  verificationMethod: 'webhook_only' | 'api_verified' | 'reconciled';
  isSettled: boolean;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  providerCreatedAt: string | null;
}
```

AI agents can make **risk-weighted decisions**: require `api_verified` for high-value transactions, accept `webhook_only` for low-value.

---

## 11. Normalized Event Contract & Versioning

### 11.1 Normalized Event Schema

```typescript
interface NormalizedWebhookEvent {
  // Required (guaranteed present)
  eventType: NormalizedEventType;
  providerRef: string;
  amount: number;
  currency: string;
  providerEventId: string;

  // Optional (present when provider supplies them)
  applicationRef?: string;
  providerTimestamp?: string;
  customerEmail?: string;
  providerMetadata?: Record<string, any>;
}
```

### 11.2 Normalized Event Types

| Event Type            | Description                                       |
| --------------------- | ------------------------------------------------- |
| `payment.successful`  | Payment completed and funds captured               |
| `payment.failed`      | Payment attempt failed                             |
| `payment.abandoned`   | Payment timed out or was abandoned                 |
| `refund.successful`   | Refund completed (full or partial)                 |
| `refund.failed`       | Refund attempt failed                              |
| `refund.pending`      | Refund initiated but not yet completed             |
| `charge.disputed`     | Chargeback or dispute opened                       |
| `dispute.resolved`    | Dispute resolved (won or lost)                     |

### 11.3 Versioning & Compatibility

- Follows **SemVer** aligned with the `@payhook/core` package version.
- **Required fields** are never removed or changed in type within a major version.
- **New optional fields** can be added in minor versions.
- **`providerMetadata`** is the escape hatch for provider-specific data. No stability guarantee on its shape.
- Breaking changes to the normalized event schema require a major version bump.

### 11.4 Adapter Author Guidance

- Map all provider data to standard fields where possible.
- Place unmapped but useful data in `providerMetadata`.
- Return `null` for optional fields rather than guessing.
- Throw `NormalizationError` for fundamentally unparseable payloads (pipeline classifies as `normalization_failed`).

---

## 12. Observability (Hooks + Structured Logs)

PayHook is a library. It does not ship a metrics server, dashboard, or tracing backend. Instead, it provides **structured logs** and **lifecycle hooks** that the host app wires to its own observability stack.

### 12.1 Structured Logging

All log entries include correlation fields where applicable:

- `transaction_id`, `application_ref`, `provider_ref`, `provider_event_id`, `webhook_log_id`

PayHook uses NestJS's built-in `Logger`. Log levels:

| Level   | Used For                                                        |
| ------- | --------------------------------------------------------------- |
| `error` | Signature failures, normalization errors, dispatch failures      |
| `warn`  | Transition rejections, reconciliation divergences, unmatched webhooks |
| `log`   | Successful transitions, reconciliation confirmations             |
| `debug` | Full pipeline trace (development only)                           |

### 12.2 Lifecycle Hooks

PayHook exposes optional callbacks the host app can register to feed its own metrics/alerting:

```typescript
PayHookModule.forRoot({
  hooks: {
    onWebhookFate: (fate: WebhookFateEvent) => {
      // e.g., increment Prometheus counter
      // { provider, processingStatus, eventType, latencyMs }
    },
    onTransition: (transition: TransitionEvent) => {
      // { provider, fromStatus, toStatus, triggerType, transactionId }
    },
    onDispatchResult: (result: DispatchResultEvent) => {
      // { eventType, handlerName, status, isReplay, errorMessage? }
    },
    onReconciliation: (result: ReconciliationEvent) => {
      // { provider, applicationRef, result, latencyMs }
    },
  },
});
```

**What the host can build with these hooks:**

- Prometheus counters (webhook fates by provider, transitions by direction, dispatch success/failure)
- Latency histograms (pipeline duration, reconciliation duration)
- Alerting (spike in `signature_failed`, high `unmatched` rate)
- OpenTelemetry spans (wrap hook calls in spans)

---

## 13. Security Requirements

### 13.1 Mandatory Verification

- Signature verification cannot be disabled.
- Failures logged with `signature_valid=false` and `processing_status=signature_failed`.

### 13.2 Timing-Safe Signature Checking

- Constant-time compare for all signature validation.
- Raw body preserved by middleware — no JSON re-stringification.

### 13.3 Replay/Duplicate Resistance

- Deduplicate using provider event ID.
- Unique constraint on `(provider, provider_event_id)`.

### 13.4 No Sensitive Data Logging

- Secrets never logged. No PAN/CVV handled.

### 13.5 Secret Rotation

PayHook accepts an array of active secrets per provider. During rotation, both old and new secrets are accepted:

```typescript
providers: {
  paystack: {
    secrets: [process.env.PAYSTACK_SECRET_NEW, process.env.PAYSTACK_SECRET_OLD],
  },
},
```

The adapter tries each secret in order; first successful verification wins.

### 13.6 Webhook Endpoint Hardening (Helpers)

PayHook ships optional NestJS middleware that the host can apply:

```typescript
import { PayHookRateLimitGuard, PayHookBodySizeGuard } from '@payhook/core/middleware';

// In your app module or controller
@UseGuards(PayHookRateLimitGuard({ max: 100, windowSeconds: 1 }))
@UseGuards(PayHookBodySizeGuard({ maxSize: '1mb' }))
```

| Helper                  | What It Does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `PayHookRateLimitGuard` | Token bucket rate limiting per provider route                        |
| `PayHookBodySizeGuard`  | Rejects payloads over configurable size with `413`                   |
| `PayHookIpGuard`        | Optional IP allowlist check (host provides CIDR list)                |

These are **opt-in**. The host may prefer its own middleware, reverse proxy rules, or CDN-level protections.

**Documentation requirement:** PayHook's setup guide must document the raw body capture middleware requirement with copy-paste examples for Express and Fastify.

---

## 14. Data Retention & Redaction (Configuration)

PayHook stores raw payloads for auditability. The host controls how long and how much.

### 14.1 Storage Configuration

```typescript
PayHookModule.forRoot({
  storage: {
    storeRawPayload: true,    // false = store only normalized event, not raw body
    redactKeys: [              // paths to redact before persistence
      'customer.email',
      'metadata.cardFingerprint',
    ],
  },
  retention: {
    webhookLogDays: 180,       // guidance value; host calls purgeExpiredLogs()
    dispatchLogDays: 90,
  },
});
```

### 14.2 Redaction Behavior

- Redaction runs **after** normalization but **before** persistence.
- Normalized event fields are extracted before redaction, so matching still works.
- Redacted fields are replaced with `[REDACTED]` in the stored `raw_payload`.

### 14.3 Retention Cleanup

PayHook provides the method. The host schedules it:

```typescript
// Call this from your cron job, queue worker, or admin endpoint
const deleted = await payhook.purgeExpiredLogs({
  webhookLogDays: 180,
  dispatchLogDays: 90,
});
// { webhookLogsDeleted: 1234, dispatchLogsDeleted: 567 }
```

### 14.4 Compliance Posture

- PayHook does not implement encryption-at-rest (database responsibility).
- PayHook does not store PCI-scoped data.
- The append-only audit trail supports compliance requirements but is not itself a certification.

---

## 15. Provider Asymmetry Strategy

### 15.1 Handling Paystack vs Stripe

| Behavior                     | Paystack                                              | Stripe                                   |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| Webhook model                | Success-heavy; primarily emits on successful charge   | Rich event stream; emits on most transitions |
| Missing transitions          | Synthesized via verification API (host-triggered)      | Arrive directly via webhooks              |
| Verification API             | `GET /transaction/verify/:reference`                   | Retrieve event + expand                   |

### 15.2 Deterministic Transition Synthesis

When a provider does not emit a transition, PayHook synthesizes it **only** via explicit verification against the provider API:

1. Host calls `reconcile(ref)` → PayHook queries provider → applies missing transition
2. Host calls `scanStaleTransactions(30)` → gets stuck refs → decides to reconcile or abandon

**Determinism contract:** Synthesized transitions are never based on heuristic or timeout alone. They always involve a provider API check. The `trigger_type` in the audit log distinguishes synthesized transitions from webhook-driven ones.

---

## 16. Package Boundaries

PayHook ships as a **single npm package**: `@payhook/core`.

```typescript
// Production
import { PayHookModule, TransactionService } from '@payhook/core';

// Testing
import { MockProviderAdapter, MockWebhookFactory } from '@payhook/core/testing';

// Middleware helpers (opt-in)
import { PayHookRateLimitGuard } from '@payhook/core/middleware';
```

Implemented via `package.json` `exports`:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./testing": "./dist/testing/index.js",
    "./middleware": "./dist/middleware/index.js"
  }
}
```

**Rationale:** single package reduces installation friction. Subpaths are tree-shakeable.

**Post-MVP:** storage adapters and CLI tools may be split into separate packages (`@payhook/mongoose`, `@payhook/cli`).

---

## 17. Developer Experience (DX)

### 17.1 Installation

```bash
npm install @payhook/core
```

### 17.2 Minimal Setup

```typescript
import { PayHookModule } from '@payhook/core';

@Module({
  imports: [
    PayHookModule.forRoot({
      providers: {
        paystack: { secrets: [process.env.PAYSTACK_SECRET_KEY] },
      },
      typeorm: { dataSource: AppDataSource },
    }),
  ],
})
export class AppModule {}
```

- Auto-registers webhook controller at `/webhooks/{provider}`
- Migrations: `auto` (run on init) or `manual` (exported for host pipeline)

### 17.3 "Time to First Truth"

Success metric: **under 10 minutes** from install → receiving a verified `payment.successful`.

### 17.4 Local Development & Testing

```typescript
import { MockWebhookFactory } from '@payhook/core/testing';

const webhook = MockWebhookFactory.paymentSuccessful({
  reference: 'test-ref-001',
  amount: 50000,
  currency: 'NGN',
});

await request(app.getHttpServer())
  .post('/webhooks/mock')
  .set(webhook.headers)
  .send(webhook.body)
  .expect(200);
```

The mock adapter implements the full provider interface, generates valid signatures, and supports all normalized event types.

---

## 18. Adapter Architecture (Contribution Surface)

### 18.1 Payment Provider Adapter

```typescript
interface PaymentProviderAdapter {
  readonly providerName: string;

  verifySignature(rawBody: Buffer, headers: Record<string, string>, secrets: string[]): boolean;
  normalize(rawPayload: unknown): NormalizedWebhookEvent;
  extractIdempotencyKey(rawPayload: unknown): string;
  extractReferences(rawPayload: unknown): { providerRef: string; applicationRef?: string };
  verifyWithProvider?(providerRef: string): Promise<ProviderVerificationResult>;
}
```

### 18.2 Storage Adapter

```typescript
interface StorageAdapter {
  createTransaction(dto: CreateTransactionDto): Promise<Transaction>;
  updateTransactionStatus(id: string, status: TransactionStatus, auditEntry: AuditEntry): Promise<Transaction>;
  findTransaction(query: TransactionQuery): Promise<Transaction | null>;
  listTransactions(filter: TransactionFilter, pagination: Pagination): Promise<PaginatedResult<Transaction>>;
  createWebhookLog(dto: CreateWebhookLogDto): Promise<WebhookLog>;
  listUnmatchedWebhooks(filter: UnmatchedFilter, pagination: Pagination): Promise<PaginatedResult<WebhookLog>>;
  getAuditTrail(transactionId: string): Promise<AuditEntry[]>;
  createDispatchLog(dto: CreateDispatchLogDto): Promise<DispatchLog>;
  purgeExpiredWebhookLogs(olderThan: Date): Promise<number>;
  purgeExpiredDispatchLogs(olderThan: Date): Promise<number>;
}
```

- `updateTransactionStatus` must write state change and audit entry atomically.
- Unique constraints enforced for idempotency keys and references.

**Design goal:** contributors add adapters without modifying core logic (except registry).

---

## 19. MVP Scope

### 19.1 Ships in v0.1.0

**Core engine:**
- State engine with strict transition validation
- Webhook controller with verification + dedup + persistence + dispatch
- Claim fate classification (no silent drops)
- Atomic transitions + audit in same DB transaction
- Dispatch-after-commit
- Concurrency controls: row-level locking, unique constraints

**Query surface:**
- Query-first `TransactionService` with verification metadata
- `isSettled()` convenience method
- `getAuditTrail()`

**Providers:**
- Paystack provider adapter (charge success, refund, dispute)
- Mock provider adapter (`@payhook/core/testing`)

**Storage:**
- TypeORM storage adapter (Postgres/MySQL)
- Migration files with auto/manual mode
- Transaction, webhook log, audit log, dispatch log tables

**Recovery:**
- `replayEvents()` for handler failure recovery
- Optional outbox mode (host-processed)

**Reconciliation:**
- Manual `reconcile(ref)` with defined flow
- `scanStaleTransactions()` helper

**Unmatched webhooks:**
- Persist, list, `linkUnmatchedWebhook()`

**Security:**
- Mandatory signature verification
- Secret rotation support (multi-secret)
- Optional middleware helpers (rate limit, body size, IP allowlist)

**Configuration:**
- `storeRawPayload` toggle + `redactKeys`
- Retention day values + `purgeExpiredLogs()`
- Lifecycle hooks (`onWebhookFate`, `onTransition`, `onDispatchResult`, `onReconciliation`)

**Normalized contract:**
- Stable event schema with `providerMetadata` escape hatch
- Structured logging with correlation IDs

### 19.2 Post-MVP

- Stripe provider adapter (validates asymmetry design)
- Mongoose storage adapter
- CLI replay tool for local webhook testing
- OpenTelemetry hook examples
- `@payhook/cli` for webhook replay from captured payloads
- Admin API (separate package)
- Batch reconciliation helper

---

## 20. Explicit Non-Goals

- Subscription lifecycle management
- Payment initiation / checkout sessions
- App store receipts / RevenueCat
- Customer management
- Settlement / payout tracking
- Multi-tenancy (MVP)
- Frontend components
- "AI agent" runtime or orchestration
- Automatic state rollback (states only move forward)
- Background job scheduling (host responsibility)
- Message broker / queue management (host responsibility)
- Metrics server or dashboard (host responsibility)
- Encryption-at-rest (database responsibility)

---

## 21. Success Metrics

### Adoption

- 100+ npm downloads in first month
- 25+ GitHub stars in first month
- 1 external contributor PR within 90 days (Stripe adapter target)

### Reliability / Correctness

- 0 duplicate state transitions
- 0 handler failures causing truth inconsistency
- 0 silently dropped webhooks
- Webhook processing < 100ms p50 (pipeline only, excluding DB latency)

### AI / Automation Readiness

- 100% of downstream events are verified, deduplicated, normalized, and auditable
- Every transaction exposes `verificationMethod` for risk-weighted decisions
- "Did money come in?" answered via one query: `getTransaction(ref)`
- "Is this done?" answered via one call: `isSettled(ref)`
- Failed dispatches recoverable via `replayEvents(ref)` or outbox

---

## 22. Key Risks & Mitigations

| Risk                                         | Impact                        | Mitigation                                                              |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Provider data inconsistencies                | Wrong transitions             | Normalize strictly + keep raw payload + verification API                |
| Missing events (provider doesn't send)       | Stuck in `processing`         | `reconcile()` + `scanStaleTransactions()` (host-triggered)              |
| Incorrect raw body handling                  | Signature verification fails  | Raw body middleware documented + tested; setup guide includes examples  |
| Normalization failures on unknown payloads   | Data loss                     | Claim fate classification; raw payload preserved                        |
| Reconciliation finds divergence              | Ambiguous state               | Never roll back; log divergence; surface to caller                      |
| Webhook arrives before transaction created   | Unmatched claim               | Persist unmatched + `linkUnmatchedWebhook()`                            |
| Concurrent duplicate webhooks                | Double transition             | Row-level locking + unique constraints                                  |
| Handler failures lose business events        | Missed side effects           | Dispatch log + `replayEvents()` + outbox (optional)                     |
| Unbounded log growth                         | Storage costs                 | Retention config + `purgeExpiredLogs()` (host-scheduled)                |
| PII in raw webhook payloads                  | Compliance exposure           | `redactKeys` config + `storeRawPayload` toggle                         |
| Secret rotation                              | Dropped webhooks              | Multi-secret support; try each in order                                 |
| Scope creep into platform concerns           | Library loses focus           | Responsibility boundary (§2) enforced; non-goals explicit               |

---

## 23. One-Line Positioning (For README)

> **PayHook turns payment provider webhooks into verified transaction truth—a drop-in NestJS library safe for humans and autonomous systems to act on.**