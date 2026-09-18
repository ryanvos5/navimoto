// Nieuwsbrief van Vos Oss Motoren: aan-/afmelden bij Brevo (lijst "Klanten") via de Supabase Edge
// Function `navimoto-newsletter`. Het e-mailadres komt server-side uit de sessie van de gebruiker.
import { getSupabaseClient } from './supabaseClient';

export type NewsletterAction = 'subscribe' | 'unsubscribe';

export async function setNewsletterSubscription(action: NewsletterAction, firstName?: string): Promise<void> {
  const clientPromise = getSupabaseClient();
  if (!clientPromise) throw new Error('Nieuwsbrief is niet beschikbaar zonder Supabase-configuratie.');
  const client = await clientPromise;
  const { data, error } = await client.functions.invoke<{ ok?: boolean; error?: string }>('navimoto-newsletter', {
    body: { action, firstName: firstName ?? '' },
  });
  if (error) {
    // De function geeft bij fouten een JSON-body met `error`; die tekst is nuttiger dan de generieke melding.
    const context = (error as { context?: Response }).context;
    let detail = '';
    try {
      if (context && typeof context.json === 'function') detail = String((await context.json())?.error ?? '');
    } catch {
      /* geen JSON-body */
    }
    throw new Error(detail || error.message || 'Aanmelden voor de nieuwsbrief is mislukt.');
  }
  if (!data?.ok) throw new Error(data?.error ?? 'Aanmelden voor de nieuwsbrief is mislukt.');
}
