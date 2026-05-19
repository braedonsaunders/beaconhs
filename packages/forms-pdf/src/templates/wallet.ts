// Training wallet card — landscape 3.5" × 2".
//
// Two-sided ID-style card. Front: photo placeholder + name + course + expiry.
// Back: verify URL + QR placeholder. Rendered as two pages at the wallet
// dimensions so the worker can print one PDF containing both sides.

export type WalletRenderInput = {
  tenantName: string
  tenantLogoUrl?: string
  primaryColor?: string
  recipient: {
    fullName: string
    employeeNo?: string | null
    photoUrl?: string | null
  }
  course: {
    code: string
    name: string
  }
  completedOn: string
  expiresOn?: string | null
  verifyUrl?: string
  verifyToken?: string
  qrDataUrl?: string
}

export function renderWalletHtml(input: WalletRenderInput): string {
  const primary = input.primaryColor ?? '#1f3a5f'
  const verifyUrl = input.verifyUrl ?? ''
  const verifyShort = verifyUrl.replace(/^https?:\/\//, '').slice(0, 50)

  return `
  <style>
    :root { --primary: ${primary}; }
    @page { size: 3.5in 2in landscape; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1a1a1a; }
    .card {
      width: 3.5in;
      height: 2in;
      padding: 0.12in;
      page-break-after: always;
      display: flex;
      overflow: hidden;
      position: relative;
    }
    .card:last-child { page-break-after: auto; }
    /* Front */
    .card.front {
      background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
      border: 1.5px solid var(--primary);
    }
    .card.front .bar {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 8px;
      background: var(--primary);
    }
    .front .left {
      width: 0.85in;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin-right: 6px;
      padding-top: 12px;
    }
    .photo {
      width: 0.75in;
      height: 0.95in;
      border: 1px solid #999;
      background: #e5e7eb;
      object-fit: cover;
      overflow: hidden;
    }
    .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .photo.placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #777;
      font-size: 7pt;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .front .right {
      flex: 1;
      padding: 14px 4px 4px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .tenant {
      font-size: 7pt;
      font-weight: 700;
      color: var(--primary);
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .person-name {
      font-size: 11pt;
      font-weight: 700;
      color: #111;
      line-height: 1.1;
      margin-top: 2px;
    }
    .employee-no { font-size: 7.5pt; color: #666; margin-top: 1px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
    .course {
      font-size: 8pt;
      color: #444;
      margin-top: 6px;
      line-height: 1.2;
    }
    .course .code { color: #888; font-family: ui-monospace, monospace; font-size: 7pt; }
    .expiry {
      margin-top: 4px;
      font-size: 7.5pt;
      color: #555;
    }
    .expiry strong { color: var(--primary); }

    /* Back */
    .card.back {
      background: var(--primary);
      color: white;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.16in;
    }
    .back .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .back .header img {
      max-height: 18px;
      max-width: 0.9in;
      filter: brightness(0) invert(1);
    }
    .back .header .tenant {
      color: white;
      font-size: 7pt;
      letter-spacing: 1px;
    }
    .back .center {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .back .qr {
      width: 0.7in;
      height: 0.7in;
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .back .qr img { width: 100%; height: 100%; }
    .back .qr .placeholder {
      width: 90%; height: 90%;
      background: repeating-conic-gradient(#000 0% 25%, #fff 0% 50%) 50% / 5px 5px;
    }
    .back .info { flex: 1; font-size: 7.5pt; line-height: 1.3; }
    .back .info .label { text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; font-size: 6.5pt; }
    .back .info .value { font-weight: 600; word-break: break-all; }
    .back .footer { font-size: 6.5pt; opacity: 0.75; text-align: center; }
  </style>

  <div class="card front">
    <div class="bar"></div>
    <div class="left">
      ${input.recipient.photoUrl
        ? `<div class="photo"><img src="${esc(input.recipient.photoUrl)}" alt=""/></div>`
        : `<div class="photo placeholder">Photo</div>`}
    </div>
    <div class="right">
      <div>
        <div class="tenant">${esc(input.tenantName)}</div>
        <div class="person-name">${esc(input.recipient.fullName)}</div>
        ${input.recipient.employeeNo ? `<div class="employee-no">#${esc(input.recipient.employeeNo)}</div>` : ''}
        <div class="course">
          ${esc(input.course.name)}<br/>
          <span class="code">${esc(input.course.code)}</span>
        </div>
      </div>
      <div class="expiry">
        Issued <strong>${esc(formatDate(input.completedOn))}</strong>${input.expiresOn ? ` · Expires <strong>${esc(formatDate(input.expiresOn))}</strong>` : ''}
      </div>
    </div>
  </div>

  <div class="card back">
    <div class="header">
      ${input.tenantLogoUrl ? `<img src="${esc(input.tenantLogoUrl)}" alt=""/>` : `<span class="tenant">${esc(input.tenantName)}</span>`}
      <span class="tenant">Verify</span>
    </div>
    <div class="center">
      <div class="qr">
        ${input.qrDataUrl ? `<img src="${esc(input.qrDataUrl)}" alt="QR"/>` : `<div class="placeholder"></div>`}
      </div>
      <div class="info">
        <div class="label">Scan or visit</div>
        <div class="value">${esc(verifyShort)}</div>
        ${input.verifyToken ? `<div class="label" style="margin-top:4px;">Token</div><div class="value" style="font-family: ui-monospace, monospace; font-size: 6.5pt;">${esc(input.verifyToken.slice(0, 16))}</div>` : ''}
      </div>
    </div>
    <div class="footer">Tampering with this card invalidates the credential.</div>
  </div>
  `
}

function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
