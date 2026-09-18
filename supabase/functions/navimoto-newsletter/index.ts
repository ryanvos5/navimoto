// Navimoto: nieuwsbrief-aanmelding bij Brevo (lijst "Klanten", id 3).
// Aangeroepen door de app met de JWT van de ingelogde gebruiker; het e-mailadres komt uit de sessie
// (nooit uit de body), zodat niemand andermans adres kan aanmelden.
// Vereist secret BREVO_API_KEY (Supabase > Edge Functions > Secrets). Optioneel BREVO_LIST_ID (standaard 3).
// Gedeployed in project zxwmzibfklbkuxfcgpdj als `navimoto-newsletter` (verify_jwt aan).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BREVO_LIST_ID = Number(Deno.env.get("BREVO_LIST_ID") ?? "3");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Alleen POST" });

  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return json(500, { error: "BREVO_API_KEY ontbreekt in de Edge Function-secrets" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (userError || !email) return json(401, { error: "Niet ingelogd" });

  let body: { action?: string; firstName?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* lege body is prima */
  }
  const action = body.action === "unsubscribe" ? "unsubscribe" : "subscribe";
  const firstName = typeof body.firstName === "string" ? body.firstName.trim().slice(0, 80) : "";
  const headers = { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" };

  if (action === "unsubscribe") {
    const res = await fetch(`https://api.brevo.com/v3/contacts/lists/${BREVO_LIST_ID}/contacts/remove`, {
      method: "POST",
      headers,
      body: JSON.stringify({ emails: [email] }),
    });
    // 404 = stond niet (meer) in de lijst: ook goed.
    if (!res.ok && res.status !== 404) return json(502, { error: `Brevo: ${res.status} ${await res.text()}` });
    return json(200, { ok: true, action, email });
  }

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      updateEnabled: true,
      listIds: [BREVO_LIST_ID],
      attributes: firstName ? { FIRSTNAME: firstName, VOORNAAM: firstName } : {},
    }),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    // Onbekend attribuut (bijv. VOORNAAM bestaat niet): nog een keer zonder attributen.
    if (res.status === 400 && text.includes("attribute")) {
      const retry = await fetch("https://api.brevo.com/v3/contacts", {
        method: "POST",
        headers,
        body: JSON.stringify({ email, updateEnabled: true, listIds: [BREVO_LIST_ID] }),
      });
      if (retry.ok || retry.status === 204) return json(200, { ok: true, action, email });
      return json(502, { error: `Brevo: ${retry.status} ${await retry.text()}` });
    }
    return json(502, { error: `Brevo: ${res.status} ${text}` });
  }
  return json(200, { ok: true, action, email });
});
