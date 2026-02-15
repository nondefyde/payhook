import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('PayHook — Transaction Truth Engine')
    .setDescription(
      'Turns payment provider webhooks into verified transaction truth. 4 endpoints. Query-first. Safe for humans and AI agents.',
    )
    .setVersion('0.1.0')
    .addTag('Ingest', 'Receive and process provider webhooks')
    .addTag(
      'Query',
      'Transaction state, verification confidence, and settlement status',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 4010;
  await app.listen(port, () => {
    console.log(
      `🚀 PayHook Transaction Truth Engine is running on http://localhost:${port}`,
    );
    console.log(
      `📚 OpenAPI documentation available at http://localhost:${port}/api`,
    );
    console.log(
      `📄 OpenAPI JSON spec available at http://localhost:${port}/api-json`,
    );
  });
}
bootstrap();
