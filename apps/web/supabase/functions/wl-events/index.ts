// Port of apps/api/src/modules/events/{events.routes,events.service,events.repo,eventPlayers.repo,eventStats.service}.ts
// Handles (all admin-authenticated): POST /, GET /, GET /:id, POST /:id/cohort,
// GET /:id/cohort, GET /:id/stats, POST /:id/status, POST /:id/config
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, AuthError } from "../_shared/auth.ts";
import { writeAuditEntry } from "../_shared/audit.ts";

const MAX_COHORT_SIZE = 600;
const EVENT_TIMEZONE = Deno.env.get("EVENT_TIMEZONE") ?? "Asia/Kolkata";
const EVENT_STATUSES = [
  "DRAFT", "COHORT_UPLOADED", "PRELIMS_SCHEDULED", "PRELIMS_LIVE", "PRELIMS_CLOSED",
  "PLAYOFFS_SCHEDULED", "PLAYOFFS_LIVE", "PLAYOFFS_CLOSED", "ARCHIVED",
];
// "Online now" had no equivalent to Socket.IO connection presence once the
// persistent server went away — approximated instead as "touched a session
// in the last 60s", which is what the event-driven-timer/heartbeat design
// (see the frontend rewire) keeps naturally fresh for any open player tab.
const ONLINE_WINDOW_MS = 60_000;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  // segments: ["wl-events", ...rest] when invoked as "wl-events/<rest>"
  const rest = segments.slice(1);
  const db = supabaseAdmin();

  try {
    const admin = await requireAdmin(req);

    // POST / -> create event
    if (rest.length === 0 && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 200) return json(req, { error: "name is required" }, 400);

      const { data: event, error } = await db
        .from("wl_events")
        .insert({ name, timezone: EVENT_TIMEZONE })
        .select("*")
        .single();
      if (error) throw error;

      await writeAuditEntry(db, {
        adminLabel: admin.nameLabel,
        eventId: event.id,
        actionType: "EVENT_CREATED",
        targetType: "event",
        targetIds: [event.id],
      });
      return json(req, event, 201);
    }

    // GET / -> list events with cohort size
    if (rest.length === 0 && req.method === "GET") {
      const { data: events, error } = await db.from("wl_events").select("*").order("created_at", { ascending: false });
      if (error) throw error;

      const { data: players } = await db.from("wl_event_players").select("event_id");
      const counts = new Map<number, number>();
      for (const p of players ?? []) counts.set(p.event_id, (counts.get(p.event_id) ?? 0) + 1);

      return json(
        req,
        (events ?? []).map((e) => ({ ...e, cohort_size: counts.get(e.id) ?? 0 }))
      );
    }

    const eventId = Number(rest[0]);
    if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);

    // GET /:id
    if (rest.length === 1 && req.method === "GET") {
      const { data: event } = await db.from("wl_events").select("*").eq("id", eventId).maybeSingle();
      if (!event) return json(req, { error: "Event not found" }, 404);
      return json(req, event);
    }

    // POST /:id/cohort
    if (rest.length === 2 && rest[1] === "cohort" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const players = Array.isArray(body.players) ? body.players : null;
      if (!players || players.length === 0 || players.length > MAX_COHORT_SIZE) {
        return json(req, { error: "players array is required (max 600, each with mobileNumber)" }, 400);
      }

      // Defense in depth: the frontend already normalizes before upload, but
      // this is the only place a real login match can ever happen, so a raw
      // "+91 8220 850 225"-style number has to become "8220850225" here too,
      // regardless of what got past the client. Same rule everywhere: strip
      // everything but digits, keep the last 10 (drops any country code).
      const invalid: string[] = [];
      const normalizedPlayers = players.map((p: { mobileNumber: string; displayName?: string }) => {
        const digits = String(p.mobileNumber ?? "").replace(/\D/g, "");
        const mobileNumber = digits.length > 10 ? digits.slice(-10) : digits;
        if (mobileNumber.length !== 10) invalid.push(String(p.mobileNumber ?? ""));
        return { ...p, mobileNumber };
      });
      if (invalid.length > 0) {
        return json(req, { error: `Cohort upload contains mobile numbers that aren't 10 digits: ${invalid.join(", ")}` }, 400);
      }

      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const p of normalizedPlayers) {
        if (seen.has(p.mobileNumber)) duplicates.add(p.mobileNumber);
        seen.add(p.mobileNumber);
      }
      if (duplicates.size > 0) {
        return json(req, { error: `Cohort upload contains duplicate mobile numbers: ${[...duplicates].join(", ")}` }, 400);
      }

      const records = normalizedPlayers.map((p) => ({
        event_id: eventId,
        mobile_number: p.mobileNumber,
        display_name: p.displayName?.trim() || null,
      }));

      const { data: inserted, error } = await db
        .from("wl_event_players")
        .upsert(records, { onConflict: "event_id,mobile_number" })
        .select("*");
      if (error) throw error;

      await db.from("wl_events").update({ status: "COHORT_UPLOADED" }).eq("id", eventId);
      await writeAuditEntry(db, {
        adminLabel: admin.nameLabel,
        eventId,
        actionType: "COHORT_UPLOADED",
        targetType: "event_player",
        metadata: { count: inserted?.length ?? 0 },
      });
      return json(req, { count: inserted?.length ?? 0 });
    }

    // GET /:id/cohort
    if (rest.length === 2 && rest[1] === "cohort" && req.method === "GET") {
      const { data: cohort, error } = await db
        .from("wl_event_players")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json(req, cohort ?? []);
    }

    // GET /:id/stats
    if (rest.length === 2 && rest[1] === "stats" && req.method === "GET") {
      const { data: event } = await db.from("wl_events").select("status").eq("id", eventId).maybeSingle();
      const { count: cohortSize } = await db
        .from("wl_event_players")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId);

      const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const inPlayoffsStage = event?.status === "PLAYOFFS_SCHEDULED" || event?.status === "PLAYOFFS_LIVE" || event?.status === "PLAYOFFS_CLOSED";

      let onlineNow = 0;
      let completedCount = 0;

      if (inPlayoffsStage) {
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (puzzle) {
          const { count: online } = await db
            .from("wl_unwordle_sessions")
            .select("id", { count: "exact", head: true })
            .eq("puzzle_id", puzzle.id)
            .gte("last_activity_at", since);
          onlineNow = online ?? 0;

          const { count: completed } = await db
            .from("wl_unwordle_sessions")
            .select("id", { count: "exact", head: true })
            .eq("puzzle_id", puzzle.id)
            .in("status", ["COMPLETED", "ENDED"]);
          completedCount = completed ?? 0;
        }
      } else {
        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (puzzle) {
          const { count: online } = await db
            .from("wl_timed_wordle_sessions")
            .select("id", { count: "exact", head: true })
            .eq("puzzle_id", puzzle.id)
            .gte("last_activity_at", since);
          onlineNow = online ?? 0;

          const { count: completed } = await db
            .from("wl_timed_wordle_sessions")
            .select("id", { count: "exact", head: true })
            .eq("puzzle_id", puzzle.id)
            .in("status", ["FOUND", "NOT_FOUND_TRIES", "NOT_FOUND_TIME", "ADMIN_ENDED"]);
          completedCount = completed ?? 0;
        }
      }

      return json(req, { cohortSize: cohortSize ?? 0, onlineNow, completedCount });
    }

    // GET /:id/roster -> full cohort with each player's Prelims/Playoffs status,
    // for the admin's post-go-live "all players and their status" view.
    if (rest.length === 2 && rest[1] === "roster" && req.method === "GET") {
      const { data: cohort, error } = await db
        .from("wl_event_players")
        .select("id, display_name, mobile_number")
        .eq("event_id", eventId)
        .order("id", { ascending: true });
      if (error) throw error;

      const { data: twPuzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
      // UNWORDLE Playoffs is now a bank of many puzzles per event (played in
      // a fixed order), not one — pull every puzzle number so this roster's
      // "current" playoffs status can pick each player's most-advanced one.
      const { data: uwPuzzles } = await db
        .from("wl_unwordle_puzzles")
        .select("id, puzzle_number")
        .eq("event_id", eventId);

      const twByPlayer = new Map<number, { status: string; advanced_to_playoffs: boolean }>();
      if (twPuzzle) {
        const { data: twSessions } = await db
          .from("wl_timed_wordle_sessions")
          .select("event_player_id, status, advanced_to_playoffs")
          .eq("puzzle_id", twPuzzle.id);
        for (const s of twSessions ?? []) twByPlayer.set(s.event_player_id, s);
      }

      const uwByPlayer = new Map<number, { status: string; puzzle_number: number }>();
      if (uwPuzzles && uwPuzzles.length > 0) {
        const puzzleNumberById = new Map(uwPuzzles.map((p) => [p.id, p.puzzle_number]));
        const { data: uwSessions } = await db
          .from("wl_unwordle_sessions")
          .select("event_player_id, status, puzzle_id")
          .in("puzzle_id", uwPuzzles.map((p) => p.id));
        for (const s of uwSessions ?? []) {
          const puzzleNumber = puzzleNumberById.get(s.puzzle_id) ?? 0;
          const existing = uwByPlayer.get(s.event_player_id);
          if (!existing || puzzleNumber > existing.puzzle_number) {
            uwByPlayer.set(s.event_player_id, { status: s.status, puzzle_number: puzzleNumber });
          }
        }
      }

      const roster = (cohort ?? []).map((p) => {
        const tw = twByPlayer.get(p.id);
        const uw = uwByPlayer.get(p.id);
        return {
          eventPlayerId: p.id,
          displayName: p.display_name,
          mobileNumber: p.mobile_number,
          prelimsStatus: tw?.status ?? "NOT_STARTED",
          advancedToPlayoffs: tw?.advanced_to_playoffs ?? false,
          playoffsStatus: uw?.status ?? null,
        };
      });

      return json(req, roster);
    }

    // POST /:id/status
    if (rest.length === 2 && rest[1] === "status" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!EVENT_STATUSES.includes(body.status)) return json(req, { error: "A valid status is required" }, 400);

      const { data: event, error } = await db
        .from("wl_events")
        .update({ status: body.status })
        .eq("id", eventId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!event) return json(req, { error: "Event not found" }, 404);

      await writeAuditEntry(db, {
        adminLabel: admin.nameLabel,
        eventId,
        actionType: "EVENT_STATUS_CHANGED",
        targetType: "event",
        targetIds: [eventId],
        metadata: { status: body.status },
      });
      return json(req, event);
    }

    // DELETE /:id -> permanently delete the event and everything under it
    // (cohort, sessions, tries, puzzles, winners, notifications — all FKs are
    // ON DELETE CASCADE). wl_audit_log.event_id has no FK constraint, so the
    // audit trail survives the deletion untouched; write the entry first so
    // it captures the event's name before the row is gone.
    if (rest.length === 1 && req.method === "DELETE") {
      const { data: event } = await db.from("wl_events").select("name").eq("id", eventId).maybeSingle();
      if (!event) return json(req, { error: "Event not found" }, 404);

      await writeAuditEntry(db, {
        adminLabel: admin.nameLabel,
        eventId,
        actionType: "EVENT_DELETED",
        targetType: "event",
        targetIds: [eventId],
        metadata: { name: event.name },
      });

      const { error } = await db.from("wl_events").delete().eq("id", eventId);
      if (error) throw error;

      return json(req, { ok: true });
    }

    // POST /:id/config
    if (rest.length === 2 && rest[1] === "config" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (body.roundOpensAt) patch.round_opens_at = new Date(body.roundOpensAt).toISOString();
      if (body.roundClosesAt) patch.round_closes_at = new Date(body.roundClosesAt).toISOString();
      if (typeof body.prelimsTopN === "number") patch.prelims_top_n = body.prelimsTopN;
      if (typeof body.playoffsWinnerCount === "number") patch.playoffs_winner_count = body.playoffsWinnerCount;
      // A bank size or round duration of 0 (easy to produce by clearing a
      // number input mid-edit — Number("") is 0, not NaN) would silently
      // brick the whole Playoffs round: a 0ms duration stamps every
      // player's personal deadline as already-expired the instant they
      // enter (see wl-unwordle's "enter" route), showing the round as
      // ended for everyone before anyone gets to play.
      if (body.unwordleBankSize !== undefined) {
        if (typeof body.unwordleBankSize !== "number" || body.unwordleBankSize <= 0) {
          return json(req, { error: "Puzzle bank size must be a positive number" }, 400);
        }
        patch.unwordle_bank_size = body.unwordleBankSize;
      }
      if (body.unwordleRoundDurationMs !== undefined) {
        if (typeof body.unwordleRoundDurationMs !== "number" || body.unwordleRoundDurationMs <= 0) {
          return json(req, { error: "Playoffs round length must be a positive number of minutes" }, 400);
        }
        patch.unwordle_round_duration_ms = body.unwordleRoundDurationMs;
      }

      const { data: event, error } = await db.from("wl_events").update(patch).eq("id", eventId).select("*").maybeSingle();
      if (error) throw error;
      if (!event) return json(req, { error: "Event not found" }, 404);

      await writeAuditEntry(db, {
        adminLabel: admin.nameLabel,
        eventId,
        actionType: "EVENT_CONFIG_UPDATED",
        targetType: "event",
        targetIds: [eventId],
        metadata: body,
      });
      return json(req, event);
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-events error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
