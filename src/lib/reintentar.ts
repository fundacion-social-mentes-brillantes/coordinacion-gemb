/**
 * Escucha algo de Firestore y, si el servidor lo rechaza, vuelve a intentarlo
 * solo unas veces más tarde.
 *
 * Firestore no reintenta una escucha rechazada: se queda muerta hasta
 * recargar. Pasó con una cuenta recién creada, que en sus primeros minutos
 * veía la carpeta, los enlaces y las reuniones vacíos aunque ya tenía
 * permiso. Con esto, la pantalla se arregla sola.
 */
const ESPERAS_MS = [4_000, 15_000, 45_000, 120_000];

export function escucharConReintentos(
  suscribir: (onError: (e: Error) => void) => () => void,
  alFallarDelTodo: (e: Error) => void,
): () => void {
  let cancelar: (() => void) | null = null;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let intento = 0;
  let vivo = true;

  const arrancar = () => {
    cancelar = suscribir((e) => {
      const codigo = (e as { code?: string }).code;
      const reintentable = codigo === 'permission-denied' || codigo === 'unavailable';
      if (!vivo) return;
      if (reintentable && intento < ESPERAS_MS.length) {
        temporizador = setTimeout(() => {
          if (!vivo) return;
          cancelar?.();
          arrancar();
        }, ESPERAS_MS[intento++]);
        return;
      }
      alFallarDelTodo(e);
    });
  };

  arrancar();
  return () => {
    vivo = false;
    clearTimeout(temporizador);
    cancelar?.();
  };
}
