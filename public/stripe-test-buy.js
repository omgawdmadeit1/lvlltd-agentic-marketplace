(function () {
  "use strict";

  var MODE_LABEL = "Stripe Checkout · $0.99 · mode=live";
  var PACK_SUCCESS_PATH = "/buy/success";

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, kind) {
    var el = $("sf-status");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "sf-status" + (kind ? " " + kind : "");
  }

  function listingIdFromButton(button) {
    return button.getAttribute("data-sf-buy") || button.getAttribute("data-listing") || "";
  }

  async function startCheckout(listingId, button) {
    if (!listingId) {
      setStatus("Missing listing id.", "err");
      return;
    }
    if (button) button.disabled = true;
    var scrim = $("scrim");
    if (scrim) scrim.classList.remove("on");
    var panel = $("panel");
    if (panel) {
      panel.classList.remove("open");
      panel.setAttribute("aria-hidden", "true");
    }
    setStatus("Opening Stripe Checkout…", "warn");
    try {
      var response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a2a_listing_id: listingId }),
      });
      var payload = await response.json().catch(function () {
        return {};
      });
      if (payload.livemode === false || (payload.checkout && payload.checkout.livemode === false)) {
        setStatus("Refusing test Stripe session. This storefront is LIVE.", "err");
        return;
      }
      if (!response.ok || !payload.ok || !payload.checkout || !payload.checkout.url) {
        setStatus(payload.message || payload.error || "Checkout is not ready.", "err");
        return;
      }
      window.location.href = payload.checkout.url;
    } catch (error) {
      setStatus(error && error.message ? error.message : "Checkout request failed.", "err");
    } finally {
      if (button) button.disabled = false;
    }
  }

  // Legacy return URL (/buy?checkout=success): link buyers to the server-verified download page.
  function packDownloadHref(sessionId) {
    if (!sessionId) return PACK_SUCCESS_PATH;
    return PACK_SUCCESS_PATH + "?session_id=" + encodeURIComponent(sessionId);
  }

  function showPackDownload(href) {
    var wrap = $("sf-download");
    var link = $("sf-download-link");
    if (!wrap || !link || !href) return;
    link.href = href;
    wrap.hidden = false;
  }

  function hidePackDownload() {
    var wrap = $("sf-download");
    if (wrap) wrap.hidden = true;
  }

  function httpsUrl(value) {
    try {
      return new URL(value).protocol === "https:" ? value : "";
    } catch (error) {
      return "";
    }
  }

  async function showReturnedSession() {
    var params = new URLSearchParams(window.location.search);
    var state = params.get("checkout");
    var sessionId = params.get("session_id");
    if (state === "cancel") {
      setStatus("Checkout canceled. No charge recorded here.", "warn");
      return;
    }
    if (state !== "success") return;
    showPackDownload(packDownloadHref(sessionId));
    if (!sessionId) {
      setStatus("Returned from Stripe Checkout. Confirm payment_status in the Stripe Dashboard — this page does not invent revenue.", "ok");
      return;
    }
    try {
      var response = await fetch("/api/checkout/session?session_id=" + encodeURIComponent(sessionId));
      var payload = await response.json().catch(function () {
        return {};
      });
      if (payload.livemode === false || (payload.checkout && payload.checkout.livemode === false)) {
        hidePackDownload();
        setStatus("Test session hidden. This storefront only reports LIVE Checkout.", "err");
        return;
      }
      if (httpsUrl(payload.pack_download_url)) {
        showPackDownload(payload.pack_download_url);
      }
      if (!response.ok || !payload.ok) {
        setStatus(payload.message || "Returned from Checkout. Session lookup unavailable.", "warn");
        return;
      }
      var payment = payload.checkout && payload.checkout.payment_status ? payload.checkout.payment_status : "unknown";
      setStatus(
        "Stripe session payment_status=" +
          payment +
          " · $0.99 · mode=live. Not a revenue claim from this page.",
        "ok"
      );
    } catch (error) {
      setStatus("Returned from Stripe Checkout. Session lookup failed.", "warn");
    }
  }

  function bind() {
    document.querySelectorAll("[data-sf-buy]").forEach(function (button) {
      button.addEventListener("click", function () {
        startCheckout(listingIdFromButton(button), button);
      });
    });
    showReturnedSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.LVLStripeLiveBuy = { startCheckout: startCheckout, MODE_LABEL: MODE_LABEL };
})();
