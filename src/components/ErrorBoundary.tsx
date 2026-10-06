import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Si una pantalla falla al pintarse, muestra un aviso con "Recargar" en vez
 * de dejar la app entera en blanco. En la app instalada del celular no hay
 * barra del navegador ni botón de recargar: sin esto, la única salida era
 * cerrar la app a la fuerza.
 *
 * `resetKey` (la ruta) lo reinicia al navegar: un error en Panel no deja
 * bloqueada la pantalla de Sesiones.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error al pintar la pantalla', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto mt-8 max-w-sm space-y-3 p-6 text-center">
        <p className="text-lg font-bold text-primary-900">Algo falló en esta pantalla</p>
        <p className="text-sm text-slate-600">
          Lo que ya marcaste está guardado. Recarga la app para seguir; si vuelve a
          pasar, avisa a la administración.
        </p>
        <button
          type="button"
          onClick={() => {
            // Si hay versión nueva esperando, recargar instala esa (suele ser
            // justo lo que arregla el error); si no, recarga sin más.
            window.dispatchEvent(new CustomEvent('gemb:do-update'));
            setTimeout(() => window.location.reload(), 600);
          }}
          className="btn-primary w-full"
        >
          Recargar
        </button>
      </div>
    );
  }
}
