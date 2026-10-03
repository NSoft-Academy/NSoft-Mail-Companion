// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
