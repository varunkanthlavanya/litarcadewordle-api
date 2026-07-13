import { Router } from "express";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { getAuditLog } from "./audit.service.js";

export const auditAdminRouter = Router();
auditAdminRouter.use(asyncHandler(requireAdminAuth));

auditAdminRouter.get(
  "/:eventId/audit",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getAuditLog(Number(req.params.eventId)));
  })
);
