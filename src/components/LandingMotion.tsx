'use client';
import { useEffect } from 'react';

/**
 * Progressive enhancement for the landing page. Server-rendered content is
 * complete without it; on mount this adds:
 *   - [data-reveal]   fade/settle in when scrolled into view (children of
 *                     [data-stagger] get an index for sequenced delays)
 *   - [data-count]    figures count up to their printed value
 *   - nav scroll-spy  the section being read is marked in the masthead
 * Everything is skipped when the visitor prefers reduced motion.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.classList.add('lp-js');

    document.querySelectorAll<HTMLElement>('[data-stagger]').forEach((group) => {
      Array.from(group.children).forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i)));
    });

    const counted = new WeakSet<Element>();
    const countUp = (el: HTMLElement) => {
      if (counted.has(el)) return;
      counted.add(el);
      const to = Number(el.dataset.count);
      const decimals = Number(el.dataset.decimals ?? 0);
      const prefix = el.dataset.prefix ?? '';
      const suffix = el.dataset.suffix ?? '';
      const start = performance.now();
      const dur = 1100;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = `${prefix}${(to * eased).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.classList.add('is-in');
          el.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
          if (el.dataset.count !== undefined) countUp(el);
          reveal.unobserve(el);
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => reveal.observe(el));

    // Scroll-spy: underline the last listed section whose top has reached the
    // reading band, so nothing is marked while the cover is in view.
    const links = new Map<string, HTMLAnchorElement>();
    document.querySelectorAll<HTMLAnchorElement>('.lp-links a[href^="#"]').forEach((a) => links.set(a.hash.slice(1), a));
    const sections = [...links.keys()].map((id) => document.getElementById(id)).filter((s): s is HTMLElement => s !== null);
    const spy = new IntersectionObserver(
      (entries) => {
        const band = entries[0]?.rootBounds?.top ?? innerHeight * 0.45;
        let active: string | null = null;
        for (const s of sections) if (s.getBoundingClientRect().top <= band) active = s.id;
        links.forEach((a, id) => a.classList.toggle('on', id === active));
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    // Every block of the page is watched, so the mark is re-checked whenever the band
    // moves into another one (also after a jump, e.g. back to the cover).
    document.querySelectorAll('.lp > header, .lp > section').forEach((el) => spy.observe(el));

    return () => {
      reveal.disconnect();
      spy.disconnect();
      root.classList.remove('lp-js');
    };
  }, []);
  return null;
}
