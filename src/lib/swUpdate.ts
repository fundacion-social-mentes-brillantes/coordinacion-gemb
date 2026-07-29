/**
 * Estado de "hay versión nueva esperando".
 *
 * El service worker avisa muy pronto (a los pocos milisegundos de abrir la
 * app), mucho antes de que la pantalla con el botón "Actualizar" exista
 * (esa solo se monta después de iniciar sesión). Por eso, además de lanzar
 * el evento, se deja una marca que el aviso pueda consultar al aparecer.
 */
let ready = false;

/** Marca que hay versión nueva y avisa a quien ya esté escuchando. */
export function markUpdateReady() {
  ready = true;
  window.dispatchEvent(new CustomEvent('gemb:update-ready'));
}

/** ¿Ya había versión nueva esperando antes de montar el aviso? */
export function isUpdateReady() {
  return ready;
}
