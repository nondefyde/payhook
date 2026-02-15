import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PayHookModule } from './modules';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PayHookModule.forRoot({
      storage: {
        type: 'mock', // Using mock storage for now
      },
      providers: [
        {
          name: 'paystack',
          adapter: 'mock', // Using mock adapter for development
          keys: {
            secretKey: 'sk_test_xxx',
            webhookSecret: 'whsec_test_xxx',
          },
        },
      ],
      webhooks: {
        skipSignatureVerification: true, // Skip for development
        storeRawPayload: true,
      },
      events: {
        enableLogging: true,
      },
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
