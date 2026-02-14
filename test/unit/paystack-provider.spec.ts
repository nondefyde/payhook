import * as crypto from 'crypto';
import { PaystackProviderAdapter, NormalizedEventType } from '../../src';

describe('PaystackProviderAdapter', () => {
  let adapter: PaystackProviderAdapter;

  beforeEach(() => {
    adapter = new PaystackProviderAdapter();
  });

  describe('Signature Verification', () => {
    it('should verify valid HMAC-SHA512 signature', () => {
      const secret = 'sk_test_xxxxxxxxxxxxx';
      const payload = JSON.stringify({
        event: 'charge.success',
        data: {
          id: 123456789,
          reference: 'ref_test_123',
          amount: 10000,
          currency: 'NGN',
        },
      });
      const body = Buffer.from(payload);

      // Generate correct signature
      const signature = crypto
        .createHmac('sha512', secret)
        .update(body)
        .digest('hex');

      const headers = {
        'x-paystack-signature': signature,
      };

      const isValid = adapter.verifySignature(body, headers, [secret]);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const body = Buffer.from('{"event":"charge.success"}');
      const headers = {
        'x-paystack-signature': 'invalid_signature',
      };

      const isValid = adapter.verifySignature(body, headers, ['sk_test_xxx']);
      expect(isValid).toBe(false);
    });

    it('should handle missing signature header', () => {
      const body = Buffer.from('{"event":"charge.success"}');
      const headers = {};

      const isValid = adapter.verifySignature(body, headers, ['sk_test_xxx']);
      expect(isValid).toBe(false);
    });

    it('should try multiple secrets', () => {
      const correctSecret = 'sk_live_correct';
      const payload = '{"event":"charge.success"}';
      const body = Buffer.from(payload);

      const signature = crypto
        .createHmac('sha512', correctSecret)
        .update(body)
        .digest('hex');

      const headers = {
        'x-paystack-signature': signature,
      };

      const isValid = adapter.verifySignature(body, headers, [
        'sk_test_wrong',
        correctSecret,
        'sk_test_another_wrong',
      ]);

      expect(isValid).toBe(true);
    });
  });

  describe('Payload Parsing', () => {
    it('should parse valid Paystack webhook payload', () => {
      const payload = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: {
            id: 123456789,
            reference: 'ref_test_123',
            amount: 10000,
            currency: 'NGN',
          },
        }),
      );

      const parsed = adapter.parsePayload(payload);

      expect(parsed.event).toBe('charge.success');
      expect(parsed.data.id).toBe(123456789);
      expect(parsed.data.reference).toBe('ref_test_123');
    });

    it('should throw error for invalid JSON', () => {
      const payload = Buffer.from('not a json');

      expect(() => adapter.parsePayload(payload)).toThrow(
        'Failed to parse Paystack payload',
      );
    });

    it('should throw error for missing event field', () => {
      const payload = Buffer.from(
        JSON.stringify({
          data: { id: 123 },
        }),
      );

      expect(() => adapter.parsePayload(payload)).toThrow(
        'Invalid Paystack webhook structure',
      );
    });
  });

  describe('Event Normalization', () => {
    it('should normalize charge.success event', () => {
      const rawPayload = {
        event: 'charge.success',
        data: {
          id: 123456789,
          reference: 'ref_test_123',
          amount: 10000, // 100 NGN in kobo
          currency: 'NGN',
          status: 'success',
          customer: {
            id: 1234,
            customer_code: 'CUS_xxxxxxxxxxxxx',
            email: 'user@example.com',
            first_name: 'John',
            last_name: 'Doe',
          },
          metadata: {
            order_id: 'order_123',
            custom_field: 'value',
          },
          created_at: '2024-01-15T10:30:00.000Z',
        },
      };

      const normalized = adapter.normalize(rawPayload);

      expect(normalized.eventType).toBe(NormalizedEventType.PAYMENT_SUCCEEDED);
      expect(normalized.amount).toBe(10000);
      expect(normalized.currency).toBe('NGN');
      expect(normalized.providerRef).toBe('ref_test_123');
      expect(normalized.applicationRef).toBe('order_123');
      expect(normalized.customerEmail).toBe('user@example.com');
      expect(normalized.providerMetadata?.customer?.name).toBe('John Doe');
      expect(normalized.providerMetadata?.metadata?.custom_field).toBe('value');
    });

    it('should normalize refund.processed event', () => {
      const rawPayload = {
        event: 'refund.processed',
        data: {
          id: 987654321,
          reference: 'ref_refund_456',
          amount: 5000,
          currency: 'NGN',
          status: 'processed',
          transaction_reference: 'ref_original_123',
          metadata: {},
        },
      };

      const normalized = adapter.normalize(rawPayload);

      expect(normalized.eventType).toBe(NormalizedEventType.REFUND_COMPLETED);
      expect(normalized.amount).toBe(5000);
      expect(normalized.providerRef).toBe('ref_refund_456');
    });

    it('should normalize dispute.create event', () => {
      const rawPayload = {
        event: 'dispute.create',
        data: {
          id: 555555,
          reference: 'ref_dispute_789',
          amount: 20000,
          currency: 'NGN',
          status: 'pending',
          reason: 'Fraudulent transaction',
        },
      };

      const normalized = adapter.normalize(rawPayload);

      expect(normalized.eventType).toBe(NormalizedEventType.DISPUTE_CREATED);
      expect(normalized.amount).toBe(20000);
    });

    it('should handle unknown events', () => {
      const rawPayload = {
        event: 'unknown.event',
        data: {
          id: 111111,
        },
      };

      const normalized = adapter.normalize(rawPayload);

      expect(normalized.eventType).toBe(NormalizedEventType.UNKNOWN);
    });
  });

  describe('Reference Extraction', () => {
    it('should extract provider and application references', () => {
      const rawPayload = {
        event: 'charge.success',
        data: {
          id: 123456789,
          reference: 'prov_ref_123',
          metadata: {
            order_id: 'app_ref_456',
          },
        },
      };

      const refs = adapter.extractReferences(rawPayload);

      expect(refs.providerRef).toBe('prov_ref_123');
      expect(refs.applicationRef).toBe('app_ref_456');
    });

    it('should handle missing metadata', () => {
      const rawPayload = {
        event: 'charge.success',
        data: {
          id: 123456789,
          reference: 'prov_ref_123',
        },
      };

      const refs = adapter.extractReferences(rawPayload);

      expect(refs.providerRef).toBe('prov_ref_123');
      expect(refs.applicationRef).toBeUndefined();
    });

    it('should use transaction_id from metadata if order_id not present', () => {
      const rawPayload = {
        event: 'charge.success',
        data: {
          reference: 'prov_ref',
          metadata: {
            transaction_id: 'txn_789',
          },
        },
      };

      const refs = adapter.extractReferences(rawPayload);

      expect(refs.applicationRef).toBe('txn_789');
    });
  });

  describe('Idempotency Key Extraction', () => {
    it('should generate idempotency key from event and id', () => {
      const rawPayload = {
        event: 'charge.success',
        data: {
          id: 123456789,
          reference: 'ref_test',
        },
      };

      const key = adapter.extractIdempotencyKey(rawPayload);

      expect(key).toBe('charge.success_123456789');
    });

    it('should use reference if id not available', () => {
      const rawPayload = {
        event: 'transfer.success',
        data: {
          reference: 'ref_test',
        },
      };

      const key = adapter.extractIdempotencyKey(rawPayload);

      expect(key).toBe('transfer.success_ref_test');
    });
  });

  describe('Event Classification', () => {
    it('should identify success events', () => {
      expect(adapter.isSuccessEvent('charge.success')).toBe(true);
      expect(adapter.isSuccessEvent('transfer.success')).toBe(true);
      expect(adapter.isSuccessEvent('paymentrequest.success')).toBe(true);
      expect(adapter.isSuccessEvent('charge.failed')).toBe(false);
    });

    it('should identify failure events', () => {
      expect(adapter.isFailureEvent('charge.failed')).toBe(true);
      expect(adapter.isFailureEvent('transfer.failed')).toBe(true);
      expect(adapter.isFailureEvent('invoice.payment_failed')).toBe(true);
      expect(adapter.isFailureEvent('charge.success')).toBe(false);
    });

    it('should identify refund events', () => {
      expect(adapter.isRefundEvent('refund.pending')).toBe(true);
      expect(adapter.isRefundEvent('refund.processing')).toBe(true);
      expect(adapter.isRefundEvent('refund.processed')).toBe(true);
      expect(adapter.isRefundEvent('refund.failed')).toBe(true);
      expect(adapter.isRefundEvent('charge.success')).toBe(false);
    });

    it('should identify dispute events', () => {
      expect(adapter.isDisputeEvent('dispute.create')).toBe(true);
      expect(adapter.isDisputeEvent('dispute.remind')).toBe(true);
      expect(adapter.isDisputeEvent('dispute.resolve')).toBe(true);
      expect(adapter.isDisputeEvent('charge.success')).toBe(false);
    });
  });

  describe('Metadata Extraction', () => {
    it('should extract comprehensive metadata', () => {
      const rawPayload = {
        event: 'charge.success',
        data: {
          id: 123456789,
          reference: 'ref_test',
          gateway_response: 'Successful',
          channel: 'card',
          ip_address: '192.168.1.1',
          fees: 150,
          authorization: {
            authorization_code: 'AUTH_xxxxx',
            card_type: 'visa',
            last4: '1234',
            exp_month: '12',
            exp_year: '2025',
            bank: 'Test Bank',
          },
          metadata: {
            custom_field: 'value',
          },
        },
      };

      const normalized = adapter.normalize(rawPayload);

      expect(normalized.providerMetadata?.gateway_response).toBe('Successful');
      expect(normalized.providerMetadata?.channel).toBe('card');
      expect(normalized.providerMetadata?.ip_address).toBe('192.168.1.1');
      expect(normalized.providerMetadata?.fees).toBe(150);
      expect(normalized.providerMetadata?.authorization?.card_type).toBe('visa');
      expect(normalized.providerMetadata?.authorization?.last4).toBe('1234');
      expect(normalized.providerMetadata?.custom_field).toBe('value');
    });
  });
});
