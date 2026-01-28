export type Priority = 'high' | 'medium' | 'low';

interface QueueItem {
  priority: Priority;
  resolve: () => void;
  enqueuedAt: number;
}

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  high: 0,    // Script generation
  medium: 1,  // SEO generation
  low: 2      // Shorts extraction
};

export class PriorityQueue {
  private queue: QueueItem[] = [];
  private processing = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue(priority: Priority): Promise<void> {
    if (this.processing < this.maxConcurrent) {
      this.processing++;
      return;
    }

    return new Promise((resolve) => {
      const item: QueueItem = {
        priority,
        resolve: () => {
          this.processing++;
          resolve();
        },
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
}
