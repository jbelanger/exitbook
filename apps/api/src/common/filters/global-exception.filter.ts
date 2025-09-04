import { LoggerService } from '@exitbook/shared-logger';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    this.logger.errorWithContext(exception, {
      metadata: {
        body: this.sanitizeRequestBody(request.body),
        ip: request.ip,
        method: request.method,
        path: request.url,
        statusCode: status,
        userAgent: request.headers['user-agent'],
      },
      module: 'GlobalExceptionFilter',
      // Let the logger service handle severity calculation automatically
    });

    // Simplified and more robust response logic
    let responseBody: object | { message: string };

    if (exception instanceof HttpException) {
      const errorResponse = exception.getResponse();
      responseBody = typeof errorResponse === 'string' ? { message: errorResponse } : (errorResponse as object);
    } else {
      responseBody = { message: 'Internal Server Error' };
    }

    response.status(status).json({
      ...responseBody, // Spread the detailed error (e.g., from ValidationPipe)
      path: request.url,
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  }

  private sanitizeRequestBody(body: unknown): unknown {
    if (!body || typeof body !== 'object' || body === null) return body;
    const sanitized = { ...(body as Record<string, unknown>) };
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'authorization'];
    for (const field of sensitiveFields) {
      if (sanitized[field]) sanitized[field] = '[REDACTED]';
    }
    return sanitized;
  }
}
