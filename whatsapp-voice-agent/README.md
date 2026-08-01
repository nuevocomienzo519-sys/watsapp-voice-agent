# Agente de WhatsApp (voz + texto) — Nuevo Comienzo

Recibe mensajes de WhatsApp (vía TimelinesAI) — **nota de voz o texto** —
y responde en el formato que más convenga: voz si el cliente prefiere
hablar, texto si lo que necesita es un dato para releer (precio, lista de
amenidades, opciones de pago), sin importar por qué canal escribió.

```
Cliente (nota de voz o texto)
   → Webhook de TimelinesAI → este servidor
   → [si es nota de voz] Whisper (transcribe)
   → Claude (genera respuesta con datos de tus proyectos, decide formato: voz o texto)
   → [si decide voz] ElevenLabs (texto a voz) → ffmpeg (convierte a ogg/opus)
   → TimelinesAI API (reenvía voz o texto, según lo decidido)
```

## Cómo decide el agente si responder con voz o texto

Por defecto, **respeta el canal del cliente**: si te escribió por nota de
voz, responde en voz; si te escribió por texto, responde en texto.

**Excepción**: si la respuesta trae datos que el cliente va a querer
releer o guardar — precios, lista de amenidades, varias opciones de pago,
varios datos concretos juntos — el agente responde en **texto** aunque el
cliente haya preguntado por voz. Nadie quiere reescuchar un audio para
anotar un precio.

Esta decisión la toma Claude en cada respuesta (ver `lib/llm.js`), no es
una regla fija en código — así que si quieres ajustar el criterio (por
ejemplo, ser más o menos estricto sobre cuándo usar texto), se ajusta
editando las instrucciones de "FORMATO DE SALIDA" en ese archivo.

## ✅ Ya configurado en este proyecto

- **Entrada dual** (`lib/timelinesPayload.js` + `server.js`): detecta si el
  mensaje entrante es nota de voz o texto y lo procesa según corresponda
  (transcripción con Whisper solo cuando hace falta).
- **Salida dual** (`lib/timelinesClient.js`): puede responder con audio
  (nota de voz real, vía conversión a ogg/opus) o con texto plano, según
  lo que decida Claude.
- **Mapeo defensivo del payload** (`lib/timelinesPayload.js`): intenta varias
  formas conocidas de los campos de TimelinesAI (v1/v2) en vez de asumir una
  sola. El log del payload completo sigue activo en consola por si acaso.
- **Conversión automática a ogg/opus** (`lib/audioConvert.js`, vía `ffmpeg`):
  cuando la respuesta es de voz, se convierte antes de enviarse para que
  llegue como nota de voz real en WhatsApp y no como archivo adjunto.
- **Prompt separado de los datos** (`data/proyectos.json` + `lib/llm.js`):
  el agente arma su prompt leyendo este JSON. Solo menciona datos que ya
  fueron llenados; si un campo dice `"TODO"` o está vacío, el agente no lo
  inventa y ofrece pasar al cliente con un asesor humano.
- **Configuración de despliegue lista** (`render.yaml` y `Procfile`): para
  Render o Railway, ver sección de despliegue abajo.
- **Estimado de costos por mensaje** (ver abajo).

## 🔲 Lo mínimo que te toca a ti

1. **Llenar `data/proyectos.json`** con los datos reales de Diamante y
   Santuario (precio, habitaciones, amenidades, etc.). No tienes que tocar
   ningún archivo de código — solo ese JSON. (Santa Fe ya no aparece aquí,
   porque diste de baja ese proyecto.)
2. **Conseguir las 4 credenciales** y pegarlas en `.env` (o en las
   variables de entorno de Render/Railway): token de TimelinesAI, API key
   de OpenAI, API key de Anthropic, API key + voice_id de ElevenLabs.
3. **Inventar un `WEBHOOK_SECRET`** (cualquier cadena larga y aleatoria) y
   ponerlo también en `.env`.
4. **Desplegar** (ver sección de abajo) y **registrar la URL del webhook**
   en TimelinesAI → Integrations → Webhooks.
5. **Mandar un mensaje de prueba (voz y texto)** y revisar el log del
   servidor. Si por algún motivo tu cuenta de TimelinesAI usa nombres de
   campo distintos a los que ya contemplé — incluyendo el nombre del campo
   para enviar texto, que puede variar según cuenta — el log te va a
   mostrar el payload completo para ajustar `lib/timelinesPayload.js` o
   `lib/timelinesClient.js` en un par de líneas.

Todo lo demás (parseo del webhook, conversión de audio, construcción del
prompt, arranque del servidor) ya está resuelto en el código.

## Instalación local (para probar antes de desplegar)

```bash
cd whatsapp-voice-agent
npm install
cp .env.example .env
# Edita .env y llena las 4 credenciales + el WEBHOOK_SECRET
npm start
```

El servidor arranca en `http://localhost:3000`. Para exponerlo a internet
en pruebas locales (TimelinesAI necesita llamar tu webhook desde afuera):

```bash
ngrok http 3000
```

## Despliegue en producción (Render — recomendado)

Ya incluí `render.yaml`, así que el flujo es:

1. Sube esta carpeta a un repositorio de GitHub (o GitLab).
2. En [render.com](https://render.com) → **New → Blueprint**, conecta el
   repo. Render va a leer `render.yaml` automáticamente y va a crear el
   servicio.
3. Render te va a pedir llenar las variables marcadas como secretas
   (token de TimelinesAI, API keys, etc.) — pégalas ahí, no en el código.
4. Al terminar el deploy, Render te da una URL pública fija tipo
   `https://whatsapp-voice-agent-xxxx.onrender.com`. Esa es tu dominio para
   el webhook.
5. Regístralo en TimelinesAI → **Integrations → Webhooks**:
   `https://TU-DOMINIO.onrender.com/webhooks/timelines?secret=EL_MISMO_VALOR_DE_TU_.ENV`
   — selecciona el evento de mensaje nuevo (`message:new` o equivalente).

**Alternativa: Railway.** También funciona con el mismo código — usa el
`Procfile` incluido (`web: npm start`). En Railway: New Project → Deploy
from GitHub repo → agrega las mismas variables de entorno en la pestaña
Variables → Railway te da tu dominio público.

Fly.io es otra opción si prefieres, pero requiere un `Dockerfile` (avísame
si la quieres en vez de Render/Railway y te lo preparo).

## Estimado de costos por mensaje

Con base en tarifas públicas actuales (verifica siempre la página oficial
de cada proveedor, ya que cambian):

| Servicio | Tarifa aprox. | Costo típico |
|---|---|---|
| Whisper (transcripción, solo si entra por voz) | $0.006 USD/minuto | ~$0.002 USD |
| Claude Sonnet 5 (respuesta, siempre) | $2/$10 USD por millón de tokens (input/output, precio de lanzamiento) | ~$0.001–0.003 USD |
| ElevenLabs (texto a voz, solo si responde en voz) | ~$0.05–0.10 USD por 1,000 caracteres, según modelo/plan | ~$0.01–0.02 USD |

**Un intercambio texto→texto** (el más barato) cuesta prácticamente solo
lo de Claude: ~$0.001–0.003 USD.

**Un intercambio voz→voz** (el más caro) ronda entre $0.015 y $0.03 USD.
Como ahora una parte de las respuestas va a salir en texto aunque haya
entrado por voz (cuando hay precios/listas de por medio), el costo
promedio real por mes debería quedar un poco por debajo de lo estimado
antes. Para 500 interacciones al mes, un estimado conservador sigue
siendo de $7.50–$15 USD, sin contar el plan mensual fijo que probablemente
ya tengas con ElevenLabs (los planes de pago empiezan alrededor de
$5–6 USD/mes e incluyen un bloque de caracteres).

No incluye el costo del hosting (Render/Railway free o starter tier suele
bastar para este volumen).

## ⚠️ Fuera de mi alcance (requieren decisión o acceso tuyo)

- **Prompt de ventas más elaborado / tono de marca**: el prompt actual es
  funcional pero genérico en estilo. Si quieres que suene más a como tú
  hablas con tus clientes, dime y lo ajusto — pero eso es una decisión de
  tono, no una configuración técnica.
- **Confirmar el campo exacto para enviar texto en tu cuenta de
  TimelinesAI**: `lib/timelinesClient.js` usa `text` como nombre de campo
  al llamar la API; si tu cuenta espera otro nombre (ej. `message`), el
  log del primer intento fallido te lo va a mostrar.
- **Conectar el agente a HubSpot en vivo** (en vez de al JSON estático)
  para que consulte disponibilidad real por proyecto: es un proyecto
  aparte, lo podemos armar cuando quieras.
- **Retell AI**: como se comentó antes, está pensado para llamadas
  telefónicas en tiempo real, no para este flujo de WhatsApp. Si más
  adelante quieres ofrecer llamadas telefónicas reales a leads, ahí sí
  encaja y sería un proyecto aparte.

## Estructura del proyecto

```
whatsapp-voice-agent/
├── server.js                  # Webhook + orquestación (entrada/salida voz o texto)
├── data/
│   └── proyectos.json         # ← Aquí llenas los datos reales de tus proyectos
├── lib/
│   ├── timelinesClient.js     # Descargar audio / enviar audio o texto (TimelinesAI)
│   ├── timelinesPayload.js    # Parseo defensivo del payload del webhook (voz y texto)
│   ├── stt.js                  # Transcripción (Whisper)
│   ├── llm.js                   # Genera respuesta y decide formato (Claude)
│   ├── tts.js                   # Texto a voz (ElevenLabs)
│   └── audioConvert.js         # Conversión mp3 → ogg/opus (ffmpeg)
├── render.yaml                 # Despliegue en Render (Blueprint)
├── Procfile                     # Despliegue en Railway/Heroku-style
├── .env.example
├── package.json
└── README.md
```
