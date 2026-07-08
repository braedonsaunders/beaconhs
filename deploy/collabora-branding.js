/* BeaconHS Collabora branding.
 *
 * Mounted over /usr/share/coolwsd/browser/dist/branding.js (the stock CODE
 * hook, preserved below). cool.html loads this file after every stylesheet,
 * so the injected rules win the cascade — the editor chrome follows the
 * BeaconHS theme exactly: white header + slate text in light mode, the app's
 * slate-900 header in dark mode, teal accents everywhere (replacing the
 * per-app tint that `--doc-type` normally carries).
 */

/* --- BeaconHS theme ------------------------------------------------------ */
;(function () {
  var TEAL_RGB = '13, 148, 136' /* app accent #0d9488 */

  var style = document.createElement('style')
  style.id = 'beaconhs-brand'
  style.textContent = [
    /* Accents (selected tab underline, selection handles, focus rings). */
    ':root, [data-doctype] {',
    '  --doc-type: ' + TEAL_RGB + ' !important;',
    '  --co-primary-element: #0d9488;',
    '  --co-primary-element-light: #14b8a6;',
    '}',
    /* Light mode: white header + slate text, matching the app chrome. */
    'html:not([data-theme=dark]) {',
    '  --co-color-text-nb-tab: #334155;',
    '  --co-color-bg-nb-tab: rgba(15, 23, 42, 0.06);',
    '}',
    'html:not([data-theme=dark]) .main-nav {',
    '  background-color: #ffffff !important;',
    '  box-shadow: inset 0 -1px 0 #e2e8f0;',
    '}',
    'html:not([data-theme=dark]) .main-nav #document-name-input,',
    'html:not([data-theme=dark]) .main-nav #document-name-input.editable:not(:focus) {',
    '  color: #0f172a !important;',
    '}',
    'html:not([data-theme=dark]) .main-nav #save.saving::after,',
    'html:not([data-theme=dark]) .main-nav #save.saved::after {',
    '  color: #475569 !important;',
    '}',
    /* Dark mode: the app header dark (slate-900). */
    'html[data-theme=dark] .main-nav {',
    '  background-color: #0f172a !important;',
    '  box-shadow: inset 0 -1px 0 #1e293b;',
    '}',
  ].join('\n')
  document.head.appendChild(style)

  // The tint variable is (re)declared on elements deeper than :root while the
  // UI boots, so stylesheet overrides alone lose the cascade. Inline
  // `!important` on the elements themselves always wins; a MutationObserver
  // catches the header/doctype nodes whenever the UI creates them.
  function apply() {
    var targets = [document.documentElement, document.body].concat(
      Array.prototype.slice.call(document.querySelectorAll('[data-doctype], .main-nav')),
    )
    targets.forEach(function (el) {
      if (el && el.style && el.style.getPropertyValue('--doc-type') !== TEAL_RGB) {
        el.style.setProperty('--doc-type', TEAL_RGB, 'important')
      }
    })
  }
  apply()
  new MutationObserver(function () {
    apply()
  }).observe(document.documentElement, { childList: true, subtree: true })
})()

/* --- Stock CODE branding hook (unchanged) -------------------------------- */

var brandProductName = 'Collabora Online Development Edition (CODE)'
var brandProductURL = 'https://www.collaboraonline.com/code/'
var brandProductFAQURL = 'https://www.collaboraonline.com/code/#code-scalability'
var menuItems
window.onload = function () {
  // wait until the menu (and particularly the document-header) actually exists
  function setLogo() {
    var logoHeader = document.getElementById('document-header')
    var logo = logoHeader && document.querySelector('#document-header > a')
    if (!logo) {
      // the logo does not exist in the menu yet, re-try in 250ms
      setTimeout(setLogo, 250)
    } else {
      logo.setAttribute('data-cooltip', brandProductName)
      logo.setAttribute('href', brandProductURL)

      menuItems = document.querySelectorAll('#main-menu > li > a')
    }
  }
  function setAboutImg() {
    var lk = document.getElementById('lokit-version')
    var aboutDialog = document.getElementById('about-dialog-info')
    if (!lk || !aboutDialog) {
      setTimeout(setAboutImg, 250)
    } else {
      var div = document.createElement('div')
      div.style.marginInlineEnd = 'auto'
      div.id = 'lokit-extra'

      let span = document.createElement('span')
      span.setAttribute('dir', 'ltr')
      span.textContent = 'built on '

      let anchor = document.createElement('a')
      anchor.href = 'https://col.la/lot'
      anchor.setAttribute('target', '_blank')
      anchor.textContent = 'a great technology base'

      div.appendChild(span)
      div.appendChild(anchor)
      lk.parentNode.parentNode.insertBefore(div, lk.parentNode)
    }
  }

  setLogo()
  setAboutImg()
}

document.onkeyup = function (e) {
  if (e.altKey && e.shiftKey && menuItems) {
    menuItems.forEach(function (menuItem) {
      menuItem.style.setProperty('text-decoration', 'underline', 'important')
    })
  }
}
