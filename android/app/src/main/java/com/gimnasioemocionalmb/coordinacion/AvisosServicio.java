package com.gimnasioemocionalmb.coordinacion;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * El aviso del día antes, «Mañana coordinas tú» (versión 1.0.4).
 *
 * Lo manda el servidor (api/avisos) por Firebase Cloud Messaging. Con la app
 * cerrada lo muestra el propio Android con los datos del mensaje (canal
 * «coordinar», ícono ic_aviso); con la app abierta llega aquí y se muestra
 * igual. Al tocarlo se abre la app en Asistencia, donde está la tarjeta con
 * la imagen y el mensaje para el grupo.
 */
public class AvisosServicio extends FirebaseMessagingService {

    static final String CANAL = "coordinar";

    /** El canal tiene que existir antes de que llegue el primer aviso. */
    static void crearCanal(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CANAL) != null) return;
        NotificationChannel canal = new NotificationChannel(CANAL, "Recordatorios para coordinar", NotificationManager.IMPORTANCE_HIGH);
        canal.setDescription("El día antes de tu reunión: tu imagen y el mensaje para el grupo.");
        nm.createNotificationChannel(canal);
    }

    /** ¿Puede mostrar avisos? (permiso de la app y el canal sin apagar) */
    static boolean puedeAvisar(Context ctx) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (!nm.areNotificationsEnabled()) return false;
        NotificationChannelCompat canal = nm.getNotificationChannelCompat(CANAL);
        return canal == null || canal.getImportance() != NotificationManagerCompat.IMPORTANCE_NONE;
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // Nada que hacer aquí: la página pide el token al abrir la app y, si
        // cambió, lo vuelve a registrar (mantenerAvisos en services/avisos.ts).
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage m) {
        Map<String, String> d = m.getData();
        RemoteMessage.Notification n = m.getNotification();
        String titulo = d.get("titulo");
        String cuerpo = d.get("cuerpo");
        if (titulo == null && n != null) titulo = n.getTitle();
        if (cuerpo == null && n != null) cuerpo = n.getBody();
        if (titulo == null) return;
        String etiqueta = d.get("etiqueta");
        mostrar(this, titulo, cuerpo != null ? cuerpo : "", etiqueta != null ? etiqueta : "gemb");
    }

    @SuppressLint("MissingPermission") // puedeAvisar() lo comprueba
    static void mostrar(Context ctx, String titulo, String cuerpo, String etiqueta) {
        if (!puedeAvisar(ctx)) return;
        crearCanal(ctx);
        Intent abrir = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent alTocar = PendingIntent.getActivity(ctx, 3, abrir, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification aviso = new NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_aviso)
            .setColor(0xFFD6B064)
            .setContentTitle(titulo)
            .setContentText(cuerpo)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(cuerpo))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(alTocar)
            .build();
        // La misma etiqueta reemplaza al anterior: si llegara dos veces, se ve uno.
        NotificationManagerCompat.from(ctx).notify(etiqueta, 1, aviso);
    }
}
