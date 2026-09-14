/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // melancholic "night at the SOC" palette — warm near-black, warm ink,
      // amber primary accent, warm red for errors. Colors are CSS custom
      // properties so the theme toggle (F2) can swap dark<->light by overriding
      // a single `data-theme` block in index.css — every Tailwind utility
      // (incl. bg-bg/15, text-muted/60, ...) flips at once. <alpha-value>
      // keeps the existing opacity modifiers working.
      colors: {
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        panel2: 'rgb(var(--color-panel2) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        border2: 'rgb(var(--color-border2) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        text2: 'rgb(var(--color-text2) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        faint: 'rgb(var(--color-faint) / <alpha-value>)',
        sidebar: 'rgb(var(--color-sidebar) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        accent2: 'rgb(var(--color-accent2) / <alpha-value>)',
        user: 'rgb(var(--color-user) / <alpha-value>)',
        err: 'rgb(var(--color-err) / <alpha-value>)',
        ok: 'rgb(var(--color-ok) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
      },
      keyframes: {
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
      animation: {
        blink: 'blink 2.4s steps(2, start) infinite',
      },
    },
  },
  plugins: [],
}
