// Talks to Supabase Edge Functions instead of the old Express API. The public
// shape (apiClient.get/post with the same REST-style path strings every
// screen already uses) is kept identical on purpose — only this file and the
// mapping table below needed to change; every other component is untouched.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;

const ADMIN_TOKEN_KEY = "wl_admin_token";
const PLAYER_TOKEN_KEY = "wl_player_token";

function getStoredToken(audience: "admin" | "player"): string | null {
  return sessionStorage.getItem(audience === "admin" ? ADMIN_TOKEN_KEY : PLAYER_TOKEN_KEY);
}
function setStoredToken(audience: "admin" | "player", token: string | null): void {
  const key = audience === "admin" ? ADMIN_TOKEN_KEY : PLAYER_TOKEN_KEY;
  if (token) sessionStorage.setItem(key, token);
  else sessionStorage.removeItem(key);
}

/**
 * Maps every REST-style path this app already uses onto the new edge
 * function + sub-path that serves it. Ordered most-specific-first. A few
 * entries are new paths that used to be Socket.IO-only actions (session
 * start/end, guess/row submit, clock adjust) — see the wl-timed-wordle /
 * wl-unwordle edge functions for the server side of those.
 */
const ROUTES: Array<{ test: RegExp; to: (m: RegExpMatchArray) => string; audience?: "admin" | "player" }> = [
  { test: /^\/admin\/auth\/(login|logout|me)$/, to: (m) => `wl-admin-auth/${m[1]}`, audience: "admin" },
  { test: /^\/player\/auth\/(login|logout|me)$/, to: (m) => `wl-player-auth/${m[1]}`, audience: "player" },

  { test: /^\/admin\/events$/, to: () => `wl-events`, audience: "admin" },
  { test: /^\/admin\/events\/(\d+)$/, to: (m) => `wl-events/${m[1]}`, audience: "admin" },
  { test: /^\/admin\/events\/(\d+)\/(stats|config|cohort|status|roster)$/, to: (m) => `wl-events/${m[1]}/${m[2]}`, audience: "admin" },

  { test: /^\/admin\/events\/(\d+)\/timed-wordle\/(.+)$/, to: (m) => `wl-timed-wordle/admin/${m[1]}/${m[2]}`, audience: "admin" },
  { test: /^\/player\/events\/(\d+)\/timed-wordle\/(.+)$/, to: (m) => `wl-timed-wordle/player/${m[1]}/${m[2]}`, audience: "player" },

  { test: /^\/admin\/events\/(\d+)\/unwordle\/(.+)$/, to: (m) => `wl-unwordle/admin/${m[1]}/${m[2]}`, audience: "admin" },
  { test: /^\/player\/events\/(\d+)\/unwordle\/(.+)$/, to: (m) => `wl-unwordle/player/${m[1]}/${m[2]}`, audience: "player" },

  { test: /^\/admin\/events\/(\d+)\/cutoff\/(.+)$/, to: (m) => `wl-cutoff/${m[1]}/${m[2]}`, audience: "admin" },
  { test: /^\/admin\/events\/(\d+)\/winners$/, to: (m) => `wl-winners/${m[1]}`, audience: "admin" },
  { test: /^\/admin\/events\/(\d+)\/audit$/, to: (m) => `wl-audit/${m[1]}`, audience: "admin" },

  { test: /^\/admin\/events\/(\d+)\/notifications$/, to: (m) => `wl-notifications/admin/${m[1]}/send`, audience: "admin" },
  { test: /^\/player\/notifications$/, to: () => `wl-notifications/player/list`, audience: "player" },
  { test: /^\/player\/notifications\/(\d+)\/read$/, to: (m) => `wl-notifications/player/${m[1]}/read`, audience: "player" },
];

function resolveRoute(path: string): { functionPath: string; audience: "admin" | "player" | null } {
  const [pathname, query] = path.split("?");
  for (const route of ROUTES) {
    const match = pathname.match(route.test);
    if (match) {
      const functionPath = route.to(match) + (query ? `?${query}` : "");
      return { functionPath, audience: route.audience ?? null };
    }
  }
  throw new Error(`apiClient: no edge function route mapped for "${path}"`);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { functionPath, audience } = resolveRoute(path);
  const token = audience ? getStoredToken(audience) : null;

  const res = await fetch(`${FUNCTIONS_BASE_URL}/${functionPath}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  // Login endpoints return a bearer token in the body — captured here,
  // transparently to every call site, so they can keep calling
  // apiClient.post("/admin/auth/login", ...) exactly as before.
  if (audience && typeof body.token === "string") {
    setStoredToken(audience, body.token);
  }
  if (audience && /\/auth\/logout$/.test(path)) {
    setStoredToken(audience, null);
  }

  return body as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
};
