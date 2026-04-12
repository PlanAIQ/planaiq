/**
 * Plan AIQ — Cloudflare Pages Function
 * Route: POST /api/send-email
 *
 * FIXES applied vs previous version:
 *   1. CORS: now sends correct headers on EVERY response including errors
 *   2. ENV check: returns clear error if RESEND_API_KEY is missing/empty
 *   3. Resend from address: uses onboarding@resend.dev (only verified sender on free plan)
 *   4. reply_to: changed to array format (Resend v2 API requirement)
 *   5. Error body: returns the actual Resend error text so you can see what went wrong
 *   6. Added /api/debug endpoint to check env vars are loaded (disable after testing)
 */

const RATE_MAX  = 5;
const RATE_MINS = 15;
const _store    = new Map();

function isRateLimited(ip) {
  const now  = Date.now();
  const win  = RATE_MINS * 60 * 1000;
  const hits = (_store.get(ip) || []).filter(t => now - t < win);
  if (hits.length >= RATE_MAX) return true;
  hits.push(now);
  _store.set(ip, hits);
  return false;
}

function clean(val, max = 2000) {
  if (typeof val !== 'string') return '';
  return val.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim().slice(0, max);
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* ── CORS headers helper — called on EVERY response ── */
function cors(env, request) {
  const allowed = (env && env.ALLOWED_ORIGIN) ? env.ALLOWED_ORIGIN : '*';
  const origin  = request ? (request.headers.get('Origin') || '') : '';
  const allow   = (allowed === '*' || origin === allowed) ? (allowed === '*' ? '*' : origin) : '';
  return {
    'Access-Control-Allow-Origin' : allow || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type'                : 'application/json',
  };
}

function ok(body, env, req, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(env, req) });
}

/* ══════════════════════════════════════════
   HTML EMAIL TEMPLATE
══════════════════════════════════════════ */
function buildHtml({ formType, name, email, phone, company, industry, message, timestamp, ip }) {
  const isAudit   = formType === 'audit';
  const isConsult = formType === 'consultation';
  const badge     = isAudit ? 'FREE AUDIT REQUEST' : isConsult ? 'CONSULTATION REQUEST' : 'CONTACT FORM';
  const headline  = isAudit ? 'New Free Audit Request' : isConsult ? 'New Consultation Request' : 'New Message Received';
  const replySub  = encodeURIComponent(isAudit ? 'Re: Your Free Audit Request — Plan AIQ'
                  : isConsult ? 'Re: Your Consultation Request — Plan AIQ'
                  : 'Re: Your Message — Plan AIQ');
  const RED = '#991818', GOLD = '#f59e0b';

  const fields = [
    { icon: '&#128100;', label: 'Name',     value: name    || '&mdash;' },
    { icon: '&#9993;',   label: 'Email',    value: `<a href="mailto:${email}" style="color:${RED};text-decoration:none;font-weight:600;">${email}</a>` },
    { icon: '&#128222;', label: 'Phone',    value: phone   || '&mdash;' },
    { icon: '&#127970;', label: 'Company',  value: company || '&mdash;' },
    ...(industry ? [{ icon: '&#127981;', label: 'Industry', value: industry }] : []),
    { icon: '&#128172;', label: 'Message',  value: message ? message.replace(/\n/g, '<br>') : '&mdash;' },
    { icon: '&#128336;', label: 'Received', value: timestamp },
  ];

  const rows = fields.map(f => `
    <tr>
      <td style="width:120px;padding:11px 14px 11px 0;vertical-align:top;font-size:12px;
                 font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;white-space:nowrap;">
        ${f.icon}&nbsp;${f.label}
      </td>
      <td style="padding:11px 0;vertical-align:top;font-size:13px;color:#111827;
                 line-height:1.65;border-bottom:1px solid #f3f4f6;">${f.value}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${headline}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:36px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" border="0"
  style="max-width:580px;width:100%;background:#fff;border-radius:14px;
         overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,.10);">
  <tr><td style="background:${RED};padding:32px 36px 26px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em;">
        Plan<span style="color:${GOLD};">AIQ</span></span>
        <span style="font-size:10px;color:rgba(255,255,255,.45);margin-left:8px;letter-spacing:.08em;text-transform:uppercase;">Business Intelligence</span>
      </td>
      <td align="right"><span style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);
        color:#fff;font-size:9px;font-weight:700;letter-spacing:.12em;padding:4px 11px;border-radius:20px;">
        ${badge}</span></td>
    </tr></table>
    <p style="margin:18px 0 0;font-size:24px;font-weight:300;color:#fff;line-height:1.25;letter-spacing:-.02em;">${headline}</p>
    <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,.50);">Submitted via planaiq.com &nbsp;·&nbsp; ${timestamp}</p>
  </td></tr>
  <tr><td style="background:#fef3c7;padding:12px 36px;border-bottom:1px solid #fde68a;">
    <p style="margin:0;font-size:12px;color:#92400e;font-weight:600;">&#9889;&nbsp; Action required — reply within 12 hours to secure this lead</p>
  </td></tr>
  <tr><td style="padding:26px 36px 18px;">
    <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af;">Submission Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
  </td></tr>
  <tr><td style="padding:6px 36px 32px;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:${RED};border-radius:7px;box-shadow:0 3px 12px rgba(153,24,24,.28);">
        <a href="mailto:${email}?subject=${replySub}"
           style="display:inline-block;padding:12px 26px;font-size:13px;font-weight:700;
                  color:#fff;text-decoration:none;">Reply to ${name} &rarr;</a>
      </td>
    </tr></table>
    <p style="margin:10px 0 0;font-size:11px;color:#9ca3af;">Direct email: <a href="mailto:${email}" style="color:${RED};">${email}</a></p>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:16px 36px;border-top:1px solid #e5e7eb;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:10px;color:#9ca3af;line-height:1.5;">
        Sent automatically from your Plan AIQ website form.<br/>
        Use the reply button above — do not reply to this message directly.
      </td>
      <td align="right" style="font-size:11px;color:#d1d5db;white-space:nowrap;padding-left:12px;">
        Plan<strong style="color:${GOLD};">AIQ</strong> &copy; ${new Date().getFullYear()}
      </td>
    </tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildText({ formType, name, email, phone, company, industry, message, timestamp }) {
  const type = formType === 'audit' ? 'FREE AUDIT REQUEST'
             : formType === 'consultation' ? 'CONSULTATION REQUEST' : 'CONTACT FORM';
  return [
    `PLAN AIQ — ${type}`,
    '─'.repeat(44),
    `Name:      ${name}`,
    `Email:     ${email}`,
    `Phone:     ${phone    || '—'}`,
    `Company:   ${company  || '—'}`,
    ...(industry ? [`Industry:  ${industry}`] : []),
    `Message:   ${message  || '—'}`,
    '',
    `Received:  ${timestamp}`,
    '',
    '─'.repeat(44),
    `Reply to: ${email}`,
    'Sent automatically from planaiq.com',
  ].join('\n');
}

/* ══════════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════════ */
export async function onRequestPost({ request, env }) {

  /* ── FIX 1: Check env vars are actually loaded ── */
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set in Cloudflare environment variables');
    return ok({
      ok: false,
      error: 'Server configuration error: RESEND_API_KEY not set. Please add it in Cloudflare Pages → Settings → Environment Variables, then redeploy.'
    }, env, request, 500);
  }

  /* ── Rate limit ── */
  const ip = request.headers.get('CF-Connecting-IP')
          || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
          || 'unknown';

  if (isRateLimited(ip))
    return ok({ ok: false, error: 'Too many submissions. Please try again in 15 minutes.' }, env, request, 429);

  /* ── Parse body ── */
  let body;
  try { body = await request.json(); }
  catch (_) { return ok({ ok: false, error: 'Invalid request body.' }, env, request, 400); }

  const { formType = 'general', name, email, phone, company, industry, message } = body;

  const cleanName     = clean(name);
  const cleanEmail    = clean(email);
  const cleanPhone    = clean(phone);
  const cleanCompany  = clean(company);
  const cleanIndustry = clean(industry);
  const cleanMessage  = clean(message);

  if (!cleanName)
    return ok({ ok: false, error: 'Name is required.' }, env, request, 400);
  if (!cleanEmail || !validEmail(cleanEmail))
    return ok({ ok: false, error: 'A valid email address is required.' }, env, request, 400);

  const isAudit   = formType === 'audit';
  const isConsult = formType === 'consultation';
  const subject   = isAudit   ? `Free Audit Request - ${cleanCompany || cleanName}`
                  : isConsult ? `Consultation Request - ${cleanName}`
                  : `Website Enquiry from ${cleanName}${cleanCompany ? ' - ' + cleanCompany : ''}`;

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Detroit',
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' ET';

  const data = {
    formType, name: cleanName, email: cleanEmail,
    phone: cleanPhone, company: cleanCompany,
    industry: cleanIndustry, message: cleanMessage,
    timestamp, ip,
  };

  /* ── FIX 2: Resend API call with corrected format ── */
  let resendResponse, resendBody;
  try {
    resendResponse = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        from    : 'Plan AIQ <onboarding@resend.dev>',          /* must use verified sender on free plan */
        to      : [env.RECIPIENT_EMAIL || 'infoplanaiq@gmail.com'],
        reply_to: [cleanEmail],                                 /* FIX: must be array in Resend v2 */
        subject,
        html    : buildHtml(data),
        text    : buildText(data),
      }),
    });

    resendBody = await resendResponse.json().catch(() => ({ raw: 'unparseable' }));

  } catch (fetchErr) {
    /* Network-level failure reaching Resend */
    console.error('Fetch to Resend failed:', fetchErr.message);
    return ok({
      ok: false,
      error: `Network error reaching Resend: ${fetchErr.message}`
    }, env, request, 500);
  }

  /* ── FIX 3: Return the actual Resend error so you can diagnose it ── */
  if (!resendResponse.ok) {
    const detail = resendBody?.message || resendBody?.name || JSON.stringify(resendBody);
    console.error('Resend rejected:', resendResponse.status, detail);
    return ok({
      ok: false,
      error: `Email delivery failed (${resendResponse.status}): ${detail}`
    }, env, request, 500);
  }

  console.log(`Email sent [${formType}] from ${cleanEmail} id=${resendBody?.id}`);
  return ok({ ok: true, message: 'Email sent successfully.' }, env, request, 200);
}

/* ── OPTIONS preflight ── */
export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: cors(env, request) });
}
