package com.gimnasioemocionalmb.coordinacion;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * Lo que se ve dentro de la burbuja: la página /burbuja de la app (la reunión
 * de hoy, su asistencia, la carpeta y los enlaces de Meet).
 *
 * Es un WebView aparte, pero comparte con la app la sesión de Google y lo
 * guardado sin señal: Android guarda el almacenamiento por app, no por
 * pantalla. Los enlaces de fuera (Meet, WhatsApp…) se abren en su app.
 */
public class BurbujaActivity extends AppCompatActivity {

    private static final int FONDO = Color.parseColor("#03050f");
    private static final String TAG = "GembBurbuja";

    private FrameLayout marco;
    private WebView web;
    private Puente puente;
    private OnBackPressedCallback atras;

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);

        marco = new FrameLayout(this);
        marco.setBackgroundColor(FONDO);
        setContentView(marco);

        // Fuera de la burbuja (aviso en pantalla completa) la página no debe
        // quedar debajo de la barra de estado ni del teclado.
        ViewCompat.setOnApplyWindowInsetsListener(marco, (v, insets) -> {
            Insets i = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime()
            );
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        // «Atrás» navega dentro de la página mientras haya a dónde volver; en
        // la primera pantalla lo maneja Android (pliega la burbuja). Se
        // enciende y apaga según el historial: si se apagara para siempre al
        // plegar, la burbuja reabierta ya no volvería de la lista a «Reunión
        // de hoy».
        atras = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, atras);

        web = crearWeb();
        // Antes de cargar: así el puente ya existe cuando arranca la página.
        puente = new Puente(this, web, true);

        if (guardado != null) web.restoreState(guardado);
        if (web.getUrl() == null) web.loadUrl(Puente.ORIGEN + "/burbuja");
        seguirHistorial();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView crearWeb() {
        WebView w = new WebView(this);
        w.setBackgroundColor(FONDO);
        marco.addView(w, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // Para acercar la carpeta con dos dedos (sin los botones de + y −).
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " GembAndroid");

        w.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest pedido) {
                    Uri u = pedido.getUrl();
                    if (Puente.esNuestra(u)) return false;
                    puente.abrirFuera(u);
                    return true;
                }

                @Override
                public void doUpdateVisitedHistory(WebView v, String url, boolean recarga) {
                    seguirHistorial();
                }

                /**
                 * Si el proceso del WebView muere (poca memoria con Meet
                 * abierto), se arma uno nuevo en vez de dejar que Android
                 * cierre la app y se pierda la burbuja.
                 */
                @Override
                public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detalle) {
                    Log.w(TAG, "Se cayó el WebView de la burbuja; se vuelve a abrir");
                    marco.removeView(v);
                    v.destroy();
                    web = crearWeb();
                    puente.conectar(web);
                    web.loadUrl(Puente.ORIGEN + "/burbuja");
                    seguirHistorial();
                    return true;
                }
            }
        );
        w.setWebChromeClient(new WebChromeClient());
        return w;
    }

    /** El historial se actualiza un instante después: se lee en el siguiente ciclo. */
    private void seguirHistorial() {
        final WebView w = web;
        w.post(() -> {
            if (w == web) atras.setEnabled(w.canGoBack());
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle salida) {
        super.onSaveInstanceState(salida);
        web.saveState(salida);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
