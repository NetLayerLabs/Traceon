'use client';
import { useEffect, useState } from 'react';

const LINKS = [
  ['#method', 'Method'],
  ['#why', 'Explain why'],
  ['#blind', 'Blind tests'],
  ['#stack', 'Stack'],
] as const;

/**
 * Landing masthead. Desktop: section links on the right. Phones and tablets
 * (<= 900px): a burger opens a left drawer with the same links and the call to
 * action pinned at the bottom. Closes on backdrop, Esc, Close and navigation.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <nav className={`lp-nav ${open ? 'open' : ''}`}>
      <div className="lp-wrap">
        <a className="lp-logo" href="/" aria-label="Traceon home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/traceon-header.png" alt="Traceon" width={882} height={160} />
        </a>
        <div className="lp-links">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </div>
        <button className="lp-burger" aria-expanded={open} aria-controls="lp-drawer" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>
          <span />
          <span />
          <span />
        </button>
      </div>
      <button className="lp-backdrop" aria-label="Close menu" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />
      <div className="lp-drawer" id="lp-drawer" role="dialog" aria-label="Menu" aria-hidden={!open}>
        <div className="lp-drawer-head">
          <span className="lp-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/traceon-header.png" alt="Traceon" width={882} height={160} />
          </span>
          <button className="lp-drawer-close" aria-label="Close menu" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
            ×
          </button>
        </div>
        {LINKS.map(([href, label], i) => (
          <a key={href} href={href} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
            <span>0{i + 1}</span>
            {label}
          </a>
        ))}
        <div className="lp-drawer-cta">
          <a className="lp-btn primary big" href="/app" tabIndex={open ? 0 : -1}>
            Open the case file <span className="arr">→</span>
          </a>
          <a className="lp-btn big" href="/app?autorun=1" tabIndex={open ? 0 : -1}>
            Watch a live investigation
          </a>
        </div>
      </div>
    </nav>
  );
}
