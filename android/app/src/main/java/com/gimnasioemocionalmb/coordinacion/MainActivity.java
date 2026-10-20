package com.gimnasioemocionalmb.coordinacion;

import android.os.Bundle;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * La app: la misma Coordinación GEMB publicada en la web, dentro de un
 * WebView de Capacitor. Lo único propio de Android es el puente
 * ({@link GembPlugin}): entrar con Google, compartir archivos, la burbuja
 * flotante encima de Meet y el aviso del día antes ({@link AvisosServicio}).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Antes de super.onCreate: ahí Capacitor arma el puente y carga la página.
        registerPlugin(GembPlugin.class);
        super.onCreate(savedInstanceState);

        // El canal del aviso del día antes tiene que existir antes de que
        // llegue uno con la app cerrada (si no, Android lo pone en «Otros»).
        AvisosServicio.crearCanal(this);

        // Si el proceso del WebView muere (poca memoria, sobre todo con la
        // burbuja y Meet abiertos), Chrome cierra TODA la app, burbuja
        // incluida, salvo que cada WebView diga que lo maneja. Aquí se vuelve
        // a armar la pantalla. (Va después de super.onCreate: Capacitor
        // reemplaza la lista de oyentes al terminar de armar el puente.)
        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                        Log.w("GembPuente", "Se cayó el WebView de la app; se vuelve a abrir");
                        recreate();
                        return true;
                    }
                }
            );
    }
}
