// Training wallet card — true credit-card size (CR80: 3.375 × 2.125 in).
//
// Two-sided ID-style card printed as two pages at exact card dimensions so
// the PDF can go straight to a card printer or be cut from a sheet.
//
//   Front: brand band (tenant gradient + logo), portrait photo (or initials
//          tile), holder name + employee no, credential name/code, issue +
//          expiry dates, miniature rosette seal.
//   Back:  dark brand field with security lattice, QR verify tile, verify
//          URL + token, issuer line, tamper notice + card id.
//
// Same generalized input as the certificate: variant 'completion' (course)
// or 'qualification' (skill, with issuing authority).

import { credentialFontFaces } from './fonts'
import {
  type CredentialDesignOptions,
  esc,
  formatDateShort,
  initialsOf,
  normalizeCredentialDesignOptions,
  patternOpacity,
  rgba,
  ringLattice,
  sealSvg,
  shade,
  tint,
} from './credential-theme'

export type WalletRenderInput = {
  tenantName: string
  tenantLogoUrl?: string
  primaryColor?: string
  variant?: 'completion' | 'qualification'
  recipient: {
    fullName: string
    employeeNo?: string | null
    photoUrl?: string | null
  }
  credential: {
    name: string
    code?: string | null
  }
  authorityName?: string | null
  completedOn: string
  expiresOn?: string | null
  verifyUrl?: string
  verifyToken?: string
  qrDataUrl?: string
  cardId?: string
  design?: CredentialDesignOptions
}

export function renderWalletHtml(input: WalletRenderInput): string {
  const variant = input.variant ?? 'completion'
  const design = normalizeCredentialDesignOptions(
    { ...input.design, format: 'wallet' },
    input.primaryColor,
  )
  const primary = design.primary
  const accent = design.accent
  const paper = design.paper
  const primaryDark = shade(primary, 0.42)
  const ink = shade(primary, 0.62)
  const latticeOpacity = patternOpacity(design.patternStrength, 0.07)
  const bodyFont =
    design.typeface === 'technical'
      ? "ui-monospace, 'SF Mono', Menlo, monospace"
      : design.typeface === 'classic'
        ? "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
        : "'Archivo', 'Helvetica Neue', Arial, sans-serif"
  const utilityFont =
    design.typeface === 'technical'
      ? "ui-monospace, 'SF Mono', Menlo, monospace"
      : "'Archivo', 'Helvetica Neue', Arial, sans-serif"

  const verifyUrl = input.verifyUrl ?? ''
  const verifyShort = verifyUrl.replace(/^https?:\/\//, '').slice(0, 64)
  const cardIdShort = input.cardId ? input.cardId.slice(0, 8).toUpperCase() : null

  const tag = variant === 'qualification' ? 'Skill Credential' : 'Training Credential'
  const name = input.recipient.fullName
  const nameSize = name.length > 24 ? 8.5 : name.length > 18 ? 9.5 : 10.5

  const miniSeal = sealSvg({
    initials: initialsOf(input.tenantName, 2),
    ribbon: primary,
    size: 34,
    showRibbons: false,
  })

  return `
  <style>
    ${credentialFontFaces}
    @page { size: 3.375in 2.125in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ${bodyFont};
      color: ${ink};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .card {
      width: 3.375in;
      height: 2.125in;
      position: relative;
      overflow: hidden;
      page-break-after: always;
    }
    .card:last-child { page-break-after: auto; }

    /* ---------- Front ---------- */
    .card.front { background: ${paper}; }
    .front .band {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 0.56in;
      background: linear-gradient(118deg, ${primary} 0%, ${primaryDark} 78%);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 0.13in;
    }
    .front .band::after {
      content: '';
      position: absolute;
      left: 0; right: 0; bottom: -2px;
      height: 2px;
      background: linear-gradient(90deg, ${tint(accent, 0.35)}, ${accent} 46%, ${shade(accent, 0.18)});
    }
    .band .brand { min-width: 0; }
    .band .tenant {
      font-size: 7pt;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .band .tag {
      margin-top: 1.5px;
      font-size: 4.8pt;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.72);
    }
    .band .logo-chip {
      flex-shrink: 0;
      margin-left: 6px;
      background: #ffffff;
      border-radius: 3px;
      padding: 2px 5px;
      max-width: 0.95in;
    }
    .band .logo-chip img { max-height: 0.22in; max-width: 0.85in; display: block; object-fit: contain; }

    .front .lattice {
      position: absolute;
      inset: 0.56in 0 0 0;
      background: ${design.patternStrength ? ringLattice(primary, patternOpacity(design.patternStrength, 0.052)) : 'none'};
      background-size: 120px 120px;
    }

    .front .photo {
      position: absolute;
      top: 0.36in;
      left: 0.13in;
      width: 0.68in;
      height: 0.85in;
      border-radius: 5px;
      border: 2px solid #ffffff;
      box-shadow: 0 1.5px 5px rgba(15, 23, 42, 0.28);
      overflow: hidden;
      background: linear-gradient(135deg, ${tint(primary, 0.18)}, ${primaryDark});
    }
    .front .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .front .photo .initials {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17pt;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.92);
      letter-spacing: 0.04em;
    }

    .front .info {
      position: absolute;
      top: 0.64in;
      left: 0.93in;
      right: 0.13in;
    }
    .front.no-photo .info { left: 0.16in; top: 0.68in; }
    .info .name {
      font-size: ${nameSize}pt;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.05;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
    }
    .info .emp {
      margin-top: 1.5px;
      font-size: 5.4pt;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: #64748b;
      font-family: ${utilityFont};
    }
    .info .cred {
      margin-top: 0.055in;
      font-size: 7.2pt;
      font-weight: 600;
      color: #1e293b;
      line-height: 1.18;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .info .cred-meta {
      margin-top: 2.5px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .cred-meta .code {
      font-size: 5.2pt;
      font-weight: 600;
      font-family: ${utilityFont};
      color: ${primaryDark};
      border: 0.6px solid ${rgba(primary, 0.45)};
      border-radius: 2.5px;
      padding: 0.5px 3px;
      letter-spacing: 0.05em;
    }
    .cred-meta .authority {
      font-size: 5.2pt;
      font-weight: 500;
      color: #64748b;
      letter-spacing: 0.04em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .front .dates {
      position: absolute;
      left: 0.13in;
      right: 0.55in;
      bottom: 0.115in;
      display: flex;
      gap: 0.26in;
    }
    .dates .cell .label {
      font-size: 4.6pt;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: ${accent};
    }
    .dates .cell .value {
      margin-top: 1px;
      font-size: 6.8pt;
      font-weight: 700;
      color: #0f172a;
    }
    .front .mini-seal {
      position: absolute;
      right: 0.125in;
      bottom: 0.095in;
      opacity: 0.92;
    }

    /* ---------- Back ---------- */
    .card.back {
      background:
        radial-gradient(ellipse at 18% 0%, ${rgba(tint(primary, 0.25), 0.3)} 0%, rgba(0,0,0,0) 52%),
        ${design.patternStrength ? `${ringLattice('#ffffff', latticeOpacity)},` : ''}
        linear-gradient(150deg, ${primaryDark} 0%, ${shade(primary, 0.58)} 100%);
      background-size: auto, 120px 120px, auto;
      color: #ffffff;
      padding: 0.115in 0.14in;
      display: flex;
      flex-direction: column;
    }
    .back .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .back .head .tenant {
      font-size: 6.2pt;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.92);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .back .head .label {
      flex-shrink: 0;
      font-size: 4.8pt;
      font-weight: 600;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: ${tint(accent, 0.38)};
    }
    .back .head-rule {
      margin-top: 4px;
      height: 0.8px;
      background: linear-gradient(90deg, ${accent}, rgba(255,255,255,0.12));
    }

    .back .center {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0.13in;
      padding-top: 0.06in;
    }
    .back .center.no-qr {
      justify-content: center;
      padding: 0.13in 0.08in 0;
      text-align: center;
    }
    .back .qr-tile {
      flex-shrink: 0;
      width: 0.8in;
      height: 0.8in;
      background: #ffffff;
      border-radius: 6px;
      padding: 0.045in;
      box-shadow: 0 1.5px 5px rgba(0, 0, 0, 0.35);
    }
    .back .qr-tile img { width: 100%; height: 100%; display: block; }
    .back .qr-tile .blank {
      width: 100%;
      height: 100%;
      border: 1px dashed ${rgba(primary, 0.5)};
      border-radius: 3px;
    }
    .back .verify { flex: 1; min-width: 0; }
    .verify .scan {
      font-size: 6.4pt;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #ffffff;
    }
    .verify .url {
      margin-top: 2.5px;
      font-size: 5.6pt;
      line-height: 1.35;
      color: rgba(255, 255, 255, 0.82);
      word-break: break-all;
      font-family: ${utilityFont};
    }
    .verify .token-label {
      margin-top: 4.5px;
      font-size: 4.6pt;
      font-weight: 600;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.55);
    }
    .verify .token {
      margin-top: 1.5px;
      display: inline-block;
      font-size: 5.8pt;
      font-weight: 600;
      letter-spacing: 0.08em;
      font-family: ${utilityFont};
      color: ${tint(accent, 0.38)};
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      padding: 1.5px 5px;
    }

    .back .foot {
      border-top: 0.6px solid rgba(255, 255, 255, 0.22);
      padding-top: 4px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 8px;
    }
    .foot .issuer {
      min-width: 0;
      font-size: 4.9pt;
      line-height: 1.45;
      color: rgba(255, 255, 255, 0.72);
    }
    .foot .issuer .notice { color: rgba(255, 255, 255, 0.48); }
    .foot .card-id {
      flex-shrink: 0;
      font-size: 4.9pt;
      font-weight: 600;
      letter-spacing: 0.08em;
      font-family: ${utilityFont};
      color: rgba(255, 255, 255, 0.55);
    }

    .card.field-pass.front .band {
      height: 0.50in;
      background: linear-gradient(90deg, ${primary} 0%, ${shade(primary, 0.28)} 100%);
    }
    .card.field-pass.front .band .tag { display: none; }
    .card.field-pass.front .lattice { inset: 0.50in 0 0 0; }
    .card.field-pass.front .photo { top: 0.32in; border-radius: 2px; }
    .card.field-pass.front .mini-seal { opacity: 0.8; }
    .card.field-pass.back {
      background:
        ${design.patternStrength ? `${ringLattice('#ffffff', latticeOpacity)},` : ''}
        linear-gradient(135deg, ${primary} 0%, ${shade(primary, 0.5)} 100%);
    }

    .card.clean-authority.front .band {
      height: 0.42in;
      background: ${primary};
    }
    .card.clean-authority.front .lattice { opacity: 0.35; }
    .card.clean-authority.front .photo {
      top: 0.40in;
      border-radius: 7px;
      box-shadow: none;
      border-color: ${paper};
    }
    .card.clean-authority.front .info { top: 0.60in; }
    .card.clean-authority.front.no-photo .info { top: 0.58in; }
    .card.clean-authority.front .mini-seal { display: none; }
    .card.clean-authority.back {
      background:
        linear-gradient(180deg, ${primaryDark}, ${shade(primary, 0.7)});
    }
  </style>

  <div class="card front ${design.templateId} ${design.showPhoto ? '' : 'no-photo'}">
    <div class="lattice"></div>
    <div class="band">
      <div class="brand">
        <div class="tenant">${esc(input.tenantName)}</div>
        <div class="tag">${esc(tag)}</div>
      </div>
      ${input.tenantLogoUrl ? `<div class="logo-chip"><img src="${esc(input.tenantLogoUrl)}" alt=""/></div>` : ''}
    </div>
    ${
      design.showPhoto
        ? `<div class="photo">
      ${
        input.recipient.photoUrl
          ? `<img src="${esc(input.recipient.photoUrl)}" alt=""/>`
          : `<div class="initials">${esc(initialsOf(name, 2))}</div>`
      }
    </div>`
        : ''
    }
    <div class="info">
      <div class="name">${esc(name)}</div>
      ${input.recipient.employeeNo ? `<div class="emp">NO. ${esc(input.recipient.employeeNo)}</div>` : ''}
      <div class="cred">${esc(input.credential.name)}</div>
      <div class="cred-meta">
        ${input.credential.code ? `<span class="code">${esc(input.credential.code)}</span>` : ''}
        ${input.authorityName ? `<span class="authority">${esc(input.authorityName)}</span>` : ''}
      </div>
    </div>
    <div class="dates">
      <div class="cell">
        <div class="label">${variant === 'qualification' ? 'Granted' : 'Issued'}</div>
        <div class="value">${esc(formatDateShort(input.completedOn))}</div>
      </div>
      <div class="cell">
        <div class="label">Expires</div>
        <div class="value">${input.expiresOn ? esc(formatDateShort(input.expiresOn)) : 'No expiry'}</div>
      </div>
    </div>
    ${design.showSeal ? `<div class="mini-seal">${miniSeal}</div>` : ''}
  </div>

  <div class="card back ${design.templateId}">
    <div class="head">
      <div class="tenant">${esc(input.tenantName)}</div>
      <div class="label">Credential Verification</div>
    </div>
    <div class="head-rule"></div>
    <div class="center ${design.showQr ? '' : 'no-qr'}">
      ${
        design.showQr
          ? `<div class="qr-tile">
        ${input.qrDataUrl ? `<img src="${esc(input.qrDataUrl)}" alt="QR"/>` : `<div class="blank"></div>`}
      </div>`
          : ''
      }
      <div class="verify">
        <div class="scan">${design.showQr ? 'Scan to verify' : 'Verify credential'}</div>
        ${verifyShort ? `<div class="url">${esc(verifyShort)}</div>` : ''}
        ${
          input.verifyToken
            ? `<div class="token-label">Verification token</div>
        <div class="token">${esc(input.verifyToken.slice(0, 20))}</div>`
            : ''
        }
      </div>
    </div>
    <div class="foot">
      <div class="issuer">
        Issued by ${esc(input.tenantName)}${input.authorityName ? ` · Authority: ${esc(input.authorityName)}` : ''}<br/>
        <span class="notice">This card remains property of the issuer. Tampering or alteration voids the credential.</span>
      </div>
      ${cardIdShort ? `<div class="card-id">ID ${esc(cardIdShort)}</div>` : ''}
    </div>
  </div>
  `
}
