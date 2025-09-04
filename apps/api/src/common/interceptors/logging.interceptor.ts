import { randomUUID } from 'node:crypto';

import { CorrelationService, ErrorContext, LoggerService } from '@exitbook/shared-logger';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly correlationService: CorrelationService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();
    const correlationId = this.extractOrGenerateCorrelationId(request);

    return this.correlationService.setContextFromActiveSpan(correlationId, () => {
      this.logger.log(
        {
          correlationId,
          ip: this.getClientIp(request),
          method: request.method,
          path: request.path,
          type: 'request_start',
          url: request.url,
          userAgent: request.headers['user-agent'],
        },
        'HTTP'
      );

      return next.handle().pipe(
        tap(responseData => {
          this.logger.log(
            {
              duration: Date.now() - startTime,
              method: request.method,
              path: request.path,
              responseSize: this.estimateResponseSize(responseData),
              statusCode: response.statusCode,
              type: 'request_complete',
            },
            'HTTP'
          );
        }),
        catchError(error => {
          const statusCode = response.statusCode || 500;
          const errorContext: ErrorContext = {
            metadata: {
              duration: Date.now() - startTime,
              ip: this.getClientIp(request),
              method: request.method,
              path: request.path,
              statusCode,
              userAgent: request.headers['user-agent'],
            },
            module: 'HTTP',
            requestId: correlationId,
            // Let the logger service handle severity calculation automatically
          };
          this.logger.errorWithContext(error, errorContext);
          return throwError(() => error);
        })
      );
    });
  }

  private extractOrGenerateCorrelationId(request: Request): string {
    const correlationId =
      (request.headers['x-correlation-id'] as string) ||
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-trace-id'] as string);
    return correlationId || randomUUID();
  }

  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'] as string;
    return forwarded
      ? forwarded.split(',')[0].trim()
      : request.connection?.remoteAddress || request.socket?.remoteAddress || 'unknown';
  }

  private estimateResponseSize(responseData: unknown): number {
    try {
      return responseData ? JSON.stringify(responseData).length : 0;
    } catch {
      return 0;
    }
  }
}
