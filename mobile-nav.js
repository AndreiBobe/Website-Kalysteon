/* ════════════════════════════════════════════════════════════════
   KALYSTEON — Mobile Navigation
   Clones the existing .header-nav of each page into a fullscreen
   overlay with accordion sub-menus. Keeps data-en/data-fr i18n so
   setLang() translates injected nodes too. No desktop impact.
   ════════════════════════════════════════════════════════════════ */
(function () {
  function copyLang(from, to) {
    if (from.hasAttribute('data-en')) to.setAttribute('data-en', from.getAttribute('data-en'));
    if (from.hasAttribute('data-fr')) to.setAttribute('data-fr', from.getAttribute('data-fr'));
  }

  function init() {
    var header = document.querySelector('header');
    var nav = document.querySelector('.header-nav');
    if (!header || !nav || document.querySelector('.mnav-toggle')) return;

    // Hamburger button
    var btn = document.createElement('button');
    btn.className = 'mnav-toggle';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    header.appendChild(btn);

    // Overlay
    var ov = document.createElement('div');
    ov.className = 'mnav-overlay';
    ov.innerHTML = '<button class="mnav-close" aria-label="Close">&times;</button><nav class="mnav-list"></nav>';
    document.body.appendChild(ov);
    var list = ov.querySelector('.mnav-list');

    // Build groups from existing pills
    nav.querySelectorAll('.nav-pill').forEach(function (pill) {
      var trigger = pill.querySelector('.nav-link');
      if (!trigger) return;
      var dd = pill.querySelector('.nav-dd-menu');

      var group = document.createElement('div');
      group.className = 'mnav-group';

      var row = document.createElement('div');
      row.className = 'mnav-row';

      var link = document.createElement('a');
      link.className = 'mnav-link';
      link.href = trigger.getAttribute('href') || '#';
      link.textContent = trigger.textContent.trim();
      copyLang(trigger, link);
      row.appendChild(link);

      var exp = null;
      if (dd) {
        exp = document.createElement('button');
        exp.className = 'mnav-exp';
        exp.setAttribute('aria-label', 'Expand');
        exp.setAttribute('aria-expanded', 'false');
        exp.innerHTML = '<span>+</span>';
        row.appendChild(exp);
      }
      group.appendChild(row);

      if (dd) {
        var sub = document.createElement('div');
        sub.className = 'mnav-sub';
        var wrap = document.createElement('div');
        var inner = document.createElement('div');
        inner.className = 'mnav-sub-inner';
        dd.querySelectorAll('.nav-dd-item').forEach(function (it) {
          var sa = document.createElement('a');
          sa.className = 'mnav-subitem';
          sa.href = it.getAttribute('href') || '#';
          sa.innerHTML = it.innerHTML; // keeps icon span + data-en/fr span
          inner.appendChild(sa);
        });
        wrap.appendChild(inner);
        sub.appendChild(wrap);
        group.appendChild(sub);

        exp.addEventListener('click', function () {
          var open = group.classList.toggle('open');
          exp.setAttribute('aria-expanded', String(open));
        });
      }
      list.appendChild(group);
    });

    // On real mobile widths, relocate secondary controls (currency +
    // language) into the overlay so the header isn't overcrowded. We move
    // (not clone) to keep inline handlers/state and avoid duplicate ids.
    // Skipped on desktop so the desktop header is never altered.
    if (window.matchMedia('(max-width: 768px)').matches) {
      var actions = document.createElement('div');
      actions.className = 'mnav-actions';
      var curr = document.querySelector('header .curr-toggle');
      var lang = document.querySelector('header .lang-toggle');
      if (curr) actions.appendChild(curr);
      if (lang) actions.appendChild(lang);
      if (actions.children.length) ov.insertBefore(actions, list);
    }

    function openMenu() {
      ov.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }
    function closeMenu() {
      ov.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    btn.addEventListener('click', openMenu);
    ov.querySelector('.mnav-close').addEventListener('click', closeMenu);
    list.addEventListener('click', function (e) {
      if (e.target.closest('a.mnav-link, a.mnav-subitem')) closeMenu();
    });
    ov.addEventListener('click', function (e) { if (e.target === ov) closeMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

    // Re-translate injected nodes
    if (typeof setLang === 'function') {
      setLang(localStorage.getItem('kalysteon-lang') || 'en');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
