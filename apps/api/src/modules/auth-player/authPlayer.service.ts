import { config } from "../../config/index.js";
import { generateToken, hashToken } from "../../shared/tokens.js";
import { findEventPlayerByMobile, findEventPlayerById } from "../events/eventPlayers.repo.js";
import {
  findPlayerSessionByTokenHash,
  insertPlayerLoginSession,
  revokePlayerSession,
  touchPlayerSession,
} from "./authPlayer.repo.js";

export class PlayerNotOnCohortError extends Error {
  constructor() {
    super("This mobile number is not on the whitelist for this event");
    this.name = "PlayerNotOnCohortError";
  }
}

export interface PlayerIdentity {
  eventPlayerId: number;
  eventId: number;
  mobileNumber: string;
  displayName: string | null;
}

export async function loginPlayer(params: {
  eventId: number;
  mobileNumber: string;
}): Promise<{ token: string; expiresAt: Date; player: PlayerIdentity }> {
  const eventPlayer = await findEventPlayerByMobile(params.eventId, params.mobileNumber);
  if (!eventPlayer) {
    throw new PlayerNotOnCohortError();
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.playerSessionTtlHours * 60 * 60 * 1000);

  await insertPlayerLoginSession({ eventPlayerId: eventPlayer.id, tokenHash, expiresAt });

  return {
    token,
    expiresAt,
    player: {
      eventPlayerId: eventPlayer.id,
      eventId: eventPlayer.event_id,
      mobileNumber: eventPlayer.mobile_number,
      displayName: eventPlayer.display_name,
    },
  };
}

export async function logoutPlayer(token: string): Promise<void> {
  await revokePlayerSession(hashToken(token));
}

export async function resolvePlayerToken(token: string): Promise<PlayerIdentity | null> {
  const tokenHash = hashToken(token);
  const session = await findPlayerSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  await touchPlayerSession(tokenHash);

  const eventPlayer = await findEventPlayerById(session.event_player_id);
  if (!eventPlayer) return null;

  return {
    eventPlayerId: eventPlayer.id,
    eventId: eventPlayer.event_id,
    mobileNumber: eventPlayer.mobile_number,
    displayName: eventPlayer.display_name,
  };
}
