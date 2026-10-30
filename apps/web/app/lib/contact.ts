/**
 * The contact form of the career page (docs/career-page.md, "Contact"): a message goes to the owner through Web3Forms, a hosted
 * form-to-email relay, so the site needs no backend and no mail service of its own. Pure (the network call takes the `fetch` it is
 * given), tested in `contact.test.ts`.
 *
 * `CONTACT_ACCESS_KEY` is public by design: Web3Forms keys are sent from the visitor's browser, and what limits their use is the
 * allowed-domains list and the rate limit in the owner's Web3Forms dashboard, not secrecy. It names the inbox; it opens nothing else.
 */
export const CONTACT_ENDPOINT = "https://api.web3forms.com/submit";
export const CONTACT_ACCESS_KEY = "7f05b5ae-7a5d-47fe-ba9b-47f283b06a00";

/** Anchor of the form on the career page: the header's button links to it. */
export const CONTACT_ID = "contact";

export const CONTACT_LIMITS = { name: 100, email: 254, message: 4000, minMessage: 10 } as const;

export interface ContactValues {
  name: string;
  email: string;
  message: string;
  /** The honeypot: a field no visitor sees; a bot that fills every field fills it, and Web3Forms drops the message. */
  botcheck?: string;
}

export type ContactField = "name" | "email" | "message";
export type ContactErrors = Partial<Record<ContactField, string>>;

/** One address, no spaces, a dot in the domain: what a person types by mistake is caught, the rest is the mail server's to judge. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with the values, per field (empty when nothing is). Texts are trimmed before they are judged. */
export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const message = values.message.trim();
  if (!name) errors.name = "Tell me your name.";
  else if (name.length > CONTACT_LIMITS.name) errors.name = `Keep it under ${CONTACT_LIMITS.name} characters.`;
  if (!email) errors.email = "I need an address to answer to.";
  else if (email.length > CONTACT_LIMITS.email || !EMAIL.test(email)) errors.email = "This does not look like an email address.";
  if (message.length < CONTACT_LIMITS.minMessage) errors.message = "A few words, at least.";
  else if (message.length > CONTACT_LIMITS.message) errors.message = `Keep it under ${CONTACT_LIMITS.message} characters.`;
  return errors;
}

export type ContactResult = { ok: true } | { ok: false; reason: "invalid" | "rejected" | "network"; message: string };

/**
 * Sends the message. A spam catch (the honeypot filled) answers "sent" without calling anything: the bot learns nothing. Errors
 * are words for the visitor, never the service's own text.
 */
export async function sendContact(values: ContactValues, doFetch: typeof fetch = fetch): Promise<ContactResult> {
  if (Object.keys(validateContact(values)).length > 0) return { ok: false, reason: "invalid", message: "Check the highlighted fields." };
  if (values.botcheck) return { ok: true };
  try {
    const response = await doFetch(CONTACT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: CONTACT_ACCESS_KEY,
        subject: `Message from ${values.name.trim()} through the site`,
        from_name: values.name.trim(),
        name: values.name.trim(),
        email: values.email.trim(),
        message: values.message.trim(),
        botcheck: "",
      }),
    });
    const body = (await response.json().catch(() => null)) as { success?: unknown } | null;
    if (response.ok && body?.success === true) return { ok: true };
    return { ok: false, reason: "rejected", message: "The message was not accepted. Try again in a moment." };
  } catch {
    return { ok: false, reason: "network", message: "The message could not be sent: check your connection and try again." };
  }
}
