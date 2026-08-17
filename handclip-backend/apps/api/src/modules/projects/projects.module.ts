import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProjectsController } from './projects.controller';
import { PublicSharesController } from './public-shares.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [ProjectsController, PublicSharesController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
