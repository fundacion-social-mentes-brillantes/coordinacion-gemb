package com.gimnasioemocionalmb.coordinacion;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * El puente entre la página (la app web publicada) y lo nativo del teléfono.
 *
 * La página ve un objeto {@code GembNativo} con {@code postMessage(texto)} y
 * {@code onmessage}. Cada pedido es un JSON {@code {id, accion, ...}} y cada
 * respuesta {@code {id, ok, datos}} o {@code {id, ok:false, codigo, mensaje}}.
 * El lado web está en src/lib/nativo.ts.
 *
 * Solo responde a nuestra página (el WebView filtra por origen) y solo al
 * marco principal: un iframe de otro sitio no puede usarlo.
 */
final class Puente implements WebViewCompat.WebMessageListener {

    static final String ORIGEN = "https://coordinacion-gemb.vercel.app";
    private static final String TAG = "GembPuente";

    private final ComponentActivity actividad;
    private final boolean esBurbuja;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService trabajo = Executors.newSingleThreadExecutor();
    private final ActivityResultLauncher<String> pedirAvisos;
    @Nullable
    private Consumer<Boolean> trasPermiso;

    Puente(ComponentActivity actividad, WebView web, boolean esBurbuja) {
        this.actividad = actividad;
        this.esBurbuja = esBurbuja;
        // Se registra al crear la pantalla: Android no deja hacerlo después.
        pedirAvisos = actividad.registerForActivityResult(new ActivityResultContracts.RequestPermission(), concedido -> {
            Consumer<Boolean> f = trasPermiso;
            trasPermiso = null;
            if (f != null) f.accept(concedido);
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "GembNativo", Collections.singleton(ORIGEN), this);
        } else {
            // WebView muy viejo: la app funciona como la página web, sin extras.
            Log.w(TAG, "Este WebView no admite el puente de mensajes; actualiza Android System WebView.");
        }
    }

    static boolean esNuestra(@Nullable Uri u) {
        return u != null && "https".equals(u.getScheme()) && "coordinacion-gemb.vercel.app".equals(u.getHost());
    }

    @Override
    public void onPostMessage(
        @NonNull WebView view,
        @NonNull WebMessageCompat mensaje,
        @NonNull Uri origen,
        boolean marcoPrincipal,
        @NonNull JavaScriptReplyProxy respuesta
    ) {
        if (!marcoPrincipal || mensaje.getData() == null) return;
        final JSONObject m;
        final String id;
        try {
            m = new JSONObject(mensaje.getData());
            id = m.getString("id");
        } catch (JSONException e) {
            return;
        }
        String accion = m.optString("accion");
        try {
            switch (accion) {
                case "info":
                    listo(respuesta, id, info());
                    break;
                case "copiar":
                    copiar(m.optString("texto"));
                    listo(respuesta, id, null);
                    break;
                case "compartir":
                    compartir(m, respuesta, id);
                    break;
                case "abrir":
                    abrir(m.optString("url"));
                    listo(respuesta, id, null);
                    break;
                case "abrirApp":
                    abrirApp();
                    listo(respuesta, id, null);
                    break;
                case "entrarGoogle":
                    entrarConGoogle(respuesta, id);
                    break;
                case "salirGoogle":
                    salirDeGoogle(respuesta, id);
                    break;
                case "burbuja":
                    mostrarBurbuja(respuesta, id);
                    break;
                case "estadoBurbuja":
                    listo(respuesta, id, Burbuja.estado(actividad));
                    break;
                case "cerrarBurbuja":
                    Burbuja.ocultar(actividad);
                    listo(respuesta, id, null);
                    break;
                case "ajustesBurbuja":
                    Burbuja.abrirAjustesBurbujas(actividad);
                    listo(respuesta, id, null);
                    break;
                case "ajustesAvisos":
                    Burbuja.abrirAjustesAvisos(actividad);
                    listo(respuesta, id, null);
                    break;
                default:
                    fallo(respuesta, id, "desconocida", "Acción desconocida: " + accion);
            }
        } catch (Exception e) {
            Log.e(TAG, "Falló «" + accion + "»", e);
            fallo(respuesta, id, "fallo", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    // ---------------------------------------------------------------- respuestas

    private void listo(JavaScriptReplyProxy r, String id, @Nullable JSONObject datos) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("ok", true);
            if (datos != null) o.put("datos", datos);
            enviar(r, o);
        } catch (JSONException ignorada) {
            // No pasa: las claves son fijas.
        }
    }

    private void fallo(JavaScriptReplyProxy r, String id, String codigo, String mensaje) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("ok", false);
            o.put("codigo", codigo);
            o.put("mensaje", mensaje);
            enviar(r, o);
        } catch (JSONException ignorada) {
            // No pasa: las claves son fijas.
        }
    }

    private void enviar(JavaScriptReplyProxy r, JSONObject o) {
        String texto = o.toString();
        if (Looper.myLooper() == Looper.getMainLooper()) r.postMessage(texto);
        else principal.post(() -> r.postMessage(texto));
    }

    // ------------------------------------------------------------------ acciones

    private JSONObject info() throws JSONException {
        JSONObject o = new JSONObject();
        String version = "";
        try {
            version = actividad.getPackageManager().getPackageInfo(actividad.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException ignorada) {
            // Es nuestro propio paquete: siempre existe.
        }
        o.put("version", version);
        o.put("android", Build.VERSION.SDK_INT);
        o.put("burbuja", esBurbuja);
        o.put("burbujasPosibles", Build.VERSION.SDK_INT >= 30);
        return o;
    }

    private void copiar(String texto) {
        ClipboardManager cm = (ClipboardManager) actividad.getSystemService(Context.CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("Coordinación GEMB", texto));
    }

    /** Comparte un archivo (la lista, el PDF de la carpeta, un Excel…) con el menú de Android. */
    private void compartir(JSONObject m, JavaScriptReplyProxy r, String id) {
        String datos = m.optString("datos");
        String mime = m.optString("mime", "application/octet-stream");
        String texto = m.optString("texto");
        String nombre = m.optString("nombre").replaceAll("[^\\p{L}\\p{N}._ -]", "_").trim();
        if (nombre.isEmpty()) nombre = "archivo";
        if (nombre.length() > 120) nombre = nombre.substring(nombre.length() - 120);
        final String nombreFinal = nombre;
        trabajo.execute(() -> {
            try {
                // Una carpeta propia en la caché, que se vacía en cada envío.
                File carpeta = new File(actividad.getCacheDir(), "compartir");
                if (!carpeta.isDirectory() && !carpeta.mkdirs()) throw new IllegalStateException("No se pudo preparar el archivo.");
                File[] viejos = carpeta.listFiles();
                if (viejos != null) for (File f : viejos) //noinspection ResultOfMethodCallIgnored
                    f.delete();
                File archivo = new File(carpeta, nombreFinal);
                try (FileOutputStream out = new FileOutputStream(archivo)) {
                    out.write(Base64.decode(datos, Base64.DEFAULT));
                }
                Uri uri = FileProvider.getUriForFile(actividad, actividad.getPackageName() + ".fileprovider", archivo);
                Intent enviar = new Intent(Intent.ACTION_SEND);
                enviar.setType(mime);
                enviar.putExtra(Intent.EXTRA_STREAM, uri);
                if (!texto.isEmpty()) enviar.putExtra(Intent.EXTRA_TEXT, texto);
                enviar.setClipData(ClipData.newRawUri(nombreFinal, uri));
                enviar.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent elegir = Intent.createChooser(enviar, null);
                // Desde la burbuja, el menú y WhatsApp se abren en pantalla completa.
                if (esBurbuja) elegir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                principal.post(() -> {
                    try {
                        actividad.startActivity(elegir);
                        listo(r, id, null);
                    } catch (ActivityNotFoundException e) {
                        fallo(r, id, "sin-app", "No hay ninguna app para compartir el archivo.");
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "No se pudo compartir", e);
                fallo(r, id, "fallo", "No se pudo preparar el archivo para compartir.");
            }
        });
    }

    /** Abre un enlace fuera de la app (Meet abre su propia app si está instalada). */
    void abrirFuera(Uri uri) {
        String esquema = uri.getScheme();
        if (!"https".equals(esquema) && !"http".equals(esquema) && !"mailto".equals(esquema) && !"tel".equals(esquema)) return;
        try {
            Intent ver = new Intent(Intent.ACTION_VIEW, uri);
            ver.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            actividad.startActivity(ver);
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "Nada abre " + uri, e);
        }
    }

    private void abrir(String url) {
        abrirFuera(Uri.parse(url));
    }

    private void abrirApp() {
        Intent abrir = new Intent(actividad, MainActivity.class);
        abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        actividad.startActivity(abrir);
    }

    // ------------------------------------------------------------ entrar con Google

    /**
     * Google no deja entrar desde un WebView: aquí se entra con el selector de
     * cuentas de Android y se le pasa a la página el token, que con él entra a
     * Firebase (signInWithCredential).
     */
    private void entrarConGoogle(JavaScriptReplyProxy r, String id) {
        CredentialManager cm = CredentialManager.create(actividad);
        GetSignInWithGoogleOption opcion = new GetSignInWithGoogleOption.Builder(actividad.getString(R.string.default_web_client_id)).build();
        GetCredentialRequest pedido = new GetCredentialRequest.Builder().addCredentialOption(opcion).build();
        cm.getCredentialAsync(
            actividad,
            pedido,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(actividad),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse resultado) {
                    Credential c = resultado.getCredential();
                    if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        try {
                            GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(c.getData());
                            JSONObject d = new JSONObject();
                            d.put("idToken", g.getIdToken());
                            listo(r, id, d);
                        } catch (Exception e) {
                            Log.e(TAG, "Respuesta de Google ilegible", e);
                            fallo(r, id, "fallo", "Google respondió algo que no se pudo leer.");
                        }
                    } else {
                        fallo(r, id, "fallo", "Google respondió con otro tipo de cuenta.");
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    Log.w(TAG, "No se pudo entrar con Google: " + e.getType(), e);
                    if (e instanceof GetCredentialCancellationException) {
                        fallo(r, id, "cancelado", "Se canceló el ingreso.");
                    } else if (e instanceof NoCredentialException) {
                        fallo(r, id, "sin-cuenta", "No hay cuentas de Google en este teléfono.");
                    } else {
                        fallo(r, id, "fallo", e.getMessage() != null ? e.getMessage() : e.getType());
                    }
                }
            }
        );
    }

    /** Al salir: que la próxima vez vuelva a preguntar con qué cuenta entrar. */
    private void salirDeGoogle(JavaScriptReplyProxy r, String id) {
        CredentialManager.create(actividad).clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            new CancellationSignal(),
            ContextCompat.getMainExecutor(actividad),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void v) {
                    listo(r, id, null);
                }

                @Override
                public void onError(@NonNull ClearCredentialException e) {
                    // No es grave: solo significa que Android puede recordar la cuenta.
                    listo(r, id, null);
                }
            }
        );
    }

    // ----------------------------------------------------------------- burbuja

    private void mostrarBurbuja(JavaScriptReplyProxy r, String id) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(actividad, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            trasPermiso = concedido -> {
                if (concedido) publicarBurbuja(r, id);
                else fallo(r, id, "sin-permiso", "Sin permiso para mostrar avisos.");
            };
            pedirAvisos.launch(Manifest.permission.POST_NOTIFICATIONS);
            return;
        }
        publicarBurbuja(r, id);
    }

    @SuppressLint("MissingPermission") // se comprueba justo antes
    private void publicarBurbuja(JavaScriptReplyProxy r, String id) {
        if (!NotificationManagerCompat.from(actividad).areNotificationsEnabled()) {
            fallo(r, id, "sin-permiso", "Los avisos de la app están apagados.");
            return;
        }
        Burbuja.mostrar(actividad);
        // Android decide en un momento si la muestra como burbuja o como aviso.
        principal.postDelayed(() -> listo(r, id, Burbuja.estado(actividad)), 900);
    }
}
