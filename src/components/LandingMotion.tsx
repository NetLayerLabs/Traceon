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

    // Scroll-spy: underline the section currently in the reading band.
    const links = new Map<string, HTMLAnchorElement>();
    document.querySelectorAll<HTMLAnchorElement>('.lp-links a[href^="#"]').forEach((a) => links.set(a.hash.slice(1), a));
    const spy = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          links.forEach((a) => a.classList.remove('on'));
          links.get(e.target.id)?.classList.add('on');
        }
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    links.forEach((_, id) => {
      const s = document.getElementById(id);
      if (s) spy.observe(s);
    });

    return () => {
      reveal.disconnect();
      spy.disconnect();
      root.classList.remove('lp-js');
    };
  }, []);
  return null;
}
