/**
 * Process lifecycle for the worker: what happens when startup fails, when a stop signal arrives, and when something throws that nothing caught.
 *
 * The worker used to log a startup failure and then keep running with no workers attached, because its Redis connection held the process open. Docker's
 * `restart: always` only acts on an exit, so a database that was briefly down at boot left the queues unprocessed with every health signal green.
 */

export interface LifecycleLogger {
  log(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface LifecycleOptions {
  /** How long a graceful stop may take before the process gives up and exits non-zero. Keep it under the container's stop_grace_period. */
  shutdownTimeoutMs?: number;
  logger?: LifecycleLogger;
  exit?: (code: number) => void;
  /** Where signals and fatal-error hooks attach. Injected so tests never touch the real process. */
  proc?: Pick<NodeJS.Process, 'on'>;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

/**
 * Runs `start`, which returns the function that stops everything it started.
 * - startup failure: logged, exit code 1 (so the supervisor restarts the container);
 * - SIGTERM / SIGINT: one graceful stop, bounded by a timeout, exit 0 on success and 1 on failure or timeout;
 * - an unhandled rejection or uncaught exception: logged, then the same graceful stop, exit 1.
 */
export function runWithLifecycle(start: () => Promise<() => Promise<void>>, options: LifecycleOptions = {}): Promise<void> {
  const {
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    logger = { log: (m) => console.log(m), error: (m, e) => console.error(m, e) },
    exit = (code) => process.exit(code),
    proc = process,
  } = options;

  let stop: (() => Promise<void>) | undefined;
  let stopping = false;

  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.log(`Worker: ${reason}, shutting down`);
    const timer = setTimeout(() => {
      logger.error(`Worker: graceful shutdown did not finish within ${shutdownTimeoutMs}ms, forcing exit`);
      exit(1);
    }, shutdownTimeoutMs);
    timer.unref();
    try {
      await stop?.();
      clearTimeout(timer);
      exit(exitCode);
    } catch (error) {
      clearTimeout(timer);
      logger.error('Worker: error during shutdown', error);
      exit(1);
    }
  };

  proc.on('SIGTERM', () => void shutdown('SIGTERM received', 0));
  proc.on('SIGINT', () => void shutdown('SIGINT received', 0));
  proc.on('unhandledRejection', (reason) => {
    logger.error('Worker: unhandled promise rejection', reason);
    void shutdown('unhandled rejection', 1);
  });
  proc.on('uncaughtException', (error) => {
    logger.error('Worker: uncaught exception', error);
    void shutdown('uncaught exception', 1);
  });

  return start().then(
    (stopFn) => {
      stop = stopFn;
    },
    (error: unknown) => {
      logger.error(`Worker failed to start: ${describe(error)}`);
      stopping = true;
      exit(1);
    },
  );
}
