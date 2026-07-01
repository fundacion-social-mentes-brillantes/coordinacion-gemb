import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'pink' | 'dark';

const STORAGE_KEY = 'gemb-theme';

// Color de la barra del navegador (móvil) por tema.
const META_COLOR: Record<Theme, string> = {
  light: '#2b9678',
  pink: '#c83ab8',
  dark: '#0c1222',
};

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}

function getInitial(): Theme {
  if (typeof document !== 'undefined') {
    const d = document.documentElement.getAttribute('data-theme');
    if (d === 'pink' || d === 'dark' || d === 'light') return d;
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitial);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* modo privado: se ignora */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLOR[theme]);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
