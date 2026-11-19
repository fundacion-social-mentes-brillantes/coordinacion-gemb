# Reglas de R8 para la app de Android de Coordinación GEMB (desde la 1.0.5, 19 nov 2026).
# Capacitor, Firebase, Google Play Services y AndroidX traen sus propias reglas
# (consumer rules); aquí va solo lo que ellas no cubren.

# El código propio de la app es poco y Capacitor llama al plugin (GembPlugin) por su
# nombre; además Puente.java recibe los mensajes de la página. Se deja entero, sin
# renombrar: así un error nunca depende de qué renombró R8.
-keep class com.gimnasioemocionalmb.coordinacion.** { *; }

# Entrar con Google (Credential Manager): la guía oficial pide esta regla, porque
# CredentialManager busca la implementación de Play Services por reflexión.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}

# Los informes de fallos de Play muestran la línea exacta (con mapping.txt).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
