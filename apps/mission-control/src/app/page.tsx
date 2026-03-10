import Link from "next/link";

const capabilities = [
  "Identity-bound memory and operator context",
  "Private control surfaces for agent fleets",
  "Audit-ready handoffs, contracts, and tasks",
  "A branded layer between public trust and private execution",
];

const pillars = [
  {
    label: "Public Face",
    title: "Explain the system before you expose it.",
    body:
      "The root domain should earn trust. SoulMD positions the product, frames the operating philosophy, and captures demand before anyone sees the admin plane.",
  },
  {
    label: "Private Plane",
    title: "Keep operations behind a separate surface.",
    body:
      "The dashboard belongs on a gated subdomain. That split keeps the product narrative clean and sharply reduces accidental exposure of internal tooling.",
  },
  {
    label: "Memory Layer",
    title: "Treat context as infrastructure.",
    body:
      "SoulMD is designed around persistent identity, traceable edits, and operator-grade continuity instead of disposable prompt sessions.",
  },
];

const roadmap = [
  "Launch `soulmd.app` as the public narrative layer.",
  "Deploy the authenticated dashboard to `app.soulmd.app`.",
  "Replace shared credentials with user records on SQLite/Postgres.",
  "Add waitlist, product docs, and operator onboarding flows.",
];

export default function HomePage() {
  return (
    <main className="landing-page">
      <section className="landing-shell">
        <div className="landing-noise" />

        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">SM</span>
            <div>
              <p className="brand-name">SoulMD</p>
              <p className="brand-subtitle">Identity, memory, and control for AI operators</p>
            </div>
          </div>

          <nav className="topnav">
            <a href="#architecture">Architecture</a>
            <a href="#positioning">Positioning</a>
            <a href="#roadmap">Roadmap</a>
            <Link href="/app" className="topnav-cta">
              Open app
            </Link>
          </nav>
        </header>

        <section className="landing-hero">
          <div className="hero-stack">
            <p className="landing-kicker">soulmd.app should sell the idea. `app.soulmd.app` should run it.</p>
            <h1>
              Build the public myth
              <br />
              and keep the
              <br />
              machine private.
            </h1>
            <p className="landing-copy">
              SoulMD is the brand surface for an operator-grade AI system: a place
              to explain memory, identity, and orchestration without exposing the
              raw control plane. The domain architecture should make that distinction
              obvious from the first visit.
            </p>

            <div className="landing-actions">
              <Link href="/app" className="landing-button landing-button-primary">
                Enter Mission Control
              </Link>
              <a href="#architecture" className="landing-button">
                See domain structure
              </a>
            </div>

            <div className="signal-strip">
              {capabilities.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>

          <aside className="hero-card">
            <div className="hero-card-label">Domain split</div>
            <div className="hero-card-grid">
              <article>
                <span>Root</span>
                <strong>`soulmd.app`</strong>
                <p>Public landing page, narrative, demand capture, docs entry.</p>
              </article>
              <article>
                <span>App</span>
                <strong>`app.soulmd.app`</strong>
                <p>Authenticated dashboard, private ops surface, mutable system state.</p>
              </article>
            </div>
            <div className="hero-card-foot">
              <p>Remembered impression</p>
              <strong>Not another AI toy. An operating identity.</strong>
            </div>
          </aside>
        </section>

        <section id="architecture" className="architecture-band">
          <div className="section-heading">
            <p className="landing-kicker">Recommended architecture</p>
            <h2>Separate trust from execution.</h2>
          </div>

          <div className="architecture-grid">
            <article className="architecture-card architecture-card-root">
              <span>01</span>
              <h3>soulmd.app</h3>
              <p>Landing page, positioning, waitlist, onboarding narrative, conversion path.</p>
            </article>
            <article className="architecture-card architecture-card-app">
              <span>02</span>
              <h3>app.soulmd.app</h3>
              <p>Authenticated control surface with audit trails, contracts, tasks, and operators.</p>
            </article>
            <article className="architecture-card architecture-card-later">
              <span>03</span>
              <h3>api/docs later</h3>
              <p>Add `api.` and `docs.` only after the product shape and workflow boundaries solidify.</p>
            </article>
          </div>
        </section>

        <section id="positioning" className="pillars-grid">
          {pillars.map((pillar) => (
            <article key={pillar.title} className="pillar-card">
              <p>{pillar.label}</p>
              <h3>{pillar.title}</h3>
              <span>{pillar.body}</span>
            </article>
          ))}
        </section>

        <section className="manifest-panel">
          <div>
            <p className="landing-kicker">What the homepage should do</p>
            <h2>Frame the system in human terms.</h2>
          </div>
          <div className="manifest-copy">
            <p>
              The homepage should not feel like an admin panel preview. It should
              feel like a confident thesis: why memory matters, why identity matters,
              and why operator-grade AI needs a durable surface instead of another
              disposable chat box.
            </p>
            <p>
              When someone lands on SoulMD, they should understand the split
              immediately: the public domain is for meaning and conversion; the app
              domain is where the system actually runs.
            </p>
          </div>
        </section>

        <section id="roadmap" className="roadmap-panel">
          <div className="section-heading">
            <p className="landing-kicker">Rollout order</p>
            <h2>Ship the brand first, then the gate.</h2>
          </div>

          <div className="roadmap-list">
            {roadmap.map((item, index) => (
              <article key={item} className="roadmap-step">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
