package com.gimnasioemocionalmb.coordinacion;

import android.annotation.SuppressLint;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.content.LocusIdCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * La burbuja flotante (Android 11 o más nuevo): un círculo encima de Meet o de
 * cualquier app que se abre y se cierra con un toque, con la asistencia, la
 * carpeta y los enlaces de la reunión ({@link BurbujaActivity}).
 *
 * Android solo deja burbujas de "conversaciones": por eso el aviso usa el
 * estilo de mensajes y va unido a un atajo de larga duración. En teléfonos más
 * viejos queda un aviso normal que abre la misma pantalla.
 */
final class Burbuja {

    static final String CANAL = "burbuja_reunion";
    static final String ATAJO = "reunion_de_hoy";
    static final int AVISO = 7;
    private static final String TAG = "GembBurbuja";

    private Burbuja() {}

    /**
     * ¿Este teléfono puede mostrar burbujas? Android 11+ y no «Android Go»
     * (los de poca memoria nunca las muestran, aunque la versión sí las tenga).
     */
    static boolean soportada(Context ctx) {
        if (Build.VERSION.SDK_INT < 30) return false;
        ActivityManager am = ctx.getSystemService(ActivityManager.class);
        return am == null || !am.isLowRamDevice();
    }

    private static void prepararCanal(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CANAL) != null) return;
        NotificationChannel canal = new NotificationChannel(CANAL, "Burbuja de la reunión", NotificationManager.IMPORTANCE_HIGH);
        canal.setDescription("La burbuja flotante con la asistencia, la carpeta y los enlaces de la reunión.");
        canal.setSound(null, null);
        canal.enableVibration(false);
        if (Build.VERSION.SDK_INT >= 29) canal.setAllowBubbles(true);
        nm.createNotificationChannel(canal);
    }

    private static IconCompat icono(Context ctx) {
        return IconCompat.createWithAdaptiveBitmap(BitmapFactory.decodeResource(ctx.getResources(), R.mipmap.ic_launcher_foreground));
    }

    @SuppressLint("MissingPermission") // quien llama comprueba el permiso
    static void mostrar(Context ctx) {
        prepararCanal(ctx);
        IconCompat icono = icono(ctx);
        Person gemb = new Person.Builder().setName("Coordinación GEMB").setIcon(icono).setKey("gemb").setImportant(true).build();
        Person tu = new Person.Builder().setName("Tú").build();

        // El atajo es la "conversación" a la que Android le permite flotar.
        ShortcutInfoCompat atajo = new ShortcutInfoCompat.Builder(ctx, ATAJO)
            .setShortLabel("Reunión de hoy")
            .setLongLabel("Asistencia y enlaces de la reunión")
            .setIcon(icono)
            .setIntent(new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW))
            .setLongLived(true)
            .setPerson(gemb)
            .build();
        ShortcutManagerCompat.pushDynamicShortcut(ctx, atajo);

        Intent pantalla = new Intent(ctx, BurbujaActivity.class).setAction(Intent.ACTION_VIEW);
        // La burbuja exige un PendingIntent modificable (Android le añade datos).
        int modificable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent paraBurbuja = PendingIntent.getActivity(ctx, 1, pantalla, PendingIntent.FLAG_UPDATE_CURRENT | modificable);
        // Sin burbuja, tocar el aviso abre la misma pantalla, pero siempre la
        // misma: tocarlo varias veces no debe apilar pantallas (y memoria)
        // mientras Meet está abierto.
        Intent unaSola = new Intent(ctx, BurbujaActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent paraAviso = PendingIntent.getActivity(ctx, 2, unaSola, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.BubbleMetadata meta = new NotificationCompat.BubbleMetadata.Builder(paraBurbuja, icono)
            .setDesiredHeight(640)
            .setAutoExpandBubble(true)
            .setSuppressNotification(true)
            .build();

        NotificationCompat.MessagingStyle estilo = new NotificationCompat.MessagingStyle(tu).addMessage(
            "Asistencia, carpeta y enlaces de Meet, a un toque.",
            System.currentTimeMillis(),
            gemb
        );

        Notification aviso = new NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(0xFF2B59FF)
            .setContentTitle("Reunión de hoy")
            .setContentText("Toca para abrir la asistencia.")
            .setContentIntent(paraAviso)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setShortcutId(ATAJO)
            .setLocusId(new LocusIdCompat(ATAJO))
            .addPerson(gemb)
            .setStyle(estilo)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setBubbleMetadata(meta)
            .build();
        NotificationManagerCompat.from(ctx).notify(AVISO, aviso);
    }

    static void ocultar(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(AVISO);
    }

    /** Lo que la página necesita para explicar qué pasó si no se ve la burbuja. */
    static JSONObject estado(Context ctx) {
        JSONObject e = new JSONObject();
        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            e.put("soportada", soportada(ctx));
            // El interruptor general de burbujas de todo el teléfono (en Samsung,
            // «Notificaciones flotantes»).
            e.put("general", Build.VERSION.SDK_INT < 31 || nm.areBubblesEnabled());
            e.put("avisos", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
            // La categoría «Burbuja de la reunión» (o su conversación) apagada
            // desde el aviso: entonces no sale ni burbuja ni aviso.
            boolean canalApagado = false;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel canal = nm.getNotificationChannel(CANAL);
                canalApagado = canal != null && canal.getImportance() == NotificationManager.IMPORTANCE_NONE;
            }
            if (Build.VERSION.SDK_INT >= 30) {
                NotificationChannel conversacion = nm.getNotificationChannel(CANAL, ATAJO);
                canalApagado = canalApagado || (conversacion != null && conversacion.getImportance() == NotificationManager.IMPORTANCE_NONE);
            }
            e.put("canalApagado", canalApagado);
            String preferencia = "desconocida";
            if (Build.VERSION.SDK_INT >= 31) {
                int p = nm.getBubblePreference();
                preferencia = p == NotificationManager.BUBBLE_PREFERENCE_ALL
                    ? "todas"
                    : p == NotificationManager.BUBBLE_PREFERENCE_SELECTED ? "seleccionadas" : "ninguna";
            } else if (Build.VERSION.SDK_INT >= 30) {
                //noinspection deprecation
                preferencia = nm.areBubblesAllowed() ? "todas" : "ninguna";
            }
            e.put("preferencia", preferencia);
            boolean visible = false;
            boolean flotando = false;
            for (StatusBarNotification s : nm.getActiveNotifications()) {
                if (s.getId() != AVISO) continue;
                visible = true;
                if (Build.VERSION.SDK_INT >= 29 && (s.getNotification().flags & Notification.FLAG_BUBBLE) != 0) flotando = true;
            }
            e.put("visible", visible);
            e.put("flotando", flotando);
        } catch (JSONException ex) {
            Log.w(TAG, "estado", ex);
        }
        return e;
    }

    /** Ajustes → Notificaciones → Burbujas de esta app. */
    static void abrirAjustesBurbujas(Context ctx) {
        if (Build.VERSION.SDK_INT >= 29) {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_BUBBLE_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                ctx.startActivity(i);
                return;
            } catch (Exception ex) {
                Log.w(TAG, "Sin pantalla de burbujas", ex);
            }
        }
        abrirAjustesAvisos(ctx);
    }

    /** Ajustes → Notificaciones de esta app (o su ficha, en Android muy viejo). */
    static void abrirAjustesAvisos(Context ctx) {
        Intent i;
        if (Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }
}
