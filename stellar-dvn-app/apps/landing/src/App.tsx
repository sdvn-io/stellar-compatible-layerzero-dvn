import {
  ArrowUpRight,
  Blocks,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Fingerprint,
  Github,
  Orbit,
  RadioTower,
  ShieldCheck,
} from "lucide-react";

const OAPP_URL = "https://oapp.sdvn.io";
const DOCS_URL = "https://docs.sdvn.io";
const GITHUB_URL = "https://github.com/sdvn-io/stellar-compatible-layerzero-dvn";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

function Mark({ compact = false }: { compact?: boolean }) {
  return <div className="brand" aria-label="SDVN">
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    {!compact && <span>SDVN</span>}
  </div>;
}

function App() {
  return <div className="site-shell">
    <div className="ambient ambient-one" />
    <div className="ambient ambient-two" />

    <header className="nav wrap">
      <a href="#top" className="logo-link" aria-label="SDVN home"><Mark /></a>
      <nav aria-label="Primary navigation">
        <a href="#network">Network</a>
        <a href="#architecture">Architecture</a>
        <a href={DOCS_URL} {...external}>Docs <ArrowUpRight size={13} /></a>
        <a href={GITHUB_URL} {...external}>GitHub <Github size={13} /></a>
      </nav>
      <a className="nav-cta" href={OAPP_URL} {...external}>
        Launch OApp <ArrowUpRight size={15} />
      </a>
    </header>

    <main id="top">
      <section className="hero wrap">
        <div className="eyebrow"><span className="live-dot" /> Live on public testnets</div>
        <h1>Verification infrastructure<br />for the <em>omnichain</em> world.</h1>
        <p className="hero-copy">
          SDVN is a Stellar-compatible LayerZero DVN—built to verify cross-chain messages and connect Stellar applications to LayerZero's omnichain infrastructure.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href={OAPP_URL} {...external}>
            Launch OApp <ArrowUpRight size={18} />
          </a>
          <a className="button button-secondary" href={GITHUB_URL} {...external}>
            Read documentation <BookOpen size={17} />
          </a>
        </div>

        <div className="network-stage" aria-label="Stellar to LayerZero verification flow">
          <div className="stage-glow" />
          <div className="chain-node stellar-node">
            <span className="node-icon"><Orbit size={25} /></span>
            <span><small>Source or destination</small>Stellar</span>
          </div>
          <div className="signal-line">
            <span className="signal signal-a" />
            <span className="signal signal-b" />
            <div className="verification-pill"><ShieldCheck size={15} /> Verified by SDVN</div>
          </div>
          <div className="chain-node lz-node">
            <span className="node-icon"><Blocks size={25} /></span>
            <span><small>Omnichain protocol</small>LayerZero V2</span>
          </div>
        </div>
      </section>

      <section className="proof-strip" id="network">
        <div className="wrap proof-grid">
          <div><strong>2</strong><span>Live testnets</span></div>
          <div><strong>↔</strong><span>Bidirectional delivery</span></div>
          <div><strong>256</strong><span>UTF-8 bytes per message</span></div>
          <div><strong>V2</strong><span>LayerZero Endpoint</span></div>
        </div>
      </section>

      <section className="section wrap" id="architecture">
        <div className="section-heading">
          <span className="kicker">The verification layer</span>
          <h2>Security, without<br />application lock-in.</h2>
          <p>A clean separation between applications, verification, and execution. SDVN attests to packet validity while your OApp owns its payload and state.</p>
        </div>

        <div className="feature-grid">
          <article className="feature-card feature-wide">
            <div className="feature-icon"><Fingerprint size={23} /></div>
            <div>
              <span className="card-number">01</span>
              <h3>Canonical packet verification</h3>
              <p>SDVN verifies the packet header and payload hash, preserving the exact application message while remaining agnostic to its meaning.</p>
            </div>
            <div className="hash-visual" aria-hidden="true">
              <span>0x4a9e4cda95d748b6</span>
              <span>83a286e45f2f8361</span>
              <span>80c55a8463e415ae</span>
              <span>ce83ec3b474341e5</span>
              <i />
            </div>
          </article>

          <article className="feature-card">
            <div className="feature-icon"><RadioTower size={23} /></div>
            <span className="card-number">02</span>
            <h3>Bidirectional by design</h3>
            <p>Messages move from Stellar to EVM and from EVM to Stellar through configured LayerZero pathways.</p>
            <div className="mini-route" aria-hidden="true">
              <span>Stellar</span><i /><CircleDot size={16} /><i /><span>EVM</span>
            </div>
          </article>

          <article className="feature-card">
            <div className="feature-icon"><ShieldCheck size={23} /></div>
            <span className="card-number">03</span>
            <h3>Observable end to end</h3>
            <p>Track source send, DVN verification, ULN commit, and destination execution with public explorer evidence.</p>
            <ul className="check-list">
              <li><Check size={14} /> Packet verified</li>
              <li><Check size={14} /> ULN committed</li>
              <li><Check size={14} /> OApp executed</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="cta-section wrap">
        <div className="cta-panel">
          <div className="cta-orbit" aria-hidden="true"><Mark compact /></div>
          <span className="kicker">See it work</span>
          <h2>Send one message.<br />Watch every proof.</h2>
          <p>Launch the testnet OApp to send an exact UTF-8 message between Stellar and Sepolia, then follow each step onchain.</p>
          <div className="hero-actions">
            <a className="button button-primary" href={OAPP_URL} {...external}>Launch OApp <ArrowUpRight size={18} /></a>
            <a className="text-link" href={DOCS_URL} {...external}>Explore the architecture <ChevronRight size={16} /></a>
          </div>
        </div>
      </section>
    </main>

    <footer className="footer wrap">
      <Mark />
      <p>Stellar-compatible LayerZero verification infrastructure.</p>
      <div>
        <a href={OAPP_URL} {...external}>OApp <ArrowUpRight size={12} /></a>
        <a href={DOCS_URL} {...external}>Documentation <ArrowUpRight size={12} /></a>
        <a href={GITHUB_URL} {...external}>GitHub <Github size={12} /></a>
      </div>
    </footer>
  </div>;
}

export default App;
