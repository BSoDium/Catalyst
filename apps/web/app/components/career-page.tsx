import { Link } from "react-router";
import type { PublishedCareer, PublishedCareerEducation, PublishedCareerRole } from "@catalyst/schemas";
import { Icon } from "~/components/ui";
import { asOfText, careerDuration, careerPeriod, formatCareerMonth, isCurrent, languageDetail, safeLinks, safePortrait } from "~/lib/career";
import { safeExternalUrl } from "~/lib/entry-blocks";
import { placePath } from "~/lib/entries";
import { SITE_NAME } from "~/lib/site";

/**
 * `/career`: the curriculum vitae as a page (docs/career-page.md), set as the other pages of the site: a running head over ONE
 * hairline (the document's title at the left, the month it was reviewed at the right), the owner's name at the list-title scale, the
 * profile statement in the reading face, then the dated availability when there is one. Right under the head, ONE compact line of
 * languages (a recruiter's first filter); then the experience and the education as vertical hairline timelines (an ordered list,
 * newest first, each item with its `<time>` span), the skills as a compact definition list and a footer row of public profile links.
 *
 * Headings: h1 the name; h2 Languages (visually hidden: the line is its own region), Experience, Education, Skills, Elsewhere; h3 a
 * role's organisation or a programme's institution. The portrait is optional: with none, the name block simply takes the room. There is
 * no contact channel anywhere (the contract has no field for one).
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
      className="entry career mx-auto max-w-[90rem] px-4 pt-[calc(var(--navbar-height)+3rem)] pb-24 outline-none md:px-14 print:max-w-none print:p-0"
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
              {SITE_NAME}
            </h1>
            <p className="career-summary">{career.summary}</p>
            {available && (
              <p data-slot="career-availability" className="career-availability type-meta">
                <span className="career-dot" aria-hidden="true" />
                <span>
                  {available.text}
                  <span className="career-asof">
                    {" "}
                    · <time dateTime={available.asOf}>{asOfText(available.asOf)}</time>
                  </span>
                </span>
              </p>
            )}
          </div>
          {portrait && (
            <figure data-slot="career-portrait" className="career-portrait">
              <img
                src={portrait.src}
                alt={portrait.alt}
                width={portrait.width}
                height={portrait.height}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                style={{ aspectRatio: "4 / 5" }}
              />
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
            <RoleItem key={role.id} role={role} placeKnown={role.place !== undefined && known.has(role.place)} />
          ))}
        </ol>
      </Block>

      {career.education.length > 0 && (
        <Block id="education" title="Education" count={career.education.length}>
          <ol className="career-timeline" aria-labelledby="education-h">
            {career.education.map((e) => (
              <EducationItem key={e.id} item={e} placeKnown={e.place !== undefined && known.has(e.place)} />
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

      {links.length > 0 && (
        <footer data-slot="career-links" className="career-footer">
          <h2 id="links-h" className="career-block-title type-meta">
            Elsewhere
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
    </main>
  );
}

/** A block of the page: the heading at the left (from 48 rem; above the list below it) and its content at the right. */
function Block({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} data-slot={`career-${id}`} className="career-block">
      <h2 id={`${id}-h`} className="career-block-title type-meta">
        {title}
        {count !== undefined && <span className="sr-only">, {count === 1 ? "1 item" : `${count} items`}</span>}
      </h2>
      <div className="career-block-body">{children}</div>
    </section>
  );
}

function Period({ start, end }: { start: string; end: string | undefined }) {
  const p = careerPeriod(start, end);
  const duration = careerDuration(start, end);
  return (
    <div className="career-strip">
      <p className="career-period type-meta">
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
        <span className="career-duration type-meta" aria-hidden="true">
          {duration}
        </span>
      )}
    </div>
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

function RoleItem({ role, placeKnown }: { role: PublishedCareerRole; placeKnown: boolean }) {
  const orgUrl = role.orgUrl ? safeExternalUrl(role.orgUrl) : null;
  return (
    <li id={role.id} data-slot="career-role" data-current={isCurrent(role) ? "true" : undefined} className="career-item">
      <div className="career-card">
        <Period start={role.start} end={role.end} />
        <div className="career-body">
          <h3 className="career-org">
            {orgUrl ? (
              <a href={orgUrl} rel="noopener noreferrer" className="career-org-link">
                {role.org}
              </a>
            ) : (
              role.org
            )}
          </h3>
          <p className="career-role">{role.title}</p>
          <p className="career-facts type-meta">
            <Where text={role.location} place={role.place} known={placeKnown} />
            {role.employment && <span>{role.employment}</span>}
          </p>
          {role.highlights.length > 0 && (
            <ul className="career-highlights">
              {role.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
        {role.skills.length > 0 && (
          <ul className="career-stack" aria-label="Skills">
            {role.skills.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function EducationItem({ item, placeKnown }: { item: PublishedCareerEducation; placeKnown: boolean }) {
  return (
    <li id={item.id} data-slot="career-education-item" className="career-item">
      <div className="career-card">
        <Period start={item.start} end={item.end} />
        <div className="career-body">
          <h3 className="career-org">{item.institution}</h3>
          <p className="career-role">
            {item.programme}
            {item.level && <span className="career-level"> · {item.level}</span>}
          </p>
          {(item.location || item.note) && (
            <p className="career-facts type-meta">
              {item.location && <Where text={item.location} place={item.place} known={placeKnown} />}
              {item.note && <span>{item.note}</span>}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
