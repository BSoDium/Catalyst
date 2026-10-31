import { Link } from "react-router";
import type { PublishedCareer, PublishedCareerEducation, PublishedCareerRole } from "@catalyst/schemas";
import { ContactForm } from "~/components/contact-form";
import { Button, Icon } from "~/components/ui";
import type { IconName } from "~/components/ui/icon";
import { asOfText, careerDuration, careerIcon, careerLogoSrc, careerPeriod, formatCareerMonth, isCurrent, languageDetail, safeLinks, safePortrait } from "~/lib/career";
import { CONTACT_ID } from "~/lib/contact";
import { safeExternalUrl } from "~/lib/entry-blocks";
import { placePath } from "~/lib/entries";
import { SITE } from "~/lib/site";

/**
 * `/career`: the curriculum vitae as a page (docs/career-page.md), set as the other pages of the site: a running head over ONE
 * hairline (the document's title at the left, the month it was reviewed at the right), the owner's name at the list-title scale, the
 * profile statement in the reading face, then the dated availability when there is one. Right under the head, ONE compact line of
 * languages (a recruiter's first filter); then the experience and the education as vertical hairline timelines (an ordered list,
 * newest first, each item with its `<time>` span), the skills as a compact definition list and a footer row of public profile links.
 *
 * Headings: h1 the name; h2 Languages (visually hidden: the line is its own region), Experience, Education, Skills, Socials; h3 a
 * role's organisation or a programme's institution. The portrait is optional: with none, the name block simply takes the room. The
 * one way to reach the owner is the contact form (`ContactForm`, docs/career-page.md, "Contact") after the socials: a "Get in touch"
 * button in the head scrolls to it. There is no address, phone number or mailto link anywhere (the contract has no field for one).
 */
export function CareerPage({ career, places = [] }: { career: PublishedCareer; places?: readonly string[] }) {
  const portrait = safePortrait(career);
  const links = safeLinks(career);
  const updated = formatCareerMonth(career.updated);
  const available = career.availability;
  const known = new Set(places);
  return (
    <main
      id="main"
      tabIndex={-1}
      data-surface="reading"
      data-layout="full"
      data-slot="career"
      aria-labelledby="career-name"
      className="entry career mx-auto max-w-[90rem] px-4 pt-[calc(var(--navbar-height)+0.5rem)] min-[56rem]:pt-[calc(var(--navbar-height)+3rem)] pb-24 outline-none md:px-14 print:max-w-none print:p-0"
    >
      <header data-slot="career-head" className="list-head">
        <p className="list-running type-meta">
          <span>{career.title}</span>
          {updated && (
            <span>
              Updated <time dateTime={career.updated}>{updated}</time>
            </span>
          )}
        </p>
        <div className="career-id" data-portrait={portrait ? "true" : "false"}>
          <div className="career-id-text">
            <h1 id="career-name" className="list-title career-name">
              {SITE.givenName} <span className="career-name-family">{SITE.familyName}</span>
            </h1>
            <p className="career-summary">{career.summary}</p>
            {available && (
              <p data-slot="career-availability" className="career-availability type-meta">
                <span>
                  {available.text}
                  <span className="career-asof">
                    <span className="career-sep"> · </span>
                    <time dateTime={available.asOf}>{asOfText(available.asOf)}</time>
                  </span>
                </span>
              </p>
            )}
            <p className="career-reach print:hidden">
              <Button asChild variant="secondary">
                <a href={`#${CONTACT_ID}`} data-slot="career-contact-link">
                  Get in touch
                  <Icon name="arrow-down" size="inline" aria-hidden="true" />
                </a>
              </Button>
            </p>
            {updated && (
              <p data-slot="career-updated" className="career-updated type-meta">
                Updated <time dateTime={career.updated}>{updated}</time>
              </p>
            )}
          </div>
          {portrait && (
            <figure data-slot="career-portrait" className="career-portrait">
              <PortraitPicture portrait={portrait} alt="" decorative className="career-portrait-glow" />
              <PortraitPicture portrait={portrait} alt={portrait.alt} eager />
            </figure>
          )}
        </div>
      </header>

      {career.languages.length > 0 && (
        <section data-slot="career-languages" aria-labelledby="career-languages-h" className="career-languages">
          <h2 id="career-languages-h" className="career-languages-label type-meta">
            Languages
          </h2>
          <ul>
            {career.languages.map((l) => {
              const detail = languageDetail(l);
              return (
                <li key={l.name}>
                  <span className="career-language-name">{l.name}</span>
                  {detail && <span className="career-language-detail">{detail}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Block id="experience" title="Experience" count={career.roles.length}>
        <ol className="career-timeline" aria-labelledby="experience-h">
          {career.roles.map((role) => (
            <RoleItem key={role.id} role={role} placeKnown={role.place !== undefined && known.has(role.place)} asOf={career.updated} />
          ))}
        </ol>
      </Block>

      <div className="career-pair">
        {career.education.length > 0 && (
          <Block id="education" title="Education" count={career.education.length}>
            <ol className="career-timeline" aria-labelledby="education-h">
              {career.education.map((e) => (
                <EducationItem key={e.id} item={e} placeKnown={e.place !== undefined && known.has(e.place)} asOf={career.updated} />
              ))}
            </ol>
          </Block>
        )}

        {career.skills.length > 0 && (
          <Block id="skills" title="Skills">
            <dl className="career-skills">
              {career.skills.map((g) => (
                <div key={g.group}>
                  <dt className="type-meta">{g.group}</dt>
                  <dd>
                    <ul className="career-chips">
                      {g.items.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </Block>
        )}
      </div>

      <div className="career-pair">
      {links.length > 0 && (
        <footer data-slot="career-links" className="career-block career-footer">
          <h2 id="links-h" className="career-block-title">
            Socials
          </h2>
          <ul aria-labelledby="links-h" className="career-links">
            {links.map((l) => (
              <li key={l.url}>
                <a href={l.url} rel="me noopener noreferrer" className="career-link">
                  <span>{l.label}</span>
                  <Icon name="arrow-up-right" size="inline" className="print:hidden" />
                </a>
              </li>
            ))}
          </ul>
        </footer>
      )}
      {/* After the socials in the document, so that wrapped to one column the socials come first and the tab order is the order seen; from 80 rem the pair is two columns, the socials at the left and the form at the right. */}
      <ContactForm />
      </div>
    </main>
  );
}

/**
 * The portrait as a `<picture>`: with a dark variant in the document, the dark colour scheme is offered that file (the site has no
 * scheme toggle, so `prefers-color-scheme` is the whole story). Drawn twice: once as the picture, once as its faint bleed.
 */
function PortraitPicture({ portrait, alt, decorative, eager, className }: { portrait: NonNullable<ReturnType<typeof safePortrait>>; alt: string; decorative?: boolean; eager?: boolean; className?: string }) {
  const img = (
    <img
      src={portrait.src}
      alt={alt}
      aria-hidden={decorative ? "true" : undefined}
      width={portrait.width}
      height={portrait.height}
      loading={eager ? "eager" : undefined}
      decoding="async"
      fetchPriority={eager ? "high" : undefined}
      className={className}
      style={eager ? { aspectRatio: "1 / 1" } : undefined}
    />
  );
  return portrait.dark ? (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={portrait.dark.src} width={portrait.dark.width} height={portrait.dark.height} />
      {img}
    </picture>
  ) : (
    img
  );
}

/** A block of the page: the heading at the left (from 48 rem; above the list below it) and its content at the right. */
function Block({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} data-slot={`career-${id}`} className="career-block">
      <h2 id={`${id}-h`} className="career-block-title">
        {title}
        {count !== undefined && <span className="sr-only">, {count === 1 ? "1 item" : `${count} items`}</span>}
      </h2>
      <div className="career-block-body">{children}</div>
    </section>
  );
}

function Period({ start, end, asOf }: { start: string; end: string | undefined; asOf: string }) {
  const p = careerPeriod(start, end);
  const duration = careerDuration(start, end, asOf);
  return (
    <>
      <p className="career-period">
        <span className="sr-only">{p.spoken}</span>
        <span aria-hidden="true">
          <time dateTime={p.start.dateTime}>{p.start.text}</time>
          {p.end && (
            <>
              {" – "}
              {p.end.dateTime ? <time dateTime={p.end.dateTime}>{p.end.text}</time> : <span>{p.end.text}</span>}
            </>
          )}
        </span>
      </p>
      {duration && (
        <p className="career-duration" aria-hidden="true">
          {duration}
        </p>
      )}
    </>
  );
}

/**
 * The item's marker on the rail: the organisation's logo when there is one (a decorative square: the name follows), else the icon of
 * what was done there (`careerIcon`). Either sits on a page-coloured mask that keeps the rail from running through it.
 */
function Marker({ item, name, icon }: { item: { logo?: { src: string } | undefined }; name: string; icon: IconName }) {
  const src = careerLogoSrc(item, name);
  return (
    <>
      {src && <img src={src} alt="" aria-hidden="true" width={200} height={200} loading="lazy" decoding="async" className="career-glow" />}
      <span className="career-icon" data-logo={src ? "true" : undefined} aria-hidden="true">
        {src ? <img src={src} alt="" width={200} height={200} loading="lazy" decoding="async" /> : <Icon name={icon} size="large" />}
      </span>
    </>
  );
}

function Where({ text, place, known }: { text: string; place: string | undefined; known: boolean }) {
  return known && place ? (
    <Link to={placePath(place)} className="career-place">
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  );
}

function RoleItem({ role, placeKnown, asOf }: { role: PublishedCareerRole; placeKnown: boolean; asOf: string }) {
  const orgUrl = role.orgUrl ? safeExternalUrl(role.orgUrl) : null;
  return (
    <li id={role.id} data-slot="career-role" data-current={isCurrent(role) ? "true" : undefined} className="career-item">
      <Marker item={role} name={role.org} icon={careerIcon(role.title, "role")} />
      <div className="career-head">
        <div className="career-top">
          <h3 className="career-org">
            {orgUrl ? (
              <a href={orgUrl} rel="noopener noreferrer" className="career-org-link">
                {role.org}
              </a>
            ) : (
              role.org
            )}
          </h3>
        </div>
        <p className="career-role" title={role.title}>
          {role.title}
        </p>
        <div className="career-meta type-meta">
          <Period start={role.start} end={role.end} asOf={asOf} />
        </div>
        <p className="career-facts">
          <Where text={role.location} place={role.place} known={placeKnown} />
          {role.employment && <span>{role.employment}</span>}
        </p>
      </div>
      {(role.highlights.length > 0 || role.skills.length > 0) && (
        <div className="career-detail">
          {role.highlights.length > 0 && (
            <ul className="career-highlights">
              {role.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
          {role.skills.length > 0 && (
            <ul className="career-stack" aria-label="Skills">
              {role.skills.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function EducationItem({ item, placeKnown, asOf }: { item: PublishedCareerEducation; placeKnown: boolean; asOf: string }) {
  return (
    <li id={item.id} data-slot="career-education-item" className="career-item">
      <Marker item={item} name={item.institution} icon={careerIcon(item.programme, "education")} />
      <div className="career-head">
        <div className="career-top">
          <h3 className="career-org">{item.institution}</h3>
        </div>
        <p className="career-role" title={item.level ? `${item.programme} · ${item.level}` : item.programme}>
          {item.programme}
          {item.level && <span className="career-level"> · {item.level}</span>}
        </p>
        <div className="career-meta type-meta">
          <Period start={item.start} end={item.end} asOf={asOf} />
        </div>
        {(item.location || item.note) && (
          <p className="career-facts">
            {item.location && <Where text={item.location} place={item.place} known={placeKnown} />}
            {item.note && <span>{item.note}</span>}
          </p>
        )}
      </div>
    </li>
  );
}
