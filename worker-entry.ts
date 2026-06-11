import astroWorker from './dist/_worker.js/index.js';
import { processFlightImageJob, failFlightImageJob, type FlightImageJobPayload } from './src/lib/flight-image-jobs';

export interface Env {
  FLIGHT_IMAGE_QUEUE?: Queue;
  DB?: D1Database;
  IMAGES?: R2Bucket;
  ANTHROPIC_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return astroWorker.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<FlightImageJobPayload>, env: Env, ctx: ExecutionContext) {
    for (const msg of batch.messages) {
      const payload = msg.body;
      try {
        await processFlightImageJob(env, payload);
        msg.ack();
      } catch (e) {
        await failFlightImageJob(env, payload, e);
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
