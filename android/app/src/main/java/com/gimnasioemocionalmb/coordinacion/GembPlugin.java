package com.gimnasioemocionalmb.coordinacion;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Solo sirve para enganchar el {@link Puente} al WebView de Capacitor en el
 * momento justo: Capacitor llama a {@code load()} después de crear el WebView
 * y ANTES de cargar la página, así el objeto {@code GembNativo} ya existe
 * cuando la página arranca.
 *
 * La página no usa los plugins de Capacitor: la app carga la versión
 * publicada (con su service worker) y ahí el código que Capacitor inyecta en
 * el HTML no siempre llega. El puente de mensajes, en cambio, lo pone el
 * propio WebView en cada página.
 */
@CapacitorPlugin(name = "Gemb")
public class GembPlugin extends Plugin {

    @SuppressWarnings("unused")
    private Puente puente;

    @Override
    public void load() {
        puente = new Puente(getActivity(), getBridge().getWebView(), false);
    }
}
