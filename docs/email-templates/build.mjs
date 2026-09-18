// Builds every Supabase auth email in the site's own design (2026-09-13 redesign).
// Email-safe: tables, inline styles, system fonts, 560px card, no external CSS.
// Applied to the Supabase project on 2026-09-13 through the Management API
// (PATCH /v1/projects/{ref}/config/auth with out/patch.json). Edit here, run
// `node docs/email-templates/build.mjs`, then apply out/patch.json the same way.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const C = {
  bg: "#fdf8f0", card: "#ffffff", border: "#ece0cd", fg: "#1f1a14", muted: "#5c5145", subtle: "#766a5c",
  accent: "#b0561d", accentDark: "#944815", soft: "#fbeee1", line: "#e6cba7", sunken: "#f4ecdd",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DEV = "'Noto Sans Devanagari','Tiro Devanagari Hindi',-apple-system,'Segoe UI',Arial,sans-serif";
const SITE = "{{ .SiteURL }}";

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 4px"><tr><td align="center" bgcolor="${C.accent}" style="border-radius:999px;background:${C.accent}">
<a href="${href}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:999px">${label}</a>
</td></tr></table>`;
}

function code(token) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 2px"><tr><td align="center" style="padding:18px 12px;background:${C.soft};border:1px solid ${C.line};border-radius:16px">
<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.accentDark};padding-bottom:8px">Your code</div>
<div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${C.fg}">${token}</div>
</td></tr></table>`;
}

function note(html) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px"><tr><td style="padding:14px 16px;background:${C.sunken};border-radius:14px;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${C.muted}">${html}</td></tr></table>`;
}

function p(html, extra = "") {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:15.5px;line-height:1.65;color:${C.muted};${extra}">${html}</p>`;
}

function layout({ preheader, eyebrow, title, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">

<tr><td style="padding:0 6px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${FONT};font-size:17px;font-weight:800;letter-spacing:-0.2px;color:${C.fg}"><a href="${SITE}" target="_blank" style="color:${C.fg};text-decoration:none"><span style="color:${C.accent}">&#10022;</span> Bhakti Nam Jap</a></td>
<td align="right" style="font-family:${DEV};font-size:15px;color:${C.accent}">&#2344;&#2366;&#2350; &#2332;&#2346;</td>
</tr></table>
</td></tr>

<tr><td bgcolor="${C.accent}" style="height:4px;line-height:4px;font-size:0;border-radius:24px 24px 0 0;background:${C.accent}">&nbsp;</td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-top:0;border-radius:0 0 24px 24px;padding:34px 32px 30px">
<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${C.accentDark};padding-bottom:10px">${eyebrow}</div>
<h1 style="margin:0 0 14px;font-family:${FONT};font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.5px;color:${C.fg}">${title}</h1>
${body}
</td></tr>

<tr><td align="center" style="padding:22px 16px 6px;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${C.subtle}">
Questions? Just reply to this email.<br>
<a href="${SITE}" target="_blank" style="color:${C.accentDark};text-decoration:none;font-weight:600">Bhakti Nam Jap</a> &middot; Count, chant and keep your daily sadhana in rhythm.
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

const ignore = "If you did not ask for this, you can ignore this email &mdash; nothing about your account has changed.";

/** key -> [subject, html] ; keys match the Management API's mailer_* names */
const T = {
  magic_link: [
    "Your Bhakti Nam Jap log-in code",
    layout({
      preheader: "Your log-in code, valid for 15 minutes.",
      eyebrow: "Log in",
      title: "Your log-in code",
      body:
        p("Type this code on the log-in page to open your account. It is the quickest way in, and no mail app can use it up before you do.") +
        /* B65: the same mail goes out straight after a purchase (Supabase has one
           template for both), so it says what a new buyer needs to hear too. */
        p("<b style=\"color:#1f1a14\">Just bought Premium?</b> Thank you &mdash; your payment went through and Premium is active on this email. Log in with the code below on each device you use.") +
        code("{{ .Token }}") +
        p("Or log in with one tap:", "margin:22px 0 6px;text-align:center") +
        button("{{ .ConfirmationURL }}", "Log in to Bhakti Nam Jap") +
        note(`The code and the button each work <b>once</b> and expire in <b>15 minutes</b>. ${ignore}`),
    }),
  ],
  recovery: [
    "Choose a new password for Bhakti Nam Jap",
    layout({
      preheader: "Open the page and press Set new password. The link lasts 15 minutes.",
      eyebrow: "Password",
      title: "Choose a new password",
      body:
        p("You asked to set or reset the password for your account. Open the page below and press <b style=\"color:#1f1a14\">Set new password</b>.") +
        button("{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery", "Choose a new password") +
        note(`The link works <b>once</b> and expires in <b>15 minutes</b>. Opening it changes nothing until you press the button on the page, and until then your old password still works. ${ignore}`),
    }),
  ],
  confirmation: [
    "Confirm your email for Bhakti Nam Jap",
    layout({
      preheader: "One tap to confirm this email address.",
      eyebrow: "Welcome",
      title: "Confirm your email address",
      body: p("Press the button to confirm this email address for your Bhakti Nam Jap account.") +
        button("{{ .ConfirmationURL }}", "Confirm email address") + note(ignore),
    }),
  ],
  invite: [
    "Your Bhakti Nam Jap account is ready",
    layout({
      preheader: "Open your account with one tap.",
      eyebrow: "Welcome",
      title: "Your account is ready",
      body: p("An account has been made for you on Bhakti Nam Jap. Press the button to open it.") +
        button("{{ .ConfirmationURL }}", "Open my account") + note(ignore),
    }),
  ],
  email_change: [
    "Confirm your new email for Bhakti Nam Jap",
    layout({
      preheader: "Confirm the new email address for your account.",
      eyebrow: "Account",
      title: "Confirm your new email",
      body: p("Press the button to use <b style=\"color:#1f1a14\">{{ .NewEmail }}</b> as the email address for your Bhakti Nam Jap account.") +
        button("{{ .ConfirmationURL }}", "Confirm new email") + note(ignore),
    }),
  ],
  reauthentication: [
    "{{ .Token }} is your Bhakti Nam Jap verification code",
    layout({
      preheader: "Your verification code.",
      eyebrow: "Verification",
      title: "Your verification code",
      body: p("Type this code to confirm it is you.") + code("{{ .Token }}") + note(`The code expires in 15 minutes. ${ignore}`),
    }),
  ],
};

const notice = (key, subject, title, text) => {
  T[key] = [subject, layout({
    preheader: text.replace(/<[^>]+>/g, ""),
    eyebrow: "Security notice",
    title,
    body: p(text) + note("If this was not you, reset your password straight away from the log-in page and reply to this email so we can help."),
  })];
};
notice("password_changed_notification", "Your Bhakti Nam Jap password was changed", "Your password was changed", "The password for your Bhakti Nam Jap account ({{ .Email }}) was just changed.");
notice("email_changed_notification", "Your Bhakti Nam Jap email was changed", "Your email address was changed", "The email address for your Bhakti Nam Jap account was just changed.");
notice("phone_changed_notification", "Your Bhakti Nam Jap phone number was changed", "Your phone number was changed", "The phone number on your Bhakti Nam Jap account ({{ .Email }}) was just changed.");
notice("identity_linked_notification", "A log-in method was added to your Bhakti Nam Jap account", "A log-in method was added", "A new way to log in was just added to your Bhakti Nam Jap account ({{ .Email }}).");
notice("identity_unlinked_notification", "A log-in method was removed from your Bhakti Nam Jap account", "A log-in method was removed", "A way to log in was just removed from your Bhakti Nam Jap account ({{ .Email }}).");
notice("mfa_factor_enrolled_notification", "A verification method was added to your Bhakti Nam Jap account", "A verification method was added", "A new verification method was just added to your Bhakti Nam Jap account ({{ .Email }}).");
notice("mfa_factor_unenrolled_notification", "A verification method was removed from your Bhakti Nam Jap account", "A verification method was removed", "A verification method was just removed from your Bhakti Nam Jap account ({{ .Email }}).");

const patch = {};
for (const [key, [subject, html]] of Object.entries(T)) {
  patch[`mailer_subjects_${key}`] = subject;
  patch[`mailer_templates_${key}_content`] = html;
  writeFileSync(join(out, `${key}.html`), html);
}
writeFileSync(join(out, "patch.json"), JSON.stringify(patch, null, 1));
console.log(Object.keys(T).length, "templates");
