// modules/flow/flow.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Param,
  NotFoundException,
  Sse,
  Get,
} from '@nestjs/common';
import { FlowService } from './flow.service';
import { GenerateVideoFlowDto } from './dto/generate-video.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { VideoResponseDto } from '@videos/dto/video-response.dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { interval, Observable, switchMap } from 'rxjs';

@Controller('flow')
export class FlowController {
  constructor(
    private readonly flowService: FlowService,
    @InjectQueue('video-generation') private readonly flowQueue: Queue,
  ) {}

  @Post('generate-video')
  @UseGuards(JwtAuthGuard)
  async generateVideoFlow(
    @Body() generateVideoFlowDto: GenerateVideoFlowDto,
    @Req() req: any,
  ): Promise<VideoResponseDto> {
    return this.flowService.generateVideoFlow(
      generateVideoFlowDto,
      req.user.userId,
    );
  }

  /**
   * Orchestrates the full video generation flow.
   * Protected by JWT authentication.
   */
  @Post('generate-video-job')
  @UseGuards(JwtAuthGuard)
  async enqueueVideoJob(
    @Body() generateVideoFlowDto: GenerateVideoFlowDto,
    @Req() req: any,
  ) {
    const { scriptId } = generateVideoFlowDto;
    const job = await this.flowQueue.add('generate', {
      userId: req.user.userId,
      scriptId,
    });

    return {
      message: 'Video generation started',
      scriptId,
      jobId: job.id,
    };
  }

  @Get('job/:id/status')
  async getJobStatus(@Param('id') jobId: string) {
    const job = await this.flowQueue.getJob(jobId);
    if (!job) throw new NotFoundException('Job not found');

    const state = await job.getState(); // 'completed', 'failed', 'waiting', etc.
    const progress = job.progress();
    const reason = job.failedReason;

    return { id: job.id, state, progress, reason };
  }

  @Sse('job/:id/stream')
  sseJobProgress(@Param('id') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const job = await this.flowQueue.getJob(jobId);
        if (!job) {
          const data = JSON.stringify({ error: 'Job not found' });
          return { data } as MessageEvent;
        }

        const progress = job.progress();
        const state = await job.getState();
        const data = JSON.stringify({ jobId, state, progress });
        return { data } as MessageEvent;
      }),
    );
  }
}
