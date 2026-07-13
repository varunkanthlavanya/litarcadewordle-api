import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4 does not catch rejected promises from async handlers — wrap every
 * async route so a thrown/rejected error reaches the global error middleware
 * instead of hanging the request or crashing the process. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
