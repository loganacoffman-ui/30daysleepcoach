import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web-navy.css', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

describe('web navy theme', () => {
  it('loads the theme after the existing stylesheet', () => {
    expect(html.indexOf('href="web-navy.css"')).toBeGreaterThan(html.indexOf('</style>'));
  });
  it('keeps browser and installed-app chrome aligned with the canvas', () => {
    expect(css).toContain('--bg: #16213A');
    expect(html).toContain('name="theme-color" content="#16213A"');
    expect(manifest.theme_color).toBe('#16213A');
    expect(manifest.background_color).toBe('#16213A');
  });
  it('includes keyboard focus and reduced-motion treatments', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain("if (getComputedStyle(canvas).display === 'none') return;");
  });
});
