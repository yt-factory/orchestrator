export type Priority = 'high' | 'medium' | 'low';

interface QueueItem {
  priority: Priority;
  resolve: () => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  high: 0,    // Script generation
  medium: 1,  // SEO generation
  low: 2      // Shorts extraction
};

/** Error thrown when queue is at capacity */
export class QueueFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueFullError';
  }
}

interface PriorityQueueConfig {
  /** Maximum concurrent requests being processed */
  maxConcurrent?: number;
  /** Maximum queue size (waiting requests). Set to 0 for unbounded. */
  maxQueueSize?: number;
  /** Whether to drop lowest priority items when full (true) or reject new items (false) */
  dropLowestOnFull?: boolean;
}

export class PriorityQueue {
  private queue: QueueItem[] = [];
  private processing = 0;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly dropLowestOnFull: boolean;

  constructor(config: PriorityQueueConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 5;
    // Default max queue size from env or 100
    this.maxQueueSize = config.maxQueueSize ??
      parseInt(process.env.PRIORITY_QUEUE_MAX_SIZE ?? '100', 10);
    this.dropLowestOnFull = config.dropLowestOnFull ?? true;
  }

  async enqueue(priority: Priority): Promise<void> {
    if (this.processing < this.maxConcurrent) {
      this.processing++;
      return;
    }

    // Check if queue is at capacity
    if (this.maxQueueSize > 0 && this.queue.length >= this.maxQueueSize) {
      if (this.dropLowestOnFull) {
        // Try to drop a lower priority item
        const dropped = this.dropLowestPriority(priority);
        if (!dropped) {
          // No lower priority item to drop, reject this request
          throw new QueueFullError(
            `Priority queue is full (${this.maxQueueSize} items). ` +
            `No lower priority items to drop for priority '${priority}'.`
          );
        }
      } else {
        // Simply reject the new request
        throw new QueueFullError(
          `Priority queue is full (${this.maxQueueSize} items). Request rejected.`
        );
      }
    }

    return new Promise((resolve, reject) => {
      const item: QueueItem = {
        priority,
        resolve: () => {
          this.processing++;
          resolve();
        },
        reject,
        enqueuedAt: Date.now()
      };

      // 按优先级插入
      const insertIndex = this.queue.findIndex(
        (existing) => PRIORITY_WEIGHTS[existing.priority]! > PRIORITY_WEIGHTS[priority]!
      );

      if (insertIndex === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(insertIndex, 0, item);
      }
    });
  }

  /**
   * Try to drop the lowest priority item that has lower priority than the given one
   * Returns true if an item was dropped, false otherwise
   */
  private dropLowestPriority(incomingPriority: Priority): boolean {
    // Find the last item in queue (lowest priority due to sorting)
    if (this.queue.length === 0) return false;

    const lastItem = this.queue[this.queue.length - 1]!;
    const lastWeight = PRIORITY_WEIGHTS[lastItem.priority]!;
    const incomingWeight = PRIORITY_WEIGHTS[incomingPriority]!;

    // Only drop if incoming has higher priority (lower weight)
    if (incomingWeight < lastWeight) {
      this.queue.pop();
      lastItem.reject(new QueueFullError(
        `Request dropped due to queue pressure. Priority: ${lastItem.priority}`
      ));
      return true;
    }

    return false;
  }

  dequeue(): void {
    this.processing--;

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getProcessingCount(): number {
    return this.processing;
  }

  /**
   * Get queue statistics for monitoring
   */
  getStats(): { processing: number; queued: number; maxQueueSize: number; utilization: number } {
    return {
      processing: this.processing,
      queued: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      utilization: this.maxQueueSize > 0
        ? Math.round((this.queue.length / this.maxQueueSize) * 100)
        : 0
    };
  }
}
