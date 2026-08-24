/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0e14',
        panel: '#131722',
        panel2: '#1b2230',
        border: '#2a3344',
        text: '#e6edf3',
        muted: '#8b97a7',
        accent: '#ff9900',
        accent2: '#4f9dff',
        user: '#1f2a3a',
        tool: '#13221c',
        toolborder: '#2f6b4a',
        err: '#ff5d5d',
        ok: '#3fd07a',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
