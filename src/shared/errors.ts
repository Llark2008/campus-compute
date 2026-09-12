// src/shared/errors.ts
import type { ErrorCode } from "./contracts.ts";
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public line?: number) {
    super(message); this.name = "DomainError";
  }
}
