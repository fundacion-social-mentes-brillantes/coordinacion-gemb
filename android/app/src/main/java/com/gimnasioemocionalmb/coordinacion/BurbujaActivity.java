package com.gimnasioemocionalmb.coordinacion;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
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

    private WebView web;
    private Puente puente;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);

        FrameLayout marco = new FrameLayout(this);
        marco.setBackgroundColor(FONDO);
        web = new WebView(this);
        web.setBackgroundColor(FONDO);
        marco.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
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

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " GembAndroid");

        web.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest pedido) {
                    Uri u = pedido.getUrl();
                    if (Puente.esNuestra(u)) return false;
                    puente.abrirFuera(u);
                    return true;
                }
            }
        );
        web.setWebChromeClient(new WebChromeClient());
        // Antes de cargar: así el puente ya existe cuando arranca la página.
        puente = new Puente(this, web, true);

        if (guardado != null) web.restoreState(guardado);
        if (web.getUrl() == null) web.loadUrl(Puente.ORIGEN + "/burbuja");

        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (web.canGoBack()) {
                            web.goBack();
                        } else {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    }
                }
            );
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
