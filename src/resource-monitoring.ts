import * as path from 'path';
import { Worker } from 'worker_threads';
import { l } from '../log.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ResourceMonitoringWorkerLaunch = (sample_period: number) => {
  const worker = new Worker(path.resolve(__dirname, "..", "workers", "resource-monitoring-worker.js"), {workerData: { sample_period }});
  worker.on('exit', (code) => {
    console.error(`Worker stopped with exit code ${code}`);
  });
};
