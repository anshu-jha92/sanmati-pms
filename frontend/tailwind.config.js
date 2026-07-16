/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Palette is driven by CSS variables (see index.css) so the whole app
        // themes light/dark without touching component classes. Light values are
        // identical to the original hex; dark values are defined under .dark.
        // (`bg-white` is handled by a dedicated rule in index.css so `text-white`
        // on coloured buttons stays truly white.)
        surface: v('surface'),
        brand: {
          50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'), 300: v('brand-300'),
          400: v('brand-400'), 500: v('brand-500'), 600: v('brand-600'), 700: v('brand-700'),
          800: v('brand-800'), 900: v('brand-900'),
        },
        cyan: {
          400: v('cyan-400'), 500: v('cyan-500'), 600: v('cyan-600'),
        },
        ink: {
          50: v('ink-50'), 100: v('ink-100'), 200: v('ink-200'), 300: v('ink-300'), 400: v('ink-400'),
          500: v('ink-500'), 600: v('ink-600'), 700: v('ink-700'), 800: v('ink-800'), 900: v('ink-900'),
        },
        state: {
          running: v('state-running'), idle: v('state-idle'), maintenance: v('state-maintenance'),
          down: v('state-down'), offline: v('state-offline'),
        },
        statebg: {
          running: v('statebg-running'), idle: v('statebg-idle'), maintenance: v('statebg-maintenance'),
          down: v('statebg-down'), offline: v('statebg-offline'),
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card:     '0 1px 4px rgba(13,21,38,0.07), 0 4px 16px rgba(13,21,38,0.05)',
        cardHov:  '0 4px 12px rgba(13,21,38,0.09), 0 16px 40px rgba(13,21,38,0.07)',
        brand:    '0 3px 10px rgba(26,107,255,0.32)',
      },
      backgroundImage: {
        'grid-fade': 'linear-gradient(rgba(26,107,255,0.018) 1px,transparent 1px), linear-gradient(90deg, rgba(26,107,255,0.018) 1px,transparent 1px)',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 2s infinite',
      },
    },
  },
  plugins: [],
};
