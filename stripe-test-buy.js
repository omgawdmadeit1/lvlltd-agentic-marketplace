(function () {
  "use strict";

  var MODE_LABEL = "TEST MODE · livemode false · not live revenue";

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
    setStatus("Opening Stripe TEST Checkout…", "warn");
    try {
      var response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a2a_listing_id: listingId }),
      });
      var payload = await response.json().catch(function () {
        return {};
      });
      if (payload.livemode === true) {
        setStatus("Refusing live Stripe session. TEST mode only.", "err");
        return;
      }
      if (!response.ok || !payload.ok || !payload.checkout || !payload.checkout.url) {
        setStatus(payload.message || payload.error || "TEST Checkout is not ready.", "err");
        return;
      }
      if (payload.checkout.livemode === true) {
        setStatus("Refusing live Stripe session. TEST mode only.", "err");
        return;
      }
      window.location.href = payload.checkout.url;
    } catch (error) {
      setStatus(error && error.message ? error.message : "Checkout request failed.", "err");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function showReturnedSession() {
    var params = new URLSearchParams(window.location.search);
    var state = params.get("checkout");
    var sessionId = params.get("session_id");
    if (state === "cancel") {
      setStatus("TEST Checkout canceled. No charge. Still mode=test.", "warn");
      return;
    }
    if (state !== "success") return;
    if (!sessionId) {
      setStatus("Returned from Stripe TEST Checkout. Confirm in the Stripe TEST dashboard — not live revenue.", "ok");
      return;
    }
    try {
      var response = await fetch("/api/checkout/session?session_id=" + encodeURIComponent(sessionId));
      var payload = await response.json().catch(function () {
        return {};
      });
      if (payload.livemode === true || (payload.checkout && payload.checkout.livemode === true)) {
        setStatus("Live session hidden. This storefront only reports TEST.", "err");
        return;
      }
      if (!response.ok || !payload.ok) {
        setStatus(payload.message || "Returned from TEST Checkout. Session lookup unavailable.", "warn");
        return;
      }
      var payment = payload.checkout && payload.checkout.payment_status ? payload.checkout.payment_status : "unknown";
      setStatus(
        "Stripe TEST session " +
          payment +
          " · $0.99 TEST · livemode false. Do not count as live revenue.",
        "ok"
      );
    } catch (error) {
      setStatus("Returned from Stripe TEST Checkout. Session lookup failed.", "warn");
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

  window.LVLStripeTestBuy = { startCheckout: startCheckout, MODE_LABEL: MODE_LABEL };
})();
