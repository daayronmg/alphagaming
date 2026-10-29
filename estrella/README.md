# ESTRELLA

Sistema privado de la **Banda de Cornetas y Tambores Estrella de Málaga**. Incluye:
- gestión interna de la banda;
- dirección musical en tiempo real;
- biblioteca de partituras por instrumento y voz, con capas de anotación colaborativas;
- editor musical con control de versiones;
- academia para aprender música desde cero.

> El nombre «ESTRELLA» es provisional. Se cambia desde **Administración → Identidad** (o `APP_NAME_DEFAULT` en `web/src/config.ts`). La app **no incluye ningún escudo ni logotipo inventado**: la dirección sube el logotipo oficial desde Administración, si tiene autorización para usarlo.

---

## 1. Arquitectura

| Capa | Tecnología | Motivo |
|---|---|---|
| Cliente | React 18 + TypeScript + Vite, PWA instalable (`vite-plugin-pwa`) | Móvil primero, tableta y ordenador. Funciona parcialmente sin conexión. |
| Partituras PDF | `pdfjs-dist` + capa SVG propia en coordenadas normalizadas (0–1) | El PDF original nunca se modifica. Las anotaciones se mantienen en su sitio con cualquier zoom o tamaño de pantalla. |
| Partitura editable | Modelo musical propio (`shared/music.ts`) + VexFlow + MusicXML | Edición real de notas, colores por posición en el pentagrama y síntesis. |
| Servidor | Node.js 22 (TypeScript nativo), Express, `ws` | Un único proceso sirve la API, los WebSocket y la PWA compilada. |
| Base de datos | PostgreSQL 16 (migraciones SQL en `server/migrations`) | Datos relacionales, transacciones y bloqueos de fila para las órdenes en directo. |
| Archivos | Carpeta privada (`STORAGE_DIR`), servida solo tras comprobar permisos | Partituras, audios y recortes de dudas nunca son públicos. |
| IA (opcional) | Claude API (`@anthropic-ai/sdk`), clave solo en el servidor | Asistente musical. Sin clave, funciona un modo verificable sin IA. |

```
estrella/
  shared/music.ts        modelo musical común (posición en pentagrama, colores, diferencias entre versiones)
  server/                API, tiempo real, migraciones, seed de demostración, pruebas
  web/                   PWA (páginas, visor de partituras, editor, consola de dirección)
  e2e/                   pruebas con varias sesiones simultáneas (Playwright)
  scripts/backup.sh      copia de seguridad (BD + archivos)
  Dockerfile, docker-compose.yml
```

### Sincronización en tiempo real (dirección en directo)
- **Estado compartido persistente.** Cada sesión de ensayo guarda su estado en `live_sessions.state`: marcha, compás, sección, bucle, tempo, transporte, mensajes, seguimiento y vista. Cada orden del director se aplica en el servidor con bloqueo de fila y **aumenta la versión**. Después se difunde por WebSocket.
- **Recuperación.** Al conectarse o reconectarse, un dispositivo pide el estado completo. Si detecta que le falta una versión intermedia, lo recarga. Las órdenes antiguas o duplicadas se descartan por su número de versión.
- **Arranque simultáneo.** El director no envía «empieza ya», sino «empieza en el instante T del reloj del servidor» (T = ahora + 1,5 s). Cada dispositivo estima el desfase con su reloj mediante un intercambio tipo NTP (5 muestras, la de menor latencia) y calcula su posición: `compás = compás_ancla + (ahora − T) · tempo / 60 / tiempos_por_compás`.
  - Si la orden llega tarde, el dispositivo **recalcula la posición** en lugar de empezar desde el principio. Además, registra la incidencia, que el director ve en la consola y en las estadísticas.
  - Limitación honesta: el navegador no garantiza la latencia del audio. La precisión típica es de decenas de milisegundos. Sirve para seguir la partitura y el metrónomo, no para sustituir al director.
- **Presencia.** Cada dispositivo informa de su estado: *sincronizado*, *sincronizando* o *desconectado*. La consola lo muestra en directo.

### Partitura personalizada por componente
1. Cada componente tiene una o varias **asignaciones** (instrumento + voz), una de ellas «por defecto». La dirección puede elegir otra para un evento concreto.
2. Al enviar una marcha, el servidor resuelve la parte de cada usuario, por este orden:
   - instrumento + voz exactos;
   - si no existe, la parte común del instrumento;
   - si tampoco existe, **informa de que falta**. Nunca se muestra la parte de otra voz como si fuera la suya.
3. **Compases equivalentes.** Las parejas página/posición no coinciden entre partes. Por eso cada parte PDF tiene un **mapa de compases**, que la dirección vincula manualmente marcando rectángulos. Los compases de la partitura editable son identificadores compartidos. Si un compás no está vinculado, el músico ve un aviso: *«la dirección está en el compás N; localízalo manualmente»*. La posición nunca se adivina.

### Capas de partitura
1. **Original** (PDF o imagen): inmutable. Una sustitución crea una versión nueva y conserva la anterior.
2. **Anotaciones oficiales**: dirección y responsables autorizados, con destinatarios (toda la banda o secciones concretas). Tienen dos anclajes:
   - dibujos sobre la página de una parte;
   - **indicaciones de compás**, que cada músico ve sobre su propia parte.
3. **Anotaciones personales**: privadas. Funcionan sin conexión (cola local) y nunca se convierten solas en oficiales.
4. **Dudas**: zona exacta, recorte de imagen, compás solo si es conocido, audio opcional, respuestas (texto, voz o dibujo sobre el fragmento) y conversión en nota oficial.
5. **Edición musical** (modo B): borrador con autoguardado y control de concurrencia. Se **publica explícitamente** como versión numerada: autor, fecha, compases afectados y diferencias. Las versiones se pueden restaurar.

Todas las anotaciones llevan identificador único y número de versión. Una edición con versión antigua devuelve **conflicto** y no sobrescribe. En la capa personal, el cambio local se guarda como copia.

---

## 2. Instalación (desarrollo)

Requisitos: **Node.js ≥ 22.18** (ejecuta TypeScript sin compilar) y **PostgreSQL 16**.

```bash
cd estrella
```
```bash
npm install
```
```bash
cp server/.env.example server/.env   # ajusta DATABASE_URL
```
Crea la base de datos (ejemplo con un usuario local):
```bash
sudo -u postgres psql -c "create user estrella with password 'estrella_dev' createdb;" -c "create database estrella owner estrella;"
```
Carga los datos de demostración, claramente marcados como tales:
```bash
npm run seed -w server -- --reset
```
Arranca la API (puerto 4000) y la web (puerto 5173) en dos terminales:
```bash
npm run dev -w server
```
```bash
npm run dev -w web
```
Abre http://localhost:5173. Cuentas demo (contraseña `Estrella2026demo`):

| Cuenta | Rol |
|---|---|
| `emilio@estrella.demo` | Dirección musical (Emilio García) |
| `componente.a@estrella.demo` | Corneta · 3ª voz |
| `componente.b@estrella.demo` | Trompeta |
| `componente.c@estrella.demo` | Corneta · 1ª voz, responsable de cornetas |
| `componente.d/e/f@estrella.demo` | Trombón / caja + bombo / corneta 2ª (sin parte en la marcha demo) |

Las partituras de la «Marcha de demostración» son PDF generados automáticamente y rotulados «DOCUMENTO DE DEMOSTRACIÓN»: **no son obras reales**. La segunda marcha no tiene partituras, para comprobar el aviso «todavía no disponible».

## 3. Puesta en marcha real (sin datos de demostración)

1. Crea la base de datos vacía y la cuenta de dirección:
   ```bash
   npm run seed -w server -- --director "Emilio García" correo@real.es
   ```
   El comando imprime un enlace para activar la cuenta con su propia contraseña.
2. Opcional: carga solo la academia.
   ```bash
   npm run seed -w server -- --academy
   ```
3. En **Administración → Estructura**, configura las secciones, instrumentos y voces reales de la banda.
4. En **Componentes → Importar CSV / Excel**, carga la lista de componentes (descarga la plantilla). Verás una vista previa antes de confirmar. Cada persona recibe su enlace de activación.
5. En **Biblioteca**, crea las marchas y sube cada parte indicando instrumento y voz. En **Compases**, vincula el mapa de compases de cada parte para el salto automático.

## 4. Despliegue

### Docker (recomendado)
En un archivo `.env` junto a `docker-compose.yml` define:
- `POSTGRES_PASSWORD`
- `PUBLIC_URL`, por ejemplo `https://estrella.tudominio.es`
- opcionales: `ANTHROPIC_API_KEY`, `SMTP_URL`, `MAIL_FROM`, `AUDIVERIS_PATH`

```bash
docker compose up -d --build
```
Pon delante un proxy HTTPS que reenvíe también las conexiones WebSocket (`/ws`). Ejemplo con Caddy: `estrella.tudominio.es { reverse_proxy 127.0.0.1:4000 }`.

### Sin Docker
Compila la web:
```bash
npm run build -w web
```
Y arranca el servidor (sirve `web/dist`):
```bash
NODE_ENV=production npm start -w server
```
Usa systemd o pm2 para mantenerlo activo. Las migraciones se aplican solas al arrancar.

### Variables de entorno (`server/.env.example`)
| Variable | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL. |
| `PUBLIC_URL` | Origen público (enlaces de invitación/recuperación, comprobación de origen del WebSocket, cookies seguras). |
| `STORAGE_DIR` | Carpeta privada de archivos. **No** debe servirse por el proxy. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Opcional. Asistente con IA (por defecto `claude-opus-5-5`). La clave nunca llega al navegador. |
| `SMTP_URL`, `MAIL_FROM` | Opcional. Correos de recuperación de contraseña. Sin correo, la dirección genera el enlace desde la ficha del componente. |
| `AUDIVERIS_PATH` | Opcional. Reconocimiento óptico de música (OMR) con [Audiveris](https://github.com/Audiveris/audiveris). |

### Copias de seguridad
```bash
DATABASE_URL=... STORAGE_DIR=/data/storage ./scripts/backup.sh /copias
```
Hazlas a diario con cron y guárdalas fuera del servidor. El script conserva las 30 copias más recientes; la restauración está explicada en el propio script.

### Registro de errores
El servidor escribe los errores en la salida estándar con el prefijo `[error]` (visible con `docker compose logs`). Cada acción sensible queda en la tabla `audit_log`: inicios de sesión, cambios de asignación, publicaciones, exportaciones…

## 5. Pruebas

Unitarias y de API (usan la base de datos `estrella_test`, que se borra en cada ejecución):
```bash
npm test -w server
```
Pruebas de extremo a extremo con varias sesiones (necesitan Playwright y el servidor en marcha). Primero reinicia los datos:
```bash
npm run seed -w server -- --reset
```
Batería principal: tres sesiones simultáneas (Emilio, corneta 3ª y trompeta) y las pruebas A–G.
```bash
BASE=http://localhost:4000 node e2e/run.mjs
```
Recorrido de las 24 pantallas con cada rol, detectando errores.
```bash
BASE=http://localhost:4000 node e2e/pages.mjs
```

Resultado verificado sobre el build de producción:
- 15/15 pruebas de servidor;
- 18/18 pasos e2e, incluida la prueba sin conexión con service worker;
- 72 pantallas revisadas sin errores de ejecución.

## 6. Estado de las funciones

**Leyenda:** ✅ implementado y probado · 🔌 necesita un servicio externo · 🧪 prototipo o limitado

| Área | Estado | Notas |
|---|---|---|
| Inicio de sesión, invitaciones, recuperación, sesiones, roles y permisos por sección | ✅ | El correo identifica la cuenta, pero nunca concede permisos. El rol de dirección no se asigna por importación. |
| Componentes, asignaciones múltiples, historial y cambios con fecha o confirmación, importación/exportación CSV y Excel | ✅ | Contactos y observaciones internas protegidos. |
| Calendario, eventos, confirmaciones, asistencia oficial (5 estados), historial, QR rotatorio, avisos de última hora | ✅ | QR: código HMAC que cambia cada 20 s, ventana horaria del evento, un registro por persona. No impide del todo un registro remoto (alguien podría enviar una foto del QR en esos 20 s). |
| Biblioteca: fichas, carpetas, etiquetas, favoritas, búsqueda, versiones de partituras, grabaciones, control de cambios | ✅ | |
| Partitura personalizada por instrumento y voz en el ensayo en directo | ✅ | Probado con corneta 3ª y trompeta. |
| Dirección en tiempo real (selección, inicio/pausa/parada, compases, bucle, secciones, tempo, metrónomo, mensajes por sección, seguimiento, silencio, cambio de vista, plan de trabajo, presencia, resumen) | ✅ | Ver limitación de latencia de audio en §1. |
| Anotaciones PDF en capas (lápiz, resaltador, texto, formas, flechas, símbolos, borrar, deshacer/rehacer, autoguardado, trazo en directo) | ✅ | Coordenadas normalizadas; el original no se modifica. |
| Dudas: selección de fragmento, recorte, audio, bandeja con filtros y repetidas, respuestas con voz o dibujo, privacidad, conversión en nota oficial | ✅ | |
| Partitura editable: importación/exportación MusicXML, editor de notas, publicación de versiones, restauración, comparación con el PDF | ✅ | MusicXML: una parte y una voz por partitura. Tresillos y voces múltiples se aproximan o se ignoran, con aviso. Sin `.mxl` comprimido. |
| Colores rojo (sobre línea) / azul (espacios y líneas adicionales) | ✅ | Solo con datos estructurados. Se calculan desde la posición escrita y la clave. Los PDF no se colorean. |
| Reconocimiento óptico (OMR) de PDF | 🔌🧪 | Requiere Audiveris en el servidor. El resultado entra como **borrador «requiere revisión»**. Los escaneos de mala calidad pueden fallar. |
| Reproductor de grabaciones (velocidad conservando el tono, bucle A–B, marcadores, mezcla por pistas, voz aislada) | ✅ | Necesita que la banda suba sus audios. |
| Síntesis desde la partitura editable, metrónomo, modo lento | ✅ | Timbre sintético aproximado: no imita una corneta real. |
| Academia: 3 niveles, 25 lecciones con 7 pasos, ejercicios, test, progreso, rachas, editor y flujo de revisión | ✅ | Las lecciones técnicas por instrumento (corneta, percusión) quedan **en revisión** hasta que las valide un responsable. |
| Entrenador de lectura, oído e intervalos, ritmo con detección de adelantos y retrasos, pulso | ✅ | Detección de ritmo aproximada (±50 ms según el dispositivo). |
| Afinador por micrófono, metrónomo, autograbación local | ✅🧪 | El afinador usa autocorrelación: preciso con notas largas y sin ruido. |
| Asistente musical | ✅ modo verificable · 🔌 IA | Sin clave responde con datos calculados: notas de un compás, ritmo, colores, rutinas y ejercicios con tus fallos. Con `ANTHROPIC_API_KEY` responde con IA restringida a los materiales autorizados, e indica cuándo algo no es verificable. |
| Avisos, urgentes destacados, confirmaciones de lectura, documentos internos, preferencias de notificación | ✅ | Notificaciones dentro de la app. Las notificaciones push del sistema operativo (Web Push) no están implementadas. |
| Estadísticas (dato objetivo / estimación / valoración manual), informe CSV | ✅ | Sin rankings ni valoraciones de calidad musical. |
| Material, instrumentos y uniformidad | ✅ | Básico. |
| Sin conexión: app, partituras abiertas o descargadas, datos consultados, cola de notas personales | ✅ | Probado (e2e). Las órdenes del director no se pueden recibir sin conexión: al volver se recupera el estado. |
| Exportación de mis datos personales | ✅ | La supresión la gestiona la dirección (baja de la ficha). |

### Valoración de funciones extraordinarias
- **Implementadas por su utilidad real:** afinador, entrenador de oído, ejercicios de ritmo con detección de errores, autograbación para comparar, detección de desviación de tempo (pulso), planificador de repertorio y plan de ensayo, inventario, archivo histórico (historial de ensayos por marcha y pasajes repetidos), formación para principiantes, partituras sin conexión y avisos de última hora.
- **Descartadas por ahora (no son fiables en un navegador):**
  - Reconocimiento automático de notas tocadas en una partitura completa: el afinador detecta una nota cada vez, no evalúa interpretaciones.
  - Simulador de actuaciones: aporta poco frente al ensayo en directo con bucles.

## 7. Seguridad y privacidad
- **Sesiones:** contraseñas con scrypt; sesión por cookie `httpOnly` + `SameSite=Lax` (+ `Secure` en producción); cabecera anti-CSRF en toda mutación; límite de intentos de acceso; comprobación del origen del WebSocket.
- **Archivos:** se validan por su contenido (bytes iniciales), no por la extensión. Se guardan fuera de la carpeta pública y solo se entregan a quien tiene derecho a verlos (partituras a miembros, dudas a su autor y gestores, documentos según sección).
- **Datos personales:** teléfono y correo solo para la dirección y los responsables de la sección, o si el componente decide compartirlos; las observaciones internas, solo para la dirección. El micrófono solo se activa a petición del usuario y las autograbaciones no salen del dispositivo.
- **Permisos en servidor:** todos los permisos se comprueban en el servidor, no solo en la interfaz. Las pruebas E y G lo verifican.
- **Métricas:** solo con fines organizativos y de estudio. La interfaz advierte de que no miden la calidad musical.

## 8. Fases
- **Fase 1:** ✅ completa.
- **Fase 2:** ✅ completa, salvo el OMR, que depende de Audiveris.
- **Fase 3:** ✅ completa (asistente con IA opcional).
- **Fase 4:** ✅ entrenamiento auditivo, ritmo, uso sin conexión y estadísticas.
- **Pendiente:**
  - notificaciones push del sistema (Web Push con claves VAPID);
  - una app nativa, si se quiere. La arquitectura actual (PWA + API) permite empaquetarla con Capacitor.
