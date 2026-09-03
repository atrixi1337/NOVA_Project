/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // melancholic "night at the SOC" palette — warm near-black, warm ink,
      // amber primary accent, warm red for errors.
      colors: {
        bg: '#0b0a09',          // near-black, warm
        panel: '#12100e',       // card surface (one step raised)
        panel2: '#1a1915',      // two steps raised
        border: '#24221d',      // divider lines
        border2: '#2e2c27',
        text: '#d6d0c2',        // warm off-white (ink)
        text2: '#efe9da',       // ink-bright
        muted: '#6f6a5d',       // dim
        faint: '#3a372f',       // faint
        accent: '#c9a227',      // amber (primary)
        accent2: '#8a7320',     // amber-dim (secondary)
        user: '#12100e',
        err: '#96402f',         // warm red
        ok: '#3fd07a',          // status green (kept)
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
