/**
 * Example: Using PayHook as a Local Library
 *
 * After linking PayHook locally, use it in your NestJS application
 */

// app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayHookModule } from 'payhook-core';  // Import from linked library
import { PaystackProviderAdapter } from 'payhook-core';

@Module({
  imports: [
    // Your database configuration
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'myapp',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production',
    }),

    // Configure PayHook
    PayHookModule.forRoot({
      storage: {
        adapter: 'typeorm',
      },
      providers: [
        {
          name: 'paystack',
          adapter: PaystackProviderAdapter,
          keys: {
            secretKey: process.env.PAYSTACK_SECRET_KEY!,
            publicKey: process.env.PAYSTACK_PUBLIC_KEY,
          },
        },
      ],
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

// payment.service.ts
import { Injectable } from '@nestjs/common';
import { TransactionService, TransactionStatus } from 'payhook-core';

@Injectable()
export class PaymentService {
  constructor(
    private readonly transactionService: TransactionService,
  ) {}

  async createPayment(orderId: string, amount: number) {
    // Create transaction in PayHook
    const transaction = await this.transactionService.createTransaction({
      applicationRef: orderId,
      provider: 'paystack',
      amount: amount * 100, // Convert to kobo
      currency: 'NGN',
      metadata: {
        orderId,
        createdAt: new Date(),
      },
    });

    // Initialize with Paystack (your own integration)
    const paystackResponse = await this.initializePaystack({
      amount: transaction.money.amount,
      reference: transaction.applicationRef,
      // ... other Paystack params
    });

    // Update PayHook transaction with provider reference
    await this.transactionService.markAsProcessing(
      transaction.id,
      {
        providerRef: paystackResponse.data.reference,
      },
    );

    return {
      transactionId: transaction.id,
      paymentUrl: paystackResponse.data.authorization_url,
    };
  }

  async checkPaymentStatus(transactionId: string) {
    // PayHook will handle webhook updates automatically
    // But you can also query status directly
    const transaction = await this.transactionService.getTransaction(
      transactionId,
      {
        verify: true, // Optionally verify with Paystack API
        includeWebhooks: true, // Include webhook history
      },
    );

    return {
      status: transaction?.status,
      isSettled: transaction?.isSettled(),
      webhooks: transaction?.metadata?.webhooks,
    };
  }

  private async initializePaystack(params: any) {
    // Your Paystack initialization logic
    // This is YOUR code, not PayHook's
    return {
      data: {
        reference: 'ps_' + Date.now(),
        authorization_url: 'https://paystack.com/pay/xxx',
      },
    };
  }
}

// webhook.controller.ts
import { Controller, Post, Body, Headers, Param } from '@nestjs/common';
import { PayHookService } from 'payhook-core';

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly payHookService: PayHookService,
  ) {}

  @Post(':provider')
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() body: Buffer,
    @Headers() headers: any,
  ) {
    // PayHook handles everything: verification, deduplication, state updates
    const result = await this.payHookService.processWebhook(
      provider,
      body,
      headers,
    );

    if (result.success) {
      console.log(`Webhook processed: ${result.fate}`);
      // result.fate: PROCESSED, DUPLICATE, UNMATCHED, etc.
    }

    return { status: 'ok' };
  }
}

// event.handler.ts
import { Injectable } from '@nestjs/common';
import { OnPaymentEvent, PaymentEventContext } from 'payhook-core';

@Injectable()
export class PaymentEventHandler {
  @OnPaymentEvent('payment.succeeded')
  async handleSuccess(context: PaymentEventContext) {
    console.log('Payment successful:', context.transaction.id);

    // Your business logic here
    await this.sendSuccessEmail(context.transaction);
    await this.fulfillOrder(context.transaction.applicationRef);
  }

  @OnPaymentEvent('payment.failed')
  async handleFailure(context: PaymentEventContext) {
    console.log('Payment failed:', context.transaction.id);

    // Your business logic here
    await this.notifyCustomer(context.transaction);
  }

  private async sendSuccessEmail(transaction: any) {
    // Your email logic
  }

  private async fulfillOrder(orderId: string) {
    // Your order fulfillment logic
  }

  private async notifyCustomer(transaction: any) {
    // Your notification logic
  }
}