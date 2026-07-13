import { config } from "../../config/index.js";
import { generateToken, hashToken, safeStringEqual } from "../../shared/tokens.js";
import {
  findAdminSessionByTokenHash,
  insertAdminSession,
  revokeAdminSession,
} from "./authAdmin.repo.js";

export class InvalidSecretKeyError extends Error {
  constructor() {
    super("Invalid admin secret key");
    this.name = "InvalidSecretKeyError";
  }
}

export interface AdminIdentity {
  adminSessionId: number;
  nameLabel: string;
}

export async function loginAdmin(params: {
  secretKey: string;
  nameLabel: string;
  ipAddress: string | null;
}): Promise<{ token: string; expiresAt: Date; nameLabel: string }> {
  if (!safeStringEqual(params.secretKey, config.adminSecretKey)) {
    throw new InvalidSecretKeyError();
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.adminSessionTtlHours * 60 * 60 * 1000);

  const session = await insertAdminSession({
    tokenHash,
    nameLabel: params.nameLabel.trim().slice(0, 100),
    expiresAt,
    ipAddress: params.ipAddress,
  });

  return { token, expiresAt: new Date(session.expires_at), nameLabel: session.name_label };
}

export async function logoutAdmin(token: string): Promise<void> {
  await revokeAdminSession(hashToken(token));
}

export async function resolveAdminToken(token: string): Promise<AdminIdentity | null> {
  const session = await findAdminSessionByTokenHash(hashToken(token));
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;
  return { adminSessionId: session.id, nameLabel: session.name_label };
}
