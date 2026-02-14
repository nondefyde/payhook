import * as crypto from 'crypto';

/**
 * Paystack Webhook Factory
 * Generates realistic Paystack webhook payloads for testing
 */
export class PaystackWebhookFactory {
  /**
   * Generate a charge.success webhook
   */
  static chargeSuccess(
    options: {
      reference?: string;
      amount?: number;
      currency?: string;
      orderId?: string;
      email?: string;
    } = {},
  ): {
    body: Buffer;
    headers: Record<string, string>;
    payload: any;
  } {
    const payload = {
      event: 'charge.success',
      data: {
        id: Math.floor(Math.random() * 1000000000),
        domain: 'test',
        status: 'success',
        reference: options.reference || `ref_${Date.now()}`,
        amount: options.amount || 10000, // Default 100 NGN
        message: null,
        gateway_response: 'Successful',
        paid_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        channel: 'card',
        currency: options.currency || 'NGN',
        ip_address: '192.168.1.1',
        metadata: {
          order_id: options.orderId || `order_${Date.now()}`,
          custom_fields: [
            {
              display_name: 'Order ID',
              variable_name: 'order_id',
              value: options.orderId || `order_${Date.now()}`,
            },
          ],
        },
        fees: Math.floor((options.amount || 10000) * 0.015), // 1.5% fees
        customer: {
          id: Math.floor(Math.random() * 1000000),
          first_name: 'John',
          last_name: 'Doe',
          email: options.email || 'john.doe@example.com',
          customer_code: `CUS_${Math.random().toString(36).substring(7)}`,
          phone: '+2348012345678',
          risk_action: 'default',
        },
        authorization: {
          authorization_code: `AUTH_${Math.random().toString(36).substring(7)}`,
          bin: '408408',
          last4: '4081',
          exp_month: '12',
          exp_year: '2025',
          channel: 'card',
          card_type: 'visa',
          bank: 'TEST BANK',
          country_code: 'NG',
          brand: 'visa',
          reusable: true,
          signature: `SIG_${Math.random().toString(36).substring(7)}`,
        },
        plan: {},
        paidAt: new Date().toISOString(),
      },
    };

    const body = Buffer.from(JSON.stringify(payload));

    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': '',
      },
      payload,
    };
  }

  /**
   * Generate a charge.failed webhook
   */
  static chargeFailed(
    options: {
      reference?: string;
      amount?: number;
      reason?: string;
    } = {},
  ): {
    body: Buffer;
    headers: Record<string, string>;
    payload: any;
  } {
    const payload = {
      event: 'charge.failed',
      data: {
        id: Math.floor(Math.random() * 1000000000),
        domain: 'test',
        status: 'failed',
        reference: options.reference || `ref_${Date.now()}`,
        amount: options.amount || 10000,
        message: options.reason || 'Card declined',
        gateway_response: options.reason || 'Card declined by bank',
        created_at: new Date().toISOString(),
        channel: 'card',
        currency: 'NGN',
        ip_address: '192.168.1.1',
        metadata: {},
        customer: {
          email: 'user@example.com',
        },
      },
    };

    const body = Buffer.from(JSON.stringify(payload));

    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': '',
      },
      payload,
    };
  }

  /**
   * Generate a refund.processed webhook
   */
  static refundProcessed(
    options: {
      reference?: string;
      transactionReference?: string;
      amount?: number;
    } = {},
  ): {
    body: Buffer;
    headers: Record<string, string>;
    payload: any;
  } {
    const payload = {
      event: 'refund.processed',
      data: {
        id: Math.floor(Math.random() * 1000000),
        domain: 'test',
        reference: options.reference || `ref_refund_${Date.now()}`,
        amount: options.amount || 5000,
        currency: 'NGN',
        status: 'processed',
        refunded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        transaction: {
          reference: options.transactionReference || `ref_txn_${Date.now()}`,
          id: Math.floor(Math.random() * 1000000000),
        },
        customer: {
          email: 'user@example.com',
        },
      },
    };

    const body = Buffer.from(JSON.stringify(payload));

    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': '',
      },
      payload,
    };
  }

  /**
   * Generate a transfer.success webhook
   */
  static transferSuccess(
    options: {
      reference?: string;
      amount?: number;
      recipient?: string;
    } = {},
  ): {
    body: Buffer;
    headers: Record<string, string>;
    payload: any;
  } {
    const payload = {
      event: 'transfer.success',
      data: {
        id: Math.floor(Math.random() * 1000000),
        domain: 'test',
        reference: options.reference || `ref_transfer_${Date.now()}`,
        amount: options.amount || 50000,
        currency: 'NGN',
        status: 'success',
        transfer_code: `TRF_${Math.random().toString(36).substring(7)}`,
        transferred_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        recipient: {
          name: options.recipient || 'John Doe',
          account_number: '0123456789',
          bank_code: '058',
          currency: 'NGN',
        },
        metadata: {},
      },
    };

    const body = Buffer.from(JSON.stringify(payload));

    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': '',
      },
      payload,
    };
  }

  /**
   * Generate a subscription.create webhook
   */
  static subscriptionCreate(
    options: {
      subscriptionCode?: string;
      amount?: number;
      interval?: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'annually';
    } = {},
  ): {
    body: Buffer;
    headers: Record<string, string>;
    payload: any;
  } {
    const payload = {
      event: 'subscription.create',
      data: {
        id: Math.floor(Math.random() * 1000000),
        domain: 'test',
        status: 'active',
        subscription_code:
          options.subscriptionCode ||
          `SUB_${Math.random().toString(36).substring(7)}`,
        amount: options.amount || 10000,
        cron_expression: '0 0 * * *',
        next_payment_date: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        open_invoice: null,
        created_at: new Date().toISOString(),
        plan: {
          name: 'Premium Plan',
          plan_code: `PLN_${Math.random().toString(36).substring(7)}`,
          amount: options.amount || 10000,
          interval: options.interval || 'monthly',
          currency: 'NGN',
        },
        customer: {
          email: 'subscriber@example.com',
          customer_code: `CUS_${Math.random().toString(36).substring(7)}`,
        },
        authorization: {
          authorization_code: `AUTH_${Math.random().toString(36).substring(7)}`,
        },
        metadata: {},
      },
    };

    const body = Buffer.from(JSON.stringify(payload));

    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': '',
      },
      payload,
    };
  }

  /**
   * Sign a webhook payload with a secret
   */
  static sign(body: Buffer, secret: string): string {
    return crypto.createHmac('sha512', secret).update(body).digest('hex');
  }

  /**
   * Generate a signed webhook
   */
  static generateSignedWebhook(
    event:
      | 'charge.success'
      | 'charge.failed'
      | 'refund.processed'
      | 'transfer.success'
      | 'subscription.create',
    options: any = {},
    secret: string = 'sk_test_xxxxxxxxxxxxx',
  ): {
    body: Buffer;
    headers: Record<string, string>;
  } {
    let webhook;

    switch (event) {
      case 'charge.success':
        webhook = this.chargeSuccess(options);
        break;
      case 'charge.failed':
        webhook = this.chargeFailed(options);
        break;
      case 'refund.processed':
        webhook = this.refundProcessed(options);
        break;
      case 'transfer.success':
        webhook = this.transferSuccess(options);
        break;
      case 'subscription.create':
        webhook = this.subscriptionCreate(options);
        break;
      default:
        webhook = this.chargeSuccess(options);
    }

    const signature = this.sign(webhook.body, secret);
    webhook.headers['x-paystack-signature'] = signature;

    return {
      body: webhook.body,
      headers: webhook.headers,
    };
  }

  /**
   * Generate batch of webhooks for testing
   */
  static batch(
    count: number,
    secret?: string,
  ): Array<{
    body: Buffer;
    headers: Record<string, string>;
  }> {
    const events: Array<
      | 'charge.success'
      | 'charge.failed'
      | 'refund.processed'
      | 'transfer.success'
      | 'subscription.create'
    > = ['charge.success', 'charge.failed', 'refund.processed'];

    const webhooks: Array<{
      body: Buffer;
      headers: Record<string, string>;
    }> = [];

    for (let i = 0; i < count; i++) {
      const event = events[i % events.length];
      webhooks.push(
        this.generateSignedWebhook(
          event,
          {
            reference: `batch_ref_${i}`,
            amount: (i + 1) * 1000,
          },
          secret,
        ),
      );
    }

    return webhooks;
  }
}
