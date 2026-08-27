/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // DeepAI-style palette: pure black, clean grays, subtle accent
      colors: {
        bg: '#000000',
        panel: '#0a0a0a',
        panel2: '#121212',
        border: '#1a1a1a',
        border2: '#222222',
        text: '#e0e0e0',
        text2: '#a0a0a0',
        muted: '#888888',
        accent: '#ff9900',
        accent2: '#4f9dff',
        user: '#1a1a1a',
        err: '#ff5d5d',
        ok: '#3fd07a',
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
