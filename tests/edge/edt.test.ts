// The timetable relay (supabase/functions/edt/index.ts): the real function, a fake network. Never calls a real server.
// Run: npm run test:edge (Deno: deno run --config tests/edge/deno.jsonc --allow-env --allow-read --allow-net --allow-write tests/edge/edt.test.ts).
import { assertEquals, assert } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
const requested: string[] = [];
const ICS = "BEGIN:VCALENDAR\r\nX-WR-CALNAME:TD1\r\nEND:VCALENDAR\r\n";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  if (url.hostname === "fake.supabase.co") {   // my_role: member unless the token says outsider
    const outsider = (headers.get("Authorization") || "").includes("outsider");
    return new Response(JSON.stringify(outsider ? null : "member"), { headers: { "Content-Type": "application/json" } });
  }
  requested.push(url.href);
  const signal = init?.signal;
  switch (url.pathname) {
    case "/ok.ics": return new Response(ICS);
    case "/redir-ok": return new Response(null, { status: 302, headers: { location: "/ok.ics" } });
    case "/redir-evil": return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
    case "/redir-port": return new Response(null, { status: 302, headers: { location: "https://edt.insa-cvl.fr:8443/x" } });
    case "/loop": return new Response(null, { status: 302, headers: { location: "/loop" } });
    case "/big": {   // 5 MB, sent in chunks
      let sent = 0;
      return new Response(new ReadableStream({ pull(c) { if (sent >= 5e6) return c.close(); sent += 1e5; c.enqueue(new Uint8Array(1e5).fill(65)); } }));
    }
    case "/slow": return await new Promise((_, rej) => signal?.addEventListener("abort", () => rej(signal.reason)));
    case "/expired": return new Response("<html>login</html>");
    default: return new Response("nope", { status: 404 });
  }
}) as typeof fetch;

let handler: (req: Request) => Promise<Response> = () => { throw new Error("not loaded"); };
(Deno as unknown as { serve: unknown }).serve = (h: typeof handler) => { handler = h; return {}; };
await import(new URL("../../supabase/functions/edt/index.ts", import.meta.url).href);

const call = (url: string, token = "member") => handler(new Request("https://fn/edt", { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify({ url }) }));
const S = "https://edt.insa-cvl.fr";
let n = 0; const ok = (name: string) => console.log("ok -", name, ++n);

let r = await call(S + "/ok.ics"); assertEquals(r.status, 200); assertEquals(await r.text(), ICS); ok("a timetable of the school server");
r = await call(S + "/ok.ics", "outsider"); assertEquals(r.status, 403); ok("not on the team: refused");
r = await call("https://evil.example/x"); assertEquals(r.status, 400); ok("other host refused");
r = await call("https://edt.insa-cvl.fr.evil.example/x"); assertEquals(r.status, 400); ok("look-alike host refused");
r = await call("https://evil.example@edt.insa-cvl.fr.evil.example/x"); assertEquals(r.status, 400); ok("@ in the link refused");
r = await call("https://edt.insa-cvl.fr:8443/x"); assertEquals(r.status, 400); ok("other port refused");
r = await call("http://edt.insa-cvl.fr/ok.ics"); assertEquals(r.status, 400); ok("http refused");
r = await call(S + "/redir-ok"); assertEquals(r.status, 200); ok("redirection within the school server followed");
requested.length = 0;
r = await call(S + "/redir-evil"); assertEquals(r.status, 502); assertEquals(await r.text(), "redirected outside the school server");
assert(!requested.some((u) => new URL(u).hostname === "evil.example"), "the outside host is never requested"); ok("redirection elsewhere: refused before any request");
r = await call(S + "/redir-port"); assertEquals(r.status, 502); ok("redirection to another port refused");
r = await call(S + "/loop"); assertEquals(r.status, 502); assertEquals(await r.text(), "too many redirections"); ok("redirection loop stopped");
r = await call(S + "/big"); assertEquals(r.status, 502); assertEquals(await r.text(), "calendar too large"); ok("too large: stopped while reading");
const t0 = Date.now(); r = await call(S + "/slow"); assertEquals(r.status, 502); assertEquals(await r.text(), "school server too slow");
assert(Date.now() - t0 < 12000); ok("silent server: gives up after 10 s");
r = await call(S + "/expired"); assertEquals(r.status, 502); ok("not an iCal file (expired link)");
console.log(`\n${n} relay checks OK`);
globalThis.fetch = realFetch;
