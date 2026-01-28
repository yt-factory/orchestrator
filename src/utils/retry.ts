interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs, onRetry } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      onRetry?.(attempt, error as Error);

      // 指数退避 + 抖动
      const delay = baseDelayMs * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Unexpected: retry loop exhausted');
}
