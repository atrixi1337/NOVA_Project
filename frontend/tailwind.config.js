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
      // Modern pass: UI text uses the platform's native sans (zero download,
      // crisp on the phone); IBM Plex Mono stays for code. Radii are bumped one
      // step across the board so every existing rounded-* utility gets softer.
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        serif: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        sm: '0.5rem',
        DEFAULT: '0.625rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.75rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(0 0 0 / 0.18), 0 4px 16px -4px rgb(0 0 0 / 0.28)',
        float: '0 8px 30px -8px rgb(0 0 0 / 0.5)',
        glow: '0 6px 24px -6px rgb(var(--color-accent) / 0.55)',
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
