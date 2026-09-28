// Timetable relay: the school's HyperPlanning serves iCal files without CORS headers, so the browser cannot read
// them directly. This function fetches one for a signed-in member of the team and passes it on.
// Only https links to the hosts below are accepted, so it cannot be used as an open proxy.
// Deploy: supabase functions deploy edt   (or paste this file in Dashboard > Edge Functions > Create)
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_HOSTS = (Deno.env.get("EDT_HOSTS") ?? "edt.insa-cvl.fr").split(",").map((h) => h.trim()).filter(Boolean);
const MAX_BYTES = 3_000_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: string, status = 200, type = "text/plain; charset=utf-8") =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": type } });

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
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.includes(target.hostname)) return reply("host not allowed: " + target.hostname, 400);

  let res: Response;
  try {
    res = await fetch(target, { redirect: "follow", headers: { "User-Agent": "QG-Killer timetable relay" } });
  } catch (e) {
    return reply("school server unreachable: " + (e as Error).message, 502);
  }
  if (res.url && !ALLOWED_HOSTS.includes(new URL(res.url).hostname)) return reply("redirected outside the school server", 502);   // e.g. to the CAS login page
  if (!res.ok) return reply("school server answered " + res.status, 502);
  const text = await res.text();
  if (text.length > MAX_BYTES) return reply("calendar too large", 502);
  if (!text.trimStart().startsWith("BEGIN:VCALENDAR")) return reply("not an iCal file (the link may have expired)", 502);
  return reply(text, 200, "text/calendar; charset=utf-8");
});
