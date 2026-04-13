/**
 * Plan AIQ — Cloudflare Worker
 * ══════════════════════════════════════════════════
 * wrangler.jsonc: run_worker_first: true
 * → Worker runs on EVERY request
 * → /api/send-email  → handles email sending
 * → /api/test        → diagnostic (GET in browser)
 * → everything else  → served from env.ASSETS
 * ══════════════════════════════════════════════════
 * Secrets set in Cloudflare Dashboard:
 *   RESEND_API_KEY, RECIPIENT_EMAIL, ALLOWED_ORIGIN
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

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGIN || '').trim();

  /* Allow exact match, www variant, and non-www variant */
  const isAllowed =
    !allowed ||                                                      /* no restriction set — allow all */
    origin === allowed ||
    origin === allowed.replace('https://', 'https://www.') ||
    origin === allowed.replace('https://www.', 'https://');

  return {
    'Access-Control-Allow-Origin' : isAllowed ? (origin || '*') : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type'                : 'application/json',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}

/* ══════════════════════════════════════════
   HTML EMAIL TEMPLATE
══════════════════════════════════════════ */
function buildHtml({ formType, name, email, phone, company, industry, message, timestamp }) {
  const isAudit   = formType === 'audit';
  const isConsult = formType === 'consultation';
  const badge     = isAudit ? 'FREE AUDIT REQUEST' : isConsult ? 'CONSULTATION REQUEST' : 'CONTACT FORM';
  const headline  = isAudit ? 'New Free Audit Request' : isConsult ? 'New Consultation Request' : 'New Message Received';
  const replySub  = encodeURIComponent(
    isAudit   ? 'Re: Your Free Audit Request - Plan AIQ' :
    isConsult ? 'Re: Your Consultation Request - Plan AIQ' :
                'Re: Your Message - Plan AIQ'
  );
  const RED = '#991818', GOLD = '#f59e0b';

  const fields = [
    { label: 'Name',     value: name    || '—' },
    { label: 'Email',    value: `<a href="mailto:${email}" style="color:${RED};font-weight:600;text-decoration:none;">${email}</a>` },
    { label: 'Phone',    value: phone   || '—' },
    { label: 'Company',  value: company || '—' },
    ...(industry ? [{ label: 'Industry', value: industry }] : []),
    { label: 'Message',  value: message ? message.replace(/\n/g, '<br>') : '—' },
    { label: 'Received', value: timestamp },
  ];

  const rows = fields.map(f => `
    <tr>
      <td style="width:110px;padding:11px 14px 11px 0;vertical-align:top;font-size:12px;
                 font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;white-space:nowrap;">${f.label}</td>
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
  style="max-width:580px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,.10);">
  <tr><td style="background:${RED};padding:32px 36px 26px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em;">Plan<span style="color:${GOLD};">AIQ</span></span>
          <span style="font-size:10px;color:rgba(255,255,255,.45);margin-left:8px;letter-spacing:.08em;text-transform:uppercase;">Business Intelligence</span></td>
      <td align="right"><span style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);
          color:#fff;font-size:9px;font-weight:700;letter-spacing:.12em;padding:4px 11px;border-radius:20px;">${badge}</span></td>
    </tr></table>
    <p style="margin:18px 0 0;font-size:24px;font-weight:300;color:#fff;line-height:1.25;letter-spacing:-.02em;">${headline}</p>
    <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,.50);">Submitted via planaiq.co &nbsp;·&nbsp; ${timestamp}</p>
  </td></tr>
  <tr><td style="background:#fef3c7;padding:12px 36px;border-bottom:1px solid #fde68a;">
    <p style="margin:0;font-size:12px;color:#92400e;font-weight:600;">Action required — reply within 12 hours to secure this lead</p>
  </td></tr>
  <tr><td style="padding:26px 36px 18px;">
    <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af;">Submission Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
  </td></tr>
  <tr><td style="padding:6px 36px 32px;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:${RED};border-radius:7px;box-shadow:0 3px 12px rgba(153,24,24,.28);">
        <a href="mailto:${email}?subject=${replySub}"
           style="display:inline-block;padding:12px 26px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;">
          Reply to ${name} &rarr;</a>
      </td>
    </tr></table>
    <p style="margin:10px 0 0;font-size:11px;color:#9ca3af;">Direct email: <a href="mailto:${email}" style="color:${RED};">${email}</a></p>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:16px 36px;border-top:1px solid #e5e7eb;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:10px;color:#9ca3af;line-height:1.5;">
        Sent automatically from your Plan AIQ website form.<br/>Use the reply button above — do not reply to this message.
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
    `Received:  ${timestamp}`,
    '─'.repeat(44),
    `Reply to: ${email}`,
    'Sent automatically from planaiq.co',
  ].join('\n');
}

/* ══════════════════════════════════════════
   MAIN HANDLER
   run_worker_first: true → this runs on
   every single request before assets
══════════════════════════════════════════ */
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const hdrs   = corsHeaders(env, origin);

    /* ── /api/test — diagnostic, works with GET in browser ── */
    if (url.pathname === '/api/test') {
      return new Response(JSON.stringify({
        worker        : 'RUNNING ✓',
        resend_key_set: !!env.RESEND_API_KEY,
        recipient_set : !!env.RECIPIENT_EMAIL,
        origin_set    : !!env.ALLOWED_ORIGIN,
        allowed_origin: env.ALLOWED_ORIGIN || 'NOT SET — add in Cloudflare → Worker → Settings → Variables',
        request_origin: origin || 'direct browser visit',
        timestamp     : new Date().toISOString(),
        next_step     : env.RESEND_API_KEY ? 'Secrets look good — try submitting the form' : 'RESEND_API_KEY is missing — add it in Cloudflare → Worker → Settings → Variables and Secrets',
      }, null, 2), {
        status : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    /* ── All non-API requests → serve static assets ── */
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    /* ── /api/send-email ── */

    /* OPTIONS preflight */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: hdrs });
    }

    /* POST only */
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed.' }, 405, hdrs);
    }

    /* Secrets check */
    if (!env.RESEND_API_KEY) {
      return json({
        ok   : false,
        error: 'RESEND_API_KEY not set — go to Cloudflare → Workers & Pages → planaiq → Settings → Variables and Secrets → add it',
      }, 500, hdrs);
    }

    /* Rate limit */
    const ip = request.headers.get('CF-Connecting-IP')
            || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
            || 'unknown';
    if (isRateLimited(ip)) {
      return json({ ok: false, error: 'Too many submissions. Please try again in 15 minutes.' }, 429, hdrs);
    }

    /* Parse body */
    let body;
    try { body = await request.json(); }
    catch (_) { return json({ ok: false, error: 'Invalid request body.' }, 400, hdrs); }

    const { formType = 'general', name, email, phone, company, industry, message } = body;

    const cleanName     = clean(name);
    const cleanEmail    = clean(email);
    const cleanPhone    = clean(phone);
    const cleanCompany  = clean(company);
    const cleanIndustry = clean(industry);
    const cleanMessage  = clean(message);

    if (!cleanName)
      return json({ ok: false, error: 'Name is required.' }, 400, hdrs);
    if (!cleanEmail || !validEmail(cleanEmail))
      return json({ ok: false, error: 'A valid email address is required.' }, 400, hdrs);

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

    /* Call Resend */
    let resendRes, resendBody;
    try {
      resendRes = await fetch('https://api.resend.com/emails', {
        method : 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type' : 'application/json',
        },
        body: JSON.stringify({
          from    : 'Plan AIQ <onboarding@resend.dev>',
          to      : [env.RECIPIENT_EMAIL || 'infoplanaiq@gmail.com'],
          reply_to: [cleanEmail],
          subject,
          html    : buildHtml(data),
          text    : buildText(data),
        }),
      });
      resendBody = await resendRes.json().catch(() => ({}));
    } catch (err) {
      return json({ ok: false, error: `Network error reaching Resend: ${err.message}` }, 500, hdrs);
    }

    if (!resendRes.ok) {
      const detail = resendBody?.message || resendBody?.name || JSON.stringify(resendBody);
      return json({
        ok   : false,
        error: `Resend rejected the request (${resendRes.status}): ${detail}`,
      }, 500, hdrs);
    }

    return json({ ok: true, message: 'Email sent successfully.' }, 200, hdrs);
  },
};
