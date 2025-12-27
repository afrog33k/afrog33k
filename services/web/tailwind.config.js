/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Tesla-like dark theme
        surface: {
          DEFAULT: '#0a0a0a',
          raised: '#141414',
          overlay: '#1a1a1a',
        },
        accent: {
          DEFAULT: '#3b82f6',
          muted: '#1d4ed8',
        },
        text: {
          primary: '#fafafa',
          secondary: '#a3a3a3',
          muted: '#525252',
        },
        // Report type colors
        decision: '#22c55e',
        research: '#3b82f6',
        repo: '#a855f7',
        drift: '#f59e0b',
        watchlist: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
