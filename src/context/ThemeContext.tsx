import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  aplicarColores,
  coloresDe,
  guardarApariencia,
  leerApariencia,
  type Apariencia,
  type ColoresTema,
} from '../lib/tema';

// Los colores que cada quien eligió en Ajustes (como en Budget). Se guardan
// en este celular o computador: así funcionan incluso antes de entrar.

interface AparienciaValue {
  apariencia: Apariencia;
  /** Elige un tema listo (id) o el propio ('propio'). */
  elegirTema: (tema: string) => void;
  /** Guarda los tres colores del tema propio y lo deja puesto. */
  guardarPropio: (c: ColoresTema) => void;
  /** Muestra unos colores sin guardarlos (null = volver a los guardados). */
  vistaPrevia: (c: ColoresTema | null) => void;
}

const AparienciaContext = createContext<AparienciaValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export function useApariencia() {
  const ctx = useContext(AparienciaContext);
  if (!ctx) throw new Error('useApariencia debe usarse dentro de <ThemeProvider>');
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [apariencia, setApariencia] = useState<Apariencia>(leerApariencia);

  // Al arrancar y cada vez que cambia: aplica y recuerda.
  useEffect(() => {
    guardarApariencia(apariencia);
  }, [apariencia]);

  // Otra pestaña cambió los colores: se ven también aquí.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'gemb-apariencia') setApariencia(leerApariencia());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const elegirTema = useCallback((tema: string) => setApariencia((a) => ({ ...a, tema })), []);
  const guardarPropio = useCallback(
    (c: ColoresTema) => setApariencia({ tema: 'propio', propio: c }),
    [],
  );
  const vistaPrevia = useCallback(
    (c: ColoresTema | null) => {
      aplicarColores(c ?? coloresDe(apariencia));
    },
    [apariencia],
  );

  const value = useMemo(
    () => ({ apariencia, elegirTema, guardarPropio, vistaPrevia }),
    [apariencia, elegirTema, guardarPropio, vistaPrevia],
  );
  return <AparienciaContext.Provider value={value}>{children}</AparienciaContext.Provider>;
}
