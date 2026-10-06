/**
 * Espera una escritura, pero sin quedarse girando para siempre: sin señal,
 * Firestore no resuelve la promesa hasta reconectar (el cambio ya quedó en el
 * teléfono y se enviará solo). Devuelve false si se agotó el tiempo.
 */
export async function esperarConLimite(p: Promise<unknown>, ms = 6000): Promise<boolean> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<false>((r) => {
    t = setTimeout(() => r(false), ms);
  });
  try {
    return await Promise.race([p.then(() => true as const), limite]);
  } finally {
    clearTimeout(t);
  }
}
