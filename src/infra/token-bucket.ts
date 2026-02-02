interface TokenBucketConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  /** Jitter percentage (0-1). E.g., 0.1 = ±10% jitter on wait times. Default: 0.1 */
  jitterFactor?: number;
}

export class TokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefillTime: number;
  private readonly jitterFactor: number;

  constructor(config: TokenBucketConfig) {
    this.maxTokens = config.maxTokens;
    this.tokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.lastRefillTime = Date.now();
    // Default jitter factor from env or 0.1 (±10%)
    this.jitterFactor = config.jitterFactor ??
      parseFloat(process.env.TOKEN_BUCKET_JITTER_FACTOR ?? '0.1');
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // 等待直到有 token 可用 (with jitter to prevent thundering herd)
    const baseWaitMs = ((1 - this.tokens) / this.refillRate) * 1000;
    const jitteredWaitMs = this.applyJitter(baseWaitMs);
    await new Promise<void>((resolve) => setTimeout(resolve, jitteredWaitMs));

    this.refill();
    this.tokens -= 1;
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefillTime = now;
  }

  /**
   * Apply jitter to a wait time to prevent thundering herd
   * @param baseMs Base wait time in milliseconds
   * @returns Wait time with random jitter applied (±jitterFactor%)
   */
  private applyJitter(baseMs: number): number {
    if (this.jitterFactor <= 0) return baseMs;

    // Random value between -jitterFactor and +jitterFactor
    const jitterMultiplier = 1 + (Math.random() * 2 - 1) * this.jitterFactor;
    return Math.max(0, baseMs * jitterMultiplier);
  }

  /**
   * Get current bucket statistics for monitoring
   */
  getStats(): { available: number; max: number; refillRate: number } {
    this.refill();
    return {
      available: Math.floor(this.tokens),
      max: this.maxTokens,
      refillRate: this.refillRate
    };
  }
}
