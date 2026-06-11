// Training credential certificate — full page, 11×8.5in landscape.
//
// Engraved-certificate design: parchment field over an interlocking-ring
// security lattice, triple rule-and-gilt frame with filigree corners, tenant
// branding up top, calligraphic recipient name, gold rosette seal between the
// signature blocks, and a QR + verify-token block for authenticity.
//
// One template serves both credential paths:
//   variant 'completion'    — course completion (training records)
//   variant 'qualification' — externally-authorised skill (skill assignments)
//
// Typography is embedded (Cormorant Garamond / Great Vibes / Archivo) so the
// output is pixel-identical in every render environment.
//
// The renderer wraps the returned HTML in <html><head> and prints to PDF.

import { credentialFontFaces } from './fonts'
import {
  GOLD,
  esc,
  formatDateLong,
  initialsOf,
  mix,
  rgba,
  ringLattice,
  safeColor,
  sealSvg,
  shade,
} from './credential-theme'

export type CertificateRenderInput = {
  tenantName: string
  tenantLogoUrl?: string
  primaryColor?: string
  // 'completion' (course certificate, default) or 'qualification' (skill).
  variant?: 'completion' | 'qualification'
  recipient: {
    fullName: string
    employeeNo?: string | null
  }
  credential: {
    name: string
    code?: string | null
  }
  // Issuing authority for skills (e.g. "Boilermakers Local 128").
  authorityName?: string | null
  completedOn: string
  expiresOn?: string | null
  instructor?: string | null
  grade?: number | null
  verifyUrl?: string
  verifyToken?: string
  qrDataUrl?: string // pre-rendered QR PNG (data URL); omitted → no QR block
  certificateId?: string
  generatedAt?: string | Date
}

export function renderCertificateHtml(input: CertificateRenderInput): string {
  const variant = input.variant ?? 'completion'
  const primary = safeColor(input.primaryColor, '#1f3a5f')
  const ink = shade(primary, 0.55)
  const inkSoft = mix(ink, '#445', 0.35)
  const parchment = '#fdfcf7'

  const verifyUrl = input.verifyUrl ?? ''
  const verifyShort = verifyUrl.replace(/^https?:\/\//, '').slice(0, 70)

  const name = input.recipient.fullName
  // Calligraphic names must never wrap or kiss the frame — step the size
  // down as the name gets longer.
  const nameSize = name.length > 34 ? 30 : name.length > 26 ? 37 : 46
  const credName = input.credential.name
  const credSize = credName.length > 58 ? 17 : credName.length > 38 ? 20 : 25

  const subTitle = variant === 'qualification' ? 'OF QUALIFICATION' : 'OF COMPLETION'
  const preface =
    variant === 'qualification'
      ? 'has demonstrated the required competency and is hereby certified in'
      : 'has successfully completed all requirements for'

  const credMetaParts: string[] = []
  if (input.credential.code) {
    credMetaParts.push(
      `${variant === 'qualification' ? 'Credential' : 'Course'} code ${input.credential.code}`,
    )
  }
  if (input.authorityName) credMetaParts.push(`Under the authority of ${input.authorityName}`)

  const metaCells: { label: string; value: string }[] = [
    {
      label: variant === 'qualification' ? 'Granted on' : 'Completed on',
      value: formatDateLong(input.completedOn),
    },
  ]
  if (input.expiresOn)
    metaCells.push({ label: 'Valid until', value: formatDateLong(input.expiresOn) })
  if (input.grade != null) metaCells.push({ label: 'Final grade', value: `${input.grade}%` })

  const sigLeftLabel =
    input.instructor ??
    (variant === 'qualification' ? 'Evaluator / Authority' : 'Instructor / Evaluator')

  const microParts: string[] = []
  if (verifyShort) microParts.push(`Verify at ${verifyShort}`)
  if (input.verifyToken) microParts.push(`Token ${input.verifyToken.slice(0, 16)}`)
  if (input.certificateId)
    microParts.push(`Certificate ${input.certificateId.slice(0, 8).toUpperCase()}`)
  if (microParts.length === 0 && input.generatedAt)
    microParts.push(`Generated ${formatDateLong(input.generatedAt)}`)

  const seal = sealSvg({
    initials: initialsOf(input.tenantName, 2),
    ribbon: primary,
    inscription: variant === 'qualification' ? 'CERTIFIED · QUALIFIED' : 'CERTIFIED · AUTHENTIC',
    size: 118,
  })
  const watermark = sealSvg({
    initials: initialsOf(input.tenantName, 2),
    ribbon: primary,
    size: 360,
    showRibbons: false,
  })

  const corner = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 63 V16 Q3 3 16 3 H63" fill="none" stroke="${GOLD.mid}" stroke-width="2.4"/>
    <path d="M9.5 63 V19 Q9.5 9.5 19 9.5 H63" fill="none" stroke="${ink}" stroke-width="0.9" opacity="0.55"/>
    <path d="M16 16 l4.6 -4.6 4.6 4.6 -4.6 4.6 Z" fill="${GOLD.deep}"/>
  </svg>`

  return `
  <style>
    ${credentialFontFaces}
    :root { --primary: ${primary}; --ink: ${ink}; --gold: ${GOLD.mid}; --gold-deep: ${GOLD.deep}; }
    @page { size: 11in 8.5in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
      color: ${ink};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 11in;
      height: 8.5in;
      position: relative;
      overflow: hidden;
      background:
        radial-gradient(ellipse at 50% 42%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 58%),
        radial-gradient(ellipse at 0% 0%, ${rgba(primary, 0.05)} 0%, rgba(0,0,0,0) 42%),
        radial-gradient(ellipse at 100% 100%, ${rgba(primary, 0.05)} 0%, rgba(0,0,0,0) 42%),
        ${ringLattice(ink, 0.05)},
        ${parchment};
      background-size: auto, auto, auto, 120px 120px, auto;
    }
    /* Triple frame: gilt band between two engraved rules. */
    .frame-outer { position: absolute; inset: 0.26in; border: 2.6px solid ${ink}; }
    .frame-gold  { position: absolute; inset: 0.335in; border: 1.4px solid ${GOLD.mid}; }
    .frame-hair  { position: absolute; inset: 0.40in; border: 0.6px solid ${rgba(ink, 0.38)}; }
    .corner { position: absolute; width: 0.62in; height: 0.62in; }
    .corner.tl { top: 0.33in; left: 0.33in; }
    .corner.tr { top: 0.33in; right: 0.33in; transform: rotate(90deg); }
    .corner.br { bottom: 0.33in; right: 0.33in; transform: rotate(180deg); }
    .corner.bl { bottom: 0.33in; left: 0.33in; transform: rotate(270deg); }
    .watermark {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -54%);
      opacity: 0.05;
      filter: grayscale(1);
    }
    .content {
      position: absolute;
      inset: 0.58in 0.78in 0.50in;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .brand { display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .brand img.logo { max-height: 0.48in; max-width: 2.6in; object-fit: contain; }
    .tenant-name {
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 12pt;
      font-weight: 600;
      letter-spacing: 0.32em;
      text-indent: 0.32em; /* recentre letterspaced caps */
      text-transform: uppercase;
      color: ${inkSoft};
    }
    .rule-diamond { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
    .rule-diamond .line { width: 1.15in; height: 1px; background: ${GOLD.mid}; }
    .rule-diamond .dot { width: 5px; height: 5px; background: ${GOLD.deep}; transform: rotate(45deg); }

    .title {
      margin-top: 0.16in;
      font-size: 44pt;
      font-weight: 700;
      letter-spacing: 0.17em;
      text-indent: 0.17em;
      color: ${ink};
      line-height: 1;
    }
    .subtitle {
      margin-top: 0.075in;
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 10.5pt;
      font-weight: 500;
      letter-spacing: 0.46em;
      text-indent: 0.46em;
      color: ${GOLD.deep};
    }
    .subtitle .line { width: 0.62in; height: 0.8px; background: ${rgba(GOLD.deep, 0.65)}; }

    .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; }
    .certify { font-style: italic; font-size: 13.5pt; color: ${inkSoft}; }
    .recipient {
      font-family: 'Great Vibes', 'Apple Chancery', cursive;
      font-size: ${nameSize}pt;
      color: ${shade(primary, 0.35)};
      line-height: 1.12;
      margin-top: 0.04in;
      padding: 0 0.3in;
    }
    .recipient-rule { display: flex; align-items: center; gap: 8px; margin-top: 0.02in; }
    .recipient-rule .line { width: 2.1in; height: 1px; background: linear-gradient(90deg, rgba(0,0,0,0), ${GOLD.mid}, rgba(0,0,0,0)); }
    .recipient-rule .dot { width: 4px; height: 4px; background: ${GOLD.deep}; transform: rotate(45deg); }
    .employee-no {
      margin-top: 0.055in;
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 7.5pt;
      font-weight: 500;
      letter-spacing: 0.26em;
      text-indent: 0.26em;
      text-transform: uppercase;
      color: ${rgba(ink, 0.62)};
    }
    .preface { margin-top: 0.14in; font-style: italic; font-size: 12.5pt; color: ${inkSoft}; }
    .credential {
      margin-top: 0.055in;
      font-size: ${credSize}pt;
      font-weight: 600;
      color: ${shade(primary, 0.3)};
      line-height: 1.18;
      max-width: 8.6in;
    }
    .credential-meta {
      margin-top: 0.06in;
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 8pt;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-indent: 0.18em;
      text-transform: uppercase;
      color: ${rgba(ink, 0.6)};
    }

    .meta-row {
      margin-top: 0.17in;
      display: flex;
      align-items: stretch;
      justify-content: center;
    }
    .meta-cell { padding: 0 0.34in; }
    .meta-cell + .meta-cell { border-left: 0.8px solid ${rgba(ink, 0.28)}; }
    .meta-label {
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 7.5pt;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-indent: 0.22em;
      text-transform: uppercase;
      color: ${GOLD.deep};
    }
    .meta-value { margin-top: 3px; font-size: 14pt; font-weight: 600; color: ${ink}; }

    .footer {
      width: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.3in;
    }
    .sig-block { flex: 1; max-width: 2.7in; padding-bottom: 0.14in; }
    .sig-line { border-bottom: 1px solid ${rgba(ink, 0.75)}; height: 0.26in; }
    .sig-label {
      margin-top: 5px;
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 7.5pt;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-indent: 0.16em;
      text-transform: uppercase;
      color: ${rgba(ink, 0.65)};
      text-align: center;
    }
    .seal-block { flex-shrink: 0; }

    /* Verification QR rides the top-right corner — the only reliably empty
       region (the footer hosts signatures + seal, the centre is text). */
    .qr-corner {
      position: absolute;
      right: 0.56in;
      top: 0.52in;
      text-align: center;
      width: 0.86in;
    }
    .qr-corner img { width: 0.62in; height: 0.62in; display: block; margin: 0 auto; }
    .qr-corner .qr-label {
      margin-top: 3px;
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 5.4pt;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${rgba(ink, 0.6)};
    }
    .microline {
      margin-top: 0.07in;
      text-align: center;
      font-family: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
      font-size: 6.4pt;
      letter-spacing: 0.06em;
      color: ${rgba(ink, 0.55)};
    }
  </style>

  <div class="page">
    <div class="watermark">${watermark}</div>
    <div class="frame-outer"></div>
    <div class="frame-gold"></div>
    <div class="frame-hair"></div>
    <div class="corner tl">${corner}</div>
    <div class="corner tr">${corner}</div>
    <div class="corner br">${corner}</div>
    <div class="corner bl">${corner}</div>

    <div class="content">
      <div class="brand">
        ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
        <div class="tenant-name">${esc(input.tenantName)}</div>
        <div class="rule-diamond"><div class="line"></div><div class="dot"></div><div class="line"></div></div>
      </div>

      <div class="title">CERTIFICATE</div>
      <div class="subtitle"><div class="line"></div>${esc(subTitle)}<div class="line"></div></div>

      <div class="body">
        <div class="certify">This is to certify that</div>
        <div class="recipient">${esc(name)}</div>
        <div class="recipient-rule"><div class="line"></div><div class="dot"></div><div class="line"></div></div>
        ${
          input.recipient.employeeNo
            ? `<div class="employee-no">Employee No. ${esc(input.recipient.employeeNo)}</div>`
            : ''
        }
        <div class="preface">${esc(preface)}</div>
        <div class="credential">${esc(credName)}</div>
        ${credMetaParts.length ? `<div class="credential-meta">${esc(credMetaParts.join('  ·  '))}</div>` : ''}
        <div class="meta-row">
          ${metaCells
            .map(
              (c) => `<div class="meta-cell">
            <div class="meta-label">${esc(c.label)}</div>
            <div class="meta-value">${esc(c.value)}</div>
          </div>`,
            )
            .join('')}
        </div>
      </div>

      <div class="footer">
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-label">${esc(sigLeftLabel)}</div>
        </div>
        <div class="seal-block">${seal}</div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-label">Issued by ${esc(input.tenantName)}</div>
        </div>
      </div>
      ${microParts.length ? `<div class="microline">${esc(microParts.join('   ·   '))}</div>` : ''}
    </div>

    ${
      input.qrDataUrl
        ? `<div class="qr-corner">
        <img src="${esc(input.qrDataUrl)}" alt="QR"/>
        <div class="qr-label">Scan to verify</div>
      </div>`
        : ''
    }
  </div>
  `
}
