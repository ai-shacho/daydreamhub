import astroWorker from './dist/_worker.js/index.js';
import { processFlightImageJob, failFlightImageJob } from './src/lib/flight-image-jobs.ts';

export default {
  async fetch(request, env, ctx) {
    return astroWorker.fetch(request, env, ctx);
  },

  async queue(batch, env, ctx) {
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
};
