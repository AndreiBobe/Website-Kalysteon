// Stratum, mode demo pour le site.
//
// Remplace le pont Python (eel.js) : l'interface est la vraie, mais chaque
// appel au "cerveau" recoit une reponse preparee (demo-data.js, genere par
// build_demo.py). Rien ne tourne : les actions reelles (run, fichiers,
// licence...) affichent un message qui invite a telecharger Stratum.
(function () {
  var DEMO = window.STRATUM_DEMO || {};
  // La demo demarre en anglais, quelle que soit la langue du site : le
  // visiteur change la langue dans Reglages, comme dans le vrai logiciel.
  var lang = "en";

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  var cfg = clone(DEMO.config) || {};
  // Avant le premier run, le dossier d'export est vide, comme pour un vrai
  // projet neuf : les montagnes arrivent a la fin du faux run. Les fenetres
  // de fonction (#library, #pipeline...) montrent directement le resultat.
  var ran = !!location.hash;
  var EMPTY_LIB = { assets: [], stats: { total: 0, by_project: {}, by_style: {}, by_format: {} } };
  cfg.ui = cfg.ui || {};
  cfg.ui.language = lang;

  function setPath(obj, path, value) {
    var parts = String(path).split(".");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  var TOAST = {
    en: "Demo: download Stratum to run this for real.",
    fr: "Démo : téléchargez Stratum pour le faire pour de vrai.",
  };
  var toastTimer = null;
  function demoToast() {
    var el = document.getElementById("demo-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-toast";
      el.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;"
        + "background:#051a1f;color:#5DEFD5;border:1px solid rgba(31,184,171,.45);border-radius:8px;"
        + "padding:9px 16px;font:12px/1.4 'IBM Plex Mono',monospace;letter-spacing:.04em;"
        + "box-shadow:0 12px 30px rgba(0,0,0,.5);pointer-events:none;transition:opacity .25s";
      document.body.appendChild(el);
    }
    el.textContent = TOAST[curLang()] || TOAST.en;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = "0"; }, 2400);
  }

  var H = {
    get_config: function () { return clone(cfg); },
    save_field: function (path, value) { setPath(cfg, path, value); return true; },
    app_info: function () {
      return { version: DEMO.version, name: "Stratum", theme: (cfg.ui || {}).theme || "dark",
               language: lang, frozen: true };
    },
    get_tier_limits: function () { return clone(DEMO.tier_limits); },
    list_builtin_hdas: function () { return clone(DEMO.hdas); },
    list_projects: function () { return clone(DEMO.projects); },
    current_project: function () { return DEMO.projects && DEMO.projects[0] ? DEMO.projects[0].slug : ""; },
    list_variants: function () { return clone(DEMO.variants); },
    list_stale: function () { return { ok: true, count: 0, variants: {}, stages: [] }; },
    list_assets: function () { return ran ? clone(DEMO.assets) : []; },
    list_library_assets: function () { return ran ? clone(DEMO.library) : clone(EMPTY_LIB); },
    preview_folder_summary: function () { var n = ran ? (DEMO.assets || []).length : 0; return { meshes: n, textures: n }; },
    get_preview_source: function () { return { path: DEMO.export_dir, default_path: DEMO.export_dir }; },
    get_license_status: function () { return clone(DEMO.license_status); },
    get_license_info: function () { return clone(DEMO.license_info); },
    get_pipeline_defaults: function () { return clone(DEMO.pipeline_defaults); },
    check_updates: function () { return { ok: false }; },
    list_presets: function () { return []; },
    list_runs: function () { return []; },
    list_cleaned_versions: function () { return []; },
    list_all_files: function () { return []; },
    save_thumbnail: function () { return null; },
    set_preview_view: function () { return true; },
    set_preview_selection: function () { return true; },
    set_library_asset_meta: function () { return true; },
    set_pipeline_default: function () { return true; },
  };

  // ── Faux run ───────────────────────────────────────────────────────
  // "Run" joue un run complet avec les vrais callbacks de l'interface
  // (cartes, barres, console), puis invite a telecharger Stratum.
  var RUN = { timers: [] };
  function later(ms, fn) { RUN.timers.push(setTimeout(fn, ms)); }
  function F(name) { return typeof window[name] === "function" ? window[name] : function () {}; }
  var LOG = {
    gaea: ["Building Arctic_Mountain.terrain", "{v} built, mesh + color + normal"],
    houdini: ["Chaining Reduce Polycount > Fix Normals", "SM_Arctic_Mountain_{v} cleaned"],
    unreal: ["Importing into ArcticWorld.uproject", "{v} imported: mesh, textures, MI_Arctic_Mountain_{v}"],
    unity: ["Importing into ArcticWorld (HDRP)", "{v} imported: prefab, LODs, material"],
  };
  var END = {
    en: { t: "Your terrains are ready.", s: "That was the demo. The real Stratum does it with your own graphs, in your own engine.", b: "Download Stratum", c: "Keep exploring" },
    fr: { t: "Vos terrains sont prêts.", s: "C'était la démo. Le vrai Stratum le fait avec vos propres graphes, dans votre moteur.", b: "Télécharger Stratum", c: "Continuer à explorer" },
  };
  function showEnd() {
    var tx = END[curLang()] || END.en;
    var old = document.getElementById("demo-end");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "demo-end";
    el.style.cssText = "position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(2,8,16,.72);backdrop-filter:blur(3px)";
    el.innerHTML = '<div style="max-width:520px;text-align:center;padding:38px 40px;border-radius:14px;background:#06131f;border:1px solid rgba(31,184,171,.45);box-shadow:0 30px 80px rgba(0,0,0,.6)">'
      + '<div style="font:600 30px/1.15 Rajdhani,sans-serif;color:#e6edf2;margin-bottom:10px">' + tx.t + '</div>'
      + '<div style="font:15px/1.6 system-ui,sans-serif;color:#8c9eb0;margin-bottom:26px">' + tx.s + '</div>'
      + '<button id="demo-end-dl" style="font:500 13px IBM Plex Mono,monospace;letter-spacing:.12em;text-transform:uppercase;background:#1FB8AB;color:#021A18;border:0;border-radius:8px;padding:15px 28px;cursor:pointer">' + tx.b + '</button>'
      + '<div><button id="demo-end-x" style="margin-top:14px;background:none;border:0;color:#5DEFD5;font:12px IBM Plex Mono,monospace;letter-spacing:.08em;cursor:pointer">' + tx.c + '</button></div></div>';
    document.body.appendChild(el);
    document.getElementById("demo-end-dl").onclick = function () {
      try { window.parent.postMessage({ type: "stratum-demo-download" }, "*"); } catch (e) {}
      el.remove();
    };
    document.getElementById("demo-end-x").onclick = function () {
      el.remove();
      if (coach.waitRun) { coach.waitRun = false; setTimeout(function () { coachShow(2); }, 500); }
    };
  }
  function simulateRun() {
    RUN.timers.forEach(clearTimeout);
    RUN.timers = [];
    var pipe = cfg.pipeline || {};
    var ids = ["gaea", "houdini", "unreal", "unity"].filter(function (id) { return pipe[id] && pipe[id].enabled; });
    var vars = ((pipe.gaea || {}).variants_run || []).slice(0, 4);
    if (!vars.length) vars = ["VarA", "VarB", "VarC"];
    var t = 350;
    var start = Date.now();
    later(t, function () {
      F("frontend_log")("[PIPELINE] Started: " + ids.join(" > "), "INFO");
      ids.forEach(function (id) { F("frontend_strata")(id, "queued", ""); });
    });
    ids.forEach(function (id, si) {
      var tag = "[" + id.toUpperCase() + "] ";
      t += 450;
      later(t, function () { F("frontend_strata")(id, "running", ""); F("frontend_log")(tag + LOG[id][0], "INFO"); });
      vars.forEach(function (v, vi) {
        t += 650;
        later(t, function () {
          F("frontend_strata_item")(id, vi + 1, vars.length);
          F("frontend_log")(tag + LOG[id][1].replace(/\{v\}/g, v), "INFO");
        });
      });
      t += 350;
      later(t, function () { F("frontend_strata")(id, "done", ""); F("frontend_progress")((si + 1) / ids.length); });
    });
    t += 500;
    later(t, function () {
      F("frontend_log")("[PIPELINE] Done: " + vars.length + " variants ready.", "INFO");
      F("frontend_done")(true, Math.round((Date.now() - start) / 1000));
      // Les montagnes "sortent" du run : la liste, l'apercu 3D et la
      // bibliotheque se remplissent maintenant.
      ran = true;
      window._firstAssetLoaded = false;
      if (typeof window.refreshAssetPreview === "function") window.refreshAssetPreview();
      if (typeof window.buildLibraryPage === "function") window.buildLibraryPage();
      // Retour sur l'apercu 3D : le run se termine sur le resultat, pas sur la console.
      var tab = document.querySelector('.tab[data-tab="preview"]');
      if (tab) tab.click();
      setTimeout(function () { ensurePreview(8); }, 2500);
    });
    later(t + 900, showEnd);
  }
  H.run_pipeline = function () {
    if (coach.step < 2) { coachClear(); coach.waitRun = true; }
    simulateRun();
    return { ok: true };
  };
  H.stop_pipeline = function () {
    RUN.timers.forEach(clearTimeout);
    RUN.timers = [];
    F("frontend_log")("[PIPELINE] Stopped.", "WARN");
    F("frontend_done")(false, 0);
    return { ok: true };
  };

  // Actions qui agiraient sur la machine : message de demo, reponse neutre.
  var BLOCKED = /^(run_|stop_pipeline|pick_|open_|delete_|activate_license|deactivate_license|export_|reimport_|engine_cleanup_apply|promote_|clear_storage|build_support|create_project|duplicate_project|rename_project|switch_project|auto_detect|prune_|save_photo|set_photos_folder|set_license_tier|set_preview_source|save_preset|load_preset)/;

  function call(name, args) {
    if (H[name]) return H[name].apply(null, args);
    if (BLOCKED.test(name)) {
      demoToast();
      return /^pick_/.test(name) ? "" : { ok: false, error: "demo" };
    }
    // Reponse neutre qui ne casse pas l'interface : une liste vide pour les
    // list_*, un objet vide pour le reste (l'UI lit souvent des champs).
    return /^list_/.test(name) && name !== "list_software_versions" ? [] : {};
  }

  window.eel = new Proxy({}, {
    get: function (_, name) {
      if (name === "expose") return function () {};
      return function () {
        var args = Array.prototype.slice.call(arguments);
        return function () {
          try { return Promise.resolve(call(name, args)); }
          catch (e) { return Promise.resolve(null); }
        };
      };
    },
  });

  // #library, #settings... : ouvre directement cette page de l'interface.
  // #fonction : on ouvre la bonne zone, puis on la met en lumiere.
  var SPOTS = {
    gaea:     { open: '[data-config="gaea"]',    target: '[data-strata="gaea"]',    en: "Tick the variants to build here", fr: "Coche ici les variantes à construire" },
    houdini:  { open: '[data-config="houdini"]', target: '[data-strata="houdini"]', en: "Your modifiers, chained in order", fr: "Tes modificateurs, enchaînés dans l'ordre" },
    unreal:   { open: '[data-config="unreal"]',  target: '[data-strata="unreal"]',  en: "Import settings: one material per variant", fr: "Réglages d'import : un matériau par variante" },
    naming:   { open: "#btn-project-edit",        target: "#naming-section",         en: "Your naming rules, from Gaea to the engine", fr: "Tes règles de nommage, de Gaea au moteur" },
    preview:  { nav: "pipeline", tab: "preview",  target: '.output-tab[data-tab="preview"]', en: "Inspect every mesh in 3D, then shoot 4K", fr: "Inspecte chaque mesh en 3D, puis photographie en 4K" },
    library:  { nav: "library",                   target: "#lib-grid",               en: "Every mesh from every project", fr: "Chaque mesh de chaque projet" },
    settings: { nav: "settings",                  target: ".dcc-row", parent: true,  en: "Your tools, found automatically", fr: "Tes logiciels, trouvés automatiquement" },
  };
  var spot = { el: null, label: null, timer: null };
  function spotClear() {
    clearInterval(spot.timer);
    if (spot.el) spot.el.remove();
    if (spot.label) spot.label.remove();
    spot.el = spot.label = null;
    document.removeEventListener("mousedown", spotClear, true);
  }
  function spotShow(cfgSpot) {
    var t = document.querySelector(cfgSpot.target);
    if (t && cfgSpot.parent) t = t.parentElement;
    if (!t) return;
    coachStyle();
    spotClear();
    var box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:99980;pointer-events:none;border:2px solid #5DEFD5;border-radius:12px;"
      + "box-shadow:0 0 0 9999px rgba(2,8,16,.66),0 0 26px rgba(93,239,213,.45);transition:all .25s ease";
    var label = document.createElement("div");
    label.className = "coach";
    label.innerHTML = "<span>" + cfgSpot[curLang()] + "</span>"
      + '<svg viewBox="0 0 46 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="transform:rotate(90deg)"><path d="M3 8c14-4 28 2 38 14"/><path d="m33 20 8 3 1-9"/></svg>';
    document.body.appendChild(box);
    document.body.appendChild(label);
    spot.el = box;
    spot.label = label;
    function place() {
      var r = t.getBoundingClientRect();
      if (!r.width) return;
      var top = Math.max(6, r.top - 6), left = Math.max(6, r.left - 6);
      var bottom = Math.min(innerHeight - 6, r.bottom + 6), right = Math.min(innerWidth - 6, r.right + 6);
      box.style.left = left + "px";
      box.style.top = top + "px";
      box.style.width = (right - left) + "px";
      box.style.height = (bottom - top) + "px";
      var lw = label.offsetWidth, lh = label.offsetHeight;
      var ly = top - lh - 12;
      if (ly < 8) ly = Math.min(innerHeight - lh - 8, bottom + 12);
      var lx = Math.min(innerWidth - lw - 8, Math.max(8, left + (right - left) / 2 - lw / 2));
      label.style.left = lx + "px";
      label.style.top = ly + "px";
    }
    place();
    spot.timer = setInterval(place, 300);
    // Le premier clic du visiteur rend la main : la zone reste, le voile part.
    setTimeout(function () { document.addEventListener("mousedown", spotClear, true); }, 400);
  }
  function openHashPage(delay) {
    var page = (location.hash || "").slice(1);
    if (!page) return;
    var sp = SPOTS[page];
    setTimeout(function () {
      if (sp && sp.nav) {
        var nav = document.querySelector('[data-nav="' + sp.nav + '"]');
        if (nav) nav.click();
      }
      if (sp && sp.tab) {
        var tab = document.querySelector('.tab[data-tab="' + sp.tab + '"]');
        if (tab) tab.click();
      }
      if (sp && sp.open) {
        var btn = document.querySelector(sp.open);
        if (btn) btn.click();
      }
      if (!sp) {
        var fallback = document.querySelector('[data-config="' + page + '"]') || document.querySelector('[data-nav="' + page + '"]');
        if (fallback) fallback.click();
        return;
      }
      // Laisse l'interface s'ouvrir et se poser avant d'encadrer.
      setTimeout(function () { spotShow(sp); }, 900);
    }, delay);
  }
  // Filet : le premier mesh se charge une seule fois au demarrage. Si le
  // navigateur a mis la page en pause a ce moment-la (iframe hors ecran), la
  // vue reste sur "Aucun asset" alors que la liste est pleine. Tant que rien
  // n'est affiche, on recharge le premier mesh.
  var previewKick = 0;
  function ensurePreview(tries) {
    var wait = 2500;
    try {
      var V = window.Viewer3D;
      // ASSETS_CACHE est un `let` d'app.js : visible par nom, pas sur window.
      var list = (typeof ASSETS_CACHE !== "undefined" && ASSETS_CACHE) || [];
      var shown = V && V.getStats && V.getStats();
      if (!ran || shown || tries <= 0) return;
      // Un mesh met plusieurs secondes a se lire : on ne relance pas un
      // chargement deja parti, sinon chaque essai annule le precedent.
      if (V && list.length && typeof window.loadAssetInViewer === "function"
          && Date.now() - previewKick > 15000) {
        var canvas = document.getElementById("preview-3d-canvas");
        if (canvas && !canvas._initialized) { V.init(canvas); canvas._initialized = true; }
        previewKick = Date.now();
        window.loadAssetInViewer(0);
      }
    } catch (e) { if (tries <= 0) return; }
    setTimeout(function () { ensurePreview(tries - 1); }, wait);
  }
  // ── Bulles d'invitation ("Vas-y, lance !") ─────────────────────────
  // Trois etapes, une bulle a la fois, pointee sur la vraie zone a cliquer.
  // Elle avance quand le visiteur clique la zone, et disparait en fin de
  // parcours. Seulement sur la grande demo (sans #page).
  function curLang() { return ((cfg.ui || {}).language || "en").slice(0, 2) === "fr" ? "fr" : "en"; }
  var COACH = [
    { sel: '[data-config="gaea"]', en: "Open Gaea and pick your variants", fr: "Ouvre Gaea et choisis tes variantes" },
    { sel: "#btn-run", en: "Now hit Run!", fr: "Maintenant, lance !" },
    { sel: '[data-nav="library"]', en: "Check your results here", fr: "Regarde les résultats ici" },
  ];
  var coach = { step: -1, el: null, target: null, timer: null };
  function coachStyle() {
    if (document.getElementById("coach-style")) return;
    var st = document.createElement("style");
    st.id = "coach-style";
    st.textContent = ".coach{position:fixed;z-index:99990;pointer-events:none;display:flex;align-items:center;gap:8px;color:#5DEFD5;"
      + "font:italic 500 22px/1.1 Rajdhani,'IBM Plex Sans',sans-serif;text-shadow:0 0 16px rgba(93,239,213,.45),0 2px 6px rgba(0,0,0,.8);"
      + "white-space:nowrap;animation:coachIn .35s ease,coachFloat 2.6s ease-in-out .35s infinite;"
      // Fond sombre : la bulle reste lisible par-dessus n'importe quel texte.
      + "background:rgba(3,12,20,.92);border:1px solid rgba(93,239,213,.4);border-radius:12px;padding:7px 10px 7px 16px;"
      + "backdrop-filter:blur(6px);box-shadow:0 10px 30px rgba(0,0,0,.55)}"
      + ".coach svg{width:46px;height:30px;flex-shrink:0;filter:drop-shadow(0 0 6px rgba(93,239,213,.5))}"
      + ".coach-ring{position:fixed;z-index:99989;pointer-events:none;border:2px solid rgba(93,239,213,.8);border-radius:10px;"
      + "box-shadow:0 0 0 4px rgba(93,239,213,.15),0 0 24px rgba(93,239,213,.35);animation:coachPulse 1.6s ease-in-out infinite}"
      + "@keyframes coachIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}"
      + "@keyframes coachFloat{0%,100%{transform:translateX(0)}50%{transform:translateX(-6px)}}"
      + "@keyframes coachPulse{0%,100%{opacity:1}50%{opacity:.45}}";
    document.head.appendChild(st);
  }
  function coachClear() {
    clearInterval(coach.timer);
    if (coach.el) coach.el.remove();
    if (coach.ring) coach.ring.remove();
    if (coach.target) coach.target.removeEventListener("click", coachNext, true);
    coach.el = coach.ring = coach.target = null;
  }
  function coachPlace() {
    if (!coach.target || !coach.el) return;
    var r = coach.target.getBoundingClientRect();
    // Zone cachee (autre page de l'interface, Reglages...) : la bulle et son
    // anneau disparaissent, et reviennent quand la zone est de nouveau la.
    var visible = r.width > 0 && coach.target.offsetParent !== null;
    coach.el.style.display = visible ? "flex" : "none";
    coach.ring.style.display = visible ? "block" : "none";
    if (!visible) return;
    coach.ring.style.cssText = "left:" + (r.left - 5) + "px;top:" + (r.top - 5) + "px;width:" + (r.width + 10) + "px;height:" + (r.height + 10) + "px";
    var w = coach.el.offsetWidth;
    var left = r.left - w - 14;
    var flip = left < 8;
    coach.el.style.flexDirection = flip ? "row-reverse" : "row";
    coach.el.querySelector("svg").style.transform = flip ? "scaleX(-1)" : "";
    coach.el.style.left = (flip ? r.right + 14 : left) + "px";
    coach.el.style.top = (r.top + r.height / 2 - coach.el.offsetHeight / 2) + "px";
  }
  function coachShow(i) {
    coachClear();
    // Une fenetre du logiciel est ouverte (recap de fin de run...) : la bulle
    // attend qu'elle se ferme, sinon elle pointe derriere.
    var modal = document.querySelector(".modal-overlay");
    if (modal && getComputedStyle(modal).display !== "none") {
      setTimeout(function () { coachShow(i); }, 600);
      return;
    }
    coach.step = i;
    var c = COACH[i];
    if (!c) return;
    var t = document.querySelector(c.sel);
    if (!t) return;
    coachStyle();
    coach.target = t;
    coach.el = document.createElement("div");
    coach.el.className = "coach";
    coach.el.innerHTML = "<span>" + c[curLang()] + "</span>"
      + '<svg viewBox="0 0 46 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8c14-4 28 2 38 14"/><path d="m33 20 8 3 1-9"/></svg>';
    coach.ring = document.createElement("div");
    coach.ring.className = "coach-ring";
    document.body.appendChild(coach.ring);
    document.body.appendChild(coach.el);
    coachPlace();
    coach.timer = setInterval(coachPlace, 400);
    t.addEventListener("click", coachNext, true);
  }
  function coachNext() {
    var i = coach.step;
    coachClear();
    // Apres "Lance" : la bulle suivante attend la fin du run.
    if (i === 1) { coach.waitRun = true; return; }
    setTimeout(function () { coachShow(i + 1); }, 700);
  }
  window.addEventListener("load", function () {
    openHashPage(400);
    if (!location.hash) setTimeout(function () { coachShow(0); }, 2500);
    setTimeout(function () { ensurePreview(12); }, 3000);
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) ensurePreview(4);
  });
  window.addEventListener("hashchange", function () { openHashPage(0); });
})();
