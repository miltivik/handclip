import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiConnectionsController } from './ai-connections.controller';
import { AiConnectionsService } from './ai-connections.service';
import { loadPiAiOAuth } from './pi-ai-oauth.loader';
import { OAuthAttemptManager } from './oauth-attempts.service';

@Module({
  imports: [AuthModule],
  controllers: [AiConnectionsController],
  providers: [
    AiConnectionsService,
    {
      provide: OAuthAttemptManager,
      useFactory: (connections: AiConnectionsService) =>
        new OAuthAttemptManager(connections, loadPiAiOAuth),
      inject: [AiConnectionsService],
    },
  ],
  exports: [AiConnectionsService, OAuthAttemptManager],
})
export class AiConnectionsModule {}
