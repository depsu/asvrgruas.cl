/* ── Eventos especiales del sitio (modo lluvia + temporadas) ─────────────────────
   Un solo archivo para TODO el sitio (páginas SEO + LPs). Decide solo qué modo toca:

   1. ¿Forzado? `?modo=lluvia` en la URL (para probar) · `?modo=off` lo apaga.
   2. ¿Hay un evento en el calendario EVENTOS? (18 de sept, Halloween, Navidad…)
   3. ¿Está lloviendo en Santiago AHORA? (Open-Meteo, gratis y sin key; caché 30 min)
   4. Nada de lo anterior → el sitio queda normal, sin efecto alguno.

   Para agregar una temporada nueva: agregar la fecha en EVENTOS + su entrada en MODOS
   (+ su función de efecto si lleva animación). Ver skill `/eventos-especiales`.

   El efecto lluvia: canvas liviano en .hero (escritorio trazos teal + cielo oscurecido;
   móvil trazos blancos con halo que se funden con la foto) y un letrero "notch" colgado
   del nav. Respeta prefers-reduced-motion, se pausa con pestaña oculta o hero fuera de
   vista, y no intercepta taps. */
(function () {
  "use strict";

  /* ══ CALENDARIO (editar aquí; fechas MM-DD, hora de Santiago, ambos inclusive) ══ */
  var EVENTOS = [
    /* { id: "dieciocho", desde: "09-17", hasta: "09-19" }, */
    /* { id: "halloween", desde: "10-30", hasta: "10-31" }, */
    /* { id: "navidad",   desde: "12-15", hasta: "12-25" }, */
  ];

  /* ══ MODOS: qué muestra cada uno (notch = letrero en el nav; efecto = animación) ══ */
  var ICONO_LLUVIA =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>' +
    '<path class="ng" d="M8 16v3"/><path class="ng" d="M12 17v3"/><path class="ng" d="M16 16v3"/></svg>';

  var MODOS = {
    lluvia: {
      notch: "Ni la " + ICONO_LLUVIA + '<span class="sr-lluvia">lluvia</span> nos detiene',
      efecto: "lluvia"
      /* imgs: { "foto.webp": "/imagenes/foto-lluvia.webp" } — variantes de fotos por
         modo (asvrgruas aún no tiene). decos: [{ en, img, clase }] — adornos. */
    }
    /* Ejemplos futuros (crear su efecto en EFECTOS si lleva animación):
    dieciocho: { notch: "¡Feliz 18! 🇨🇱 Atendemos igual", efecto: null },
    navidad:   { notch: "🎄 Felices fiestas", efecto: "lluvia" }, */
  };

  /* ─────────────────────────── infraestructura ─────────────────────────── */

  var CSS = "" +
    ".hero-lluvia{display:block;position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;" +
    "-webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 72%,transparent 96%);" +
    "mask-image:linear-gradient(to bottom,#000 0%,#000 72%,transparent 96%)}" +
    /* contenido sobre la lluvia (título, botón de WhatsApp, reseñas…) — con :where()
       (especificidad 0) para NO pisar reglas propias de la página como
       .hero-collage{position:absolute} (la foto móvil) */
    ":where(.hero>*:not(.hero-lluvia),.wa-consulta>*:not(.hero-lluvia)){position:relative;z-index:1}" +
    "@media (min-width:900px){.hero-lluvia{-webkit-mask-image:none;mask-image:none}}" +
    ".head-notch{position:absolute;left:50%;top:calc(100% - 1px);transform:translateX(-50%);" +
    "display:inline-flex;align-items:center;gap:5px;padding:4px 14px 6px;border-radius:0 0 14px 14px;" +
    "background:rgba(255,255,255,.82);-webkit-backdrop-filter:blur(12px) saturate(140%);" +
    "backdrop-filter:blur(12px) saturate(140%);border:1px solid rgba(255,255,255,.6);border-top:none;" +
    "color:#06231f;font-size:11px;font-weight:700;letter-spacing:.02em;white-space:nowrap;" +
    "box-shadow:0 10px 22px rgba(6,35,31,.10);pointer-events:none}" +
    ".head-notch svg{width:15px;height:15px;flex:none;color:#0a8e80}" +
    ".head-notch .sr-lluvia{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}" +
    ".head-notch .ng{animation:notchGota 1.5s ease-in infinite}" +
    ".head-notch .ng:nth-child(3){animation-delay:.5s}" +
    ".head-notch .ng:nth-child(4){animation-delay:1s}" +
    "@keyframes notchGota{0%{opacity:0;transform:translateY(-1.5px)}35%{opacity:1}100%{opacity:0;transform:translateY(2px)}}" +
    ".head--hide{transform:translateY(-180%)}" +   /* margen extra: se lleva el notch al esconderse */
    "@media (min-width:900px){.head-notch{font-size:12.5px;padding:5px 18px 7px}" +
    ".head-notch svg{width:17px;height:17px}}" +
    "@media (prefers-reduced-motion:reduce){.head-notch .ng{animation:none}}";

  function hoyEnSantiago() {
    /* "MM-DD" según la hora de Chile, no la del visitante */
    try {
      var ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
      return ymd.slice(5);
    } catch (e) {
      var d = new Date();
      return String(d.getMonth() + 101).slice(1) + "-" + String(d.getDate() + 100).slice(1);
    }
  }

  function eventoDeHoy() {
    var hoy = hoyEnSantiago();
    for (var i = 0; i < EVENTOS.length; i++) {
      var ev = EVENTOS[i];
      var enRango = ev.desde <= ev.hasta
        ? (hoy >= ev.desde && hoy <= ev.hasta)
        : (hoy >= ev.desde || hoy <= ev.hasta);   /* rango que cruza el año nuevo */
      if (enRango && MODOS[ev.id]) return ev.id;
    }
    return null;
  }

  /* ¿Llueve en Santiago? Open-Meteo (gratis, sin key), con caché de 30 min */
  function chequearLluvia(cb) {
    var CACHE_KEY = "eventos.clima";
    var TTL = 30 * 60 * 1000;
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && (Date.now() - c.t) < TTL) return cb(c.lluvia);
    } catch (e) { /* caché corrupta: se consulta de nuevo */ }
    var url = "https://api.open-meteo.com/v1/forecast?latitude=-33.45&longitude=-70.67" +
      "&current=precipitation,weather_code&timezone=America%2FSantiago";
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var cur = j && j.current ? j.current : {};
      var code = cur.weather_code || 0;
      /* códigos WMO de llovizna/lluvia/chubascos/tormenta */
      var llueve = (cur.precipitation || 0) > 0 ||
        (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), lluvia: llueve })); } catch (e) { }
      cb(llueve);
    }).catch(function () { cb(false); });   /* sin clima no hay modo lluvia, y ya */
  }

  function ponerNotch(html) {
    var head = document.querySelector(".head");
    if (!head || head.querySelector(".head-notch")) return;
    if (getComputedStyle(head).position === "static") head.style.position = "relative";
    var notch = document.createElement("span");
    notch.className = "head-notch";
    notch.innerHTML = html;
    head.appendChild(notch);
  }

  /* ══ EFECTO LLUVIA ══
     Dónde llueve: en el hero, y en .recientes a TODO EL ANCHO de la sección
     pero solo desde el CTA "Cuéntanos tu situación" hacia abajo (`desde`) —
     así las tarjetas de trabajos quedan secas y no se ven bordes de
     contenedores angostos. El canvas va detrás (z:-1 + isolation en el host):
     botón de WhatsApp, reseñas, técnica y todo el contenido quedan encima.
     cielo = oscurecido superior solo del hero · mask = desvanecer abajo
     (solo hero móvil, para fundirse con su foto) */
  /* paleta por zona: "auto" = blanca+halo en móvil (sobre la foto del hero) y teal
     en escritorio · "teal" = SIEMPRE la teal de escritorio (zonas de fondo claro) */
  /* asvrgruas: hero + sección del CTA. La sección .tormenta de las LPs YA trae su
     propia lluvia CSS permanente — no se toca. Las páginas hijas SEO (plantilla
     .cabecera, sin .hero/.head) quedan sin efecto: el script no monta nada ahí. */
  var LLUVIA_EN = [
    { sel: ".hero", z: 0, cielo: true, mask: true, paleta: "auto" },
    { sel: ".recientes", z: -1, desde: ".wa-btn", cielo: false, mask: false, paleta: "teal" }
  ];

  /* en pantallas muy anchas la lluvia no ocupa todo: banda centrada con
     difuminado lateral, para que no se lleve la atención */
  var LLUVIA_TOPE_ANCHO = 1200;   /* ancho máximo visible de la banda */
  var LLUVIA_FUNDIDO_LADO = 200;  /* px de difuminado en cada borde lateral */
  var LLUVIA_FUNDIDO_TOP = 90;    /* px de aparición gradual arriba (canvas con `desde`) */

  function efectoLluvia() {
    for (var i = 0; i < LLUVIA_EN.length; i++) {
      var host = document.querySelector(LLUVIA_EN[i].sel);
      if (host) montarLluvia(host, LLUVIA_EN[i]);
    }
  }

  function montarLluvia(host, opts) {
    if (host.querySelector(".hero-lluvia")) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    /* con z negativo el host debe ser stacking context, o el canvas se escondería
       bajo el fondo de la propia sección */
    if (opts.z < 0) host.style.isolation = "isolate";
    var desdeEl = opts.desde ? host.querySelector(opts.desde) : null;
    var canvas = document.createElement("canvas");
    canvas.className = "hero-lluvia";
    canvas.style.zIndex = opts.z;
    if (!opts.mask) {
      canvas.style.webkitMaskImage = "none";
      canvas.style.maskImage = "none";
    }
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
    if (!canvas.getContext) return;

    var mqDesk = window.matchMedia("(min-width:900px)");
    var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    var ctx = canvas.getContext("2d");
    var drops = [];
    var raf = 0;
    var w = 0, h = 0;
    var tabVisible = !document.hidden;
    var heroVisible = true;
    var WIND = 0.14;               /* inclinación: vx = vy * WIND */
    var pal;                        /* paleta vigente (se fija en resize) */
    var cielo = null;               /* gradiente "cielo de lluvia" (solo escritorio) */
    var fundidos = [];              /* pases de borrado suave (top y laterales) */

    function palette() {
      var teal = mqDesk.matches || opts.paleta === "teal";
      return teal
        /* teal: trazos sobre fondo claro (escritorio, y zonas claras también en móvil) */
        ? { rgb: "11, 110, 100", area: 8500, aBase: 0.18, aVar: 0.32, halo: null, wAdd: 0 }
        /* blanca: los MISMOS trazos + halo oscuro para que se lean sobre la foto */
        : { rgb: "255, 255, 255", area: 9500, aBase: 0.55, aVar: 0.35, halo: "6, 35, 31", wAdd: 0.5 };
    }

    function makeDrop(anywhere) {
      var depth = 0.35 + Math.random() * 0.65;   /* 0.35 lejos … 1 cerca */
      return {
        x: Math.random() * (w + h * WIND) - h * WIND,
        y: anywhere ? Math.random() * h : -30 - Math.random() * h * 0.3,
        len: 26 + depth * 42,
        vy: (8 + depth * 10),
        alpha: pal.aBase + depth * pal.aVar,
        width: 0.7 + pal.wAdd + depth * 0.9
      };
    }

    function resize() {
      var rh = host.getBoundingClientRect();
      /* `desde`: la lluvia parte donde empieza ese hijo (lo de arriba queda seco) */
      var y0 = 0;
      if (desdeEl) {
        y0 = Math.max(0, Math.round(desdeEl.getBoundingClientRect().top - rh.top));
        canvas.style.top = y0 + "px";
        canvas.style.height = Math.max(1, Math.round(rh.height - y0)) + "px";
      }
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(rh.width));
      h = Math.max(1, Math.round(rh.height - y0));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pal = palette();
      if (pal.halo || !opts.cielo) {
        cielo = null;
      } else {
        /* cielo de lluvia: leve oscurecido arriba para que los trazos tengan contraste */
        cielo = ctx.createLinearGradient(0, 0, 0, h * 0.42);
        cielo.addColorStop(0, "rgba(6, 35, 31, .12)");
        cielo.addColorStop(1, "rgba(6, 35, 31, 0)");
      }
      /* fundidos: se BORRAN suavemente los bordes después de dibujar cada frame */
      fundidos = [];
      if (desdeEl) {
        /* aparición gradual arriba: sin línea dura donde parte la lluvia */
        var gt = ctx.createLinearGradient(0, 0, 0, LLUVIA_FUNDIDO_TOP);
        gt.addColorStop(0, "rgba(0,0,0,1)");
        gt.addColorStop(1, "rgba(0,0,0,0)");
        fundidos.push({ g: gt, x: 0, y: 0, w: w, h: LLUVIA_FUNDIDO_TOP });
      }
      if (w > LLUVIA_TOPE_ANCHO) {
        /* banda centrada con laterales esfumados */
        var borde = Math.round((w - LLUVIA_TOPE_ANCHO) / 2) + LLUVIA_FUNDIDO_LADO;
        var gl = ctx.createLinearGradient(0, 0, borde, 0);
        gl.addColorStop(0, "rgba(0,0,0,1)");
        gl.addColorStop((borde - LLUVIA_FUNDIDO_LADO) / borde, "rgba(0,0,0,1)");
        gl.addColorStop(1, "rgba(0,0,0,0)");
        fundidos.push({ g: gl, x: 0, y: 0, w: borde, h: h });
        var gr = ctx.createLinearGradient(w, 0, w - borde, 0);
        gr.addColorStop(0, "rgba(0,0,0,1)");
        gr.addColorStop((borde - LLUVIA_FUNDIDO_LADO) / borde, "rgba(0,0,0,1)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        fundidos.push({ g: gr, x: w - borde, y: 0, w: borde, h: h });
      }
      var n = Math.round((w * h) / pal.area);
      drops = [];
      for (var i = 0; i < n; i++) drops.push(makeDrop(true));
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      if (cielo) {
        ctx.fillStyle = cielo;
        ctx.fillRect(0, 0, w, h * 0.42);
      }
      ctx.lineCap = "round";
      for (var i = 0; i < drops.length; i++) {
        var d = drops[i];
        d.y += d.vy;
        d.x += d.vy * WIND;
        if (d.y - d.len > h) drops[i] = d = makeDrop(false);
        /* cola degradada (transparente arriba → color abajo): se lee como lluvia, no como rayitas */
        var tx = d.x - d.len * WIND, ty = d.y - d.len;
        if (pal.halo) {
          /* halo oscuro bajo el trazo: hace visible la gota sobre las zonas claras de la foto */
          var gh = ctx.createLinearGradient(tx, ty, d.x, d.y);
          gh.addColorStop(0, "rgba(" + pal.halo + ", 0)");
          gh.addColorStop(1, "rgba(" + pal.halo + "," + (d.alpha * 0.5) + ")");
          ctx.strokeStyle = gh;
          ctx.lineWidth = d.width + 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(d.x, d.y);
          ctx.stroke();
        }
        var g = ctx.createLinearGradient(tx, ty, d.x, d.y);
        g.addColorStop(0, "rgba(" + pal.rgb + ", 0)");
        g.addColorStop(1, "rgba(" + pal.rgb + "," + d.alpha + ")");
        ctx.strokeStyle = g;
        ctx.lineWidth = d.width;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
      /* borrar suave los bordes (aparición gradual arriba / laterales esfumados) */
      if (fundidos.length) {
        ctx.globalCompositeOperation = "destination-out";
        for (var f = 0; f < fundidos.length; f++) {
          ctx.fillStyle = fundidos[f].g;
          ctx.fillRect(fundidos[f].x, fundidos[f].y, fundidos[f].w, fundidos[f].h);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      raf = requestAnimationFrame(frame);
    }

    function shouldRun() {
      return !mqReduce.matches && tabVisible && heroVisible;
    }

    function sync() {
      if (shouldRun()) {
        if (!raf) { resize(); raf = requestAnimationFrame(frame); }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        ctx.clearRect(0, 0, w, h);
      }
    }

    /* pausa fuera de vista: la lluvia no gasta CPU si el hero ya se pasó */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        sync();
      }).observe(canvas);
    }
    document.addEventListener("visibilitychange", function () {
      tabVisible = !document.hidden;
      sync();
    });
    var t = 0;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () { if (raf) resize(); sync(); }, 150);
    });
    /* el contenedor puede cambiar de alto DESPUÉS de montar (content-visibility,
       contenido armado por JS): re-medir cuando cambie de verdad */
    if ("ResizeObserver" in window) {
      new ResizeObserver(function () {
        var r = canvas.getBoundingClientRect();
        if (Math.abs(r.height - h) > 4 || Math.abs(r.width - w) > 4) {
          clearTimeout(t);
          t = setTimeout(function () { if (raf) resize(); }, 120);
        }
      }).observe(host);
    }
    /* al cruzar el umbral móvil↔escritorio cambia la paleta: re-sembrar */
    function reseed() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      sync();
    }
    if (mqDesk.addEventListener) {
      mqDesk.addEventListener("change", reseed);
      mqReduce.addEventListener("change", sync);
    }
    sync();
  }

  var EFECTOS = { lluvia: efectoLluvia };

  /* ─────────────────────────── arranque ─────────────────────────── */

  function activar(idModo) {
    var modo = MODOS[idModo];
    if (!modo) return;
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    if (modo.notch) ponerNotch(modo.notch);
    if (modo.imgs) cambiarFotos(modo.imgs);
    if (modo.decos) ponerDecos(modo.decos);
    if (modo.efecto && EFECTOS[modo.efecto]) EFECTOS[modo.efecto]();
  }

  /* cuelga un adorno (imagen) de cada elemento indicado */
  function ponerDecos(decos) {
    for (var i = 0; i < decos.length; i++) {
      var d = decos[i];
      var host = document.querySelector(d.en);
      if (!host || host.querySelector("." + d.clase)) continue;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      var img = document.createElement("img");
      img.className = d.clase;
      img.src = d.img;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      host.appendChild(img);
    }
  }

  /* cambia cada foto por su variante del modo (busca por trozo del src) */
  function cambiarFotos(mapa) {
    for (var trozo in mapa) {
      var imgs = document.querySelectorAll('img[src*="' + trozo + '"]');
      for (var i = 0; i < imgs.length; i++) imgs[i].src = mapa[trozo];
    }
  }

  function init() {
    /* 1) forzado por URL (para probar): ?modo=lluvia · ?modo=off */
    var forzado = null;
    try { forzado = new URLSearchParams(location.search).get("modo"); } catch (e) { }
    if (forzado === "off") return;
    if (forzado) return activar(forzado);

    /* 2) evento del calendario */
    var ev = eventoDeHoy();
    if (ev) return activar(ev);

    /* 3) ¿llueve en Santiago ahora mismo? */
    chequearLluvia(function (llueve) { if (llueve) activar("lluvia"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
