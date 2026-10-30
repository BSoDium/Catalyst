import { describe, expect, it, vi } from "vitest";
import { CONTACT_ACCESS_KEY, CONTACT_ENDPOINT, sendContact, validateContact, type ContactValues } from "./contact";

const good: ContactValues = { name: "Ada", email: "ada@example.org", message: "Hello, I read your article." };
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("validateContact", () => {
  it("accepts a name, an address and a few words", () => {
    expect(validateContact(good)).toEqual({});
  });
  it("names each field that is wrong, after trimming", () => {
    expect(validateContact({ name: "  ", email: "", message: "short" })).toEqual({
      name: expect.any(String),
      email: expect.any(String),
      message: expect.any(String),
    });
    for (const email of ["ada", "ada@", "a@b", "a b@c.d", "@c.d"]) expect(validateContact({ ...good, email }).email, email).toBeDefined();
  });
  it("caps the lengths", () => {
    expect(validateContact({ ...good, name: "x".repeat(101) }).name).toBeDefined();
    expect(validateContact({ ...good, message: "x".repeat(4001) }).message).toBeDefined();
  });
});

describe("sendContact", () => {
  it("posts the message as JSON to Web3Forms with the access key and trimmed values", async () => {
    const doFetch = reply({ success: true });
    expect(await sendContact({ ...good, name: "  Ada " }, doFetch)).toEqual({ ok: true });
    const [url, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(CONTACT_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ access_key: CONTACT_ACCESS_KEY, name: "Ada", email: good.email, message: good.message });
  });
  it("does not call anything for invalid values", async () => {
    const doFetch = reply({ success: true });
    expect(await sendContact({ ...good, email: "nope" }, doFetch)).toMatchObject({ ok: false, reason: "invalid" });
    expect(doFetch).not.toHaveBeenCalled();
  });
  it("answers sent to a filled honeypot without calling anything", async () => {
    const doFetch = reply({ success: true });
    expect(await sendContact({ ...good, botcheck: "on" }, doFetch)).toEqual({ ok: true });
    expect(doFetch).not.toHaveBeenCalled();
  });
  it("words a refusal and a network failure for the visitor", async () => {
    expect(await sendContact(good, reply({ success: false, message: "Invalid key" }, 400))).toMatchObject({ ok: false, reason: "rejected" });
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const r = await sendContact(good, down);
    expect(r).toMatchObject({ ok: false, reason: "network" });
    expect(JSON.stringify(r)).not.toContain("Failed to fetch");
  });
});
