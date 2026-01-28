type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  projectId?: string;
  [key: string]: unknown;
}

class Logger {
  private minLevel: LogLevel = 'info';

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (this.levelPriority[level] < this.levelPriority[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context
    };

    // 确保 projectId 总是在前面
    const { projectId, timestamp, level: entryLevel, message: entryMsg, ...rest } = entry;
    const output = projectId
      ? { timestamp, level: entryLevel, projectId, message: entryMsg, ...rest }
      : entry;

    const line = JSON.stringify(output);

    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }
}

export const logger = new Logger();
