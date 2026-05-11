/**
 * OpenAI-compatible error response builder.
 * Ensures all API errors follow the standard OpenAI error format
 * so consumers using the OpenAI SDK get expected error shapes.
 */

export interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly type: string,
    public readonly param: string | null,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJSON(): OpenAIErrorBody {
    return {
      error: {
        message: this.message,
        type: this.type,
        param: this.param,
        code: this.code,
      },
    };
  }
}

export class InvalidRequestError extends ApiError {
  constructor(message: string, param: string | null = null, code: string | null = null) {
    super(400, "invalid_request_error", param, code, message);
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = "Invalid API key provided.") {
    super(401, "authentication_error", null, "invalid_api_key", message);
  }
}

export class RateLimitError extends ApiError {
  constructor(message = "Rate limit exceeded. Please retry after a brief wait.") {
    super(429, "rate_limit_error", null, "rate_limit_exceeded", message);
  }
}

export class InternalError extends ApiError {
  constructor(message = "An unexpected error occurred on our end.") {
    super(500, "internal_error", null, "internal_error", message);
  }
}

export class UpstreamError extends ApiError {
  constructor(message = "The upstream image generation service returned an error.") {
    super(502, "upstream_error", null, "upstream_error", message);
  }
}

