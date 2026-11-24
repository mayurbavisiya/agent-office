import { loadOrCreateConfig } from '../src/shared/config.js';
import { startApp } from '../src/core/app.js';

const cfg = loadOrCreateConfig();
const app = await startApp({ startedBy: 'serve' });
console.log(`${app.url}/?token=${cfg.token}`);
const stop = () => void app.close().finally(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
