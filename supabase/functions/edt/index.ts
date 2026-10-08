// Timetable relay: the school's HyperPlanning serves iCal files without CORS headers, so the browser cannot read
// them directly. This function fetches one for a signed-in member of the team and passes it on.
// Only https links to the hosts below are accepted, so it cannot be used as an open proxy.
// Deploy: supabase functions deploy edt   (or paste this file in Dashboard > Edge Functions > Create)
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_HOSTS = (Deno.env.get("EDT_HOSTS") ?? "edt.insa-cvl.fr").split(",").map((h) => h.trim()).filter(Boolean);
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10_000;   // the school server must answer within this
const MAX_REDIRECTS = 3;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: string, status = 200, type = "text/plain; charset=utf-8") =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": type } });

class Refused extends Error {}
// Only https, on the default port, to an allowed host: checked for the link and again for every redirection, before
// anything is requested (a redirection elsewhere is never followed).
function allowed(url: URL) { return url.protocol === "https:" && url.port === "" && ALLOWED_HOSTS.includes(url.hostname); }
async function fetchAllowed(url: URL): Promise<Response> {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(url)) throw new Refused(hop ? "redirected outside the school server" : "host not allowed: " + url.hostname);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "QG-Killer timetable relay" } });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res;
    await res.body?.cancel();
    url = new URL(next, url);
  }
  throw new Refused("too many redirections");
}
// Reads the answer but stops as soon as it is too large (the whole file is never held in memory first).
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader(); if (!reader) return "";
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Refused("calendar too large"); }
    parts.push(value);
  }
  const all = new Uint8Array(size); let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new TextDecoder().decode(all);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply("ok");
  if (req.method !== "POST") return reply("POST only", 405);

  // Same rule as the database: only confirmed accounts listed in public.accounts.
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: role, error: roleError } = await sb.rpc("my_role");
  if (roleError || !role) return reply("not a member of the team", 403);

  let target: URL;
  try {
    const { url } = await req.json();
    target = new URL(String(url));
  } catch {
    return reply("expected {\"url\": \"https://...\"}", 400);
  }
  if (!allowed(target)) return reply("host not allowed: " + target.hostname, 400);

  let res: Response, text: string;
  try {
    res = await fetchAllowed(target);   // e.g. a redirection to the CAS login page is refused, not followed
    if (!res.ok) { await res.body?.cancel(); return reply("school server answered " + res.status, 502); }
    text = await readCapped(res, MAX_BYTES);
  } catch (e) {
    if (e instanceof Refused) return reply(e.message, 502);
    const timeout = (e as Error).name === "TimeoutError";
    return reply(timeout ? "school server too slow" : "school server unreachable", 502);
  }
  if (!text.trimStart().startsWith("BEGIN:VCALENDAR")) return reply("not an iCal file (the link may have expired)", 502);
  return reply(text, 200, "text/calendar; charset=utf-8");
});
