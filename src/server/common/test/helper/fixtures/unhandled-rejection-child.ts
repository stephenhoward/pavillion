// Child-process fixture for unhandled-rejection.test.ts. Installs the
// backstop, drops a rejected promise on the floor, then proves the process
// is still running one tick later. Run with NODE_ENV=test LOG_LEVEL=error so
// pino writes JSON to stdout without a pretty-print transport.
import { installUnhandledRejectionHandler } from '@/server/common/helper/unhandled-rejection';

installUnhandledRejectionHandler();

Promise.reject(new Error('fixture rejection'));

setTimeout(() => {
  process.stdout.write('still-alive\n');
}, 50);
