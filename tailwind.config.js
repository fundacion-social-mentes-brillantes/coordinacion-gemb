/** @type {import('tailwindcss').Config} */
// Paleta suave y serena (bienestar emocional). Está centralizada aquí:
// para cambiar el color de la marca, edita `primary` y `accent`.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Verde-turquesa calmado = color principal de la marca.
        primary: {
          50: '#f2faf7',
          100: '#d9f2ea',
          200: '#b3e4d3',
          300: '#84cfb7',
          400: '#4fb497',
          500: '#2b9678',
          600: '#1f7862',
          700: '#1c5f4f',
          800: '#194c40',
          900: '#163f36',
        },
        // Azul sereno = acento secundario.
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
        surface: '#f5faf8',
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
        card: '0 1px 3px rgba(16, 40, 34, 0.08), 0 1px 2px rgba(16, 40, 34, 0.04)',
        lifted: '0 8px 24px rgba(16, 40, 34, 0.12)',
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};
