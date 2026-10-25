'use client';
// Section menu shared by every page of the app. In the case file it sits in
// the top bar (and in the controls drawer on phones); the other pages use
// SiteHeader, which carries the same menu and its own drawer.
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export const SECTIONS = [
  { href: '/app', label: 'Case file', hint: 'Run an investigation' },
  { href: '/watch', label: 'Watch', hint: 'Continuous screening that opens a case on alert' },
  { href: '/backtest', label: 'Real recalls', hint: 'Backtest on public NHTSA complaint histories' },
  { href: '/data', label: 'Your data', hint: 'Upload a CSV and investigate it' },
  { href: '/scoreboard', label: 'Scoreboard', hint: 'Model guesses against the statistics' },
] as const;

export function AppNav({ className = '' }: { className?: string }) {
  const path = usePathname();
  return (
    <nav className={`section-nav ${className}`} aria-label="Sections">
      <span className="drawer-label">Sections</span>
      {SECTIONS.map((s) => {
        const on = path === s.href || (s.href === '/app' && path.startsWith('/case/'));
        return (
          <a key={s.href} href={s.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} title={s.hint}>
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}

/** Top bar for the pages outside the case file. */
export function SiteHeader({ subtitle, action }: { subtitle: string; action?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" style={{ color: 'inherit', textDecoration: 'none' }} title="Back to overview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/brand/traceon-header.png" alt="Traceon" width={882} height={160} />
          <small>{subtitle}</small>
        </a>
        <div className={`controls ${open ? 'open' : ''}`} role={open ? 'dialog' : undefined} aria-label="Menu">
          <div className="drawer-head">
            <span>Menu</span>
            <button className="btn small" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <AppNav />
          <a className="btn ghost small drawer-only" href="/">
            Overview
          </a>
        </div>
        <button className={`burger-btn ${open ? 'open' : ''}`} aria-expanded={open} aria-label="Toggle menu" onClick={() => setOpen((o) => !o)}>
          <span />
          <span />
          <span />
        </button>
        <div className="topbar-action">{action}</div>
      </header>
      <button className={`drawer-backdrop ${open ? 'show' : ''}`} aria-label="Close menu" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />
    </>
  );
}
