// Training certificate (full size, 8.5×11 portrait).
//
// Classic completion certificate layout: tenant logo top-centre, double-rule
// border, italic serif headline, recipient + course block, signature line,
// QR code placeholder + verify URL footer.
//
// The renderer wraps the returned HTML in <html><head> and prints to PDF.

export type CertificateRenderInput = {
  tenantName: string
  tenantLogoUrl?: string
  primaryColor?: string
  recipient: {
    fullName: string
    employeeNo?: string | null
  }
  course: {
    code: string
    name: string
  }
  completedOn: string
  expiresOn?: string | null
  instructor?: string | null
  grade?: number | null
  verifyUrl?: string
  verifyToken?: string
  qrDataUrl?: string // optional pre-rendered QR PNG (data URL)
  generatedAt?: string | Date
}

export function renderCertificateHtml(input: CertificateRenderInput): string {
  const accent = input.primaryColor ?? '#b8860b' // dark goldenrod
  const verifyUrl = input.verifyUrl ?? ''
  const verifyShort = verifyUrl.replace(/^https?:\/\//, '').slice(0, 60)

  return `
  <style>
    :root { --accent: ${accent}; }
    @page { size: Letter portrait; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: "Garamond", "Hoefler Text", Georgia, "Times New Roman", serif;
      color: #2a2a2a;
      margin: 0;
      padding: 0;
    }
    .cert-outer {
      width: 8.5in;
      height: 11in;
      padding: 0.4in;
      position: relative;
    }
    .cert-inner {
      border: 6px double var(--accent);
      height: 100%;
      padding: 0.5in 0.7in;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background:
        radial-gradient(circle at 10% 10%, rgba(184,134,11,0.04), transparent 40%),
        radial-gradient(circle at 90% 90%, rgba(184,134,11,0.04), transparent 40%);
    }
    .corner {
      position: absolute;
      width: 36px;
      height: 36px;
      border: 2px solid var(--accent);
    }
    .corner.tl { top: 0.55in; left: 0.55in; border-right: 0; border-bottom: 0; }
    .corner.tr { top: 0.55in; right: 0.55in; border-left: 0; border-bottom: 0; }
    .corner.bl { bottom: 0.55in; left: 0.55in; border-right: 0; border-top: 0; }
    .corner.br { bottom: 0.55in; right: 0.55in; border-left: 0; border-top: 0; }
    .header { text-align: center; }
    .header img.logo { max-height: 70px; max-width: 240px; }
    .tenant-name {
      font-size: 14pt;
      color: #555;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-top: 6px;
    }
    .title {
      font-family: "Edwardian Script ITC", "Apple Chancery", "Brush Script MT", cursive;
      font-size: 50pt;
      color: var(--accent);
      text-align: center;
      margin: 0;
      line-height: 1;
    }
    .subtitle {
      text-align: center;
      font-size: 13pt;
      font-style: italic;
      color: #555;
      letter-spacing: 1px;
      margin-top: 6px;
    }
    .body {
      text-align: center;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 18px;
    }
    .body .presented {
      font-size: 13pt;
      font-style: italic;
      color: #444;
    }
    .body .recipient {
      font-family: "Garamond", "Hoefler Text", Georgia, serif;
      font-size: 36pt;
      font-weight: 600;
      color: #1a1a1a;
      border-bottom: 1px solid var(--accent);
      padding: 8px 60px 12px;
      display: inline-block;
      margin: 0 auto;
      letter-spacing: 1px;
    }
    .body .preface {
      font-size: 12pt;
      color: #444;
    }
    .body .course-name {
      font-size: 22pt;
      color: var(--accent);
      font-weight: 600;
      font-style: italic;
      letter-spacing: 0.5px;
    }
    .body .course-code {
      font-size: 11pt;
      color: #777;
      letter-spacing: 1px;
    }
    .dates {
      display: flex;
      justify-content: space-around;
      margin-top: 14px;
      font-size: 11pt;
    }
    .dates .label {
      text-transform: uppercase;
      letter-spacing: 1.5px;
      font-size: 8.5pt;
      color: #888;
      margin-bottom: 2px;
    }
    .dates .value {
      font-weight: 600;
      color: #222;
      font-size: 12pt;
    }
    .footer {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
    }
    .sig-block { flex: 1; }
    .sig-line {
      border-bottom: 1.5px solid #333;
      height: 26px;
    }
    .sig-label {
      text-align: center;
      font-size: 9pt;
      color: #555;
      padding-top: 4px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .qr-block {
      text-align: center;
      width: 130px;
    }
    .qr {
      width: 80px;
      height: 80px;
      margin: 0 auto;
      border: 1px solid #333;
      background: repeating-conic-gradient(#000 0% 25%, #fff 0% 50%) 50% / 6px 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qr img { width: 100%; height: 100%; }
    .qr-verify {
      font-size: 7pt;
      color: #555;
      margin-top: 4px;
      word-break: break-all;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
    }
    .qr-token { font-size: 7pt; color: #888; margin-top: 2px; font-family: ui-monospace, monospace; }
  </style>

  <div class="cert-outer">
    <div class="corner tl"></div>
    <div class="corner tr"></div>
    <div class="corner bl"></div>
    <div class="corner br"></div>

    <div class="cert-inner">
      <div>
        <div class="header">
          ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
          <div class="tenant-name">${esc(input.tenantName)}</div>
        </div>
        <h1 class="title">Certificate of Completion</h1>
        <div class="subtitle">— Awarded with distinction —</div>
      </div>

      <div class="body">
        <div class="presented">This is to certify that</div>
        <div>
          <div class="recipient">${esc(input.recipient.fullName)}</div>
        </div>
        <div class="preface">has successfully completed the requirements for</div>
        <div>
          <div class="course-name">${esc(input.course.name)}</div>
          <div class="course-code">Course code: ${esc(input.course.code)}</div>
        </div>
        <div class="dates">
          <div>
            <div class="label">Completed on</div>
            <div class="value">${esc(formatDate(input.completedOn))}</div>
          </div>
          ${
            input.expiresOn
              ? `
          <div>
            <div class="label">Expires on</div>
            <div class="value">${esc(formatDate(input.expiresOn))}</div>
          </div>`
              : ''
          }
          ${
            input.grade != null
              ? `
          <div>
            <div class="label">Grade</div>
            <div class="value">${input.grade}%</div>
          </div>`
              : ''
          }
        </div>
      </div>

      <div class="footer">
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-label">${esc(input.instructor ?? 'Instructor / Evaluator')}</div>
        </div>
        <div class="qr-block">
          <div class="qr">
            ${input.qrDataUrl ? `<img src="${esc(input.qrDataUrl)}" alt="QR"/>` : ''}
          </div>
          ${verifyShort ? `<div class="qr-verify">${esc(verifyShort)}</div>` : ''}
          ${input.verifyToken ? `<div class="qr-token">${esc(input.verifyToken.slice(0, 16))}</div>` : ''}
        </div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-label">Issued by ${esc(input.tenantName)}</div>
        </div>
      </div>
    </div>
  </div>
  `
}

function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
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
