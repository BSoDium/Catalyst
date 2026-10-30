import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "~/components/ui";
import { CONTACT_ACCESS_KEY, CONTACT_ENDPOINT, CONTACT_ID, CONTACT_LIMITS, CONTACT_SUBJECT, sendContact, validateContact, type ContactErrors, type ContactField, type ContactValues } from "~/lib/contact";
import { useContactContext } from "~/lib/use-contact-context";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * The contact form at the foot of the career page (docs/career-page.md, "Contact"): name, address, message, one button. The message
 * goes to the owner through Web3Forms (`lib/contact.ts`), from the visitor's browser. Each field has its label, its error is
 * announced with the field (`aria-invalid`, `aria-describedby`), and the outcome is one polite live region. A sent form is replaced by
 * its thanks (the message is not kept on screen); a failed one keeps what was typed. The honeypot is a field out of sight and out of the
 * tab order. Works without the script too: the form is plain HTML that posts to Web3Forms (`action`, the hidden access key, subject and
 * return address; the CSP's `form-action` names the relay), the browser's own validation checks the fields, and Web3Forms sends the visitor
 * back to `/career?sent=1` (the form then says thanks). Once hydrated, the script takes over (`noValidate`, a post that stays on the page).
 * Not part of print.
 */
export function ContactForm() {
  const uid = useId();
  const back = useContactContext();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>(back.sent ? "sent" : "idle");
  const [errors, setErrors] = useState<ContactErrors>({});
  const [failure, setFailure] = useState("");
  const thanksRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    // Focus the thanks of a message just sent here; after a return from the plain post the browser has taken the visitor to the section.
    if (status === "sent" && ready) thanksRef.current?.focus();
  }, [status, ready]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => (typeof data.get(key) === "string" ? (data.get(key) as string) : "");
    const values: ContactValues = { name: text("name"), email: text("email"), message: text("message"), botcheck: text("botcheck") };
    const found = validateContact(values);
    setErrors(found);
    setFailure("");
    const first = (["name", "email", "message"] as const).find((f) => found[f]);
    if (first) {
      event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setStatus("sending");
    const result = await sendContact(values);
    if (result.ok) {
      setStatus("sent");
    } else {
      setStatus("error");
      setFailure(result.message);
    }
  }

  return (
    <section id={CONTACT_ID} tabIndex={-1} aria-labelledby={`${uid}-h`} data-slot="career-contact" className="career-block career-contact print:hidden">
      <h2 id={`${uid}-h`} className="career-block-title">
        Get in touch
      </h2>
      <div className="career-block-body">
      {status === "sent" ? (
        <p ref={thanksRef} tabIndex={-1} role="status" className="contact-thanks">
          Thank you: your message is on its way. I read everything and answer as soon as I can.
        </p>
      ) : (
        <form action={CONTACT_ENDPOINT} method="post" noValidate={ready} onSubmit={onSubmit} className="contact-form" aria-describedby={`${uid}-lead`}>
          <input type="hidden" name="access_key" value={CONTACT_ACCESS_KEY} />
          <input type="hidden" name="subject" value={CONTACT_SUBJECT} />
          {back.redirect && <input type="hidden" name="redirect" value={back.redirect} />}
          <p id={`${uid}-lead`} className="contact-lead">
            A project, a question, an opportunity, or just a word about something here. Your message reaches me by email, and your address is used only to answer.
          </p>
          <Field uid={uid} name="name" label="Name" error={errors.name}>
            <input id={`${uid}-name`} name="name" type="text" autoComplete="name" required maxLength={CONTACT_LIMITS.name} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? `${uid}-name-e` : undefined} className="contact-input" />
          </Field>
          <Field uid={uid} name="email" label="Email" error={errors.email}>
            <input id={`${uid}-email`} name="email" type="email" inputMode="email" autoComplete="email" required maxLength={CONTACT_LIMITS.email} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? `${uid}-email-e` : undefined} className="contact-input" />
          </Field>
          <Field uid={uid} name="message" label="Message" error={errors.message}>
            <textarea id={`${uid}-message`} name="message" rows={6} required minLength={CONTACT_LIMITS.minMessage} maxLength={CONTACT_LIMITS.message} aria-invalid={errors.message ? true : undefined} aria-describedby={errors.message ? `${uid}-message-e` : undefined} className="contact-input contact-textarea" />
          </Field>
          {/* The honeypot: a person never sees it nor reaches it with the keyboard; a script that fills every field does. */}
          <div aria-hidden="true" className="contact-trap">
            <label>
              Leave this empty
              <input name="botcheck" type="text" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <div className="contact-actions">
            <Button type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send message"}
            </Button>
            <p role="status" className="contact-failure">
              {failure}
            </p>
          </div>
        </form>
      )}
      </div>
    </section>
  );
}

function Field({ uid, name, label, error, children }: { uid: string; name: ContactField; label: string; error: string | undefined; children: React.ReactNode }) {
  return (
    <div className="contact-field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={`${uid}-${name}`} className="contact-label type-meta">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${uid}-${name}-e`} className="contact-error">
          {error}
        </p>
      )}
    </div>
  );
}
