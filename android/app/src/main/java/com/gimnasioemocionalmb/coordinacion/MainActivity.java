package com.gimnasioemocionalmb.coordinacion;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * La app: la misma Coordinación GEMB publicada en la web, dentro de un
 * WebView de Capacitor. Lo único propio de Android es el puente
 * ({@link GembPlugin}): entrar con Google, compartir archivos y la burbuja
 * flotante encima de Meet.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Antes de super.onCreate: ahí Capacitor arma el puente y carga la página.
        registerPlugin(GembPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
