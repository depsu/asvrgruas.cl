/* ASVR Grúas — eventos de medición del sitio SEO.
   Todo elemento con [data-cta] dispara un evento GA4 al hacer clic
   (call_click, whatsapp_click, form_submit). gtag se carga en el <head> de cada página. */
(function () {
  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-cta]") : null;
    if (!el || typeof window.gtag !== "function") return;
    try {
      window.gtag("event", el.getAttribute("data-cta"), {
        event_category: "cta",
        event_label: el.getAttribute("data-location") || location.pathname,
        transport_type: "beacon"
      });
    } catch (err) { /* la medición jamás rompe la página */ }
  });

  // Captura de gclid: si alguien llega con clic de Ads a una página orgánica, se conserva.
  try {
    var gclid = new URLSearchParams(location.search).get("gclid");
    if (gclid) localStorage.setItem("gclid", gclid);
  } catch (err) { /* almacenamiento no disponible: seguir sin gclid */ }
})();
