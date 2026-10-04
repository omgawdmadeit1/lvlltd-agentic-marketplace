"use strict";

/**
 * Optional delivery email via Resend (https://resend.com) using fetch.
 * Link only - never attachments (Gmail blocks zips containing code).
 * No-ops safely when RESEND_API_KEY or DELIVERY_FROM_EMAIL is unset.
 */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function emailConfigured(env) {
  const source = env || process.env;
  return Boolean(
    String(source.RESEND_API_KEY || "").trim() && String(source.DELIVERY_FROM_EMAIL || "").trim()
  );
}

async function sendDeliveryEmail({ to, productName, downloadUrl, successUrl, expiresAt }, env) {
  const source = env || process.env;
  if (!emailConfigured(source)) return { ok: false, skipped: true, reason: "email_not_configured" };
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) {
    return { ok: false, skipped: true, reason: "no_buyer_email" };
  }
  const expires = new Date(expiresAt * 1000).toUTCString();
  const subject = `Your download: ${productName}`;
  const text = [
    `Thanks for your purchase of ${productName}.`,
    "",
    `Download (link expires ${expires}):`,
    downloadUrl,
    "",
    `If the link expires, reopen your order page for a fresh link: ${successUrl}`,
    "",
    "- LVL (agentic.lvlltd.com)",
  ].join("\n");
  const html = `<p>Thanks for your purchase of <strong>${escapeHtml(productName)}</strong>.</p>
<p><a href="${escapeHtml(downloadUrl)}">Download your pack</a> (link expires ${escapeHtml(expires)}).</p>
<p>If the link expires, reopen <a href="${escapeHtml(successUrl)}">your order page</a> for a fresh link.</p>
<p>- LVL (agentic.lvlltd.com)</p>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${String(source.RESEND_API_KEY).trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: String(source.DELIVERY_FROM_EMAIL).trim(),
      to: [String(to)],
      subject,
      text,
      html,
    }),
  });
  if (!response.ok) return { ok: false, skipped: false, reason: `email_http_${response.status}` };
  return { ok: true };
}

module.exports = { emailConfigured, sendDeliveryEmail, escapeHtml };
