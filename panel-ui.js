/* Panel del cliente ASRV Grúas — instanciado de panel-cliente/ (maestro DIXDY) 2026-07-16.
   - Barra superior + menú hamburguesa en todas las vistas del panel
   - Caché local (localStorage) para pintar al instante y refrescar por detrás
   Se incluye con: <script src="/panel-ui.js"></script> (al inicio del <body>) */
(function () {
  var VIEWS = [
    { href: "/panel.html", icon: "🏠", label: "Inicio" },
    { href: "/resumen.html", icon: "📊", label: "Resumen" },
    { href: "/cierres.html", icon: "📋", label: "Cierres" },
    { href: "/mi-negocio.html", icon: "⚙️", label: "Mi negocio" },
    { href: "/pago.html", icon: "💳", label: "Pagos" },
    { href: "/transferencias.html", icon: "🧾", label: "Transferencias" }
  ];
  // Workers Static Assets sirve /panel.html como /panel → comparar sin la extensión
  var path = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";

  var css = document.createElement("style");
  css.textContent =
    ".pu-top{position:fixed;top:0;left:0;right:0;height:56px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid #e3eaf2;display:flex;align-items:center;justify-content:space-between;padding:0 14px;z-index:50}" +
    ".pu-brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:15.5px;color:#0f2742;text-decoration:none}" +
    ".pu-brand .pu-dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#1f6feb,#5aa0ff);display:flex;align-items:center;justify-content:center;font-size:15px}" +
    ".pu-brand small{font-weight:600;color:#7d8da0;font-size:11px;display:block;line-height:1}" +
    /* margin/font/padding explícitos: los estilos globales button{} de cada página no deben pisarlos */
    ".pu-burger{width:42px;min-width:42px;height:42px;min-height:42px;margin:0;border:1px solid #e3eaf2;background:#fff;color:#0f2742;border-radius:11px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4.5px;padding:0;font-size:0;line-height:0;box-shadow:none;flex:none}" +
    ".pu-burger:active{transform:none}" +
    ".pu-burger span{display:block;width:17px;height:2px;background:#0f2742;border-radius:2px;transition:transform .18s,opacity .18s}" +
    ".pu-burger.on span:nth-child(1){transform:translateY(6.5px) rotate(45deg)}" +
    ".pu-burger.on span:nth-child(2){opacity:0}" +
    ".pu-burger.on span:nth-child(3){transform:translateY(-6.5px) rotate(-45deg)}" +
    ".pu-ovl{position:fixed;inset:0;background:rgba(15,39,66,.28);opacity:0;pointer-events:none;transition:opacity .18s;z-index:60}" +
    ".pu-ovl.on{opacity:1;pointer-events:auto}" +
    ".pu-menu{position:fixed;top:0;right:0;bottom:0;width:264px;max-width:82vw;background:#fff;box-shadow:-6px 0 24px rgba(15,39,66,.12);transform:translateX(105%);transition:transform .2s ease-out;z-index:70;padding:18px 14px;display:flex;flex-direction:column}" +
    ".pu-menu.on{transform:translateX(0)}" +
    ".pu-menu .pu-mh{font-size:12px;font-weight:800;color:#7d8da0;letter-spacing:.06em;text-transform:uppercase;margin:6px 6px 10px}" +
    ".pu-item{display:flex;align-items:center;gap:11px;padding:13px 12px;border-radius:11px;color:#0f2742;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:2px}" +
    ".pu-item:active{background:#eef3f9}" +
    ".pu-item.act{background:#eaf2fe;color:#1f6feb}" +
    ".pu-item .pu-i{width:34px;height:34px;border-radius:9px;background:#f2f6fb;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}" +
    ".pu-item.act .pu-i{background:#dcebfd}" +
    ".pu-out{margin-top:auto;border-top:1px solid #eef2f7;padding-top:10px}" +
    ".pu-out button{width:100%;margin:0;border:1px solid #e3eaf2;background:#fff;color:#c0392b;font-weight:700;font-size:14px;line-height:1.3;border-radius:11px;padding:12px;cursor:pointer;box-shadow:none}" +
    /* botón ⓘ de información */
    ".pu-info{position:absolute;top:7px;right:7px;width:20px;height:20px;min-width:20px;min-height:20px;margin:0;padding:0;border:1px solid #d5dee9;border-radius:50%;background:#fff;color:#7d8da0;font-size:11px;line-height:1;font-weight:800;cursor:pointer;box-shadow:none;font-style:italic;font-family:Georgia,serif}" +
    /* modal de información (hoja inferior) */
    ".pu-iovl{position:fixed;inset:0;background:rgba(15,39,66,.4);z-index:80;opacity:0;pointer-events:none;transition:opacity .18s}" +
    ".pu-iovl.on{opacity:1;pointer-events:auto}" +
    ".pu-sheet{position:fixed;left:0;right:0;bottom:0;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -8px 30px rgba(15,39,66,.25);z-index:81;padding:20px 18px 26px;max-height:78vh;overflow:auto;transform:translateY(105%);transition:transform .22s ease-out;font-size:14.5px;line-height:1.55;color:#0f2742}" +
    ".pu-sheet.on{transform:translateY(0)}" +
    ".pu-sheet h3{margin:0 0 10px;font-size:17px}" +
    ".pu-sheet .pu-x{position:absolute;top:12px;right:12px;width:32px;height:32px;min-width:32px;margin:0;padding:0;border:0;background:#eef3f9;border-radius:50%;font-size:15px;color:#5b6b7c;cursor:pointer;box-shadow:none;line-height:1}" +
    /* tour guiado */
    ".pu-hl{position:relative!important;z-index:95!important;box-shadow:0 0 0 4px #1f6feb,0 0 0 9999px rgba(15,39,66,.55)!important;border-radius:12px!important}" +
    ".pu-tovl{position:fixed;inset:0;background:rgba(15,39,66,.55);z-index:90}" +
    ".pu-tcard{position:fixed;left:12px;right:12px;bottom:16px;background:#fff;border-radius:16px;box-shadow:0 10px 34px rgba(15,39,66,.35);z-index:96;padding:16px 16px 14px;color:#0f2742}" +
    ".pu-tcard h4{margin:0 0 5px;font-size:16px}" +
    ".pu-tcard p{margin:0 0 12px;font-size:14px;line-height:1.5;color:#3d4f63}" +
    ".pu-trow{display:flex;align-items:center;gap:10px}" +
    ".pu-dots{display:flex;gap:5px;flex:1}" +
    ".pu-dots i{width:7px;height:7px;border-radius:50%;background:#dbe4ee}" +
    ".pu-dots i.on{background:#1f6feb}" +
    ".pu-tnext{margin:0;border:0;background:#1f6feb;color:#fff;font-weight:800;font-size:14px;border-radius:10px;padding:11px 20px;cursor:pointer;box-shadow:none;width:auto;min-height:0}" +
    ".pu-tskip{margin:0;border:0;background:none;color:#7d8da0;font-weight:700;font-size:13px;cursor:pointer;box-shadow:none;width:auto;padding:8px 6px;min-height:0}" +
    "body{padding-top:56px!important}";
  document.head.appendChild(css);

  var top = document.createElement("div");
  top.className = "pu-top";
  top.innerHTML =
    '<a class="pu-brand" href="/panel.html"><img src="/imagenes/logo.webp?v=e323dac5" alt="" style="height:32px;width:auto;display:block;flex:none">' +
    '<span>ASRV Grúas<small>panel del negocio</small></span></a>' +
    '<button class="pu-burger" id="puBurger" aria-label="Menú"><span></span><span></span><span></span></button>';
  var ovl = document.createElement("div"); ovl.className = "pu-ovl";
  var menu = document.createElement("div"); menu.className = "pu-menu";
  menu.innerHTML = '<div class="pu-mh">Tu panel</div>' + VIEWS.map(function (v) {
    var act = path === v.href.replace(/\.html$/, "");
    return '<a class="pu-item' + (act ? " act" : "") + '" href="' + v.href + '"><span class="pu-i">' + v.icon + "</span>" + v.label + "</a>";
  }).join("") +
  '<a class="pu-item" href="?tour=1"><span class="pu-i">🎓</span>Ver la guía</a>' +
  '<div class="pu-out"><button id="puOut">Cerrar sesión</button></div>';

  function mount() {
    document.body.prepend(top);
    document.body.appendChild(ovl);
    document.body.appendChild(menu);
    var burger = document.getElementById("puBurger");
    function toggle(open) {
      var on = open != null ? open : !menu.classList.contains("on");
      menu.classList.toggle("on", on); ovl.classList.toggle("on", on); burger.classList.toggle("on", on);
    }
    burger.onclick = function () { toggle(); };
    ovl.onclick = function () { toggle(false); };
    document.getElementById("puOut").onclick = function () {
      if (!confirm("¿Cerrar sesión en este teléfono?")) return;
      try { localStorage.removeItem("panel_pass"); } catch (e) {}
      location.href = "/panel.html";
    };
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  // --- caché local: pintar al instante, refrescar por detrás ---
  window.PanelUI = {
    cacheGet: function (key) {
      try {
        var raw = localStorage.getItem("pu_" + key);
        if (!raw) return null;
        var o = JSON.parse(raw);
        return o && o.d != null ? o.d : null;
      } catch (e) { return null; }
    },
    cacheSet: function (key, data) {
      try { localStorage.setItem("pu_" + key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) {}
    },
    cacheClear: function () {
      try {
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf("pu_") === 0 && k.indexOf("pu_tour") !== 0) localStorage.removeItem(k); });
      } catch (e) {}
    },
    // --- auto-refresco: repite fn cada ms mientras la pestaña esté visible, y SIEMPRE
    //     al volver a la vista (el navegador del teléfono restaura la página vieja de
    //     memoria: sin esto queda congelada y hay que refrescar a mano) ---
    autoRefresh: function (fn, ms) {
      if (ms) setInterval(function () { if (!document.hidden) fn(); }, ms);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) fn(); });
      window.addEventListener("pageshow", function (e) { if (e.persisted) fn(); });
    },

    // ============ GUÍA + NOVEDADES (el panel se explica solo) ============
    // Cada vista llama a PanelUI.guia(clave, pasos) tras pintar:
    //  - Primera vez en este dispositivo → tour completo de la vista.
    //  - Ya la vio → solo se anuncian las NOVEDADES de esa vista que no conozca (una vez).
    // Para FUTURAS MEJORAS: agrega una entrada a NOVEDADES y listo — nadie tiene que
    // explicarle nada al cliente. id única, vista (panel|resumen|cierres|negocio),
    // el (selector a destacar o null) y el texto en simple.
    _tourLanzado: false,
    NOVEDADES: [
      // { id: "2026-07-ejemplo", vista: "cierres", el: "#formCierre",
      //   titulo: "Botón sin código", texto: "Ahora puedes registrar clientes aunque no tengan código." },
      { id: "2026-07-proyeccion", vista: "panel", el: "#cardProy",
        titulo: "Proyección de ganancia 📈",
        texto: "Mueve la pelotita y mira cuánto ganarías al mes si tu tasa de cierre mejorara — con consejos diarios para lograrlo." },
      { id: "2026-07-pagos", vista: "panel", el: null,
        titulo: "Pagos 💳",
        texto: "En el menú ☰ ahora está «Pagos»: mira tu saldo de publicidad en vivo, los datos de transferencia, y sube tus comprobantes con una foto. Todo queda en tu historial." },
      { id: "2026-07-autorefresh", vista: "panel", el: null,
        titulo: "El panel se actualiza solo 🔄",
        texto: "Ya no necesitas refrescar la página: los números y tus cierres se actualizan solos cada minuto y cada vez que vuelves al panel." },
      { id: "2026-07-respuestas", vista: "panel", el: "#cardResp",
        titulo: "Respuestas listas 💬",
        texto: "Mensajes probados para responder al tiro en WhatsApp: con valor, hora concreta y seguimiento. Toca Copiar, pega y ajusta la hora. Responder rápido es la palanca #1 para cerrar más." }
    ],
    guia: function (clave, pasos) {
      var PU = window.PanelUI;
      if (PU._tourLanzado) return;
      var flag = "pu_tour_" + clave;
      var forzado = location.search.indexOf("tour=1") >= 0;
      var hecho = false;
      try { hecho = !!localStorage.getItem(flag); } catch (e) {}
      var novs = PU.NOVEDADES.filter(function (n) {
        var vista = !n.vista || n.vista === clave;
        var visto = false;
        try { visto = !!localStorage.getItem("pu_nov_" + n.id); } catch (e) {}
        return vista && !visto;
      });
      var marcarNovs = function () {
        novs.forEach(function (n) { try { localStorage.setItem("pu_nov_" + n.id, "1"); } catch (e) {} });
      };
      if (forzado || !hecho) {
        PU._tourLanzado = true;
        marcarNovs();   // el tour completo ya cubre lo nuevo
        setTimeout(function () { PU.tour(pasos, flag); }, 700);
      } else if (novs.length) {
        PU._tourLanzado = true;
        marcarNovs();
        setTimeout(function () {
          PU.tour(novs.map(function (n) { return { el: n.el, titulo: "✨ Nuevo: " + n.titulo, texto: n.texto }; }), null);
        }, 700);
      }
    },

    // --- semáforo de la tasa de cierre: 🔴 <10% · 🟢 10–20% · 🏆 >20% ---
    estadoCierre: function (pct) {
      if (pct >= 20) return { color: "#b8860b", label: "🏆 ¡Excelente!", nivel: "dorado" };
      if (pct >= 10) return { color: "#0c8a4a", label: "👍 Vas bien", nivel: "verde" };
      return { color: "#c0392b", label: "💪 Se puede mejorar", nivel: "rojo" };
    },

    // --- modal de información (hoja inferior, simple) ---
    info: function (titulo, html) {
      var ovl = document.querySelector(".pu-iovl"), sheet = document.querySelector(".pu-sheet");
      if (!ovl) {
        ovl = document.createElement("div"); ovl.className = "pu-iovl";
        sheet = document.createElement("div"); sheet.className = "pu-sheet";
        document.body.appendChild(ovl); document.body.appendChild(sheet);
        ovl.onclick = function () { window.PanelUI.infoCerrar(); };
      }
      sheet.innerHTML = '<button class="pu-x" onclick="PanelUI.infoCerrar()">✕</button><h3>' + titulo + "</h3>" + html;
      requestAnimationFrame(function () { ovl.classList.add("on"); sheet.classList.add("on"); });
    },
    infoCerrar: function () {
      var ovl = document.querySelector(".pu-iovl"), sheet = document.querySelector(".pu-sheet");
      if (ovl) { ovl.classList.remove("on"); sheet.classList.remove("on"); }
    },

    // --- info de la tasa de cierre (la usan panel y resumen) ---
    infoCierre: function (d) {
      d = d || {};
      var pct = d.pctCierre || 0, ec = window.PanelUI.estadoCierre(pct);
      var bloques = d.bloques || [], b = bloques.length ? bloques[bloques.length - 1] : null;
      var barra = Math.min(Math.round(pct / 25 * 100), 100);
      var html =
        '<div style="text-align:center;font-size:44px;font-weight:900;color:' + ec.color + ';letter-spacing:-1px">' + pct + "%</div>" +
        '<div style="text-align:center;font-weight:800;margin-bottom:10px;color:' + ec.color + '">' + ec.label + "</div>" +
        '<div style="background:#eef3f9;border-radius:99px;height:12px;overflow:hidden;margin-bottom:14px"><span style="display:block;height:100%;width:' + barra + '%;background:' + ec.color + ';border-radius:99px"></span></div>' +
        "<p>De <b>" + (d.contactos || 0) + " personas</b> que te contactaron por tu publicidad, <b>" + (d.cierresN || 0) + "</b> terminaron pagando.</p>" +
        (b ? "<p>En el bloque actual llevas <b>" + b.contactos + " contactos</b> — cada uno que cierres sube tu porcentaje 📈</p>" : "") +
        '<div style="display:flex;gap:7px;flex-wrap:wrap;margin:12px 0;font-size:12px;font-weight:700">' +
        '<span style="background:#fdecea;color:#c0392b;border-radius:20px;padding:4px 11px">🔴 menos de 10%</span>' +
        '<span style="background:#e3f6ec;color:#0c8a4a;border-radius:20px;padding:4px 11px">🟢 10 a 20%</span>' +
        '<span style="background:#faf3dc;color:#b8860b;border-radius:20px;padding:4px 11px">🏆 más de 20%</span></div>' +
        '<p style="background:#f2f7ff;border:1px solid #d5e4fb;border-radius:10px;padding:10px 12px;font-size:13px">💡 <b>La palanca #1 es responder rápido:</b> el primero que contesta se suele llevar al cliente. Contestar en menos de 5 minutos puede multiplicar tus cierres.</p>';
      window.PanelUI.info("Tu tasa de cierre", html);
    },

    // --- tour guiado (primera visita o «🎓 Ver la guía» del menú) ---
    tour: function (pasos, flag) {
      var i = 0, hl = null, ovl = null, card = document.createElement("div");
      card.className = "pu-tcard";
      document.body.appendChild(card);
      function limpiar() {
        if (hl) { hl.classList.remove("pu-hl"); hl = null; }
        if (ovl) { ovl.remove(); ovl = null; }
      }
      function fin() {
        limpiar(); card.remove();
        try { localStorage.setItem(flag || "pu_tour_done", "1"); } catch (e) {}
      }
      function pintar() {
        limpiar();
        var p = pasos[i];
        var el = p.el && document.querySelector(p.el);
        if (el) {
          el.classList.add("pu-hl"); hl = el;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        } else {
          ovl = document.createElement("div"); ovl.className = "pu-tovl";
          document.body.appendChild(ovl);
        }
        var ultimo = i === pasos.length - 1;
        card.innerHTML = "<h4>" + p.titulo + "</h4><p>" + p.texto + "</p>" +
          '<div class="pu-trow"><div class="pu-dots">' +
          pasos.map(function (_, j) { return '<i class="' + (j === i ? "on" : "") + '"></i>'; }).join("") +
          "</div>" +
          (ultimo ? "" : '<button class="pu-tskip" id="puTskip">Saltar</button>') +
          '<button class="pu-tnext" id="puTnext">' + (ultimo ? "¡Listo! 🎉" : "Siguiente →") + "</button></div>";
        document.getElementById("puTnext").onclick = function () { if (ultimo) fin(); else { i++; pintar(); } };
        var sk = document.getElementById("puTskip");
        if (sk) sk.onclick = fin;
      }
      pintar();
    }
  };
})();
