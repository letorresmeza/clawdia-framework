import Link from "next/link";

const principles = [
  "Persistent identity instead of disposable sessions",
  "Memory as infrastructure, not prompt residue",
  "Operator controls with clear public boundaries",
  "Audit trails, contracts, and durable execution surfaces",
];

const architecture = [
  {
    label: "Public Narrative",
    title: "The root domain explains the thesis.",
    body:
      "Use soulmd.app to frame the product, articulate why identity and memory matter, and convert interest before anyone touches the control plane.",
  },
  {
    label: "Private Operations",
    title: "The app surface runs the system.",
    body:
      "Keep the authenticated dashboard behind /app today, or move it to app.soulmd.app later when you want a harder separation between brand and execution.",
  },
  {
    label: "Memory Layer",
    title: "Context becomes a governed asset.",
    body:
      "SoulMD treats continuity, provenance, and task history as system primitives so every operator handoff stays legible and recoverable.",
  },
];

const modules = [
  {
    title: "Identity-bound memory",
    body: "Sessions should inherit context, ownership, and prior decisions instead of restarting from zero on every prompt.",
  },
  {
    title: "Operator-grade control",
    body: "Give teams a deliberate surface for contracts, approvals, tasks, and fleet state rather than a chat box pretending to be software.",
  },
  {
    title: "Public trust layer",
    body: "The homepage should be legible to buyers, partners, and operators who need a product argument before they need a login.",
  },
];

const rollout = [
  "Point soulmd.app at this landing page and keep the CTA aimed at /app.",
  "Verify the production environment variables still power the authenticated Mission Control routes.",
  "Once the product shape hardens, optionally assign app.soulmd.app to the same project or a dedicated dashboard deployment.",
  "Add waitlist capture, docs, and product proof without diluting the boundary between marketing and execution.",
];

export default function HomePage() {
  return (
    <main className="sm-page">
      <div className="sm-atmosphere" />
      <section className="sm-shell">
        <header className="sm-topbar">
          <div className="sm-brand">
            <span className="sm-brand-mark">SM</span>
            <div>
              <p className="sm-brand-name">SoulMD</p>
              <p className="sm-brand-subtitle">Memory infrastructure for AI operators</p>
            </div>
          </div>

          <nav className="sm-nav">
            <a href="#architecture">Architecture</a>
            <a href="#modules">Modules</a>
            <a href="#rollout">Rollout</a>
            <Link href="/app" className="sm-nav-cta">
              Open Mission Control
            </Link>
          </nav>
        </header>

        <section className="sm-hero">
          <div className="sm-hero-copy">
            <p className="sm-kicker">The root domain should sell the operating model.</p>
            <h1 className="sm-title">
              Memory for the machines,
              <br />
              control for the humans.
            </h1>
            <p className="sm-lede">
              SoulMD is the public-facing thesis for a private operating system:
              a product layer built around identity, durable context, and measured
              execution. The homepage should make the promise clear before the
              dashboard ever asks for trust.
            </p>

            <div className="sm-actions">
              <Link href="/app" className="sm-button sm-button-primary">
                Enter Mission Control
              </Link>
              <a href="#architecture" className="sm-button">
                View domain architecture
              </a>
            </div>

            <div className="sm-principles">
              {principles.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>

          <aside className="sm-hero-panel">
            <div className="sm-panel-label">Recommended split</div>
            <div className="sm-panel-stack">
              <article>
                <span>Root domain</span>
                <strong>soulmd.app</strong>
                <p>Positioning, proof, demand capture, and the product argument.</p>
              </article>
              <article>
                <span>App route</span>
                <strong>soulmd.app/app</strong>
                <p>Authenticated Mission Control for contracts, agents, tasks, and system state.</p>
              </article>
            </div>
            <div className="sm-panel-quote">
              <p>Remembered impression</p>
              <strong>Not another AI toy. A governed operating identity.</strong>
            </div>
          </aside>
        </section>

        <section id="architecture" className="sm-band">
          <div className="sm-section-head">
            <p className="sm-kicker">Architecture</p>
            <h2>Separate public trust from private execution.</h2>
          </div>

          <div className="sm-architecture-grid">
            {architecture.map((item, index) => (
              <article key={item.title} className="sm-architecture-card">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.label}</h3>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="sm-manifest">
          <div className="sm-manifest-mark">SoulMD</div>
          <div className="sm-manifest-copy">
            <p className="sm-kicker">Product thesis</p>
            <h2>The homepage should explain why memory matters before the operator ever logs in.</h2>
            <p>
              Buyers do not need an admin panel preview. They need a clear position
              on identity, continuity, and controlled automation. The public page
              exists to state that position with confidence.
            </p>
            <p>
              Mission Control stays available behind <code>/app</code>, but the root
              domain remains a sharper instrument: a place to frame the category,
              earn trust, and tell the story cleanly.
            </p>
          </div>
        </section>

        <section id="modules" className="sm-modules">
          {modules.map((item) => (
            <article key={item.title} className="sm-module-card">
              <p className="sm-kicker">Module</p>
              <h3>{item.title}</h3>
              <span>{item.body}</span>
            </article>
          ))}
        </section>

        <section id="rollout" className="sm-band">
          <div className="sm-section-head">
            <p className="sm-kicker">Rollout order</p>
            <h2>Connect the brand first, then harden the app boundary.</h2>
          </div>

          <div className="sm-rollout">
            {rollout.map((item, index) => (
              <article key={item} className="sm-rollout-step">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="sm-footer-card">
          <div>
            <p className="sm-kicker">Deploy posture</p>
            <h2>soulmd.app should feel inevitable, not improvised.</h2>
          </div>
          <div className="sm-footer-actions">
            <Link href="/app" className="sm-button sm-button-primary">
              Go to the app
            </Link>
            <a href="#rollout" className="sm-button">
              Domain checklist
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}
