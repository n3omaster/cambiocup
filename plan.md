# Integración de CUP en efectivo (pestaña CASH)

Plan para el equipo de cambiocup · QvaPay, 19 oct 2026

## Resumen

La pestaña **CASH** (coin_id 7) ya consulta `CUPCASH` (CUP en efectivo) en el cron, pero siempre ha mostrado "Sin datos de mercado todavía". El problema estaba **del lado de QvaPay**, y ya está corregido: QvaPay tenía los trades de CUP en efectivo (~13 públicos al mes), pero nunca los contaba al calcular el promedio.

- **Cambios de código obligatorios en cambiocup: ninguno.** El cron, la pestaña, la imagen OG, el webhook y la dinámica del juego ya soportan CASH.
- **Lo que sí toca:** verificar la integración (sección 3) y valorar 3 ajustes recomendados (sección 4).
- Valor esperado al activarse: **~799 CUP por USD en efectivo** (por transferencia, BANK_CUP, se pagan ~1.016).

## 1. Qué cambió en QvaPay

**La causa del `0`.** `GET /p2p/completed_pairs_average` solo cuenta ofertas marcadas como válidas. Esa marca la pone un cron de QvaPay, y solo para las monedas que tienen límites de tasa definidos. CUPCASH no los tenía. Por eso, en 30 días, ninguno de sus 38 trades completados contaba.

**Lo corregido:**

| Cambio | Efecto para cambiocup |
|---|---|
| CUPCASH con límites de tasa **400–1.200 CUP/USD** | El endpoint empieza a devolver promedio para `CUPCASH`. Los trades fuera de rango no cuentan. Los más comunes son efectivo en USD registrado por error como CUPCASH (tasa ~1). |
| Webhook: `CUPCASH` se envía como `coin: "CASH"` | Empiezan a llegar burbujas CASH y eventos "Lluvia de efectivo" al juego. |
| Webhook: también avisan las **órdenes de ofertas por rango** liberadas (todas las monedas) | Más eventos `completed`; ver 4.3. |
| Webhook: ya no se envían monedas sin pestaña ni tasas fuera de límites | Desaparecen los POST que llegaban con `coin` vacío y respondían 400. |
| Promedio: cuentan las órdenes por rango cuya oferta madre sigue abierta | En 7 días entran 158 órdenes más en BANK_CUP. El promedio casi no cambia (1.015,87 pasa a 1.016,29). |

**Estado en QvaPay (lo hace QvaPay, no cambiocup):**

- [ ] Deploy de qpweb con los cambios.
- [ ] Backfill de los últimos 7 días (`scripts/oneoff/p2p-validate-backfill.mjs --coin CUPCASH --run`). Sin él, el promedio solo cuenta los trades de CUPCASH que se completen a partir del deploy (más los de las últimas 24 h).
- [ ] Avisar a cambiocup cuando esté hecho para empezar la verificación.

## 2. Contrato de datos

### 2.1 Tasa (la consulta el cron de cambiocup)

```
GET https://api.qvapay.com/p2p/completed_pairs_average?coin=CUPCASH
```

Respuesta con datos (cifras reales simuladas el 19 oct):

```json
{
  "average": 797.5758,
  "average_buy": 792.6263,
  "average_sell": 805,
  "median_buy": 833.3333,
  "median_sell": 805,
  "count": 5,
  "window_hours": 168,
  "offers": [750, 704.55, 840, 860, 833.33]
}
```

Sin operaciones válidas en la ventana, responde un **`0` pelado** (no un objeto). El cron ya lo maneja: no guarda nada.

| Campo | Significado |
|---|---|
| valor de cada trade | CUP en efectivo pagados por 1 USD (QUSD) |
| qué cuenta | Ofertas fijas completadas y órdenes por rango liberadas, solo públicas (las privadas son tratos pactados), monto ≥ 1 USD, tasa entre 400 y 1.200 |
| `window_hours` | 48 si hubo al menos 3 trades en 48 h; si no, 168 (7 días) con lo que haya |
| `count` | Trades usados para el cálculo |
| `average_buy` / `average_sell` | Si un lado no tiene trades, vale el promedio general |
| `median_buy` / `median_sell` | **Si un lado no tiene trades, vale `0`** (no se rellena con el general); ver 4.2 |
| Rate limit | 10 peticiones por minuto por IP. El cron hace 6 cada 10 min, con margen |

**Volumen esperado:** CUPCASH tiene ~1,3 trades completados al día contando los privados, y ~13 públicos al mes. Lo normal es `window_hours: 168` con pocas muestras. Puede pasar una semana sin trades, y entonces el endpoint vuelve a responder `0` (ver 4.1).

### 2.2 Webhook (QvaPay hace POST a `https://www.cambiocup.com/api/webhook`)

```json
{ "type": "sell", "status": "completed", "value": 860, "coin": "CASH" }
```

Cabeceras: `Content-Type: application/json`, `User-Agent: QvaPay-P2P-Webhook/1.0`. Timeout de 3 s del lado de QvaPay, sin reintentos.

| `status` | Cuándo se envía |
|---|---|
| `attempt` | Al crear una oferta **fija** (las ofertas por rango no tienen una tasa de trato) |
| `completed` | Al completarse una oferta fija **y** al liberarse cada orden de una oferta por rango |

Mapa de monedas: `BANK_CUP` es `CUP`, `BANK_MLC` es `MLC`, `CLASICA` es `CLASICA`, `BANDECPREPAGO` es `TROPICAL`, `ETECSA` es `ETECSA` y `CUPCASH` es `CASH` (nueva). Ninguna otra moneda se envía. Las ofertas privadas sí se envían, igual que hasta ahora.

## 3. Verificación (cuando QvaPay confirme el deploy)

- [ ] `curl 'https://api.qvapay.com/p2p/completed_pairs_average?coin=CUPCASH'` devuelve un objeto con `count > 0`, no `0`.
- [ ] Tras la siguiente ejecución del cron (como máximo 10 min), hay una fila nueva con `coin_id = 7` en `exchange`. El valor esperado está alrededor de 800 y depende de los trades del momento.
- [ ] La pestaña CASH muestra el valor, desaparece el chip "Sin datos de mercado todavía" y el color de tendencia funciona.
- [ ] `/api/og?coin=CASH` genera la imagen; antes lanzaba "No data available".
- [ ] Una burbuja CASH se ve bien. Se puede probar a mano con `curl -X POST https://www.cambiocup.com/api/webhook -H 'Content-Type: application/json' -d '{"type":"buy","status":"completed","value":800,"coin":"CASH"}'`. Ojo: esto la guarda en `offers` de producción.
- [ ] **Juego:** es la primera vez que llegan ofertas CASH reales. Jugar una partida en la que entre una oferta CASH, confirmar que salta la "Lluvia de efectivo" y que el score **se verifica** (en `game_scores`, `flagged = false` y sin `flag_reason`). El verificador lee la oferta de la tabla `offers`, así que este camino nunca se ha probado con datos reales.

## 4. Ajustes recomendados (opcionales)

### 4.1 Avisar cuando el dato de CASH está viejo

Con este volumen, una semana sin trades hace que el endpoint devuelva `0`. Entonces el cron no guarda nada y la pestaña se queda **congelada en el último valor**, sin ninguna señal para el usuario. `/api` ya devuelve las filas completas, con `updated_at`, así que el front puede detectarlo:

- Si `history[0].updated_at` tiene más de ~30 min, mostrar un chip tipo "Sin operaciones recientes · último dato hace X". Se puede reutilizar el `getTimeAgo` de `/api/og`.

Matiz: mientras la ventana de 7 días tenga trades, el cron guarda el mismo valor cada 10 min y la fila parece fresca aunque el último trade sea de hace 6 días. Para reflejarlo de verdad hay que guardar `count` y `window_hours` de la respuesta (dos columnas en `exchange`, o una tabla aparte) y mostrar "basado en N operaciones de los últimos 7 días" cuando `window_hours = 168`.

### 4.2 Usar la mediana para CASH

Con 5 muestras, un solo trade raro dentro de límites mueve mucho la media. Por ejemplo, uno a 573 el 17 sep, cuando el mercado iba por ~800. La mediana es más estable. Con los datos de arriba, `(average_buy + average_sell) / 2` da **798,81** y `(median_buy + median_sell) / 2` da **819,17**.

Si se adopta, hay que respetar que una mediana vale `0` cuando ese lado no tiene trades:

```js
// en fetchAverage, solo para CUPCASH
const side = (median, average) => (median > 0 ? median : average)
return (side(body.median_buy, average_buy) + side(body.median_sell, average_sell)) / 2
```

Es una decisión de producto de cambiocup. QvaPay entrega los dos valores.

### 4.3 Balance del juego

Llegarán más eventos `completed` que antes, por dos motivos:

| Moneda | Fijas completadas/día (ya llegaban) | Órdenes por rango/día (nuevas) |
|---|---|---|
| CUP | ~413 | **~109** (+26 %) |
| CLASICA | ~70 | ~16 |
| ETECSA | ~86 | ~15 |
| TROPICAL | ~14 | ~1 |
| MLC | ~7 | ~1 |
| CASH | ~1,3 (nuevas) | ~0,1 |

Habrá más cráteres y dólares del cielo en CUP, y empieza la "Lluvia de efectivo" (`CASH_COINS × CASH_GAIN` = 900 puntos por evento). Conviene revisar si la dificultad sigue bien y si `MAX_SCORE` / `score_cap` aguantan. Ver la nota de `fix-score-caps.sql` en `CLAUDE.md`.

### 4.4 Sembrar historia de CASH (opcional, baja prioridad)

El gráfico de fondo (15 días) arrancará vacío y se irá llenando con una fila cada 10 min. Si se quiere historia previa, QvaPay puede entregar un CSV con promedios diarios de CUPCASH (con las mismas reglas: solo públicas y dentro de límites). Referencia mensual: ~430 en enero, ~530 en abril, ~665 en julio, ~745 en octubre.

Antes de insertar filas con fecha pasada hay que tener en cuenta que `CLAUDE.md` describe `exchange` como append-only con `updated_at` monótono. El verificador del juego solo reconstruye `coin_id = 1`, así que filas antiguas de `coin_id = 7` no lo afectan, pero rompen esa invariante general.

## 5. Lo que no viene

- **USD CASH (`USDCASH`) y EUR CASH:** QvaPay no publica su promedio ni los envía por webhook. Fue una decisión deliberada; si cambiocup los quiere, se pide.
- **Ofertas privadas** en el promedio: siguen fuera.

## 6. Ya aplicado en este repo (sin commit)

Solo comentarios y documentación, que atribuían el vacío a que "no había trades de efectivo":

- `CLAUDE.md`: descripción de coin_id 7 y del paso de ingesta.
- `app/api/cron/route.js`: comentario de `fetchAverage`.
- `app/page.js`: comentario del caso sin datos.
