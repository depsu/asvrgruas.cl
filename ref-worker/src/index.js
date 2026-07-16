// Panel del cliente ASRV Grúas — instanciado de panel-cliente/ (maestro DIXDY) 2026-07-16.
// ref-api · Cloudflare Worker
// (1) CÓDIGO CORTO <-> gclid (landing /new, negocio /lookup).
// (2) Panel de cierres: /cierre (guardar), /cierres (listar), /cierre-delete.
//     Los cierres SIN código (teléfono o código borrado) cuentan para el % de cierre
//     pero NO se suben a Ads (no hay gclid que atribuir).
// (3) Cron nocturno: sube los cierres pendientes a Google Ads vía DATA MANAGER API
//     (el método viejo uploadClickConversions quedó bloqueado para cuentas nuevas, feb-2026).
// (4) Mi negocio (/config): el dueño deja cambios de horario/días/presupuesto que se
//     validan aquí (rangos seguros) y se aplican AL INSTANTE a Google Ads. Un cron
//     horario maneja los días programados (pausar/subir/bajar) y reintenta pendientes.
// (5) Comentario IA (/comentario-ia): el monitor /analizar-ads publica un resumen en
//     lenguaje simple + semáforo; el panel /resumen solo lo muestra.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TTL = 60 * 60 * 24 * 100;
const CIERRE_TTL = 60 * 60 * 24 * 180;
// Lista blanca de orígenes: canonical + apex + workers.dev (el dominio .cl sigue
// "pending" en NIC; mientras tanto el panel vive en workers.dev). Mejora sobre la
// plantilla (un solo ORIGIN) — candidata a promoverse al maestro.
const ORIGINS = ["https://www.asvrgruas.cl", "https://asvrgruas.cl", "https://asvrgruas.rivera-ale98.workers.dev"];
let ORIGIN = ORIGINS[0];   // se ajusta por request al inicio de fetch()

const GADS_CUSTOMER_ID = "8655524315";   // cuenta de Ads del cliente (sin guiones)
const GADS_CONVERSION_ACTION_ID = "7687673956"; // "Cliente cerrado (offline)", creada 17-jul-2026
const GADS_CAMPAIGN_ID = "0";                  // ⚠️ PENDIENTE: completar al crear la campaña
const GADS_BUDGET_ID = "0";                    // ⚠️ PENDIENTE: presupuesto de esa campaña
const DM_ENDPOINT = "https://datamanager.googleapis.com/v1/events:ingest";
const CRON_NOCTURNO = "59 3 * * *";                      // subida de cierres (≈23:59 Santiago)

// Rangos seguros de "Mi negocio" — el worker es quien manda (el front solo pinta).
// Diseñados para NO romper el aprendizaje de Smart Bidding: cambios chicos y poco frecuentes.
const REGLAS = {
  presupuestoMin: 15000, presupuestoMax: 35000, presupuestoPaso: 1000,
  presupuestoRecomendadoMin: 20000, presupuestoRecomendadoMax: 30000,
  presupuestoCadaHoras: 20,      // máx 1 cambio de presupuesto por día
  maxDiasBloqueados: 2,          // máx 2 días programados a la vez (pausar/subir/bajar)
  diasVentana: 13,               // solo se pueden programar días dentro de ~2 semanas
  subirPct: 25, bajarPct: 25,    // "invertir más/menos" ese día = ±25% del presupuesto base
};
const MODOS_DIA = { pausar: "⏸ pausado", subir: "🟢 invertir más", bajar: "🩵 invertir menos" };

// Pagos: mensualidad del publicista + bloques de saldo de Google Ads.
// Los datos de transferencia viven en el secreto DATOS_PAGO (wrangler secret put DATOS_PAGO).
const PAGOS_REGLAS = {
  mensual: 300000, diaPago: 5,        // $300.000 el día 5 de cada mes
  bloque: 100000,                     // cada pago de saldo Ads = $100.000
  alertaSaldo: 20000,                 // con ≤ $20.000 de saldo toca pagar el siguiente bloque
  fotoMaxChars: 4000000,              // ~3 MB en dataURL (el front comprime antes de subir)
};
const TZ = "America/Santiago";
function hoySantiago() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function horaSantiago(dateUtc) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, hour: "2-digit" }).format(dateUtc));
}
// El loop local corre cada hora en punto → el próximo run es el techo de la hora actual.
function proximaAplicacion() {
  const prox = Math.ceil((Date.now() + 1) / 3600000) * 3600000;
  return { proximaAplicacion: new Date(prox).toISOString(), minutosRestantes: Math.max(1, Math.round((prox - Date.now()) / 60000)) };
}

function genCode(n = 6) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  let s = ""; for (let i = 0; i < n; i++) s += ALPHABET[a[i] % ALPHABET.length]; return s;
}
function cors(extra = {}) {
  return { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type", ...extra };
}
// no-store: las respuestas de la API (saldo, cola, cierres) JAMÁS se cachean en ninguna capa
const jsonCors = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors({ "Content-Type": "application/json", "Cache-Control": "no-store" }) });
function normCode(raw) { return (raw || "").toUpperCase().replace(/^WEB-?/, "").replace(/[^A-Z2-9]/g, ""); }
function isGclid(raw) { return (raw || "").length > 25; }

async function gadsToken(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GADS_CLIENT_ID, client_secret: env.GADS_CLIENT_SECRET,
      refresh_token: env.GADS_REFRESH_TOKEN, grant_type: "refresh_token" }) });
  if (!r.ok) throw new Error("oauth " + r.status + " " + (await r.text()).slice(0, 200));
  return (await r.json()).access_token;
}
function convTimeISO(fecha) {
  fecha = (fecha || "").trim();
  if (!fecha) return new Date().toISOString();
  if (/[Zz]$|[+\-]\d\d:?\d\d$/.test(fecha)) return fecha.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(fecha)) return fecha.replace(" ", "T") + "Z"; // guardado en UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha + "T12:00:00Z";
  return new Date().toISOString();
}

async function nightlyUpload(env, validateOnly) {
  const sum = { ts: new Date().toISOString(), validateOnly: !!validateOnly, uploaded: 0, skipped: 0, errors: [], details: [] };
  try {
    const list = await env.REF.list({ prefix: "cierre:" });
    const pending = [];
    for (const k of list.keys) {
      const raw = await env.REF.get(k.name); if (!raw) continue;
      const c = JSON.parse(raw);
      if (c.subido) { sum.skipped++; continue; }
      if (c.manual && !c.gclid) {
        // sin código: pasada la noche del cron se vuelve DATA definitiva (ya no se puede borrar)
        if (!validateOnly && !c.noBorrar) {
          c.noBorrar = true;
          await env.REF.put(k.name, JSON.stringify(c), { expirationTtl: CIERRE_TTL });
        }
        sum.skipped++; continue;
      }
      let gclid = c.gclid || c.codigo;
      if (!isGclid(c.codigo)) {
        const v = await env.REF.get(normCode(c.codigo));
        if (!v) {
          // Código que no existe (mal transcrito o inventado): no hay clic que atribuir.
          // Regla de Alejandro: pasada la subida nocturna se CONVIERTE a "sin código" —
          // sigue sumando al % de cierre como data, pero ya no se puede borrar.
          if (!validateOnly) {
            c.manual = true; c.noBorrar = true;
            c.notaSistema = "código no resuelto (¿mal escrito?) → convertido a sin código";
            await env.REF.put(k.name, JSON.stringify(c), { expirationTtl: CIERRE_TTL });
            await env.REF.delete("dash-cache");
          }
          sum.skipped++; sum.details.push(c.codigo + ": código no resuelto → sin código (queda como data)");
          continue;
        }
        gclid = JSON.parse(v).gclid;
      }
      pending.push({ key: k.name, c, gclid });
    }
    if (!pending.length) { sum.note = "nada nuevo"; await env.REF.put("lastrun", JSON.stringify(sum)); return sum; }

    const token = await gadsToken(env);
    const body = {
      destinations: [{
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: GADS_CUSTOMER_ID },
        loginAccount: { accountType: "GOOGLE_ADS", accountId: (env.GADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "") },
        productDestinationId: GADS_CONVERSION_ACTION_ID,
      }],
      encoding: "HEX",
      validateOnly: !!validateOnly,
      events: pending.map(p => ({
        eventTimestamp: convTimeISO(p.c.fecha),
        transactionId: "cierre-" + p.c.codigo,
        conversionValue: Number(p.c.precio) || 1,
        currency: "CLP",
        eventSource: "WEB",
        adIdentifiers: { gclid: p.gclid },
      })),
    };
    const r = await fetch(DM_ENDPOINT, { method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("datamanager " + r.status + " " + JSON.stringify(data).slice(0, 400));
    sum.response = data;
    if (validateOnly) { sum.validated = pending.length; sum.details.push(...pending.map(p => p.c.codigo)); }
    else {
      sum.uploaded = pending.length;
      for (const p of pending) {
        p.c.subido = true; p.c.subido_ts = Date.now();
        await env.REF.put(p.key, JSON.stringify(p.c), { expirationTtl: CIERRE_TTL });
        sum.details.push(p.c.codigo + " $" + p.c.precio);
      }
    }
  } catch (e) { sum.errors.push(String(e.message || e)); }
  await env.REF.put("lastrun", JSON.stringify(sum));
  return sum;
}

// --- Dashboard del cliente: lee métricas de Google Ads (GAQL) + cierres, cacheado 30 min ---
async function gaql(token, env, query) {
  const r = await fetch(`https://googleads.googleapis.com/v22/customers/${GADS_CUSTOMER_ID}/googleAds:searchStream`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "developer-token": env.GADS_DEVELOPER_TOKEN,
      "login-customer-id": (env.GADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, ""), "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error("gaql " + r.status + " " + (await r.text()).slice(0, 200));
  const data = await r.json();
  return (Array.isArray(data) ? data : []).flatMap(b => b.results || []);
}

// Caché "sirve y refresca": responde AL INSTANTE con lo guardado, pero si los datos
// tienen >3 min recalcula EN SEGUNDO PLANO (waitUntil) — el auto-refresco del panel
// (60 s) recoge lo fresco solo. Antes era una foto fija de 30 min y el dueño recargaba
// 10 veces sin ver cambios.
async function dashboardData(env, ctx) {
  const FRESCO_MS = 3 * 60 * 1000;   // hasta aquí los datos se consideran al día
  const TOPE_MS = 30 * 60 * 1000;    // más viejos que esto: se recalcula esperando
  const cached = await env.REF.get("dash-cache");
  if (cached) {
    const c = JSON.parse(cached);
    const edad = Date.now() - c.ts;
    if (edad < FRESCO_MS) return c;
    if (edad < TOPE_MS) {
      if (ctx) ctx.waitUntil(recalcularDash(env).catch(() => {}));
      return c;
    }
  }
  return recalcularDash(env);
}

async function recalcularDash(env) {
  const token = await gadsToken(env);
  const today = new Date().toISOString().slice(0, 10);
  const range = `segments.date BETWEEN '2026-07-16' AND '${today}'`;

  // gasto por día
  const spendRows = await gaql(token, env, `SELECT segments.date, metrics.cost_micros FROM campaign WHERE campaign.id = 0 AND ${range} ORDER BY segments.date`);
  const days = {};  // date -> {gasto, whatsapp, telefono, formulario}
  for (const r of spendRows) {
    const d = r.segments.date;
    (days[d] = days[d] || { gasto: 0, whatsapp: 0, telefono: 0, formulario: 0 }).gasto += Math.round(Number(r.metrics.costMicros || 0) / 1e6);
  }
  // contactos por día y acción — los nombres de las acciones pueden venir en español o inglés
  const actRows = await gaql(token, env, `SELECT segments.date, segments.conversion_action_name, metrics.all_conversions FROM campaign WHERE campaign.id = 0 AND ${range}`);
  for (const r of actRows) {
    const d = r.segments.date;
    const name = (r.segments.conversionActionName || "").toLowerCase();
    const v = Number(r.metrics.allConversions || 0);
    if (!days[d]) days[d] = { gasto: 0, whatsapp: 0, telefono: 0, formulario: 0 };
    if (name.includes("whatsapp")) days[d].whatsapp += v;
    else if (name.includes("llamada") || name.includes("telef") || name.includes("phone") || name.includes("call")) days[d].telefono += v;
    else if (name.includes("form") || name.includes("correo") || name.includes("mail") || name.includes("gracias")) days[d].formulario += v;
  }

  // armar bloques de $100.000 — si un día cruza el límite, se PARTE: el trozo justo
  // para cerrar el bloque en $100.000 exactos y el resto pasa al siguiente. El día
  // de transición aparece en ambos bloques, con el mismo fecha pero gastos distintos.
  const BLOQUE = 100000;
  let cum = 0, invertido = 0;
  const bloques = [];
  const ensure = (idx) => bloques[idx] || (bloques[idx] = { numero: idx + 1, gastado: 0, whatsapp: 0, telefono: 0, formulario: 0, contactos: 0, dias: [] });
  for (const f of Object.keys(days).sort()) {
    const day = days[f];
    invertido += day.gasto;
    const wspTot = Math.round(day.whatsapp), telTot = Math.round(day.telefono), formTot = Math.round(day.formulario);
    let gastoRest = day.gasto, wspRest = wspTot, telRest = telTot, formRest = formTot;
    do {
      const idx = Math.floor(cum / BLOQUE);
      const espacio = (idx + 1) * BLOQUE - cum;        // lo que falta para cerrar este bloque
      const trozo = Math.min(gastoRest, espacio);
      const ultimo = trozo >= gastoRest;               // último (o único) pedazo del día
      const frac = day.gasto > 0 ? trozo / day.gasto : 0;
      const wsp = ultimo ? wspRest : Math.min(wspRest, Math.round(wspTot * frac));
      const tel = ultimo ? telRest : Math.min(telRest, Math.round(telTot * frac));
      const form = ultimo ? formRest : Math.min(formRest, Math.round(formTot * frac));
      const cont = wsp + tel + form;
      const b = ensure(idx);
      b.dias.push({ fecha: f, gasto: trozo, whatsapp: wsp, telefono: tel, formulario: form, contactos: cont,
        costo: cont > 0 ? Math.round(trozo / cont) : 0, hoy: f === today });
      b.gastado += trozo; b.whatsapp += wsp; b.telefono += tel; b.formulario += form; b.contactos += cont;
      cum += trozo; gastoRest -= trozo; wspRest -= wsp; telRest -= tel; formRest -= form;
    } while (gastoRest > 0);
  }
  const maxIdx = bloques.length - 1;
  bloques.forEach((b, i) => { b.completo = i < maxIdx; b.costoPorContacto = b.contactos > 0 ? Math.round(b.gastado / b.contactos) : 0; });

  // keywords (en total) — cómo te encontraron
  const kws = await gaql(token, env, `SELECT ad_group_criterion.keyword.text, metrics.conversions FROM keyword_view WHERE campaign.id = 0 AND ${range} AND metrics.clicks > 0 ORDER BY metrics.conversions DESC LIMIT 30`);
  const kwMap = {};
  for (const r of kws) { const t = r.adGroupCriterion.keyword.text; kwMap[t] = (kwMap[t] || 0) + Number(r.metrics.conversions || 0); }
  const keywords = Object.entries(kwMap).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => ({ text: e[0], contactos: Math.round(e[1]) }));

  // cierres (en total) + estadísticas: con/sin código, horario y comuna
  const list = await env.REF.list({ prefix: "cierre:" });
  let cierresN = 0, facturado = 0, cierresConCodigo = 0, cierresSinCodigo = 0;
  const porHora = {}, porComunaMap = {}, porServicioMap = {};
  for (const k of list.keys) {
    const v = await env.REF.get(k.name); if (!v) continue;
    const c = JSON.parse(v);
    cierresN++; facturado += Number(c.precio) || 0;
    if (c.manual) cierresSinCodigo++; else cierresConCodigo++;
    // hora del CONTACTO (no del registro del cierre — esa sería mentira):
    //  1) la que anotó el dueño ("¿a qué hora te contactó?"), o
    //  2) con código: el ts del código = el momento real del clic en la landing.
    // Si no hay ninguna de las dos, el cierre NO aporta a esta métrica.
    let h = null;
    if (c.hora && /^\d{1,2}:/.test(c.hora)) h = Number(c.hora.split(":")[0]);
    else if (!c.manual && c.codigo && !isGclid(c.codigo)) {
      const vc = await env.REF.get(normCode(c.codigo));
      if (vc) { const ts = JSON.parse(vc).ts; if (ts) h = horaSantiago(new Date(ts)); }
    }
    if (h !== null && h >= 0 && h < 24) porHora[h] = (porHora[h] || 0) + 1;
    const com = String(c.comuna || "").trim();
    if (com) { const e = (porComunaMap[com] = porComunaMap[com] || { comuna: com, cierres: 0, facturado: 0 }); e.cierres++; e.facturado += Number(c.precio) || 0; }
    const srv = String(c.servicio || "").trim();
    if (srv) { const e = (porServicioMap[srv] = porServicioMap[srv] || { servicio: srv, cierres: 0, facturado: 0 }); e.cierres++; e.facturado += Number(c.precio) || 0; }
  }
  const porComuna = Object.values(porComunaMap).sort((a, b) => b.cierres - a.cierres);
  const porServicio = Object.values(porServicioMap).sort((a, b) => b.facturado - a.facturado);

  // gasto de los últimos 7 días (aprox. semanal, para la bienvenida)
  const fechas = Object.keys(days).sort();
  const gastoSemana = fechas.slice(-7).reduce((s, f) => s + days[f].gasto, 0);

  // saldo de Google Ads: lo pagado en bloques ($100.000 c/u) menos lo invertido
  const pagos = JSON.parse(await env.REF.get("pagos") || '{"publicista":[],"ads":[]}');
  const pagadoAds = (pagos.ads || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const saldoAds = pagadoAds - invertido;

  const contactos = bloques.reduce((s, b) => s + b.contactos, 0);
  const out = {
    ts: Date.now(), invertido, contactos,
    whatsapp: bloques.reduce((s, b) => s + b.whatsapp, 0),
    telefono: bloques.reduce((s, b) => s + b.telefono, 0),
    formulario: bloques.reduce((s, b) => s + (b.formulario || 0), 0),
    costoPorContacto: contactos > 0 ? Math.round(invertido / contactos) : 0,
    keywords, cierresN, facturado, bloques,
    cierresConCodigo, cierresSinCodigo,
    pctCierre: contactos > 0 ? Math.round(cierresN / contactos * 100) : 0,
    cierresPorHora: porHora, cierresPorComuna: porComuna, cierresPorServicio: porServicio,
    gastoSemana,
    pagadoAds, saldoAds, alertaSaldo: PAGOS_REGLAS.alertaSaldo,
  };
  await env.REF.put("dash-cache", JSON.stringify(out), { expirationTtl: 3600 });
  return out;
}

// --- Aplicadores de "Mi negocio": escriben en Google Ads (instantáneo + cron) ---
// Solo tocan LA campaña y EL presupuesto de los IDs de este archivo, nada más.

const DIAS_API = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const KEYS_DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];   // ↔ DIAS_API

async function gadsMutate(env, token, kind, operations) {
  const r = await fetch(`https://googleads.googleapis.com/v22/customers/${GADS_CUSTOMER_ID}/${kind}:mutate`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "developer-token": env.GADS_DEVELOPER_TOKEN,
      "login-customer-id": (env.GADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, ""), "Content-Type": "application/json" },
    body: JSON.stringify({ operations }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("mutate " + r.status + " " + JSON.stringify(data).slice(0, 300));
  return data;
}

// TOPE DURO independiente de la validación del endpoint: TODO presupuesto pasa por aquí.
async function setPresupuesto(env, token, monto) {
  if (!(Number.isFinite(monto) && monto >= REGLAS.presupuestoMin && monto <= REGLAS.presupuestoMax)) return false;
  await gadsMutate(env, token, "campaignBudgets", [{
    update: { resourceName: `customers/${GADS_CUSTOMER_ID}/campaignBudgets/${GADS_BUDGET_ID}`,
              amountMicros: String(monto * 1000000) },
    updateMask: "amount_micros" }]);
  return true;
}

async function presupuestoActual(env, token) {
  const rows = await gaql(token, env, `SELECT campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.id = ${GADS_BUDGET_ID}`);
  return rows.length ? Math.round(Number(rows[0].campaignBudget.amountMicros) / 1e6) : null;
}

async function estadoCampana(env, token) {
  const rows = await gaql(token, env, `SELECT campaign.status FROM campaign WHERE campaign.id = ${GADS_CAMPAIGN_ID}`);
  return rows.length ? rows[0].campaign.status : null;
}

async function setEstadoCampana(env, token, status) {
  await gadsMutate(env, token, "campaigns", [{
    update: { resourceName: `customers/${GADS_CUSTOMER_ID}/campaigns/${GADS_CAMPAIGN_ID}`, status },
    updateMask: "status" }]);
}

async function aplicarHorario(env, token, h) {
  const modo = (h && h.modo) || "simple";
  const viejos = await gaql(token, env,
    `SELECT campaign_criterion.resource_name FROM campaign_criterion WHERE campaign_criterion.type = 'AD_SCHEDULE' AND campaign.id = ${GADS_CAMPAIGN_ID}`);
  const ops = viejos.map(r => ({ remove: r.campaignCriterion.resourceName }));
  const crear = (diaApi, ini, fin) => { if (ini !== fin) ops.push({ create: {
    campaign: `customers/${GADS_CUSTOMER_ID}/campaigns/${GADS_CAMPAIGN_ID}`,
    adSchedule: { dayOfWeek: diaApi, startHour: ini, startMinute: "ZERO", endHour: fin, endMinute: "ZERO" } } }); };
  const franja = (idx, desde, hasta) => {
    // cruza medianoche (ej. 08→02): desde→24 hoy + 00→hasta el día SIGUIENTE
    if (hasta <= desde) { crear(DIAS_API[idx], desde, 24); if (hasta > 0) crear(DIAS_API[(idx + 1) % 7], 0, hasta); }
    else crear(DIAS_API[idx], desde, hasta);
  };
  let res;
  if (modo === "247") res = "24/7: sin restricción de horario";
  else if (modo === "porDia") {
    KEYS_DIAS.forEach((k, i) => { const v = (h.dias || {})[k]; if (v) franja(i, Number(v.desde), Number(v.hasta)); });
    res = "horario personalizado por día aplicado";
  } else {
    const desde = Number(h.desde), hasta = Number(h.hasta);
    for (let i = 0; i < 7; i++) franja(i, desde, hasta);
    res = `horario ${String(desde).padStart(2, "0")}:00 a ${String(hasta % 24).padStart(2, "0")}:00 todos los días`;
  }
  if (ops.length) await gadsMutate(env, token, "campaignCriteria", ops);
  return res;
}

// Aplica UN item de la cola; devuelve el texto de resultado o lanza si falla.
async function aplicarItem(env, token, item) {
  if (item.tipo === "presupuesto") {
    if (!(await setPresupuesto(env, token, Number(item.presupuesto)))) throw new Error("presupuesto fuera del tope duro");
    return "presupuesto diario → $" + Number(item.presupuesto).toLocaleString("es-CL");
  }
  if (item.tipo === "horario") return aplicarHorario(env, token, item.horario);
  if (item.tipo === "dias") return "programado — la pausa/ajuste corre solo el día que corresponda";
  throw new Error("tipo desconocido");
}

function marcarAplicado(config, item) {
  config.aplicado = config.aplicado || {};
  if (item.tipo === "presupuesto") config.aplicado.presupuesto = item.presupuesto;
  if (item.tipo === "horario") config.aplicado.horario = item.horario;
  if (item.tipo === "dias") config.aplicado.diasProgramados = item.dias;
}

function pushSistema(cola, detalle) {
  cola.unshift({ id: genCode(4), tipo: "sistema", detalle, estado: "aplicado", ts: Date.now(), aplicado_ts: Date.now() });
  return cola.slice(0, 40);
}

// Cron horario: días programados (⏸ pausar · 🟢 subir · 🩵 bajar · restaurar) +
// reintento de items que quedaron pendientes. Idempotente (mismo criterio que el
// viejo loop local aplicar-config.py, que queda solo de respaldo).
async function revisarDias(env) {
  const config = JSON.parse(await env.REF.get("ads-config") || "{}");
  let cola = JSON.parse(await env.REF.get("ads-cola") || "[]");
  const token = await gadsToken(env);
  let cambio = false;

  for (const it of cola.filter(c => c.estado === "pendiente").sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    try { it.resultado = await aplicarItem(env, token, it); it.estado = "aplicado"; marcarAplicado(config, it); }
    catch (e) { it.estado = "error"; it.resultado = String(e.message || e).slice(0, 200); }
    it.aplicado_ts = Date.now(); cambio = true;
  }

  const hoy = hoySantiago();
  const prog = {};
  for (const d of (config.diasProgramados || [])) prog[d.fecha] = d.modo;
  for (const f of (config.diasBloqueados || [])) prog[f] = prog[f] || "pausar";   // formato viejo
  const modoHoy = prog[hoy];
  let ajuste = config.ajusteDia || null;

  // el ajuste de presupuesto era de OTRO día → restaurar la base
  if (ajuste && ajuste.fecha !== hoy) {
    const base = Number(ajuste.base) || 0;
    if (await setPresupuesto(env, token, base))
      cola = pushSistema(cola, "💰 Día programado terminó → presupuesto de vuelta a $" + base.toLocaleString("es-CL"));
    delete config.ajusteDia; ajuste = null; cambio = true;
  }

  const st = await estadoCampana(env, token);
  if (modoHoy === "pausar" && st === "ENABLED") {
    await setEstadoCampana(env, token, "PAUSED");
    config.campanaPausadaHoy = true; cambio = true;
    cola = pushSistema(cola, "⏸ Campaña pausada — hoy es tu día libre");
  } else if (modoHoy !== "pausar" && st === "PAUSED" && config.campanaPausadaHoy) {
    // solo reactiva si la pausó este sistema (si la pausó Alejandro a mano, no se toca)
    await setEstadoCampana(env, token, "ENABLED");
    config.campanaPausadaHoy = false; cambio = true;
    cola = pushSistema(cola, "▶️ Día libre terminado — tu publicidad corre de nuevo");
  }

  if ((modoHoy === "subir" || modoHoy === "bajar") && !(ajuste && ajuste.fecha === hoy)) {
    const base = Number((config.aplicado || {}).presupuesto) || (await presupuestoActual(env, token)) || 0;
    if (base) {
      const factor = modoHoy === "subir" ? 1 + REGLAS.subirPct / 100 : 1 - REGLAS.bajarPct / 100;
      const nuevo = Math.max(REGLAS.presupuestoMin, Math.min(REGLAS.presupuestoMax, Math.round(base * factor / 1000) * 1000));
      if (nuevo !== base && (await setPresupuesto(env, token, nuevo))) {
        config.ajusteDia = { fecha: hoy, modo: modoHoy, base };
        cola = pushSistema(cola, (modoHoy === "subir" ? "🟢 Hoy inviertes más: " : "🩵 Hoy inviertes menos: ") +
          "$" + base.toLocaleString("es-CL") + " → $" + nuevo.toLocaleString("es-CL") + " (mañana vuelve solo)");
        cambio = true;
      }
    }
  }

  if (cambio) {
    await env.REF.put("ads-config", JSON.stringify(config));
    await env.REF.put("ads-cola", JSON.stringify(cola));
  }
  return cambio;
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === CRON_NOCTURNO) ctx.waitUntil(nightlyUpload(env, false));
    else ctx.waitUntil(revisarDias(env).catch(() => {}));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const reqOrigin = request.headers.get("Origin") || "";
    ORIGIN = ORIGINS.includes(reqOrigin) ? reqOrigin : ORIGINS[0];
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    if (request.method === "POST" && url.pathname === "/new") {
      const origin = reqOrigin;
      if (origin && !ORIGINS.includes(origin)) return jsonCors({ error: "bad origin" }, 403);
      let b = {}; try { b = await request.json(); } catch (_e) {}
      const gclid = String(b.gclid || b.wbraid || b.gbraid || "").slice(0, 300);
      if (!gclid) return jsonCors({ error: "no id" }, 400);
      const code = genCode();
      await env.REF.put(code, JSON.stringify({ gclid, ts: Date.now() }), { expirationTtl: TTL });
      return jsonCors({ code });
    }
    if (request.method === "GET" && url.pathname === "/lookup") {
      if (url.searchParams.get("key") !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      const code = normCode(url.searchParams.get("code"));
      const v = code && await env.REF.get(code);
      return v ? new Response(v, { headers: { "Content-Type": "application/json" } }) : jsonCors({ error: "not found" }, 404);
    }

    if (url.pathname === "/cierre" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.pass !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const manual = !!b.manual;                          // sin código (teléfono o lo borró) → no se sube a Ads
      const hora = String(b.hora || "").slice(0, 5);
      const diaContacto = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dia || "")) ? String(b.dia) : (manual ? hoySantiago() : "");
      let codigo = String(b.codigo || "").trim();
      if (!codigo && manual) codigo = "SC-" + genCode(4);   // id único (dos cierres a la misma hora no chocan)
      const precio = String(b.precio || "").replace(/[^0-9]/g, "");
      if (!codigo || !precio) return jsonCors({ error: "faltan datos" }, 400);
      if (manual && !hora) return jsonCors({ error: "falta la hora del primer contacto" }, 400);
      const item = { codigo, precio: Number(precio), nota: String(b.nota || "").slice(0, 120),
        comuna: String(b.comuna || "").slice(0, 40), servicio: String(b.servicio || "").slice(0, 40),
        manual, hora, diaContacto, fecha: new Date().toISOString().slice(0, 19).replace("T", " "), subido: false };
      await env.REF.put("cierre:" + codigo.toUpperCase(), JSON.stringify(item), { expirationTtl: CIERRE_TTL });
      await env.REF.delete("dash-cache");   // que el resumen refleje el cierre al tiro
      return jsonCors({ ok: true, item });
    }
    if (url.pathname === "/cierres" && request.method === "GET") {
      if (url.searchParams.get("pass") !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const list = await env.REF.list({ prefix: "cierre:" });
      const items = [];
      for (const k of list.keys) { const v = await env.REF.get(k.name); if (v) items.push(JSON.parse(v)); }
      items.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
      return jsonCors({ items });
    }
    // Corregir el código de un cierre sin código (mal transcrito): valida AL INSTANTE que
    // el nuevo código exista; si es válido, el cierre vuelve a la cola y se sube esa noche.
    if (url.pathname === "/cierre-codigo" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.pass !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const viejoKey = "cierre:" + String(b.codigo || "").toUpperCase();
      const raw = await env.REF.get(viejoKey);
      if (!raw) return jsonCors({ error: "cierre no encontrado" }, 404);
      const c = JSON.parse(raw);
      if (c.subido) return jsonCors({ error: "ese cierre ya se subió a Google" }, 400);
      const nuevo = normCode(b.nuevo);
      if (!nuevo) return jsonCors({ error: "código inválido" }, 400);
      const v = await env.REF.get(nuevo);
      if (!v) return jsonCors({ error: "El código " + nuevo + " tampoco existe 🤔 — revísalo bien en el WhatsApp del cliente (6 letras/números)" }, 400);
      if (await env.REF.get("cierre:" + nuevo)) return jsonCors({ error: "Ya registraste un cierre con ese código" }, 400);
      c.codigo = nuevo; c.manual = false;
      delete c.noBorrar; delete c.notaSistema;
      await env.REF.put("cierre:" + nuevo, JSON.stringify(c), { expirationTtl: CIERRE_TTL });
      await env.REF.delete(viejoKey);
      await env.REF.delete("dash-cache");
      return jsonCors({ ok: true, codigo: nuevo });
    }
    if (url.pathname === "/cierre-delete" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.pass !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const key = "cierre:" + String(b.codigo || "").toUpperCase();
      const raw = await env.REF.get(key);
      if (raw) {
        const c = JSON.parse(raw);
        if (c.subido || c.noBorrar) return jsonCors({ error: "este cierre ya es parte de tus datos, no se puede borrar" }, 400);
      }
      await env.REF.delete(key);
      await env.REF.delete("dash-cache");
      return jsonCors({ ok: true });
    }

    if (url.pathname === "/dashboard" && request.method === "GET") {
      if (url.searchParams.get("pass") !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      try { return jsonCors(await dashboardData(env, ctx)); }
      catch (e) { return jsonCors({ error: String(e.message || e) }, 500); }
    }

    // ---- Pagos: mensualidad del publicista + bloques de saldo Ads (con comprobante foto) ----
    if (url.pathname === "/pagos" && request.method === "GET") {
      if (url.searchParams.get("pass") !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const pagos = JSON.parse(await env.REF.get("pagos") || '{"publicista":[],"ads":[]}');
      // sin la foto en la lista (pesada): solo si tiene comprobante
      const limpio = (arr) => (arr || []).map(p => ({ ...p, foto: undefined, tieneFoto: !!p.fotoKey }));
      return jsonCors({
        publicista: limpio(pagos.publicista), ads: limpio(pagos.ads),
        datos: env.DATOS_PAGO || null, reglas: PAGOS_REGLAS, hoy: hoySantiago(),
      });
    }
    if (url.pathname === "/pago" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.pass !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const tipo = String(b.tipo || "");
      const foto = String(b.foto || "");
      if (!foto.startsWith("data:image/")) return jsonCors({ error: "Falta la foto del comprobante" }, 400);
      if (foto.length > PAGOS_REGLAS.fotoMaxChars) return jsonCors({ error: "La foto pesa demasiado — inténtalo de nuevo" }, 400);
      const pagos = JSON.parse(await env.REF.get("pagos") || '{"publicista":[],"ads":[]}');
      const item = { id: genCode(5), ts: Date.now(), fecha: hoySantiago(), fotoKey: "" };

      if (tipo === "publicista") {
        const mes = /^\d{4}-\d{2}$/.test(String(b.mes || "")) ? String(b.mes) : hoySantiago().slice(0, 7);
        if ((pagos.publicista || []).some(p => p.mes === mes))
          return jsonCors({ error: "El mes " + mes + " ya está registrado como pagado ✓" }, 400);
        item.mes = mes; item.monto = PAGOS_REGLAS.mensual;
      } else if (tipo === "ads") {
        item.bloque = (pagos.ads || []).length + 1;
        // Monto editable desde el panel: por si el pago no fue un bloque redondo de $100.000
        // (ej. cubre un sobregiro + saldo nuevo). Rango sano para atajar errores de tipeo;
        // sin monto válido cae al bloque estándar.
        const m = Math.round(Number(b.monto) || 0);
        item.monto = (m >= 1000 && m <= 1000000) ? m : PAGOS_REGLAS.bloque;
      } else return jsonCors({ error: "tipo desconocido" }, 400);

      item.fotoKey = "pago-foto:" + item.id;
      await env.REF.put(item.fotoKey, foto);
      pagos[tipo] = pagos[tipo] || [];
      pagos[tipo].unshift(item);
      await env.REF.put("pagos", JSON.stringify(pagos));
      await env.REF.delete("dash-cache");   // el saldo Ads cambia al registrar un bloque
      return jsonCors({ ok: true, item: { ...item, foto: undefined, tieneFoto: true } });
    }
    // Registro manual de pagos SIN comprobante (lo usa Alejandro vía Claude Code cuando
    // le avisan que pagaron por otro canal). Protegido por LOOKUP_SECRET, no por la clave del panel.
    if (url.pathname === "/pago-manual" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.key !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      const tipo = String(b.tipo || "");
      const pagos = JSON.parse(await env.REF.get("pagos") || '{"publicista":[],"ads":[]}');
      const item = { id: genCode(5), ts: Date.now(), fecha: hoySantiago(), fotoKey: "",
        nota: String(b.nota || "registrado por el publicista (sin comprobante)").slice(0, 120) };
      if (tipo === "publicista") {
        const mes = /^\d{4}-\d{2}$/.test(String(b.mes || "")) ? String(b.mes) : hoySantiago().slice(0, 7);
        if ((pagos.publicista || []).some(p => p.mes === mes)) return jsonCors({ error: "el mes " + mes + " ya está registrado" }, 400);
        item.mes = mes; item.monto = Number(b.monto) || PAGOS_REGLAS.mensual;
      } else if (tipo === "ads") {
        item.bloque = (pagos.ads || []).length + 1; item.monto = Number(b.monto) || PAGOS_REGLAS.bloque;
      } else return jsonCors({ error: "tipo desconocido" }, 400);
      pagos[tipo].unshift(item);
      await env.REF.put("pagos", JSON.stringify(pagos));
      await env.REF.delete("dash-cache");
      return jsonCors({ ok: true, item });
    }
    if (url.pathname === "/pago-foto" && request.method === "GET") {
      if (url.searchParams.get("pass") !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const id = String(url.searchParams.get("id") || "").replace(/[^A-Z0-9]/gi, "");
      const dataUrl = await env.REF.get("pago-foto:" + id);
      if (!dataUrl) return jsonCors({ error: "no encontrada" }, 404);
      const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/s);
      if (!m) return jsonCors({ error: "formato inválido" }, 500);
      const bin = Uint8Array.from(atob(m[2]), ch => ch.charCodeAt(0));
      return new Response(bin, { headers: cors({ "Content-Type": m[1], "Cache-Control": "private, max-age=86400" }) });
    }

    // ---- Mi negocio: configuración del dueño con cola validada ----
    if (url.pathname === "/config" && request.method === "GET") {
      if (url.searchParams.get("pass") !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const config = JSON.parse(await env.REF.get("ads-config") || "{}");
      const cola = JSON.parse(await env.REF.get("ads-cola") || "[]");
      return jsonCors({ config, cola: cola.slice(0, 20), reglas: REGLAS, hoy: hoySantiago(), ...proximaAplicacion() });
    }
    if (url.pathname === "/config" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.pass !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      const config = JSON.parse(await env.REF.get("ads-config") || "{}");
      let cola = JSON.parse(await env.REF.get("ads-cola") || "[]");
      const tipo = String(b.tipo || "");
      const item = { id: genCode(4), tipo, ts: Date.now(), estado: "pendiente" };

      if (tipo === "presupuesto") {
        const n = Number(b.presupuesto);
        if (!Number.isFinite(n) || n % REGLAS.presupuestoPaso !== 0 || n < REGLAS.presupuestoMin || n > REGLAS.presupuestoMax)
          return jsonCors({ error: "El presupuesto debe estar entre $" + REGLAS.presupuestoMin.toLocaleString("es-CL") + " y $" + REGLAS.presupuestoMax.toLocaleString("es-CL") }, 400);
        // máx 1 cambio de presupuesto aplicado por día (cuida el aprendizaje de Google)
        const ultimo = cola.find(c => c.tipo === "presupuesto" && c.estado === "aplicado");
        if (ultimo && Date.now() - (ultimo.aplicado_ts || 0) < REGLAS.presupuestoCadaHoras * 3600000)
          return jsonCors({ error: "Para cuidar el aprendizaje de Google solo se permite 1 cambio de presupuesto al día. Inténtalo mañana 🙂" }, 400);
        if ((config.aplicado || {}).presupuesto === n) return jsonCors({ error: "Ese ya es tu presupuesto actual" }, 400);
        item.presupuesto = n; item.detalle = "Presupuesto diario → $" + n.toLocaleString("es-CL");
        config.presupuesto = n;
      } else if (tipo === "horario") {
        const modo = String(b.modo || "simple");
        const validaHora = (desde, hasta) => Number.isInteger(desde) && Number.isInteger(hasta) &&
          desde >= 0 && desde <= 23 && hasta >= 0 && hasta <= 24 && desde !== hasta;
        if (modo === "247") {
          item.horario = { modo: "247" };
          item.detalle = "Horario → 🟢 todo el día, todos los días (24/7)";
        } else if (modo === "porDia") {
          const KEYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
          const NOM = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
          const dias = {}; let activos = 0;
          for (const k of KEYS) {
            const v = (b.dias || {})[k];
            if (v == null) { dias[k] = null; continue; }
            const desde = Number(v.desde), hasta = Number(v.hasta);
            if (!validaHora(desde, hasta)) return jsonCors({ error: "Horario inválido en " + NOM[k] }, 400);
            dias[k] = { desde, hasta }; activos++;
          }
          if (!activos) return jsonCors({ error: "Debes dejar al menos un día con anuncios" }, 400);
          item.horario = { modo: "porDia", dias };
          item.detalle = "Horario por día → " + KEYS.map(k => dias[k]
            ? NOM[k] + " " + String(dias[k].desde).padStart(2, "0") + "-" + String(dias[k].hasta % 24).padStart(2, "0")
            : NOM[k] + " ✕").join(" · ");
        } else {
          const desde = Number(b.desde), hasta = Number(b.hasta);   // hasta<=desde = cruza medianoche
          if (!validaHora(desde, hasta)) return jsonCors({ error: "Horario inválido" }, 400);
          item.horario = { modo: "simple", desde, hasta };
          item.detalle = "Horario → " + String(desde).padStart(2, "0") + ":00 a " + String(hasta % 24).padStart(2, "0") + ":00" + (hasta <= desde ? " (del día siguiente)" : "") + ", todos los días";
        }
        config.horario = item.horario;
      } else if (tipo === "dias") {
        const raw = Array.isArray(b.dias) ? b.dias : [];
        if (raw.length > REGLAS.maxDiasBloqueados)
          return jsonCors({ error: "Máximo " + REGLAS.maxDiasBloqueados + " días programados a la vez (así Google no pierde lo aprendido)" }, 400);
        const hoy = hoySantiago();
        const tope = new Date(hoy + "T12:00:00Z"); tope.setUTCDate(tope.getUTCDate() + REGLAS.diasVentana);
        const topeISO = tope.toISOString().slice(0, 10);
        const dias = [];
        for (const d of raw) {
          const fecha = String((d && d.fecha) || "").slice(0, 10);
          const modo = String((d && d.modo) || "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < hoy || fecha > topeISO)
            return jsonCors({ error: "Solo puedes programar días entre hoy y las próximas 2 semanas" }, 400);
          if (!MODOS_DIA[modo]) return jsonCors({ error: "Modo de día desconocido" }, 400);
          dias.push({ fecha, modo });
        }
        dias.sort((x, y) => x.fecha.localeCompare(y.fecha));
        item.dias = dias;
        item.detalle = dias.length
          ? "Días → " + dias.map(d => d.fecha.slice(5).split("-").reverse().join("/") + " " + MODOS_DIA[d.modo]).join(" · ")
          : "Sin días programados (todo normal)";
        config.diasProgramados = dias;
        delete config.diasBloqueados;   // formato viejo, reemplazado
      } else return jsonCors({ error: "tipo desconocido" }, 400);

      // un cambio pendiente por tipo: el nuevo reemplaza al pendiente anterior
      cola = cola.filter(c => !(c.tipo === tipo && c.estado === "pendiente"));
      cola.unshift(item); cola = cola.slice(0, 40);

      // aplicar AL INSTANTE (si falla queda "error"; lo pendiente lo reintenta el cron horario)
      try {
        const token = await gadsToken(env);
        item.resultado = await aplicarItem(env, token, item);
        item.estado = "aplicado"; item.aplicado_ts = Date.now();
        marcarAplicado(config, item);
      } catch (e) {
        item.estado = "error"; item.resultado = String(e.message || e).slice(0, 200); item.aplicado_ts = Date.now();
      }
      await env.REF.put("ads-config", JSON.stringify(config));
      await env.REF.put("ads-cola", JSON.stringify(cola));
      // si programó días y HOY es uno de ellos (o quitó el de hoy), actuar ahora mismo
      if (tipo === "dias" && item.estado === "aplicado") {
        try { await revisarDias(env); cola = JSON.parse(await env.REF.get("ads-cola") || "[]"); } catch (_e) {}
      }
      return jsonCors({ ok: true, item, cola: cola.slice(0, 20) });
    }

    // ---- Comentario IA: lo publica el monitor /analizar-ads, el panel /resumen lo muestra ----
    if (url.pathname === "/comentario-ia" && request.method === "GET") {
      if (url.searchParams.get("pass") !== env.PANEL_PASS) return jsonCors({ error: "clave incorrecta" }, 401);
      return jsonCors(JSON.parse(await env.REF.get("comentario-ia") || "{}"));
    }
    if (url.pathname === "/comentario-ia" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.key !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      const nivel = ["verde", "amarillo", "rojo"].indexOf(b.nivel) >= 0 ? b.nivel : "verde";
      const item = { nivel, titulo: String(b.titulo || "").slice(0, 80),
        texto: String(b.texto || "").slice(0, 600), ts: Date.now() };
      if (!item.texto) return jsonCors({ error: "falta texto" }, 400);
      await env.REF.put("comentario-ia", JSON.stringify(item));
      return jsonCors({ ok: true, item });
    }
    // el loop local lee lo pendiente y reporta lo aplicado (secret del negocio, no del dueño)
    if (url.pathname === "/config-pendientes" && request.method === "GET") {
      if (url.searchParams.get("key") !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      const config = JSON.parse(await env.REF.get("ads-config") || "{}");
      const cola = JSON.parse(await env.REF.get("ads-cola") || "[]");
      return jsonCors({ config, pendientes: cola.filter(c => c.estado === "pendiente"), reglas: REGLAS, hoy: hoySantiago() });
    }
    if (url.pathname === "/config-aplicado" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch (_e) {}
      if (b.key !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      const config = JSON.parse(await env.REF.get("ads-config") || "{}");
      const cola = JSON.parse(await env.REF.get("ads-cola") || "[]");
      const it = cola.find(c => c.id === b.id);
      if (it) {
        it.estado = b.ok ? "aplicado" : "error";
        it.aplicado_ts = Date.now();
        if (b.resultado) it.resultado = String(b.resultado).slice(0, 200);
        if (b.ok) {
          config.aplicado = config.aplicado || {};
          if (it.tipo === "presupuesto") config.aplicado.presupuesto = it.presupuesto;
          if (it.tipo === "horario") config.aplicado.horario = it.horario;
          if (it.tipo === "dias") config.aplicado.diasProgramados = it.dias;
        }
      }
      if (typeof b.campanaPausadaHoy === "boolean") config.campanaPausadaHoy = b.campanaPausadaHoy;
      // ajuste de presupuesto del día (subir/bajar): el loop registra {fecha, modo, base} y lo limpia al restaurar
      if ("ajusteDia" in b) { if (b.ajusteDia) config.ajusteDia = b.ajusteDia; else delete config.ajusteDia; }
      await env.REF.put("ads-config", JSON.stringify(config));
      await env.REF.put("ads-cola", JSON.stringify(cola));
      return jsonCors({ ok: true });
    }

    // forzar ahora la revisión de días programados + pendientes (debug / skill de respaldo)
    if (request.method === "GET" && url.pathname === "/config-run") {
      if (url.searchParams.get("key") !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      try { return jsonCors({ ok: true, cambio: await revisarDias(env) }); }
      catch (e) { return jsonCors({ ok: false, error: String(e.message || e) }, 500); }
    }

    if (request.method === "GET" && url.pathname === "/lastrun") {
      if (url.searchParams.get("key") !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      const v = await env.REF.get("lastrun");
      return new Response(v || JSON.stringify({ note: "aún no corre" }), { headers: { "Content-Type": "application/json" } });
    }
    if (request.method === "GET" && url.pathname === "/run") {
      if (url.searchParams.get("key") !== env.LOOKUP_SECRET) return jsonCors({ error: "unauthorized" }, 401);
      const validateOnly = url.searchParams.get("validate") === "1";
      return new Response(JSON.stringify(await nightlyUpload(env, validateOnly)), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("ref-api ok", { status: 200 });
  },
};
