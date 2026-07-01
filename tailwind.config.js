/** @type {import('tailwindcss').Config} */
// La marca (primary), el fondo (surface), los neutros (slate) y el blanco
// (white) se leen de variables CSS por canal, definidas por tema en index.css.
// Así, cambiar `data-theme` recolorea toda la app (incluidas las opacidades).
// El azul de acento (accent) y los colores pastel de etiquetas se quedan
// fijos a propósito (categorías legibles en cualquier tema).
const ch = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: ch('--c-surface'),
        white: ch('--c-white'),
        primary: {
          50: ch('--c-p-50'),
          100: ch('--c-p-100'),
          200: ch('--c-p-200'),
          300: ch('--c-p-300'),
          400: ch('--c-p-400'),
          500: ch('--c-p-500'),
          600: ch('--c-p-600'),
          700: ch('--c-p-700'),
          800: ch('--c-p-800'),
          900: ch('--c-p-900'),
        },
        slate: {
          50: ch('--c-sl-50'),
          100: ch('--c-sl-100'),
          200: ch('--c-sl-200'),
          300: ch('--c-sl-300'),
          400: ch('--c-sl-400'),
          500: ch('--c-sl-500'),
          600: ch('--c-sl-600'),
          700: ch('--c-sl-700'),
          800: ch('--c-sl-800'),
          900: ch('--c-sl-900'),
        },
        // Azul sereno de acento (fijo, para etiquetas).
        accent: {
          50: '#eff6fc',
          100: '#d9ebf7',
          200: '#bcdcf1',
          300: '#8ec6e6',
          400: '#5aa9d6',
          500: '#3a8cc2',
          600: '#2c6fa3',
          700: '#265a84',
          800: '#244c6d',
          900: '#21405c',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 3px rgba(8, 15, 30, 0.08), 0 1px 2px rgba(8, 15, 30, 0.04)',
        lifted: '0 8px 24px rgba(8, 15, 30, 0.18)',
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};
