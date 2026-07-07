/* BeaconHS Collabora branding.
 *
 * Mounted over /usr/share/coolwsd/browser/dist/branding.js (the stock CODE
 * hook, preserved below). cool.html loads this file after every stylesheet,
 * so the injected rules win the cascade — used to swap Collabora's per-app
 * header tint (burnt orange for presentations, `--doc-type` RGB triplet) for
 * the BeaconHS navy so the embedded editor feels native to the app.
 */

/* --- BeaconHS theme ------------------------------------------------------ */
;(function () {
	var NAVY_RGB = '27, 43, 74'; /* #1B2B4A */

	var style = document.createElement('style');
	style.id = 'beaconhs-brand';
	style.textContent = [
		':root, [data-doctype] {',
		'  --doc-type: ' + NAVY_RGB + ' !important;',
		'  --co-primary-element: #1B2B4A;',
		'  --co-primary-element-light: #33476B;',
		'}',
	].join('\n');
	document.head.appendChild(style);

	// The tint variable is (re)declared on elements deeper than :root while the
	// UI boots, so stylesheet overrides alone lose the cascade. Inline
	// `!important` on the elements themselves always wins; a MutationObserver
	// catches the header/doctype nodes whenever the UI creates them.
	function apply() {
		var targets = [document.documentElement, document.body].concat(
			Array.prototype.slice.call(document.querySelectorAll('[data-doctype], .main-nav'))
		);
		targets.forEach(function (el) {
			if (el && el.style && el.style.getPropertyValue('--doc-type') !== NAVY_RGB) {
				el.style.setProperty('--doc-type', NAVY_RGB, 'important');
			}
		});
	}
	apply();
	new MutationObserver(function () {
		apply();
	}).observe(document.documentElement, { childList: true, subtree: true });
})();

/* --- Stock CODE branding hook (unchanged) -------------------------------- */

var brandProductName = 'Collabora Online Development Edition (CODE)';
var brandProductURL = 'https://www.collaboraonline.com/code/';
var brandProductFAQURL = 'https://www.collaboraonline.com/code/#code-scalability';
var menuItems;
window.onload = function() {
	// wait until the menu (and particularly the document-header) actually exists
	function setLogo() {
		var logoHeader = document.getElementById('document-header');
		var logo = logoHeader && document.querySelector('#document-header > a');
		if (!logo) {
			// the logo does not exist in the menu yet, re-try in 250ms
			setTimeout(setLogo, 250);
		} else {
			logo.setAttribute('data-cooltip', brandProductName);
			logo.setAttribute('href', brandProductURL);

			menuItems = document.querySelectorAll('#main-menu > li > a');
		}
	}
	function setAboutImg() {
		var lk = document.getElementById('lokit-version');
		var aboutDialog = document.getElementById('about-dialog-info');
		if (!lk || !aboutDialog) {
			setTimeout(setAboutImg, 250);
		} else {
			var div = document.createElement('div');
			div.style.marginInlineEnd = 'auto';
			div.id = 'lokit-extra';

			let span = document.createElement('span');
			span.setAttribute('dir', 'ltr');
			span.textContent = 'built on ';

			let anchor = document.createElement('a');
			anchor.href = 'https://col.la/lot';
			anchor.setAttribute('target', '_blank');
			anchor.textContent = 'a great technology base';

			div.appendChild(span);
			div.appendChild(anchor);
			lk.parentNode.parentNode.insertBefore(div, lk.parentNode);
		}
	}

	setLogo();
	setAboutImg();
}

document.onkeyup = function(e) {
	if (e.altKey && e.shiftKey && menuItems) {
		menuItems.forEach(function(menuItem) {
		  menuItem.style.setProperty('text-decoration', 'underline', 'important');
		});
	}
};
