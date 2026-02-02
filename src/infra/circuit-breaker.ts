import { logger } from '../utils/logger';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit */
  failureThreshold: number;
  /** Time in ms to wait before trying again (half-open state) */
  resetTimeoutMs: number;
  /** Number of successes in half-open state to close circuit */
  successThreshold?: number;
  /** Name for logging purposes */
  name?: string;
}

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastStateChange: number;
  totalTrips: number;
}

/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by fast-failing when a service is unhealthy.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is unhealthy, requests fail immediately
 * - HALF-OPEN: Testing if service has recovered
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private lastStateChange = Date.now();
  private totalTrips = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly name: string;

  constructor(config: CircuitBreakerConfig) {
    this.failureThreshold = config.failureThreshold;
    this.resetTimeoutMs = config.resetTimeoutMs;
    this.successThreshold = config.successThreshold ?? 1;
    this.name = config.name ?? 'circuit-breaker';
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitOpenError(
        `Circuit breaker '${this.name}' is OPEN. Service unavailable.`,
        this.getStats()
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    }
  }

  /**
   * Check if requests can pass through
   */
  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if reset timeout has passed
      const now = Date.now();
      if (this.lastFailureTime && now - this.lastFailureTime >= this.resetTimeoutMs) {
        this.transitionTo('half-open');
        return true;
      }
      return false;
    }

    // half-open: allow limited requests
    return true;
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.transitionTo('closed');
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(error: Error): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Any failure in half-open goes back to open
      this.transitionTo('open');
    } else if (this.state === 'closed' && this.failures >= this.failureThreshold) {
      this.transitionTo('open');
    }

    logger.warn('Circuit breaker recorded failure', {
      name: this.name,
      state: this.state,
      failures: this.failures,
      threshold: this.failureThreshold,
      error: error.message
    });
  }

  /**
   * Get current circuit state and stats
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      totalTrips: this.totalTrips
    };
  }

  /**
   * Manually reset the circuit to closed state
   */
  reset(): void {
    this.transitionTo('closed');
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
  }

  /**
   * Check if circuit is currently open (fast-failing)
   */
  isOpen(): boolean {
    return this.state === 'open';
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'open') {
      this.totalTrips++;
    }

    if (newState === 'closed') {
      this.failures = 0;
      this.successes = 0;
    }

    if (newState === 'half-open') {
      this.successes = 0;
    }

    logger.info('Circuit breaker state transition', {
      name: this.name,
      from: oldState,
      to: newState,
      totalTrips: this.totalTrips
    });
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  public readonly stats: CircuitStats;

  constructor(message: string, stats: CircuitStats) {
    super(message);
    this.name = 'CircuitOpenError';
    this.stats = stats;
  }
}
