// ─────────────────────────────────────────────
// Stratum,front-end vanilla JS (Eel)
// ─────────────────────────────────────────────

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// État global : reflet de la config Python (chargée au bootstrap)
let CFG = null;

// Définition des strates (UI metadata, pas la config).
// Les titres/descs viennent d'i18n via la clé associée,getters lazy pour suivre le switch.
// Familles de strates (rôle dans le pipeline). L'ordre ici est l'ordre de rendu.
// Source de vérité miroir de app/pipeline/strata.py côté Python.
const FAMILY_ORDER = ["generator", "modifier", "engine"];
const FAMILY_META = {
  generator: { get label() { return window.I18N?.t("family.generator") || "Generators"; },
               get hint()  { return window.I18N?.t("family.generator.hint") || "Seed-based source content"; } },
  modifier:  { get label() { return window.I18N?.t("family.modifier")  || "Modifiers"; },
               get hint()  { return window.I18N?.t("family.modifier.hint")  || "Mesh processing & cleanup"; } },
  engine:    { get label() { return window.I18N?.t("family.engine")    || "Engines"; },
               get hint()  { return window.I18N?.t("family.engine.hint")    || "Final import target"; } },
};

const STRATA_DEFS = [
  { id: "gaea",    family: "generator", app: "gaea",
    get title() { return window.I18N?.t("strata.gaea.title") || "Gaea"; },
    get desc()  { return window.I18N?.t("strata.gaea.desc")  || "Procedural terrain generation"; },
    cfgKey: "pipeline.gaea" },
  { id: "houdini", family: "modifier",  app: "houdini",
    get title() { return window.I18N?.t("strata.houdini.title") || "Houdini"; },
    get desc()  { return window.I18N?.t("strata.houdini.desc")  || "Mesh cleanup via HDA"; },
    cfgKey: "pipeline.houdini" },
  { id: "unreal",  family: "engine",    app: "unreal",
    get title() { return window.I18N?.t("strata.unreal.title") || "Unreal Engine"; },
    get desc()  { return window.I18N?.t("strata.unreal.desc")  || "Import & material assignment"; },
    cfgKey: "pipeline.unreal" },
  { id: "unity",   family: "engine",    app: "unity",
    get title() { return window.I18N?.t("strata.unity.title") || "Unity"; },
    get desc()  { return window.I18N?.t("strata.unity.desc")  || "Import & URP material setup"; },
    cfgKey: "pipeline.unity" },
];

const DEF_BY_ID = Object.fromEntries(STRATA_DEFS.map(d => [d.id, d]));

// Default ids présents au premier lancement (Substance NON inclus,l'user l'ajoute via "+ Add").
const DEFAULT_STRATA_ORDER = ["gaea", "houdini", "unreal", "unity"];

// Lit l'ordre courant depuis la config, normalise (familles), retourne array d'ids.
function getStrataOrder() {
  const raw = cfgGet("pipeline.strata_order");
  const known = new Set(STRATA_DEFS.map(d => d.id));
  const cleaned = [];
  const seen = new Set();
  if (Array.isArray(raw)) {
    for (const sid of raw) {
      if (known.has(sid) && !seen.has(sid)) { cleaned.push(sid); seen.add(sid); }
    }
  }
  if (cleaned.length === 0) {
    for (const sid of DEFAULT_STRATA_ORDER) { cleaned.push(sid); seen.add(sid); }
  }
  // Tri stable par famille
  cleaned.sort((a, b) => FAMILY_ORDER.indexOf(DEF_BY_ID[a].family) -
                         FAMILY_ORDER.indexOf(DEF_BY_ID[b].family));
  return cleaned;
}

async function setStrataOrder(order) {
  await cfgSet("pipeline.strata_order", order);
}

// ── Icons ───────────────────────────────────────────────────────────
const ICON_CLOCK = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_CHEV  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;

const APP_LABEL = { gaea: "G", houdini: "H", unreal: "UE", unity: "U" };
const APP_COLOR = {
  gaea:    { c: "#f5d04a", bg: "rgba(245,208,74,0.14)" },   // jaune
  houdini: { c: "#ff7a3a", bg: "rgba(255,122,58,0.14)" },   // orange
  unreal:  { c: "#a78bfa", bg: "rgba(167,139,250,0.14)" },  // violet
  unity:   { c: "#5ea7ff", bg: "rgba(94,167,255,0.14)" },   // bleu
};

// ── Helpers config (lecture/écriture dot-path) ──────────────────────
function cfgGet(path) {
  if (!CFG) return undefined;
  return path.split(".").reduce((o, k) => o && o[k], CFG);
}

async function cfgSet(path, value) {
  if (!CFG) return;
  // Met à jour côté JS d'abord (UI réactive immédiate)
  const parts = path.split(".");
  let cur = CFG;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  // Le resume de la carte de strate suit tout reglage de cette strate. Un seul
  // point de branchement ici evite d'avoir a y penser dans chaque panneau, et
  // c'est ce qui garantit que la carte fermee dit toujours la verite.
  if (typeof refreshStrataSummary === "function") {
    if (parts[0] === "pipeline" && parts.length > 1) {
      refreshStrataSummary(parts[1]);
    } else if (parts[0] === "paths" && /_project$/.test(parts[1] || "")) {
      // Le projet cible vit dans `paths`, pas dans `pipeline`, mais c'est bien
      // la carte du moteur qui l'affiche.
      refreshStrataSummary(parts[1].replace("_project", ""));
    }
  }
  // Puis save côté Python
  try { await eel.save_field(path, value)(); } catch (e) { console.error(e); }
}

// ── Status pill ─────────────────────────────────────────────────────
function statusPill(status) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const map = {
    active:  { l: _t("strata.status.active", "Active"),   c: "var(--accent)" },
    off:     { l: _t("strata.status.off", "Off"),         c: "var(--fg-faint)" },
    ready:   { l: _t("strata.status.ready", "Ready"),     c: "var(--coral-400)" },
    running: { l: _t("strata.status.running", "Running"), c: "var(--ok)" },
  };
  const m = map[status] || map.off;
  return `<span class="chip dot" style="color:${m.c};border-color:color-mix(in oklab,${m.c} 30%,transparent);background:color-mix(in oklab,${m.c} 8%,transparent)">${m.l}</span>`;
}

// ── RESUME DE STRATE ────────────────────────────────────────────
// Une carte fermee doit dire ce qu'elle va faire, pas repeter son propre nom.
// Avant, les quatre cartes affichaient toutes "1x variantes" (une valeur
// globale, donc quatre fois la meme) et un nom de fichier. On les remplace par
// ce que l'utilisateur a reellement regle dans le panneau, pour qu'il retrouve
// ses choix sans avoir a le rouvrir.

// Nom lisible d'un modificateur : le label lu par l'introspection quand on
// l'a, sinon le nom de fichier degrossi. "object_Kalysteon.Smooth_Edges.hdalc"
// devient "Smooth Edges" sans avoir a lancer Houdini.
// Les modificateurs livres avec Stratum. Ils sont ranges DANS le logiciel :
// la config garde `builtin:<id>`, jamais un chemin, et on ne sort de
// l'application que pour brancher son propre HDA.
let _BUILTIN = { items: [], custom_allowed: false, tier: "free" };

async function loadBuiltinHdas() {
  try { _BUILTIN = await eel.list_builtin_hdas()(); }
  catch (e) { /* sources sans backend */ }
  return _BUILTIN;
}

function _builtinEntry(ref) {
  return (_BUILTIN.items || []).find(i => i.ref === ref) || null;
}

// Un maillon que la licence n'autorise pas : le runner l'ignorera, la liste
// doit donc le dire au lieu de laisser croire qu'il tourne.
function _modifierAllowed(ref) {
  const b = _builtinEntry(ref);
  if (b) return !!b.allowed;
  return _BUILTIN.custom_allowed !== false;
}

function _modifierName(path) {
  const b = _builtinEntry(path);
  if (b) return b.label;
  const known = cfgGet("pipeline.houdini.files_labels") || {};
  if (known[path]) return known[path];
  let n = String(path).split(/[\\/]/).pop();
  n = n.replace(/\.(hda|hdalc|hdanc|hip|hiplc|hipnc)$/i, "");
  const dot = n.lastIndexOf(".");
  if (dot > 0) n = n.slice(dot + 1);
  return n.replace(/_+/g, " ").trim() || "?";
}

// Etat des variantes du projet, rempli par renderGaeaVariants(). Declare
// ici parce que les cartes moteur le lisent aussi : elles annoncent ce que
// le dossier contient, pas ce que le compteur de Gaea dit.
let _gaeaVarData = null;

// Les moteurs peuvent suivre Gaea ou plafonner : c'est le seul endroit ou le
// nombre de variantes est une information propre a la strate.
function _engineVariantsLabel(id, _t) {
  // La pastille doit dire ce que la strate VA traiter, donc lire la grille et
  // son interrupteur. Elle lisait encore engine_limit, l'ancien plafond : elle
  // annoncait douze variantes alors que trois etaient cochees.
  const allFlag = cfgGet(`pipeline.${id}.variants_all`);
  const isAll = (allFlag === undefined) ? true : !!allFlag;
  const onDisk = ((_gaeaVarData || {}).variants || [])
    .filter(v => v.exists).length;
  const n = isAll ? onDisk : (cfgGet(`pipeline.${id}.variants_run`) || []).length;
  if (!n) return "";
  return n + " " + (n > 1 ? _t("strata.variants", "variants")
                          : _t("strata.variant_one", "variant"));
}

// Projet cible du moteur, en clair. C'est la premiere chose a verifier avant
// un run : sans lui, le prevol refuse de partir.
function _engineTarget(id) {
  const raw = (cfgGet(`paths.${id}_project`) || "").trim();
  if (!raw) return null;
  return raw.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || raw;
}

function _strataSummary(id, cfg) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const bits = [];

  if (id === "gaea") {
    const f = cfg.file || "";
    if (f) bits.push(f.split(/[\\/]/).pop().replace(/\.terrain$/i, ""));
    const res = parseInt(cfg.resolution) || 0;
    if (res) bits.push(res + " px");
    const v = parseInt(cfg.variants) || 0;
    if (v) bits.push(v + " " + _t("strata.variants", "variants"));
    bits.push(_t("strata.sum.seed_" + (cfg.seed_mode || "auto"), "seed " + (cfg.seed_mode || "auto")));
    // Le compte de noeuds n'a de sens que si l'utilisateur en a decoche :
    // sinon "tous" est deja le cas normal et n'apprend rien.
    const known = cfg.nodes_known || [];
    const on = cfg.nodes_enabled || {};
    const off = known.filter(n => on[n] === false).length;
    if (known.length && off) {
      bits.push((known.length - off) + "/" + known.length + " " + _t("strata.sum.nodes", "nodes"));
    }
  }

  else if (id === "houdini") {
    const files = (Array.isArray(cfg.files) && cfg.files.length)
      ? cfg.files : (cfg.file ? [cfg.file] : []);
    const dis = new Set(Array.isArray(cfg.files_disabled) ? cfg.files_disabled : []);
    const live = files.filter(f => !dis.has(f));
    if (!live.length) {
      bits.push(_t("strata.sum.no_modifier", "no modifier"));
    } else {
      // Un maillon par pastille, separes par une fleche : l'ordre saute aux
      // yeux, ce qui est justement l'information qui compte ici.
      live.forEach((f, i) => {
        if (i) bits.push({ text: "\u2192", cls: "arrow" });
        bits.push({ text: _modifierName(f), cls: "lead" });
      });
      const skipped = files.length - live.length;
      if (skipped) bits.push(skipped + " " + _t("strata.sum.off", "off"));
    }
    const ow = cfg.overwrite_original;
    bits.push((ow === undefined || ow)
      ? _t("strata.sum.overwrite", "overwrites the original")
      : _t("strata.sum.suffix", "keeps a copy"));
  }

  else if (id === "unreal" || id === "unity") {
    // Le projet cible passe en tete : c'est ce qui conditionne tout le reste,
    // et son absence est la panne numero un d'une strate moteur.
    const target = _engineTarget(id);
    bits.push(target
      ? { text: target, cls: "lead" }
      : { text: "\u26a0 " + _t("cfg.engine.no_target", "no target project"), cls: "warn" });

    if (id === "unreal") {
      if (cfg.create_material !== false && cfg.master_material_name) {
        bits.push(cfg.master_material_name);
      }
      if (cfg.nanite !== false) bits.push("Nanite");
      if (cfg.lods_auto !== false) bits.push(_t("strata.sum.lods", "auto LODs"));
      if (cfg.generate_lightmap_uvs) bits.push("Lightmap UVs");
    } else {
      bits.push(cfg.render_pipeline || "URP");
      if (cfg.generate_prefab !== false) bits.push(_t("strata.sum.prefab", "prefabs"));
      if (cfg.generate_lods !== false) bits.push(_t("strata.sum.lods", "auto LODs"));
      if (cfg.read_write_mesh) bits.push("Read/Write");
    }

    // "simple" seul ne disait pas de quoi il parlait.
    if (cfg.collision && cfg.collision !== "none") {
      bits.push(_t("strata.sum.collision", "collision") + " " + cfg.collision);
    }
    bits.push(_engineVariantsLabel(id, _t));
  }

  return bits.filter(Boolean);
}

// Un element de resume est soit une chaine, soit {text, cls}. Le premier
// element identifie la strate et porte l'accent ; les suivants sont du detail.
function _sumItems(bits) {
  return bits.map((b, i) => (typeof b === "string")
    ? { text: b, cls: i === 0 ? "lead" : "" }
    : { text: b.text, cls: b.cls || "" });
}

function _sumHTML(bits) {
  const items = _sumItems(bits);
  if (!items.length) {
    return `<span class="strata-sum-bit muted">${window.I18N?.t("strata.sum.empty") || "not configured yet"}</span>`;
  }
  return items.map(it => `<span class="strata-sum-bit ${it.cls}">${_esc(it.text)}</span>`).join("");
}

function _sumText(bits) {
  return _sumItems(bits).map(it => it.text).join(" \u00b7 ");
}

// Met a jour la seule ligne de resume d'une carte. Un renderStrata() complet
// reconstruirait les panneaux ouverts, ce qui relancerait l'introspection des
// HDA : le simple fait d'apprendre un nom declencherait une nouvelle serie
// d'introspections, et ainsi de suite.
function refreshStrataSummary(id) {
  const el = document.querySelector(`.strata-card[data-strata="${id}"] .strata-summary`);
  const def = DEF_BY_ID[id];
  if (!el || !def) return;
  const bits = _strataSummary(id, cfgGet(def.cfgKey) || {});
  el.title = _sumText(bits);
  el.innerHTML = _sumHTML(bits);
}

// ── STRATA CARD ─────────────────────────────────────────────────────
function strataHTML(def, sCfg, num) {
  const enabled = !!sCfg.enabled;
  const status = enabled ? "active" : "off";
  const opacity = enabled ? "" : "opacity:0.55";

  // Numérotation auto basée sur la position dans le flow (drag-drop friendly).
  const numStr = String(num).padStart(2, "0");

  const bits = _strataSummary(def.id, sCfg);

  return `
    <div class="strata-card" data-strata="${def.id}" data-family="${def.family}" draggable="false" style="${opacity}">
      <div class="strata-rail">
        <div class="strata-drag" title="${window.I18N?.t("strata.drag") || "Drag to reorder"}">⋮⋮</div>
        <div class="strata-num">${numStr}</div>
      </div>
      <div class="strata-body">
        <div class="strata-head">
          <div class="strata-app-icon" style="color:${APP_COLOR[def.app].c};background:${APP_COLOR[def.app].bg}">${APP_LABEL[def.app]}</div>
          <div class="strata-title" title="${_esc(def.desc)}">${def.title}</div>
          <div style="flex:1"></div>
        </div>
        <div class="strata-meta strata-summary" title="${_esc(_sumText(bits))}">${_sumHTML(bits)}</div>
        <div class="strata-bar" data-bar="${def.id}" hidden>
          <div class="strata-bar-track"><div class="strata-bar-fill"></div></div>
          <span class="strata-bar-count"></span>
        </div>
        <div class="strata-expand" data-expand="${def.id}"></div>
      </div>
      <div class="strata-aside">
        <div class="strata-aside-row">
          <button class="strata-refresh" data-refresh="${def.id}" title="${window.I18N?.t("strata.refresh") || "Reload info from the software"}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
          </button>
          <button class="strata-remove" data-remove="${def.id}" title="${window.I18N?.t("strata.remove") || "Remove from flow"}">✕</button>
        </div>
        <div class="switch${enabled ? " on" : ""}" data-toggle="${def.id}" title="${enabled ? (window.I18N?.t("strata.status.active") || "Active") : (window.I18N?.t("strata.status.off") || "Off")}"></div>
        <button class="btn ghost strata-config-btn" data-config="${def.id}">
          <span class="config-label" data-i18n="btn.configure">Configure</span>
          <span class="config-chev">${ICON_CHEV}</span>
        </button>
      </div>
    </div>`;
}

// Relit les infos d'une strate depuis le fichier du logiciel concerne.
// Utile quand on modifie le .terrain ou l'HDA a cote sans relancer Stratum :
// les nodes, les parametres et les compteurs sont relus a la demande.
async function refreshStrataInfo(id, btn) {
  if (btn) btn.classList.add("spinning");
  try {
    if (id === "gaea") {
      if (typeof _loadGaeaNodes === "function") await _loadGaeaNodes();
      renderStrata();
    } else if (id === "houdini") {
      if (typeof _loadHdaParams === "function") await _loadHdaParams();
    } else if (id === "unreal" || id === "unity") {
      const root = cfgGet(`pipeline.${id}.project`) || "";
      if (root) await _maybeProposeLayout(id, root);
      renderStrata();
    } else {
      renderStrata();
    }
    flashStatus(window.I18N?.t("strata.refresh.done") || "Info reloaded", "var(--ok)");
  } catch (e) {
    flashStatus((window.I18N?.t("strata.refresh.fail") || "Reload failed") + " : " + e,
                "var(--err)");
  } finally {
    if (btn) btn.classList.remove("spinning");
  }
}

// ── Add Strata modal ───────────────────────────────────────────────
// Modale légère : liste les strates de la famille qui ne sont pas
// déjà dans le flow, l'user en choisit une → ajoutée en fin de zone.
function openAddStrataModal(family) {
  const order = getStrataOrder();
  const candidates = STRATA_DEFS.filter(d => d.family === family && !order.includes(d.id));
  if (candidates.length === 0) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div class="modal-title">${window.I18N?.t("family.add.title") || "Add a strata"}</div>
        <div class="modal-sub">${FAMILY_META[family].label}, ${FAMILY_META[family].hint}</div>
      </div>
      <div class="modal-body">
        ${candidates.map(d => `
          <button class="add-candidate" data-add="${d.id}">
            <div class="strata-app-icon" style="color:${APP_COLOR[d.app].c};background:${APP_COLOR[d.app].bg}">${APP_LABEL[d.app]}</div>
            <div class="add-cand-info">
              <div class="add-cand-title">${d.title}</div>
              <div class="add-cand-desc">${d.desc}</div>
            </div>
          </button>
        `).join("")}
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>${window.I18N?.t("btn.cancel") || "Cancel"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-close]").addEventListener("click", close);
  overlay.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const sid = btn.dataset.add;
      const cur = getStrataOrder();
      // Insère en fin de la famille
      const lastSameFam = cur.map((id, i) => DEF_BY_ID[id].family === family ? i : -1).filter(i => i >= 0).pop();
      const idx = lastSameFam === undefined ? cur.length : lastSameFam + 1;
      cur.splice(idx, 0, sid);
      await setStrataOrder(cur);
      close();
      renderStrata();
      refreshStats();
    });
  });
}

// ── Drag-and-drop strata reorder (HTML5 native) ────────────────────
// Règles : drop autorisé UNIQUEMENT dans la même famille. Toute tentative
// inter-famille est ignorée (visualisé par un état not-allowed).
let _dragId = null;
function wireStrataDnD() {
  $$(".strata-card").forEach(card => {
    // Le drag ne s'active QUE depuis la poignée ⋮⋮ (.strata-drag). Le reste de
    // la carte reste non-draggable → plus de drag accidentel au clic central
    // (qui pouvait réordonner et faire atterrir un clic fantôme sur une encoche).
    const handle = card.querySelector(".strata-drag");
    if (handle) {
      handle.addEventListener("mousedown", () => { card.draggable = true; });
      handle.addEventListener("mouseup",   () => { card.draggable = false; });
    }
    card.addEventListener("dragstart", e => {
      _dragId = card.dataset.strata;
      card.classList.add("dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", _dragId); } catch(_){}
    });
    card.addEventListener("dragend", () => {
      card.draggable = false;
      card.classList.remove("dragging");
      $$(".strata-zone").forEach(z => z.classList.remove("drop-ok", "drop-bad"));
      _dragId = null;
    });
  });

  $$(".strata-zone").forEach(zone => {
    const fam = zone.dataset.family;
    zone.addEventListener("dragover", e => {
      if (!_dragId) return;
      const dragFam = DEF_BY_ID[_dragId]?.family;
      if (dragFam !== fam) { zone.classList.add("drop-bad"); return; }
      e.preventDefault();
      zone.classList.add("drop-ok");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drop-ok", "drop-bad");
    });
    zone.addEventListener("drop", async e => {
      zone.classList.remove("drop-ok", "drop-bad");
      if (!_dragId) return;
      const dragFam = DEF_BY_ID[_dragId]?.family;
      if (dragFam !== fam) return;
      e.preventDefault();

      // Index d'insertion : compare la position Y du curseur aux centres des cards
      const body = zone.querySelector(".zone-body");
      const cards = Array.from(body.querySelectorAll(".strata-card:not(.dragging)"));
      let insertBefore = null;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { insertBefore = c.dataset.strata; break; }
      }

      // Recompose l'ordre global : retire _dragId, réinsère à la bonne place
      const cur = getStrataOrder().filter(id => id !== _dragId);
      let idx;
      if (insertBefore) {
        idx = cur.indexOf(insertBefore);
      } else {
        // À la fin de la famille
        const lastSameFam = cur.map((id, i) => DEF_BY_ID[id].family === fam ? i : -1).filter(i => i >= 0).pop();
        idx = lastSameFam === undefined ? cur.length : lastSameFam + 1;
      }
      cur.splice(idx, 0, _dragId);
      await setStrataOrder(cur);
      renderStrata();
      refreshStats();
    });
  });
}

function renderStrata() {
  // Snapshot des cartes actuellement dépliées pour les ré-ouvrir après le render.
  // Sans ça, chaque changement de paramètre referme le panel → frustrant.
  const openIds = Array.from(document.querySelectorAll(".strata-expand.open"))
                       .map(el => el.dataset.expand);

  const order = getStrataOrder();
  // Numérotation globale dans l'ordre du flow (toutes familles confondues).
  const numByIdx = order.reduce((acc, sid, i) => { acc[sid] = i + 1; return acc; }, {});

  // Groupe par famille (en respectant l'ordre intra-famille du tableau `order`)
  const byFamily = Object.fromEntries(FAMILY_ORDER.map(f => [f, []]));
  for (const sid of order) {
    const def = DEF_BY_ID[sid];
    if (def) byFamily[def.family].push(sid);
  }

  const zonesHTML = FAMILY_ORDER.map(fam => {
    const ids = byFamily[fam];
    const meta = FAMILY_META[fam];
    const cards = ids.map(sid => {
      const def = DEF_BY_ID[sid];
      const sCfg = cfgGet(def.cfgKey) || {};
      return strataHTML(def, sCfg, numByIdx[sid]);
    }).join('<div class="strata-connector"></div>');
    const empty = ids.length === 0
      ? `<div class="zone-empty">${window.I18N?.t("family.empty") || "No strata in this family"}</div>`
      : "";
    // Candidats à l'ajout = strates de cette famille pas encore dans l'ordre
    const addable = STRATA_DEFS.filter(d => d.family === fam && !order.includes(d.id));
    const addBtn = addable.length > 0
      ? `<button class="zone-add" data-zone-add="${fam}" title="${window.I18N?.t("family.add") || "Add strata"}">+ ${window.I18N?.t("family.add") || "Add"}</button>`
      : "";
    // Une seule facon d'ecrire un titre de zone. Avant, une zone a une seule
    // strate le dessinait en ::before et les autres via .zone-head : deux
    // rendus, deux couleurs, pour la meme information.
    const headHTML = `<div class="zone-head">
          <div class="zone-label">${meta.label}</div>
          <div style="flex:1"></div>
          ${addBtn}
        </div>`;
    return `
      <div class="strata-zone" data-family="${fam}" data-family-label="${meta.label}">
        ${headHTML}
        <div class="zone-body" data-zone-body="${fam}">${cards}${empty}</div>
      </div>`;
  }).join('<div class="zone-connector"></div>');

  $("#strata-list").innerHTML = zonesHTML;

  wireStrataDnD();

  // Wire switches
  $$("[data-toggle]").forEach(el => {
    el.addEventListener("click", async () => {
      if (runLocked()) return;
      const id = el.dataset.toggle;
      const newOn = !el.classList.contains("on");
      // Si on désactive une strata qui était dépliée, on la replie aussi.
      // Ça évite de garder une carte grisée + ouverte qui prend de la place.
      if (!newOn) {
        const panel = document.querySelector(`[data-expand="${id}"]`);
        if (panel && panel.classList.contains("open")) {
          const btn = document.querySelector(`[data-config="${id}"]`);
          if (btn) toggleStrataExpand(id, btn);
        }
      }
      await cfgSet(`pipeline.${id}.enabled`, newOn);
      renderStrata();
      refreshStats();
    });
  });

  // Wire Configure buttons → toggle expansion inline
  $$("[data-config]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.dataset.config;
      toggleStrataExpand(id, el);
    });
  });

  // Click sur la card entière → toggle Configure (sauf si click sur un contrôle interactif)
  $$(".strata-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-toggle]") ||
          e.target.closest("[data-remove]") ||
          e.target.closest("[data-refresh]") ||
          e.target.closest(".strata-drag") ||
          e.target.closest("[data-config]") ||
          e.target.closest(".strata-expand")) {
        return;
      }
      const id = card.dataset.strata;
      const btn = card.querySelector(`[data-config="${id}"]`);
      if (btn) toggleStrataExpand(id, btn);
    });
  });

  // Wire Remove buttons → retire la strata de l'ordre (config conservée)
  $$("[data-refresh]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      refreshStrataInfo(el.dataset.refresh, el);
    });
  });

  $$("[data-remove]").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = el.dataset.remove;
      const cur = getStrataOrder().filter(s => s !== id);
      // Force off pour ne pas la voir "active" si re-ajoutée plus tard
      await cfgSet(`pipeline.${id}.enabled`, false);
      await setStrataOrder(cur);
      renderStrata();
      refreshStats();
    });
  });

  // Wire Add buttons → modale de sélection
  $$("[data-zone-add]").forEach(el => {
    el.addEventListener("click", () => openAddStrataModal(el.dataset.zoneAdd));
  });

  // Restaure les cartes qui étaient ouvertes
  for (const id of openIds) {
    const panel = document.querySelector(`[data-expand="${id}"]`);
    const btn = document.querySelector(`[data-config="${id}"]`);
    const h = CONFIG_HANDLERS[id];
    if (!panel || !btn || !h) continue;
    panel.innerHTML = h.content();
    panel.classList.add("open");
    panel.style.marginTop = "10px";
    panel.style.paddingTop = "14px";
    panel.style.borderTop = "1px dashed var(--line)";
    // Meme raison qu'a l'ouverture : la hauteur bornee du CSS coupe les
    // panneaux longs. Ici il n'y a pas d'animation a preserver, on la libere
    // tout de suite.
    panel.style.maxHeight = "none";
    panel.style.overflow = "visible";
    try { h.wire(); } catch (e) { console.warn("re-wire fail", id, e); }
    const chev = btn.querySelector(".config-chev");
    const label = btn.querySelector(".config-label");
    if (chev) chev.style.transform = "rotate(90deg)";
    if (label) label.textContent = window.I18N?.t("btn.close") || "Close";
  }
}

// ── Stats footer ───────────────────────────────────────────────────
function refreshStats() {
  const order = getStrataOrder();
  const active = order.filter(sid => cfgGet(`pipeline.${sid}.enabled`)).length;
  const total = order.length;
  const activeLbl = window.I18N?.t("stats.active") || "active";
  $("#stat-strata").innerHTML = `${active}<span class="unit">/${total} ${activeLbl}</span>`;
  const variants = cfgGet("pipeline.gaea.variants") || "—";
  $("#stat-variants").textContent = variants;
  $("#stat-res").innerHTML = `${cfgGet("pipeline.gaea.resolution") || "—"}<span class="unit">px</span>`;

  // Narrative résumée à droite des stats
  const narrEl = $("#run-narrative-text");
  if (narrEl) {
    const engineNames = order
      .filter(sid => DEF_BY_ID[sid]?.family === "engine" && cfgGet(`pipeline.${sid}.enabled`))
      .map(sid => DEF_BY_ID[sid].title);
    const houdiniOn = order.includes("houdini") && cfgGet("pipeline.houdini.enabled");
    const gaeaOn   = order.includes("gaea") && cfgGet("pipeline.gaea.enabled");

    let narr;
    if (active === 0) {
      narr = window.I18N?.t("run.narr.none") || "No strata enabled. Toggle at least one to run.";
    } else if (!gaeaOn && engineNames.length === 0) {
      narr = window.I18N?.t("run.narr.partial") || "Pipeline will run partial steps.";
    } else {
      const nVar = parseInt(variants) || 1;
      const cleanup = houdiniOn ? (window.I18N?.t("run.narr.cleanup") || ", cleaned via Houdini") : "";
      const tgt = engineNames.length
        ? (window.I18N?.t("run.narr.to") || "→") + " <strong>" + engineNames.join(" + ") + "</strong>"
        : (window.I18N?.t("run.narr.no_engine") || "(no engine selected)");
      const varWord = window.I18N?.t("run.narr.variants") || "variants";
      narr = `<strong>${nVar} ${varWord}</strong>${cleanup} ${tgt}`;
    }
    narrEl.innerHTML = narr;
  }

  // Pulse Run button si quelque chose à faire
  const btn = $("#btn-run");
  if (btn) btn.classList.toggle("ready", active > 0);

  // ETA estimateur via backend
  _refreshRunEstimate(active);
}

// Throttled call to backend estimator
let _estimateTimer = null;
function _refreshRunEstimate(active) {
  if (_estimateTimer) clearTimeout(_estimateTimer);
  _estimateTimer = setTimeout(async () => {
    const sub = $("#run-eta");
    if (!sub) return;
    if (active === 0) {
      sub.dataset.confidence = "none";
      sub.querySelector(".run-eta-time").textContent = "—";
      sub.querySelector(".run-eta-info").textContent = window.I18N?.t("run.sub.disabled") || "Nothing to run";
      return;
    }
    let est;
    try { est = await eel.estimate_run_time()(); }
    catch (e) { console.warn("estimate fail", e); return; }
    if (!est || !est.seconds) return;
    const secs = est.seconds;
    const mins = Math.floor(secs / 60);
    const rem  = secs % 60;
    const timeStr = mins > 0 ? `${mins}m ${rem.toString().padStart(2,"0")}s` : `${rem}s`;
    sub.dataset.confidence = est.confidence;
    sub.querySelector(".run-eta-time").textContent = timeStr;
    const confLabel = {
      good:  window.I18N?.t("run.eta.good")  || "based on history",
      fair:  window.I18N?.t("run.eta.fair")  || "based on past runs",
      rough: window.I18N?.t("run.eta.rough") || "rough estimate",
      none:  "",
    }[est.confidence] || "";
    const assetsLbl = window.I18N?.t("run.eta.assets") || "assets";
    sub.querySelector(".run-eta-info").textContent = `${est.assets} ${assetsLbl} · ${confLabel}`;
    const breakdown = Object.entries(est.breakdown || {}).map(([k,v]) => `${k}: ${v}s`).join(" · ");
    sub.title = breakdown
      ? `Breakdown, ${breakdown}${est.multiplier ? ` (×${est.multiplier} sur ${est.samples} runs)` : ""}`
      : "";
  }, 80);
}

// ── Project card : binder les inputs à la config ───────────────────
function wireProjectInputs() {
  const inp = $("#input-project");
  inp.value = cfgGet("pipeline.project") || "";
  inp.addEventListener("change", async () => {
    const newName = inp.value.trim();
    if (!newName) return;
    await cfgSet("pipeline.project", newName);
    $("#project-name").textContent = newName;
    // L'apercu du nommage et de l'agencement lit le nom du projet : sans ce
    // rendu, il gardait l'ancien nom jusqu'au prochain redemarrage.
    renderNamingSection();
    renderLayoutDesigner();
    // Renomme aussi le projet (fichier slug) pour rester cohérent
    if (_currentSlug) {
      try {
        const res = await eel.rename_project(_currentSlug, newName)();
        if (res.ok) {
          _currentSlug = res.slug;
          await refreshProjectsCache();
        }
      } catch (e) { console.warn("rename fail", e); }
    }
  });

  const exp = $("#input-export");
  exp.value = cfgGet("pipeline.export") || "";
  exp.addEventListener("change", async () => {
    await cfgSet("pipeline.export", exp.value);
  });

  // Agencement du dossier d'export : cartes de presets + composeur de
  // niveaux + apercu d'arborescence en direct (cf. renderLayoutDesigner).
  renderNamingSection();
  renderLayoutDesigner();

  // Bouton ··· dédié pour le picker
  $("#btn-export-browse").addEventListener("click", async () => {
    const folder = await eel.pick_folder("Select export folder", exp.value || "")();
    if (folder) {
      exp.value = folder;
      await cfgSet("pipeline.export", folder);
    }
  });

  // Working folder est désormais auto ({Export}/_inprogress/),override possible
  // dans Settings → Advanced.

  // ── Unreal target (.uproject) ──
  const ueProj = $("#input-unreal-project");
  ueProj.value = cfgGet("paths.unreal_project") || "";
  ueProj.addEventListener("change", async () => {
    await cfgSet("paths.unreal_project", ueProj.value);
  });
  $("#btn-unreal-browse").addEventListener("click", async () => {
    const p = await eel.pick_file("Select Unreal .uproject", [["uproject", "*.uproject"]], ueProj.value || "")();
    if (p) {
      ueProj.value = p;
      await cfgSet("paths.unreal_project", p);
      // Le project root = dossier du .uproject. Scan layout.
      const root = p.split(/[\\/]/).slice(0, -1).join("/");
      _maybeProposeLayout("unreal", root);
    }
  });

  // ── Unity target (folder) ──
  const uniProj = $("#input-unity-project");
  uniProj.value = cfgGet("paths.unity_project") || "";
  uniProj.addEventListener("change", async () => {
    await cfgSet("paths.unity_project", uniProj.value);
  });
  $("#btn-unity-browse").addEventListener("click", async () => {
    const folder = await eel.pick_folder("Select Unity project folder", uniProj.value || "")();
    if (folder) {
      uniProj.value = folder;
      await cfgSet("paths.unity_project", folder);
      _maybeProposeLayout("unity", folder);
    }
  });

  $("#project-name").textContent = inp.value || "—";

  // ── Compactage du Project card (summary vs form) ──
  const summary = $("#project-card-summary");
  const form    = $("#project-card-form");
  const btnEdit = $("#btn-project-edit");
  const btnClose = $("#btn-project-collapse");
  const _shortPath = (p, max = 38) => {
    if (!p) return "";
    p = p.replace(/\\/g, "/");
    if (p.length <= max) return p;
    const parts = p.split("/").filter(Boolean);
    if (parts.length <= 2) return p;
    return ".../" + parts.slice(-2).join("/");
  };
  function refreshProjectSummary() {
    $("#project-summary-name").textContent = (cfgGet("pipeline.project") || "—");
    const expVal = cfgGet("pipeline.export") || "";
    const expEl = $("#project-summary-export");
    // Chemin complet : la carte a maintenant la largeur pour le porter, et un
    // dossier d'export tronque oblige a survoler pour savoir ou on ecrit.
    expEl.textContent = expVal || (window.I18N?.t("project.no_export") || "no export folder");
    expEl.title = expVal || "";
    expEl.classList.toggle("faint", !expVal);
    const layoutLabels = {
      flat: "Flat", by_style: "Variant→Style", by_type: "Variant→Type",
      by_style_type: "Variant→Style→Type", style_first: "Style→Variant",
      style_type: "Style→Type", style_first_type: "Style→Variant→Type",
    };
    const l = cfgGet("pipeline.output_layout") || "flat";
    $("#project-summary-layout").textContent = layoutLabels[l] || l;
  }
  const ident = summary.querySelector(".project-ident");

  function setProjectCardExpanded(expanded) {
    // Animation via la classe .open (max-height) au lieu d'un swap display brut.
    // Le nom du projet ne disparait PAS a l'ouverture : il reste la ou on a
    // clique pour ouvrir, et c'est lui qui referme. Masquer tout le resume
    // obligeait a descendre jusqu'au bouton Fermer, alors que le curseur
    // venait de quitter le haut de la carte.
    summary.querySelectorAll(".project-path, .project-actions").forEach(el => {
      el.hidden = expanded;
    });
    if (expanded) {
      form.classList.add("open");
    } else {
      form.classList.remove("open");
      // Le resume est une grille depuis que la carte porte un vrai titre :
      // on rend la main au CSS plutot que de reposer un display en dur.
      summary.style.display = "";
    }
    if (ident) ident.classList.toggle("is-open", expanded);
  }
  refreshProjectSummary();
  setProjectCardExpanded(false);

  // Le bouton Editer a sa propre action. Il etait couvert par l'exclusion des
  // boutons, ajoutee pour que Supprimer n'ouvre pas la carte : il ne faisait
  // donc plus rien du tout.
  btnEdit?.addEventListener("click", e => {
    e.stopPropagation();
    setProjectCardExpanded(true);
  });

  summary.addEventListener("click", e => {
    // Toute la carte ouvre le formulaire, sauf ce qui a deja une action.
    if (e.target.closest("a, input, select, button")) return;
    // Sur la ligne d'identite, le geste est un va-et-vient : le meme clic au
    // meme endroit ouvre puis referme.
    if (ident && ident.contains(e.target) && form.classList.contains("open")) {
      refreshProjectSummary();
      setProjectCardExpanded(false);
      return;
    }
    setProjectCardExpanded(true);
  });
  btnClose.addEventListener("click", () => { refreshProjectSummary(); setProjectCardExpanded(false); });


  [inp, exp, ueProj, uniProj].forEach(el => {
    el?.addEventListener("change", refreshProjectSummary);
  });
}

// ── AGENCEMENT DU DOSSIER D'EXPORT (layout designer) ────────────────
// Un agencement n'est qu'une LISTE ORDONNEE de niveaux de dossiers :
// variant (VarA) / style (Cartoon) / type (Meshes, Textures). Miroir JS de
// app/pipeline/layouts.py. Les "presets" ne sont que des ordres courants.
// L'UI montre l'arborescence resultante en direct, au lieu d'obliger l'user
// a decoder un nom abstrait comme "by_style_type".
const LAYOUT_LEVELS_ALL = ["variant", "style", "type"];
const LAYOUT_PRESETS = {
  flat:             ["variant"],
  by_style:         ["variant", "style"],
  by_type:          ["variant", "type"],
  by_style_type:    ["variant", "style", "type"],
  style_first:      ["style", "variant"],
  style_first_type: ["style", "variant", "type"],
  style_type:       ["style", "type"],
};
// Niveaux actuels. Miroir de layouts.output_levels() cote Python : quand le
// preset vaut 'custom', la liste fait foi TELLE QUELLE, y compris vide
// (= aucun sous-dossier, tout a la racine du projet).
function _layoutLevels() {
  const preset = cfgGet("pipeline.output_layout") || "flat";
  const raw = cfgGet("pipeline.output_layout_levels");
  const clean = [];
  if (Array.isArray(raw)) {
    for (const l of raw) {
      if (LAYOUT_LEVELS_ALL.includes(l) && !clean.includes(l)) clean.push(l);
    }
  }
  if (preset === "custom") return clean;
  if (clean.length) return clean;
  return (LAYOUT_PRESETS[preset] || LAYOUT_PRESETS.flat).slice();
}

function _layoutPresetName(levels) {
  for (const name of Object.keys(LAYOUT_PRESETS)) {
    const lv = LAYOUT_PRESETS[name];
    if (lv.length === levels.length && lv.every((x, i) => x === levels[i])) return name;
  }
  return "custom";
}

// Exemple affiche dans les apercus. On prend le VRAI nom de projet et, si la
// Library en connait, de VRAIS styles : l'exemple devient reconnaissable au
// lieu d'un "Mountain/Cartoon" abstrait. Fallback generique sinon.
function _layoutSample() {
  const proj = (cfgGet("pipeline.project") || "").trim() || "Project";
  let styles = ["Cartoon", "Realistic"];
  try {
    const found = [...new Set((_LIB_ASSETS || []).map(a => a.style).filter(Boolean))];
    if (found.length >= 2) styles = found.slice(0, 2);
    else if (found.length === 1) styles = [found[0], found[0] === "Cartoon" ? "Realistic" : "Cartoon"];
  } catch (e) { /* Library pas encore chargee : on garde l'exemple generique */ }
  return { project: proj, variant: ["VarA", "VarB"], style: styles, type: ["Meshes", "Textures"] };
}

// Construit l'arborescence en texte. On ne developpe que la PREMIERE branche
// de chaque niveau : ca montre la profondeur reelle sans exploser en dizaines
// de lignes, tout en prouvant qu'il y a bien plusieurs dossiers cote a cote.
// Exception : le niveau "type" final est developpe en entier, sinon la texture
// se retrouverait affichee dans Meshes/, ce qui n'a aucun sens.
function _layoutTree(levels, opts) {
  const o = opts || {};
  const S = _layoutSample();
  const out = [S.project + "/"];
  const FILES = o.files ? [
    { name: "SM_" + S.project + "_VarA.fbx",       type: "Meshes" },
    { name: "T_" + S.project + "_VarA_Color.png",  type: "Textures" },
  ] : [];
  // Un dossier "type" ne doit contenir que les fichiers de ce type, et on
  // developpe TOUTES ses branches quelle que soit sa position : sinon, quand
  // Type n'est pas le dernier niveau, seul Meshes/ serait ouvert et la
  // texture n'apparaitrait nulle part dans l'apercu.
  const expandType = FILES.length > 0 && levels.includes("type");
  (function walk(i, prefix, typeFilter) {
    if (i >= levels.length) {
      const list = typeFilter ? FILES.filter(f => f.type === typeFilter) : FILES;
      list.forEach((f, k) => out.push(prefix + (k === list.length - 1 ? "└── " : "├── ") + f.name));
      return;
    }
    const lvl = levels[i];
    const items = (S[lvl] || []).slice(0, 2);
    items.forEach((name, idx) => {
      const last = idx === items.length - 1;
      out.push(prefix + (last ? "└── " : "├── ") + name + "/");
      if (idx === 0 || (lvl === "type" && expandType)) {
        walk(i + 1, prefix + (last ? "    " : "│   "), lvl === "type" ? name : typeFilter);
      }
    });
  })(0, "", null);
  return out;
}

// Ordre d'affichage des 3 niveaux, ACTIFS COMME ETEINTS. C'est ce qui permet
// a un niveau decoche de rester a sa place au lieu de tomber en bas de la
// liste, et d'etre quand meme deplacable. Les niveaux actifs (ce que le
// runner utilise vraiment) sont simplement cet ordre filtre.
function _layoutOrder() {
  const raw = cfgGet("pipeline.output_layout_order");
  const out = [];
  if (Array.isArray(raw) && raw.length) {
    for (const l of raw) {
      if (LAYOUT_LEVELS_ALL.includes(l) && !out.includes(l)) out.push(l);
    }
  } else {
    // Pas encore d'ordre stocke : on part des niveaux actifs, dans leur ordre.
    for (const l of _layoutLevels()) if (!out.includes(l)) out.push(l);
  }
  // Complete avec les niveaux manquants (eteints) dans l'ordre canonique.
  for (const l of LAYOUT_LEVELS_ALL) if (!out.includes(l)) out.push(l);
  return out;
}

// Ecrit l'ordre complet + les actifs qui en decoulent. Les actifs suivent
// toujours l'ordre affiche, donc deplacer une ligne allumee change bien le
// chemin de sortie.
async function _setLayoutOrder(order, activeSet) {
  const active = activeSet || new Set(_layoutLevels());
  const levels = order.filter(l => active.has(l));
  await cfgSet("pipeline.output_layout_order", order);
  await cfgSet("pipeline.output_layout_levels", levels);
  await cfgSet("pipeline.output_layout", _layoutPresetName(levels));
  renderNamingSection();
  renderLayoutDesigner();
  try { refreshProjectSummary(); } catch (e) {}
}

// Le nommage est une etape de Stratum, au meme titre que l'agencement : il a
// lieu apres la generation et avant tout le reste, que Houdini soit actif ou
// non. Ses reglages vivaient sous Houdini, donc invisibles et inoperants des
// que la strate etait eteinte.
function _namingCfg() {
  const n = cfgGet("pipeline.naming") || {};
  const h = cfgGet("pipeline.houdini") || {};
  return {
    enabled: n.enabled !== false,
    mesh: n.template_mesh || h.naming_template_mesh || "SM_{project}_{variant}{style_suffix}",
    tex: n.template_texture || h.naming_template_texture || "T_{project}_{variant}{style_suffix}_{kind}",
  };
}

function _namingExample(tpl, kind) {
  const project = cfgGet("pipeline.project") || "Project";
  return tpl.replace("{project}", project).replace("{variant}", "VarA")
            .replace("{style}", "").replace("{style_suffix}", "")
            .replace("{kind}", kind);
}

function renderNamingSection() {
  const host = $("#naming-section");
  if (!host) return;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const c = _namingCfg();
  // L'exemple et la liste de variables encombraient la colonne en permanence
  // alors qu'on ne les lit qu'une fois. Ils passent dans la bulle du "?".
  const aide = [
    `${_t("naming.example", "Example")} : `
      + _namingExample(c.mesh, "") + ".fbx  \u00b7  "
      + _namingExample(c.tex, "Color") + ".png",
    "",
    _t("naming.placeholders",
       "placeholders: {project} {variant} {style} {style_suffix} {kind}"),
  ].join("\n");

  host.innerHTML = `
    <div class="naming-head">
      <div class="switch${c.enabled ? " on" : ""}" id="naming-toggle"></div>
      <span class="naming-state">${c.enabled
        ? _t("naming.on", "Files are renamed after generation")
        : _t("naming.off", "Files keep the names the generator gave them")}</span>
      ${infoText(aide)}
    </div>
    <div id="naming-body" ${c.enabled ? "" : 'style="opacity:.45;pointer-events:none"'}>
      <div class="naming-row">
        <span class="naming-lbl">${_t("naming.mesh", "Meshes")}</span>
        <div class="input"><input id="naming-mesh" value="${_esc(c.mesh)}"></div>
      </div>
      <div class="naming-row">
        <span class="naming-lbl">${_t("naming.tex", "Textures")}</span>
        <div class="input"><input id="naming-tex" value="${_esc(c.tex)}"></div>
      </div>
    </div>`;

  host.querySelector("#naming-toggle")?.addEventListener("click", async () => {
    await cfgSet("pipeline.naming.enabled", !c.enabled);
    renderNamingSection();
  });
  const bind = (id, key) => host.querySelector(id)?.addEventListener("change", async e => {
    await cfgSet(key, e.target.value.trim());
    renderNamingSection();
  });
  bind("#naming-mesh", "pipeline.naming.template_mesh");
  bind("#naming-tex", "pipeline.naming.template_texture");
}

function renderLayoutDesigner() {
  const host = $("#layout-designer");
  if (!host) return;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const order = _layoutOrder();
  const levels = _layoutLevels();
  const active = new Set(levels);

  // Une ligne par niveau, dans l'ordre choisi. Un niveau eteint garde sa
  // place : il est juste grise et ignore dans le chemin de sortie.
  const rows = order.map(lvl => {
    const on = active.has(lvl);
    // Chaque niveau porte son explication : ce qu'il regroupe, et ce qui se
    // passe quand l'info n'est pas dans le nom du fichier.
    const tip = _t("layout.tip." + lvl, "");
    return `<div class="layout-row${on ? "" : " off"}" data-layout-level="${lvl}" draggable="false" title="${_esc(tip)}">
        <span class="layout-row-grip" title="${_t("layout.drag_hint", "Drag to reorder")}">⋮⋮</span>
        <span class="layout-row-name">${_t("layout.level." + lvl, lvl)}</span>
        <span class="layout-row-info" title="${_esc(tip)}">?</span>
        <div class="switch${on ? " on" : ""}" data-layout-toggle="${lvl}"></div>
      </div>`;
  }).join("");

  // Repere : la chaine de dossiers effective, TOUJOURS affichee. Avant elle
  // ne sortait que si l'ordre correspondait a un des 7 presets nommes, donc
  // elle apparaissait et disparaissait selon la position des niveaux.
  // Ici on la compose depuis les niveaux actifs : elle resume en une ligne ce
  // qui compte vraiment (les eteints n'y figurent pas).
  const chain = levels.length
    ? levels.map(l => _t("layout.level." + l, l)).join(" → ")
    : _t("layout.none", "no subfolder");
  const label = `<span class="layout-eq">= ${chain}</span>`;

  // La consigne d'utilisation vit dans la bulle du "?" a cote du libelle :
  // affichee en permanence, elle occupait une ligne pour une phrase qu'on ne
  // lit qu'une fois.
  const help = $("#layout-help");
  if (help) {
    help.innerHTML = infoText(_t("layout.hint",
      "Toggle and drag levels to compose your folder structure."));
  }

  host.innerHTML = `
    <div class="layout-rows" id="layout-rows">${rows}</div>
    <div class="layout-sub">${_t("layout.preview", "Result")}${label}</div>
    <pre class="layout-preview-tree">${_esc(_layoutTree(levels, { files: true }).join("\n"))}</pre>`;

  host.querySelectorAll("[data-layout-toggle]").forEach(sw => {
    sw.addEventListener("click", async e => {
      e.stopPropagation();
      const lvl = sw.dataset.layoutToggle;
      // Allumer/eteindre ne touche JAMAIS a l'ordre : la ligne reste ou elle est.
      const next = new Set(active);
      if (next.has(lvl)) next.delete(lvl); else next.add(lvl);
      await _setLayoutOrder(order, next);
    });
  });
  _wireLayoutDnD();
}

// Drag-and-drop des niveaux, en evenements souris (pas le drag HTML5 natif :
// il demande draggable=true AVANT le mousedown, et se declenche mal dans la
// WebView).
//
// Rendu : la ligne saisie SUIT le curseur (translateY sans transition, donc
// collee a la souris), et les lignes survolees se decalent d'un cran avec une
// transition CSS. Le DOM n'est reordonne qu'au relachement : pendant le geste
// on ne bouge que des transforms, ce qui evite tout saut.
// Toute la ligne est saisissable SAUF le toggle, qui garde son clic.
function _wireLayoutDnD(boxId, onReorder) {
  const box = $("#" + (boxId || "layout-rows"));
  if (!box) return;
  const commit = onReorder || (next => _setLayoutOrder(next));
  let row = null, rows = [], step = 0;
  let startY = 0, fromIdx = 0, toIdx = 0, moved = false;

  // Decale les lignes non saisies pour ouvrir la place a l'index vise.
  const applyShift = () => {
    rows.forEach((r, i) => {
      if (r === row) return;
      let shift = 0;
      if (fromIdx < toIdx && i > fromIdx && i <= toIdx) shift = -step;
      else if (fromIdx > toIdx && i >= toIdx && i < fromIdx) shift = step;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };

  const onMove = (e) => {
    if (!row) return;
    const dy = e.clientY - startY;
    // Petit seuil : un clic un peu tremblant ne doit pas passer pour un drag.
    if (!moved) {
      if (Math.abs(dy) < 4) return;
      moved = true;
      row.classList.add("dragging");
    }
    row.style.transform = `translateY(${dy}px)`;
    if (step > 0) {
      let idx = Math.round(fromIdx + dy / step);
      idx = Math.max(0, Math.min(rows.length - 1, idx));
      if (idx !== toIdx) { toIdx = idx; applyShift(); }
    }
  };

  const onUp = async () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (!row) return;
    const dragged = row;
    row = null;
    dragged.classList.remove("dragging");
    rows.forEach(r => { r.style.transform = ""; r.style.zIndex = ""; });
    if (!moved || toIdx === fromIdx) return;   // clic simple ou retour a la case depart
    const next = rows.map(r => r.dataset.layoutLevel);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragged.dataset.layoutLevel);
    await commit(next);
  };

  box.querySelectorAll(".layout-row").forEach(el => {
    el.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      if (e.target.closest("[data-layout-toggle]")) return;  // le switch garde son clic
      if (e.target.closest("input, .info-tip")) return;       // et les champs leur curseur
      e.preventDefault();                                     // pas de selection de texte
      row = el;
      rows = [...box.querySelectorAll(".layout-row")];
      fromIdx = toIdx = rows.indexOf(el);
      // Pas d'une ligne a l'autre, mesure reelle (hauteur + gap du flex).
      step = rows.length > 1
        ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
        : 0;
      startY = e.clientY;
      moved = false;
      el.style.zIndex = "5";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

// ── Listes deroulantes a notre DA ───────────────────────────────────
// Le popup d'un <select> est dessine par l'OS : impossible de lui donner des
// coins arrondis, nos couleurs ou nos espacements (color-scheme ne fait que
// le passer en sombre). On empeche donc son ouverture et on dessine notre
// propre liste.
//
// Le <select> reste dans le DOM et garde son role : il porte la valeur et
// emet 'change'. Aucun code appelant n'a besoin de changer, et si ce script
// echoue le select natif continue de fonctionner.
let _SEL_POPUP = null;

function _closeSelectPopup() {
  if (!_SEL_POPUP) return;
  _SEL_POPUP.remove();
  _SEL_POPUP = null;
  document.removeEventListener("mousedown", _selOutside, true);
  document.removeEventListener("keydown", _selKey, true);
  window.removeEventListener("scroll", _selScroll, true);
  window.removeEventListener("resize", _closeSelectPopup);
}
// L'ecouteur de defilement est en capture sur la fenetre : il recoit aussi le
// defilement de la liste elle-meme. La faire defiler la fermait donc aussitot,
// ce qui ne se voyait pas tant qu'aucune liste n'etait assez longue pour
// defiler (la serie photo en compte 18).
function _selScroll(e) {
  if (_SEL_POPUP && e && e.target instanceof Node && _SEL_POPUP.contains(e.target)) return;
  _closeSelectPopup();
}
function _selOutside(e) { if (_SEL_POPUP && !_SEL_POPUP.contains(e.target)) _closeSelectPopup(); }
function _selKey(e) { if (e.key === "Escape") { e.stopPropagation(); _closeSelectPopup(); } }

function _openSelectPopup(sel) {
  _closeSelectPopup();
  const opts = [...sel.options];
  const line = (o) => {
    const i = opts.indexOf(o);
    const cls = ["sel-opt"];
    if (o.selected) cls.push("selected");
    if (o.disabled) cls.push("disabled");
    return `<div class="${cls.join(" ")}" data-i="${i}">${_esc(o.textContent)}</div>`;
  };
  const html = [];
  for (const child of sel.children) {
    if (child.tagName === "OPTGROUP") {
      html.push(`<div class="sel-group">${_esc(child.label || "")}</div>`);
      for (const o of child.children) if (o.tagName === "OPTION") html.push(line(o));
    } else if (child.tagName === "OPTION") {
      html.push(line(child));
    }
  }
  const box = document.createElement("div");
  box.className = "sel-popup";
  box.innerHTML = html.join("");
  document.body.appendChild(box);
  _SEL_POPUP = box;

  // Position : sous le champ, ou au-dessus s'il n'y a pas la place dessous.
  // Les dimensions de fenetre peuvent etre indisponibles (valeur 0) selon le
  // contexte de rendu : dans ce cas on ne recadre pas, on colle simplement
  // sous le champ plutot que de calculer une position absurde.
  const r = sel.getBoundingClientRect();
  box.style.minWidth = r.width + "px";
  const h = box.offsetHeight, w = box.offsetWidth;
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const placeAbove = vh > 0 && (vh - r.bottom) < h + 8 && r.top > h + 8;
  box.style.top = (placeAbove ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
  box.style.left = (vw > 0
    ? Math.max(8, Math.min(r.left, vw - w - 8))
    : Math.max(8, r.left)) + "px";
  // Garde l'option courante visible quand la liste est longue.
  box.querySelector(".sel-opt.selected")?.scrollIntoView({ block: "nearest" });

  box.querySelectorAll(".sel-opt").forEach(el => {
    el.addEventListener("mousedown", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const i = parseInt(el.dataset.i);
      const opt = opts[i];
      if (!opt || opt.disabled) return;          // option verrouillee (ex. resolution capee)
      if (sel.selectedIndex !== i) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      _closeSelectPopup();
    });
  });

  // En capture : on ferme avant que le clic n'atteigne quoi que ce soit.
  document.addEventListener("mousedown", _selOutside, true);
  document.addEventListener("keydown", _selKey, true);
  window.addEventListener("scroll", _selScroll, true);
  window.addEventListener("resize", _closeSelectPopup);
}

// Un seul ecouteur global : marche aussi pour les <select> crees plus tard
// (panneaux de config, modales) sans avoir a les cabler un par un.
function wireSelectPopups() {
  document.addEventListener("mousedown", e => {
    const sel = e.target.closest("select");
    if (!sel || sel.disabled || sel.multiple || sel.size > 1) return;
    e.preventDefault();      // empeche l'ouverture du popup natif
    sel.focus();
    if (_SEL_POPUP) { _closeSelectPopup(); return; }   // 2e clic = referme
    _openSelectPopup(sel);
  });
}

// ── Panneau lumiere du viewer 3D ────────────────────────────────────
// Regroupe exposition + direction du soleil. En panneau plutot qu'en
// curseurs dans la barre : ca laisse la place a de vrais libelles et a la
// valeur chiffree, sans faire deborder la barre d'outils.
let _LIGHT_PANEL = null;

function _closeLightPanel() {
  if (!_LIGHT_PANEL) return;
  _LIGHT_PANEL.remove();
  _LIGHT_PANEL = null;
  document.removeEventListener("mousedown", _lightOutside, true);
  document.removeEventListener("keydown", _lightKey, true);
}
function _lightOutside(e) {
  if (_LIGHT_PANEL && !_LIGHT_PANEL.contains(e.target) &&
      !e.target.closest("#btn-light-panel")) _closeLightPanel();
}
function _lightKey(e) { if (e.key === "Escape") _closeLightPanel(); }

function _openLightPanel(anchor) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const V = window.Viewer3D;
  const st = V?.getLighting?.() || { exposure: 1, az: 45, el: 40, shadow: 1 };
  const nm = V?.getNormalSettings?.() || { scale: 1, flipY: false, has: false };
  const fog = V?.getFog?.() || { on: false, density: 0.35, color: "", effective: "#0a1620" };
  const ao = V?.getAO?.() || { on: true, strength: 0.5 };

  const row = (id, label, min, max, step, val, unit) => `
    <div class="lp-row">
      <span class="lp-label">${label}</span>
      <input type="range" id="${id}" class="viewer-range lp-range"
             min="${min}" max="${max}" step="${step}" value="${val}">
      <span class="lp-val" id="${id}-val">${val}${unit}</span>
    </div>`;

  const box = document.createElement("div");
  box.className = "light-panel";
  box.innerHTML = `
    <div class="lp-title">${_t("viewer.light.title", "Lighting")}</div>
    ${row("lp-exposure", _t("viewer.light.exposure", "Exposure"), 0.4, 2, 0.05, st.exposure, "")}
    ${row("lp-az", _t("viewer.light.azimuth", "Sun direction"), 0, 360, 1, st.az, "°")}
    ${row("lp-el", _t("viewer.light.elevation", "Sun height"), 5, 89, 1, st.el, "°")}
    ${row("lp-shadow", _t("viewer.light.shadows", "Shadows"), 0, 2, 0.05, st.shadow, "")}
    <label class="lp-check">
      <input type="checkbox" id="lp-ao-on" ${ao.on ? "checked" : ""}>
      <span>${_t("viewer.light.ao", "Ambient occlusion")}</span>
    </label>
    ${row("lp-ao", _t("viewer.light.ao_strength", "Occlusion"), 0, 1, 0.05, ao.strength, "")}
    <div class="lp-sep"></div>
    <div class="lp-title">${_t("viewer.light.fog", "Atmosphere")}</div>
    <label class="lp-check">
      <input type="checkbox" id="lp-fog-on" ${fog.on ? "checked" : ""}>
      <span>${_t("viewer.light.fog_on", "Fog")}</span>
    </label>
    ${row("lp-fog", _t("viewer.light.fog_density", "Density"), 0, 1, 0.01, fog.density, "")}
    <div class="lp-row">
      <span class="lp-label">${_t("viewer.light.fog_color", "Color")}</span>
      <input type="color" id="lp-fog-color" class="lp-color" value="${fog.effective}">
      <button class="lp-mini" id="lp-fog-color-reset"
              title="${_t("viewer.light.fog_color_reset", "Back to the background color")}">↺</button>
    </div>
    ${nm.has ? `
      <div class="lp-sep"></div>
      ${row("lp-nrm", _t("viewer.light.normal", "Normal map"), 0, 2, 0.05, nm.scale, "")}
      <label class="lp-check">
        <input type="checkbox" id="lp-nrm-flip" ${nm.flipY ? "checked" : ""}>
        <span>${_t("viewer.light.normal_flip", "Invert green channel")}</span>
      </label>
      <div class="lp-hint">${_t("viewer.light.normal_hint",
        "If the relief looks hollowed instead of raised, invert the green channel.")}</div>` : ""}`;
  document.body.appendChild(box);
  _LIGHT_PANEL = box;

  // Positionne sous le bouton, recadre si ca deborde a droite.
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  box.style.top = (r.bottom + 6) + "px";
  box.style.left = (vw > 0
    ? Math.max(8, Math.min(r.left - box.offsetWidth + r.width, vw - box.offsetWidth - 8))
    : Math.max(8, r.left)) + "px";

  const bind = (id, fn, unit) => {
    const el = box.querySelector("#" + id);
    const out = box.querySelector("#" + id + "-val");
    el.addEventListener("input", () => {
      fn(el.value);
      if (out) out.textContent = el.value + (unit || "");
    });
  };
  // `_pushViewerState` en plus de l'effet local : les curseurs de lumiere
  // comptent autant que les boutons pour la fenetre detachee.
  bind("lp-exposure", v => { V?.setExposure?.(v); _pushViewerState(); }, "");
  bind("lp-az", v => { V?.setSun?.(v, null); _pushViewerState(); }, "°");
  bind("lp-el", v => { V?.setSun?.(null, v); _pushViewerState(); }, "°");
  bind("lp-shadow", v => { V?.setShadowStrength?.(v); _pushViewerState(); }, "");
  const aoOn = box.querySelector("#lp-ao-on");
  aoOn?.addEventListener("change", () => { V?.setAO?.({ on: aoOn.checked }); _pushViewerState(); });
  bind("lp-ao", v => {
    V?.setAO?.({ strength: v, on: true });
    if (aoOn) aoOn.checked = true;
    _pushViewerState();
  }, "");
  const fogOn = box.querySelector("#lp-fog-on");
  fogOn?.addEventListener("change", () => { V?.setFog?.({ on: fogOn.checked }); _pushViewerState(); });
  // Toucher la densite allume le brouillard : regler un effet eteint ne
  // montrerait rien et ferait croire que le curseur ne marche pas.
  bind("lp-fog", v => {
    V?.setFog?.({ density: v, on: true });
    if (fogOn) fogOn.checked = true;
    _pushViewerState();
  }, "");
  box.querySelector("#lp-fog-color")?.addEventListener("input", (e) => {
    V?.setFog?.({ color: e.target.value });
    _pushViewerState();
  });
  box.querySelector("#lp-fog-color-reset")?.addEventListener("click", () => {
    const f = V?.setFog?.({ color: "" });
    const c = box.querySelector("#lp-fog-color");
    if (c && f) c.value = f.effective;
    _pushViewerState();
  });
  if (nm.has) {
    bind("lp-nrm", v => V?.setNormalScale?.(v), "");
    box.querySelector("#lp-nrm-flip")?.addEventListener("change", (e) => {
      V?.setNormalFlipY?.(e.target.checked);
    });
  }

  document.addEventListener("mousedown", _lightOutside, true);
  document.addEventListener("keydown", _lightKey, true);
}

function wireLightPanel() {
  const btn = document.getElementById("btn-light-panel");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_LIGHT_PANEL) { _closeLightPanel(); return; }
    _openLightPanel(btn);
  });
}

// ── Sidebar DCC status : dynamique selon paths configurés ──────────
const DCC_LABELS = [
  { key: "gaea_exe",    name: "Gaea" },
  { key: "houdini_exe", name: "Houdini" },
  { key: "unreal_exe",  name: "Unreal" },
  { key: "unity_exe",   name: "Unity" },
];

function refreshDCCStatus() {
  DCC_LABELS.forEach(({key, name}) => {
    const id = key.replace("_exe", "");
    const isOnline = !!(cfgGet(`paths.${key}`) || "").trim();
    const pill = document.getElementById(`dcc-pill-${id}`);
    if (pill) {
      pill.dataset.status = isOnline ? "online" : "idle";
      pill.title = `${name}, ${isOnline ? (window.I18N?.t("misc.online") || "online") : (window.I18N?.t("misc.idle") || "idle")}`;
    }
    const old = document.getElementById(`dcc-status-${id}`);
    if (old) {
      old.textContent = isOnline
        ? "● " + (window.I18N?.t("misc.online") || "online")
        : "○ " + (window.I18N?.t("misc.idle")   || "idle");
      old.style.color = isOnline ? "var(--accent)" : "var(--fg-faint)";
    }
  });
}

// ── Partage viewer / liste d'assets ────────────────────────────────
// La hauteur du viewer est memorisee : c'est un reglage d'atelier, pas une
// preference de projet, donc elle vit dans le navigateur et non dans la
// config du projet.
const PREVIEW_H_KEY = "stratum.previewHeight";

function _applyPreviewHeight(px) {
  const wrap = document.getElementById("preview-3d-wrap");
  if (!wrap) return;
  wrap.style.setProperty("--preview-h", Math.round(px) + "px");
  // Le canvas WebGL ne suit pas tout seul la taille de son conteneur.
  try { window.Viewer3D?.resize?.(); } catch (_) {}
}

function initPreviewSplit() {
  const bar = document.getElementById("preview-split");
  const wrap = document.getElementById("preview-3d-wrap");
  if (!bar || !wrap) return;

  let saved = 0;
  try { saved = parseInt(localStorage.getItem(PREVIEW_H_KEY)) || 0; } catch (_) {}
  if (saved) _applyPreviewHeight(saved);

  let startY = 0, startH = 0, dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const tab = bar.closest(".output-tab");
    // On ne descend jamais sous 140px de viewer ni sous 90px de liste :
    // en dessous, ni l'un ni l'autre ne sert plus a rien.
    const max = Math.max(140, (tab ? tab.getBoundingClientRect().height : 600) - 190);
    const h = Math.min(max, Math.max(140, startH + (e.clientY - startY)));
    _applyPreviewHeight(h);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove("dragging");
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    try {
      localStorage.setItem(PREVIEW_H_KEY,
        String(Math.round(wrap.getBoundingClientRect().height)));
    } catch (_) {}
  };

  bar.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = wrap.getBoundingClientRect().height;
    bar.classList.add("dragging");
    // Sans ca, le glisser selectionne le texte des cartes au passage.
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Double-clic : revient au partage par defaut.
  bar.addEventListener("dblclick", () => {
    try { localStorage.removeItem(PREVIEW_H_KEY); } catch (_) {}
    wrap.style.removeProperty("--preview-h");
    try { window.Viewer3D?.resize?.(); } catch (_) {}
  });
}

// ── Tabs Preview / Console / Files ─────────────────────────────────
function wireTabs() {
  initPreviewSplit();
  // L'onglet Apercu est celui affiche au demarrage.
  $("#output-content")?.classList.add("pane-fixed");
  $$(".tab").forEach(t => {
    t.addEventListener("click", () => {
      const id = t.dataset.tab;
      $$(".tab").forEach(x => x.classList.toggle("active", x.dataset.tab === id));
      // display = "" effacait le display:flex pose en ligne : sans regle CSS
      // pour .output-tab, l'onglet retombait en block, le flex column sautait
      // et toute la mise en page se reempilait de travers.
      $$(".output-tab").forEach(x => x.style.display = (x.dataset.tab === id) ? "flex" : "none");
      // Seul l'onglet Apercu gere son propre defilement, bande par bande.
      $("#output-content")?.classList.toggle("pane-fixed", id === "preview");
      // Init du viewer 3D quand on switch sur Preview (lazy init)
      // + auto-refresh de la liste d'assets pour récupérer les nouveaux fichiers
      if (id === "preview" && window.Viewer3D) {
        const wrap = $("#preview-3d-canvas");
        if (wrap && !wrap._initialized) {
          window.Viewer3D.init(wrap);
          wrap._initialized = true;
        }
        // Auto-refresh à chaque visite de l'onglet Preview
        refreshAssetPreview();
      }
      // Auto-refresh de Files quand on l'ouvre
      if (id === "files") {
        refreshFilesTab();
      }
    });
  });
}

// Ce que l'utilisateur a demande, independamment de l'asset affiche. Avant, la
// normale retombait a zero a chaque changement : sur une serie ou une variante
// sur deux porte une normal map, il fallait la rallumer sans arret.
let _normalWanted = false;

// Le bouton ne sert a rien sans normal map : on le grise et on dit pourquoi,
// plutot que de laisser cliquer dans le vide. Mais griser n'est pas oublier :
// l'asset suivant qui en a une la retrouve allumee.
function _syncNormalButton(has) {
  const btn = document.querySelector('.viewer-tool[data-tool="normal"]');
  if (!btn) return;
  btn.disabled = !has;
  btn.style.opacity = has ? "" : "0.35";
  btn.title = has
    ? (window.I18N?.t("viewer.normal_on") || "Normal map found. Off by default: it restores detail on decimated LODs, the full mesh already has it.")
    : (window.I18N?.t("viewer.normal_none") || "No normal map found next to this mesh");
  const on = has && _normalWanted;
  btn.classList.toggle("active", on);
  window.Viewer3D?.setNormalEnabled(on);
}

// Etat d'affichage de l'apercu, tel que la fenetre detachee doit le reproduire.
// On le lit des boutons plutot que d'en tenir une copie : la barre d'outils est
// deja la source de verite, en dupliquer une seconde les ferait diverger.
function _viewerState() {
  const on = (tool) => {
    const b = document.querySelector(`.viewer-tool[data-tool="${tool}"]`);
    return !!(b && b.classList.contains("active"));
  };
  const V = window.Viewer3D;
  const st = {
    texture: on("texture"),
    normal: on("normal"),
    wireframe: on("wireframe"),
    grid: on("grid"),
    rotate: on("rotate"),
  };
  try { st.lighting = V?.getLighting?.() || null; } catch (e) { st.lighting = null; }
  try { st.normalSettings = V?.getNormalSettings?.() || null; } catch (e) {}
  try { st.fog = V?.getFog?.() || null; } catch (e) { st.fog = null; }
  try { st.ao = V?.getAO?.() || null; } catch (e) { st.ao = null; }
  st.theme = document.documentElement.className || "theme-dark";
  return st;
}

function _pushViewerState() {
  try { eel.set_preview_view(_viewerState())(); } catch (e) { /* backend absent */ }
}

async function _openPreviewWindow() {
  try {
    const r = await eel.open_preview_window()();
    if (r && r.ok && r.mode === "browser") {
      // Repli assume : sans pywebview, l'apercu s'ouvre dans le navigateur du
      // systeme. On le dit, sinon la fenetre semble surgir de nulle part.
      flashStatus(_tt("viewer.popout_browser",
                      "Aperçu ouvert dans le navigateur"), "var(--warn)");
    } else if (r && !r.ok) {
      flashStatus(r.error || _tt("viewer.popout_fail", "Ouverture impossible"),
                  "var(--err)");
    }
  } catch (e) {
    flashStatus(_tt("viewer.popout_fail", "Ouverture impossible"), "var(--err)");
  }
}

// ── 3D Viewer toolbar wiring ───────────────────────────────────────
function wireViewerTools() {
  document.querySelectorAll(".viewer-tool[data-tool]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      const V = window.Viewer3D;
      if (!V) return;
      const toggle = () => btn.classList.toggle("active");
      const isActive = () => btn.classList.contains("active");

      switch (tool) {
        case "texture":    toggle(); V.setTextureEnabled(isActive()); break;
        case "normal":     toggle(); _normalWanted = isActive();
                           V.setNormalEnabled(_normalWanted); break;
        case "wireframe":  toggle(); V.setWireframe(isActive()); break;
        case "grid":       toggle(); V.setGrid(isActive()); break;
        case "rotate":     toggle(); V.setAutoRotate(isActive()); break;
        case "reset":      V.resetView(); break;
        case "screenshot": _togglePhotoPanel(btn); break;
        // La carte fait 400 pixels de large : pour juger une silhouette de
        // terrain, il faut de la place. La fenetre detachee montre la meme
        // scene, redimensionnable et deplacable sur un autre ecran.
        case "popout":     _openPreviewWindow(); break;
      }
      // Le reglage vient de changer : la fenetre detachee doit le savoir.
      if (tool !== "screenshot" && tool !== "popout") _pushViewerState();
    });
  });

  const sel = document.getElementById("viewer-lighting");
  if (sel) {
    sel.addEventListener("change", () => {
      window.Viewer3D?.applyLightingPreset(sel.value);
      _pushViewerState();
      // Le preset repose exposition ET direction du soleil : si le panneau
      // est ouvert, ses curseurs doivent refleter les nouvelles valeurs.
      _refreshLightPanel();
    });
  }
  wireLightPanel();
}

// Recale les curseurs du panneau sur l'etat reel du viewer.
function _refreshLightPanel() {
  if (!_LIGHT_PANEL) return;
  const st = window.Viewer3D?.getLighting?.();
  if (!st) return;
  const set = (id, v, unit) => {
    const el = _LIGHT_PANEL.querySelector("#" + id);
    const out = _LIGHT_PANEL.querySelector("#" + id + "-val");
    if (el) el.value = v;
    if (out) out.textContent = v + (unit || "");
  };
  set("lp-exposure", st.exposure, "");
  set("lp-az", st.az, "°");
  set("lp-el", st.el, "°");
  set("lp-shadow", st.shadow, "");
}

// ── Photos de presentation ─────────────────────────────────────────
// L'ancien bouton faisait un telechargement de navigateur : la photo tombait
// dans Telechargements, a la taille de la carte, fond compris, sans que rien
// dise ou. Le panneau Photo choisit le fond et la resolution, et Python range
// les fichiers dans {dossier de travail}/_Photos/{projet}/{style}/.
let _PHOTO_PANEL = null;
let _PHOTO_BATCH = null;   // { cancel } pendant une serie

function _closePhotoPanel() {
  if (!_PHOTO_PANEL) return;
  _PHOTO_PANEL.remove();
  _PHOTO_PANEL = null;
  document.removeEventListener("mousedown", _photoOutside, true);
  document.removeEventListener("keydown", _photoKey, true);
}

function _photoOutside(e) {
  // Pendant une serie, le panneau porte le bouton Arreter : il reste ouvert.
  if (!_PHOTO_PANEL || _PHOTO_BATCH) return;
  if (_PHOTO_PANEL.contains(e.target)) return;
  // Les listes deroulantes du panneau sont dessinees a part, a la racine de
  // la page : sans cette exception, choisir une resolution fermait le panneau
  // avant que le choix n'arrive.
  if (e.target.closest && e.target.closest(".sel-popup")) return;
  if (e.target.closest && e.target.closest('.viewer-tool[data-tool="screenshot"]')) return;
  _closePhotoPanel();
}

function _photoKey(e) {
  if (e.key === "Escape" && !_PHOTO_BATCH) _closePhotoPanel();
}

async function _togglePhotoPanel(anchor) {
  if (_PHOTO_PANEL) { _closePhotoPanel(); return; }
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  // Relu cote Python : la grande fenetre a pu changer ces reglages depuis.
  const s = window.StratumPhoto
    ? await window.StratumPhoto.settings()
    : Object.assign({}, cfgGet("ui.photo") || {});
  let folder = "";
  let customFolder = false;
  try {
    const pf = (await eel.photos_folder()()) || {};
    folder = pf.path || "";
    customFolder = !!pf.custom;
  } catch (e) { /* hors app */ }
  const opts = window.StratumPhoto ? window.StratumPhoto.scopeOptions(ASSETS_CACHE) : [];
  let scope = opts.some(o => o.value === s.scope) ? s.scope : "all";
  const countOf = (sc) => (opts.find(o => o.value === sc) || { count: 0 }).count;
  const n = countOf(scope);

  const box = document.createElement("div");
  box.className = "light-panel photo-panel";
  // Les reglages (fond, grille, resolution, textes) sont dessines par
  // photo.js : la grande fenetre affiche exactement les memes.
  box.innerHTML = `
    <div class="lp-title">${_t("viewer.photo.title", "Photo")}</div>
    <div class="ps-host" id="pp-settings"></div>
    <div class="lp-sep"></div>
    <div class="lp-row">
      <span class="lp-label">${_t("viewer.photo.scope", "Series")}</span>
      <select id="pp-scope" class="pp-select">${opts.map(o =>
        `<option value="${_esc(o.value)}" ${o.value === scope ? "selected" : ""}>${
          _esc(o.label || _t("viewer.photo.scope_all", "Everything"))} (${o.count})</option>`).join("")}</select>
    </div>
    <div class="pp-actions">
      <button class="btn primary" id="pp-shoot">${_t("viewer.photo.shoot", "Take photo")}</button>
      <button class="btn" id="pp-all" ${n ? "" : "disabled"}>${
        _t("viewer.photo.shoot_all", "Photograph all ({n})").replace("{n}", n)}</button>
    </div>
    <div class="pp-progress" id="pp-progress" hidden></div>
    <div class="lp-sep"></div>
    <div class="pp-folder">
      <span class="lp-label">${_t("viewer.photo.folder", "Folder")}</span>
      <span class="pp-path" id="pp-path" title="${_esc(folder)}">${_esc(folder)}</span>
    </div>
    <div class="pp-folder-actions">
      <button class="lp-mini" id="pp-change">${_t("viewer.photo.change", "Change")}</button>
      <button class="lp-mini" id="pp-reset-folder" ${customFolder ? "" : "hidden"}
              title="${_t("viewer.photo.folder_reset", "Back to the default folder")}">↺</button>
      <button class="lp-mini" id="pp-open">${_t("viewer.photo.open", "Open")}</button>
    </div>`;
  document.body.appendChild(box);
  _PHOTO_PANEL = box;
  if (window.StratumPhoto) await window.StratumPhoto.renderSettings(box.querySelector("#pp-settings"), _t);

  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  box.style.top = (r.bottom + 6) + "px";
  box.style.left = (vw > 0
    ? Math.max(8, Math.min(r.left - box.offsetWidth + r.width, vw - box.offsetWidth - 8))
    : Math.max(8, r.left)) + "px";

  box.querySelector("#pp-open").addEventListener("click", async () => {
    try { await eel.open_photos_folder()(); } catch (e) { /* hors app */ }
  });
  box.querySelector("#pp-shoot").addEventListener("click", _photoShootCurrent);

  const scopeSel = box.querySelector("#pp-scope");
  scopeSel?.addEventListener("change", async () => {
    scope = scopeSel.value;
    const allBtn = box.querySelector("#pp-all");
    if (allBtn && !_PHOTO_BATCH) {
      allBtn.textContent = _t("viewer.photo.shoot_all", "Photograph all ({n})").replace("{n}", countOf(scope));
      allBtn.disabled = !countOf(scope);
    }
    await cfgSet("ui.photo_scope", scope);
  });

  const showFolder = (pf) => {
    const pathEl = box.querySelector("#pp-path");
    if (pathEl) { pathEl.textContent = pf.path || ""; pathEl.title = pf.path || ""; }
    const rst = box.querySelector("#pp-reset-folder");
    if (rst) rst.hidden = !pf.custom;
  };
  box.querySelector("#pp-change")?.addEventListener("click", async () => {
    let picked = "";
    try { picked = await eel.pick_folder(_t("viewer.photo.folder", "Folder"), folder)(); } catch (e) { /* hors app */ }
    if (!picked) return;
    let res = null;
    try { res = await eel.set_photos_folder(picked)(); } catch (e) { /* hors app */ }
    if (!res || !res.ok) {
      flashStatus(res && res.error === "in_project"
        ? _t("viewer.photo.folder_in_project", "Not inside the project: its PNGs would be taken for textures.")
        : _t("viewer.photo.failed", "Photo failed"), "var(--warn)");
      return;
    }
    folder = res.path;
    showFolder(res);
  });
  box.querySelector("#pp-reset-folder")?.addEventListener("click", async () => {
    let res = null;
    try { res = await eel.set_photos_folder("")(); } catch (e) { /* hors app */ }
    if (res && res.ok) { folder = res.path; showFolder(res); }
  });
  box.querySelector("#pp-all").addEventListener("click", _photoShootAll);

  document.addEventListener("mousedown", _photoOutside, true);
  document.addEventListener("keydown", _photoKey, true);
}

async function _photoShootCurrent() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const sel = document.querySelector("[data-asset-idx].selected");
  const a = sel ? ASSETS_CACHE[parseInt(sel.dataset.assetIdx)] : null;
  if (!a || !window.StratumPhoto) {
    flashStatus(_t("viewer.photo.no_asset", "Select an asset first"), "var(--warn)");
    return;
  }
  const r = await window.StratumPhoto.shoot(a);
  if (r && r.ok) {
    flashStatus(`${_t("viewer.photo.saved", "Photo saved")} · ${r.width}×${r.height}`);
  } else {
    flashStatus(_t("viewer.photo.failed", "Photo failed")
      + (r && r.error ? ` : ${r.error}` : ""), "var(--err)");
  }
}

async function _photoShootAll() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  // Deuxieme clic pendant la serie = arreter apres la photo en cours.
  if (_PHOTO_BATCH) { _PHOTO_BATCH.cancel = true; return; }
  if (!window.StratumPhoto) return;
  const btn = _PHOTO_PANEL?.querySelector("#pp-all");
  const prog = _PHOTO_PANEL?.querySelector("#pp-progress");
  // Un sujet qui tourne serait photographie sous un angle different a chaque
  // fois : la serie doit etre homogene.
  const rotBtn = document.querySelector('.viewer-tool[data-tool="rotate"]');
  const wasRot = !!(rotBtn && rotBtn.classList.contains("active"));
  window.Viewer3D?.setAutoRotate(false);
  _PHOTO_BATCH = { cancel: false };
  if (btn) btn.textContent = _t("viewer.photo.stop", "Stop");

  const scopeSel = _PHOTO_PANEL?.querySelector("#pp-scope");
  const scope = scopeSel ? scopeSel.value : ((await window.StratumPhoto.settings()).scope || "all");
  const list = window.StratumPhoto.filterAssets(ASSETS_CACHE, scope);
  const res = await window.StratumPhoto.shootAll(list,
    (a) => loadAssetInViewer(ASSETS_CACHE.indexOf(a)),
    (i, n, a) => {
      if (!prog) return;
      prog.hidden = false;
      prog.textContent = _t("viewer.photo.progress", "Photo {i} / {n}")
        .replace("{i}", i + 1).replace("{n}", n) + ` · ${a.name}`;
    },
    () => !!(_PHOTO_BATCH && _PHOTO_BATCH.cancel));

  _PHOTO_BATCH = null;
  window.Viewer3D?.setAutoRotate(wasRot);
  if (prog) prog.hidden = true;
  if (btn) btn.textContent = _t("viewer.photo.shoot_all", "Photograph all ({n})").replace("{n}", list.length);
  flashStatus(_t("viewer.photo.saved_all", "{n} photos saved").replace("{n}", res.ok),
              res.ok ? undefined : "var(--warn)");
}

// ── 3D Asset preview ───────────────────────────────────────────────
let ASSETS_CACHE = [];

// Code couleur des styles graphiques. Valeurs reprises telles quelles du site
// Kalysteon (products.html, .badge-* et .filter-pill) : un pack doit se
// reconnaitre a la meme couleur dans Stratum, sur la boutique et sur sa fiche.
// Toute divergence ici se lit comme deux produits differents.
const _KIND_COLORS = {
  realistic: "#F2D777",   // or
  stylized:  "#5BA4F5",   // bleu
  polygonal: "#5ECFB7",   // vert d'eau
  cartoon:   "#A87AF0",   // violet
  retro:     "#F04444",   // rouge
  // Aucun style lisible dans le nom : neutre, jamais la couleur du realiste.
  // Afficher de l'or affirmerait un style que le fichier ne declare pas, et
  // c'est exactement ce qu'on a passe la journee a retirer du reste du code.
  mesh:      "var(--fg-dim)",
};

function _assetRowHTML(a, i) {
  const kindColor = _KIND_COLORS[a.kind] || _KIND_COLORS.mesh;
  // Les indicateurs ne sont montres que lorsqu'ils sont vrais : une pastille
  // grisee "pas de normale" occupe autant de place qu'une vraie information.
  // Ils tiennent dans UNE cellule : la grille en declare cinq, et le sixieme
  // enfant passait a la ligne, ce qui doublait la hauteur de chaque row.
  const maps = [
    a.texture_url ? `<span title="texture">T</span>` : "",
    a.normal_url ? `<span title="normal map">N</span>` : "",
  ].join("");
  return `
    <div class="asset-row" data-asset-idx="${i}" tabindex="0">
      <span class="asset-row-dot" style="background:${kindColor}"></span>
      <span class="asset-row-ext" style="color:${kindColor}">${a.ext}</span>
      <span class="asset-row-name" title="${a.name}">${a.name}</span>
      <span class="asset-row-meta">${_fmtSize(a.size_kb)}</span>
      <span class="asset-row-maps">${maps}</span>
    </div>`;
}

async function refreshAssetPreview() {
  // Le scan peut faire basculer le projet de "avec styles" a "sans styles" :
  // le panneau Houdini doit suivre, sinon il garde ses cinq colonnes jusqu'a
  // ce qu'on pense a le refermer.
  const stylesBefore = _projectUsesStyles();
  try {
    ASSETS_CACHE = await eel.list_assets()();
  } catch (e) {
    ASSETS_CACHE = [];
  }
  if (_projectUsesStyles() !== stylesBefore
      && document.querySelector('[data-expand="houdini"].open')) {
    _loadHdaParams();
  }
  // Met à jour la barre "Source: ..."
  try {
    const src = await eel.get_preview_source()();
    const pathEl = $("#preview-source-path");
    const resetEl = $("#btn-preview-reset");
    if (pathEl) {
      pathEl.textContent = src.path || "—";
      pathEl.title = src.path || "";
      // Chemin introuvable : on le dit, au lieu de laisser croire a un
      // dossier vide (cas classique : dossier renomme ou deplace).
      const missing = src.path && src.exists === false;
      pathEl.style.color = missing ? "var(--err)" : "";
      pathEl.style.textDecoration = missing ? "line-through" : "";
      if (missing) pathEl.title = (window.I18N?.t("preview.folder_missing") || "Folder not found") + " : " + src.path;
      window._PREVIEW_SRC_MISSING = !!missing;
    }
    if (resetEl) resetEl.style.display = src.is_override ? "" : "none";
  } catch (e) {}
  const grid = $("#assets-grid");
  const countEl = $("#assets-count");
  if (!grid) return;
  countEl.textContent = `${ASSETS_CACHE.length} ${window.I18N?.t("preview.found") || "found"}`;

  if (ASSETS_CACHE.length === 0) {
    // Des textures sans maillage, c'est un graphe qui n'exporte pas de
    // maillage, pas un run rate. On le dit, sinon l'ecran a l'air en panne.
    let onlyTex = 0;
    try {
      const sum = await eel.preview_folder_summary()();
      if (sum && !sum.meshes) onlyTex = sum.textures || 0;
    } catch (e) { /* backend absent */ }
    const msg = onlyTex
      ? `${(window.I18N?.t("preview.textures_only") || "{n} textures, no mesh: this Gaea graph exports no mesh.").replace("{n}", onlyTex)}`
      : window._PREVIEW_SRC_MISSING
      ? `<span style="color:var(--err)">${window.I18N?.t("preview.folder_missing") || "Folder not found"}</span><br><span style="font-size:10.5px">${window.I18N?.t("preview.folder_missing_hint") || "Check the export folder in the Project card."}</span>`
      : (window.I18N?.t("preview.no_mesh") || "no mesh found in export folder yet");
    grid.innerHTML = `<div class="faint" style="grid-column:1/-1;font-size:11px;font-style:italic;padding:14px 0;text-align:center;line-height:1.6">${msg}</div>`;
    return;
  }

  // Force 1 colonne pour le layout en rows (override l'ancien grid 3 colonnes)
  grid.style.gridTemplateColumns = "1fr";
  grid.style.gap = "10px";

  // Group par variant. Si tous les assets sont sans variant OU s'il n'y a
  // qu'un seul variant, on ne montre pas de section (juste la liste).
  const byVariant = new Map();
  ASSETS_CACHE.forEach((a, i) => {
    const key = a.variant || "";
    if (!byVariant.has(key)) byVariant.set(key, []);
    byVariant.get(key).push({ ...a, _idx: i });
  });
  const variantKeys = [...byVariant.keys()].sort();
  const showSections = variantKeys.length > 1
    || (variantKeys.length === 1 && variantKeys[0] !== "");

  if (!showSections) {
    grid.innerHTML = `<div class="asset-list">${
      ASSETS_CACHE.map((a, i) => _assetRowHTML(a, i)).join("")
    }</div>`;
  } else {
    grid.innerHTML = variantKeys.map(vk => {
      const items = byVariant.get(vk);
      const label = vk || "Unsorted";
      return `
        <div class="asset-section">
          <div class="asset-section-head">
            <span class="asset-section-pill">${label}</span>
            <span class="asset-section-count">${items.length}</span>
          </div>
          <div class="asset-list">${items.map(a => _assetRowHTML(a, a._idx)).join("")}</div>
        </div>`;
    }).join("");
  }

  // Wire click → load dans le viewer 3D
  grid.querySelectorAll("[data-asset-idx]").forEach(el => {
    el.addEventListener("click", () => loadAssetInViewer(parseInt(el.dataset.assetIdx)));
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        loadAssetInViewer(parseInt(el.dataset.assetIdx));
      }
    });
  });

  // Auto-load le premier asset au premier coup
  if (ASSETS_CACHE.length > 0 && !window._firstAssetLoaded) {
    window._firstAssetLoaded = true;
    const canvas = $("#preview-3d-canvas");
    if (canvas && !canvas._initialized && window.Viewer3D) {
      window.Viewer3D.init(canvas);
      canvas._initialized = true;
    }
    setTimeout(() => loadAssetInViewer(0), 200);
  }
}

// Miroir cote UI du jeton de chargement du viewer : un clic abandonne ne doit
// ni masquer le voile ni afficher une erreur par-dessus le chargement gagnant.
let _viewerReq = 0;

async function loadAssetInViewer(idx) {
  const a = ASSETS_CACHE[idx];
  if (!a || !window.Viewer3D) return;

  // Mark selected + loading state visuel sur la row
  document.querySelectorAll("[data-asset-idx]").forEach(el => {
    const isSel = parseInt(el.dataset.assetIdx) === idx;
    el.classList.toggle("selected", isSel);
    el.classList.toggle("loading", isSel);
  });

  // Ensure init
  const canvas = $("#preview-3d-canvas");
  if (canvas && !canvas._initialized) {
    window.Viewer3D.init(canvas);
    canvas._initialized = true;
  }

  const req = ++_viewerReq;
  // La fenetre detachee lit cette valeur cote serveur : elle suit la selection
  // sans qu'on ait a lui envoyer quoi que ce soit, et se resynchronise seule
  // si elle est ouverte apres coup.
  try { eel.set_preview_selection(idx)(); } catch (e) { /* backend absent */ }

  // Show loader, hide empty state
  $("#preview-3d-empty").style.display = "none";
  $("#preview-3d-loading").style.display = "flex";
  const titleEl = $("#preview-title");
  titleEl.textContent = a.name;
  // Tronque a l'affichage : le nom entier reste lisible au survol.
  titleEl.title = a.name || "";

  try {
    console.log("[viewer] loading", a.mesh_url, "ext:", a.ext, "texture:", a.texture_url);
    const stats = await window.Viewer3D.loadAsset(a.mesh_url, a.texture_url, a.ext, a.normal_url);
    // null = un clic plus recent a pris la main. On sort sans rien toucher :
    // le chargement gagnant s'occupe du titre, des stats et du voile.
    if (!stats) return;
    console.log("[viewer] loaded", stats);
    _syncNormalButton(stats.hasNormal);
    _pushViewerState();
    $("#preview-3d-info").style.display = "block";
    $("#preview-3d-stats").textContent = `${stats.vertices.toLocaleString()} verts · ${stats.triangles.toLocaleString()} tris`;
  } catch (e) {
    if (req !== _viewerReq) return;   // erreur d'un chargement depasse
    console.error("[viewer] load failed", e);
    const msg = e?.message || String(e);
    flashStatus(`Load failed: ${msg}`, "var(--err)");
    // Affiche l'erreur DIRECTEMENT dans l'empty state pour que l'user voie ce qui foire
    const emptyEl = $("#preview-3d-empty");
    emptyEl.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--err)">
        <circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/>
      </svg>
      <div style="font-size:13px;color:var(--err);margin-top:6px">${window.I18N?.t("preview.load_failed") || "3D load failed"}</div>
      <div style="font-size:11px;color:var(--fg-faint);max-width:380px;font-family:var(--font-mono);word-break:break-word">${msg.slice(0, 200)}</div>
      <div style="font-size:10px;color:var(--fg-faint);margin-top:4px">URL: ${a.mesh_url}</div>`;
    emptyEl.style.display = "flex";
  } finally {
    // Seule la demande encore active a le droit de retirer le voile : sinon
    // un clic abandonne le levait alors que le suivant chargeait toujours.
    if (req === _viewerReq) {
      $("#preview-3d-loading").style.display = "none";
      // Retire l'état loading sur les rows (la selected reste highlightée)
      document.querySelectorAll("[data-asset-idx].loading").forEach(el => el.classList.remove("loading"));
    }
  }
}

// ── Nav sidebar ────────────────────────────────────────────────────
function showPage(name) {
  $$(".page").forEach(p => {
    p.style.display = (p.dataset.page === name) ? "flex" : "none";
  });
  $$("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === name));
  // Auto-refresh la Library quand on l'ouvre
  if (name === "library" && typeof buildLibraryPage === "function") {
    buildLibraryPage();
  }
  if (name === "store" && typeof buildStorePage === "function") {
    buildStorePage();
  }
}

function wireNav() {
  $$("[data-nav]").forEach(el => {
    el.addEventListener("click", () => {
      showPage(el.dataset.nav);
    });
  });
}

// ── PAGE SETTINGS ──────────────────────────────────────────────────
const DCC_DEFS = [
  { key: "gaea_exe",    name: "Gaea",          icon: "Ga",  color: "#f5d04a",
    filetypes: [["Gaea Swarm", "Gaea.Swarm.exe"], ["Exe", "*.exe"]],
    statusOK: "Detected · CLI ready", statusOff: "Not configured" },
  { key: "houdini_exe", name: "Houdini",       icon: "Hou", color: "#ff7a3a",
    filetypes: [["hython", "hython.exe"], ["Exe", "*.exe"]],
    statusOK: "Detected · HDA introspection ready", statusOff: "Not configured" },
  { key: "unreal_exe",  name: "Unreal Engine", icon: "UE",  color: "#a78bfa",
    filetypes: [["UnrealEditor-Cmd", "UnrealEditor-Cmd.exe"], ["Exe", "*.exe"]],
    statusOK: "Detected · Python script ready", statusOff: "Not configured" },
  { key: "unity_exe",   name: "Unity",         icon: "Uni", color: "#5ea7ff",
    filetypes: [["Unity", "Unity.exe"], ["Exe", "*.exe"]],
    statusOK: "Detected · AutoImporter ready", statusOff: "Not configured" },
];

const PROJECT_PATHS = [
  { key: "unreal_project", label: "Unreal project (.uproject)", filetypes: [["uproject", "*.uproject"]], isDir: false },
  { key: "unity_project",  label: "Unity project folder", isDir: true },
  // Note : "inprogress" override n'est plus exposé. Gaea/Houdini écrivent
  // directement dans {Export}/{Project}/ maintenant,pas de working folder
  // séparé. Si une config legacy a paths.inprogress, on l'honore quand même.
];

function flashStatus(text, color) {
  const el = $("#settings-status");
  if (!el) return;
  el.textContent = text;
  el.style.color = color || "var(--ok)";
  setTimeout(() => { el.textContent = ""; }, 2500);
}

// ── INTEGRATIONS card ───────────────────────────────────────────────
let _DCC_VERSIONS = {};  // {key: [{path, version, default}]}
// Licence Houdini reellement active. Le chemin de hython ne dit que la
// version : une Apprentice installe le meme exe qu'une Commercial. Sans ca,
// un utilisateur non commercial passait tous les controles au vert.
let _HOU_LICENSE = null;

async function _refreshHoudiniLicense(force) {
  if (!(cfgGet("paths.houdini_exe") || "").trim()) { _HOU_LICENSE = null; return; }
  try { _HOU_LICENSE = await eel.get_houdini_license(!!force)(); }
  catch (e) { _HOU_LICENSE = null; }
}

// Ligne d'etat licence affichee sous Houdini dans Reglages.
function _houLicenseHTML() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const l = _HOU_LICENSE;
  if (!l) return "";
  if (!l.ok) {
    return `<div class="dcc-license err" title="${_esc(l.error || "")}">
      ${_t("set.dcc.lic_unknown", "Licence unreadable")}</div>`;
  }
  const cls = l.commercial ? "ok" : "err";
  const suffix = l.commercial ? "" :
    " · " + _t("set.dcc.lic_noncommercial", "non-commercial output");
  return `<div class="dcc-license ${cls}">${_esc(l.category)}${suffix}</div>`;
}

async function _refreshDCCVersions() {
  try { _DCC_VERSIONS = await eel.list_software_versions()(); }
  catch (e) { _DCC_VERSIONS = {}; }
  // La sonde est mise en cache cote Python : instantanee une fois chauffee.
  await _refreshHoudiniLicense(false);
}

function buildIntegrationsCat() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const connected = DCC_DEFS.filter(d => !!(cfgGet(`paths.${d.key}`) || "").trim()).length;

  const dccRows = DCC_DEFS.map(d => {
    const path = cfgGet(`paths.${d.key}`) || "";
    const isOn = !!path.trim();
    const short = path ? path.replace(/^[A-Z]:[\\\/]/, p => p).slice(-60) : "";
    const versions = _DCC_VERSIONS[d.key] || [];
    // Dropdown des versions trouvées (visible si 2+)
    let versionSelect = `<span></span>`;  // placeholder pour aligner le grid
    // Unreal et Unity : la version suit le projet cible (exe_for_project). Un
    // menu ici ne ferait que contredire ce choix automatique : on dit juste
    // combien de versions sont installees.
    const autoVer = d.key === "unreal_exe" || d.key === "unity_exe";
    if (versions.length > 1 && autoVer) {
      versionSelect = `<span class="chip" title="${_esc(_t("set.dcc.auto_body", ""))}" style="font-size:10px;white-space:nowrap">${
        _esc(_t("set.dcc.auto_versions", "{n} versions · auto").replace("{n}", versions.length))}</span>`;
    } else if (versions.length > 1) {
      const opts = versions.map(v =>
        `<option value="${_esc(v.path)}" ${v.path === path ? "selected" : ""}>${_esc(v.version)}</option>`
      ).join("");
      versionSelect = `<select class="dcc-version-select" data-dcc-versions="${d.key}" style="height:28px;background:var(--bg-input);color:var(--fg);border:1px solid var(--line);border-radius:var(--r-sm);font-size:11px;padding:0 6px;min-width:90px">${opts}</select>`;
    }
    return `
      <div class="dcc-row" data-dcc="${d.key}">
        <div class="dcc-icon-block" style="background:color-mix(in oklab,${d.color} 14%,transparent);color:${d.color}">${d.icon}</div>
        <div>
          <div><span class="dcc-name">${d.name}</span>${versions.length > 1 ? ` <span class="faint" style="font-size:10px">· ${versions.length} ${_t("set.dcc.found","found")}</span>` : ""}</div>
          <div class="dcc-status">${isOn ? _t("set.dcc.ok."+d.key, d.statusOK) : _t("set.dcc.not_configured", d.statusOff)}${d.key === "houdini_exe" && isOn ? _houLicenseHTML() : ""}</div>
        </div>
        <div class="dcc-path" title="${path}">${short || "—"}</div>
        ${versionSelect}
        <button class="btn" data-dcc-config="${d.key}" style="height:30px;padding:0 12px;font-size:11.5px">${_t("btn.configure","Configure")}</button>
        <div class="switch${isOn ? " on" : ""}" data-dcc-switch="${d.key}"></div>
      </div>`;
  }).join("");

  $("#settings-cat-integrations").innerHTML = `
    <div class="card" style="padding:0;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 8px">
        <span class="section-label" style="color:var(--cta)">${_t("set.dcc.title","DCC INTEGRATIONS")}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="chip accent" id="dcc-connected-count">${connected} ${_t("set.dcc.connected","connected")}</span>
          <button class="btn" id="btn-detect" style="height:28px;padding:0 12px;font-size:11.5px">${_t("set.dcc.autodetect","Auto-detect")}</button>
        </div>
      </div>
      ${dccRows}
    </div>

    <div class="card" style="padding:18px;background:color-mix(in oklab,var(--accent) 4%,var(--bg-card))">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="font-size:22px;line-height:1">💡</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">${_t("set.dcc.auto_title","Engine versions follow your project")}</div>
          <div style="font-size:12px;color:var(--fg-mid);line-height:1.5">
            ${_t("set.dcc.auto_body","For Unreal and Unity, Stratum opens the version your target project was made with, when it is installed. No need to switch it here for each project.")}
          </div>
        </div>
      </div>
    </div>`;

  // Wire DCC Configure / Switch
  DCC_DEFS.forEach(d => {
    const cfgBtn = $(`[data-dcc-config="${d.key}"]`);
    const sw     = $(`[data-dcc-switch="${d.key}"]`);
    if (cfgBtn) cfgBtn.addEventListener("click", async () => {
      const cur = cfgGet(`paths.${d.key}`) || "";
      const p = await eel.pick_file(d.name, d.filetypes, cur)();
      if (p) {
        await cfgSet(`paths.${d.key}`, p);
        refreshDCCStatus();
        buildIntegrationsCat();
        flashStatus("✅ " + window.I18N.t("set.dcc.configured", {name: d.name}));
      }
    });
    if (sw) sw.addEventListener("click", async () => {
      const cur = cfgGet(`paths.${d.key}`) || "";
      if (cur) {
        // Disable = clear path
        if (confirm(window.I18N.t("set.dcc.clear_path", {name: d.name}))) {
          await cfgSet(`paths.${d.key}`, "");
          refreshDCCStatus();
          buildIntegrationsCat();
          flashStatus(window.I18N.t("set.dcc.cleared", {name: d.name}), "var(--warn)");
        }
      } else {
        // Enable = open picker
        $(`[data-dcc-config="${d.key}"]`).click();
      }
    });
  });

  // Wire version dropdowns (switch quickly between detected versions)
  document.querySelectorAll("[data-dcc-versions]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const key = sel.dataset.dccVersions;
      await cfgSet(`paths.${key}`, sel.value);
      refreshDCCStatus();
      buildIntegrationsCat();
      flashStatus("✅ " + window.I18N.t("set.dcc.switched", {name: sel.options[sel.selectedIndex].text}));
    });
  });

  // Auto-detect button
  $("#btn-detect").addEventListener("click", async () => {
    const res = await eel.auto_detect_software()();
    // La detection ne comble que les cases vides : on annonce ce qu'elle a
    // ecrit, pas ce qu'elle a trouve, sinon le compte ment.
    const written = (res && res.written) ? Object.keys(res.written).length : 0;
    // Les chemins viennent d'etre ecrits cote Python : sans relire la config,
    // l'ecran continuait d'afficher "Not configured" et "0 connected" alors
    // que le run, lui, trouvait les logiciels. Le pire des deux mondes.
    CFG = await eel.get_config()();
    await _refreshDCCVersions();
    refreshDCCStatus();
    buildIntegrationsCat();
    flashStatus(written
      ? "✅ " + window.I18N.t("set.dcc.detected_n", {n: written})
      : window.I18N.t("set.dcc.detected_none", "Everything is already set"));
  });
}

// ── THEME card with visual previews ────────────────────────────────
function themePreviewHTML(theme) {
  // Mini représentation : sidebar + main avec couleurs du thème
  if (theme === "dark") {
    return `<div style="height:100%;display:flex;background:#08131c">
      <div style="width:30%;background:#050d14;border-right:1px solid #1a3346"></div>
      <div style="flex:1;padding:6px;display:flex;flex-direction:column;gap:4px">
        <div style="width:60%;height:6px;background:#5ed3d8;border-radius:2px"></div>
        <div style="width:100%;height:14px;background:#102634;border-radius:3px;border:1px solid #1a3346;margin-top:4px"></div>
        <div style="width:100%;height:14px;background:#102634;border-radius:3px;border:1px solid #1a3346"></div>
        <div style="margin-top:auto;align-self:flex-end;width:40px;height:10px;background:linear-gradient(90deg,#f29870,#e8835b);border-radius:3px"></div>
      </div>
    </div>`;
  } else if (theme === "light") {
    return `<div style="height:100%;display:flex;background:#eaf0f3">
      <div style="width:30%;background:#dde6eb;border-right:1px solid #c5d3da"></div>
      <div style="flex:1;padding:6px;display:flex;flex-direction:column;gap:4px">
        <div style="width:60%;height:6px;background:#0a6470;border-radius:2px"></div>
        <div style="width:100%;height:14px;background:#fff;border-radius:3px;border:1px solid #c5d3da;margin-top:4px"></div>
        <div style="width:100%;height:14px;background:#fff;border-radius:3px;border:1px solid #c5d3da"></div>
        <div style="margin-top:auto;align-self:flex-end;width:40px;height:10px;background:linear-gradient(90deg,#f29870,#e8835b);border-radius:3px"></div>
      </div>
    </div>`;
  } else if (theme === "midnight" || theme === "graphite" || theme === "ash") {
    const c = {
      midnight: { app: "#03070a", side: "#000000", card: "#0b141b", line: "#16232d" },
      graphite: { app: "#16181b", side: "#111214", card: "#22262b", line: "#30353c" },
      ash:      { app: "#3a3c40", side: "#303236", card: "#4a4c51", line: "#5b5e63" },
    }[theme];
    return `<div style="height:100%;display:flex;background:${c.app}">
      <div style="width:30%;background:${c.side};border-right:1px solid ${c.line}"></div>
      <div style="flex:1;padding:6px;display:flex;flex-direction:column;gap:4px">
        <div style="width:60%;height:6px;background:#5ed3d8;border-radius:2px"></div>
        <div style="width:100%;height:14px;background:${c.card};border-radius:3px;border:1px solid ${c.line};margin-top:4px"></div>
        <div style="width:100%;height:14px;background:${c.card};border-radius:3px;border:1px solid ${c.line}"></div>
        <div style="margin-top:auto;align-self:flex-end;width:40px;height:10px;background:linear-gradient(90deg,#f29870,#e8835b);border-radius:3px"></div>
      </div>
    </div>`;
  }
  // auto = split visuel
  return `<div style="height:100%;display:flex">
    <div style="flex:1;background:#08131c;border-right:1px dashed #5ed3d8"></div>
    <div style="flex:1;background:#eaf0f3"></div>
  </div>`;
}

// Theme -> classes CSS. Les sombres derives (Midnight, Graphite) portent aussi
// theme-dark : toutes les regles ecrites pour le sombre s'appliquent, ils ne
// redefinissent que leurs couleurs. "auto" suit Windows, et le suit en direct.
const _THEME_CLASSES = {
  dark: "theme-dark",
  light: "theme-light",
  midnight: "theme-dark theme-midnight",
  graphite: "theme-dark theme-graphite",
  ash: "theme-dark theme-ash",
};
let _autoThemeMq = null;
function applyThemeClass(theme) {
  let t = theme || "dark";
  if (t === "auto") {
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
    t = mq && mq.matches ? "light" : "dark";
    if (mq && !_autoThemeMq) {
      _autoThemeMq = mq;
      mq.addEventListener("change", () => {
        if ((cfgGet("ui.theme") || "dark") === "auto") applyThemeClass("auto");
      });
    }
  }
  const cls = _THEME_CLASSES[t] || _THEME_CLASSES.dark;
  document.documentElement.className = cls;
  const app = document.querySelector(".app");
  if (app) app.className = "app " + cls;
  // Le viewer 3D lit la classe pour son fond, sa grille et son brouillard.
  try { window.Viewer3D?.applyTheme(); } catch (e) {}
  // La grande fenetre suit tout de suite : elle ne relisait la config que
  // toutes les 3 secondes, et ratait le changement s'il n'etait pas encore
  // ecrit a ce moment-la.
  try { if (typeof _pushViewerState === "function") _pushViewerState(); } catch (e) {}
}

function buildThemeCat() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const curTheme = cfgGet("ui.theme") || "dark";
  const themes = [
    // Les ids ne changent pas (ils sont deja ecrits dans les configs), seuls
    // les noms. Abyss = le bleu officiel de Stratum ; "Dark" est le vrai noir.
    { id: "dark",     name: "Stratum Abyss" },
    { id: "midnight", name: "Stratum Dark" },
    { id: "graphite", name: "Stratum Graphite" },
    { id: "ash",      name: "Stratum Ash" },
    { id: "light",    name: "Stratum Light" },
    { id: "auto",     name: _t("set.theme.auto", "Auto (system)") },
  ];
  const cards = themes.map(t => `
    <div class="theme-card${t.id === curTheme ? " selected" : ""}" data-theme-card="${t.id}">
      <div class="theme-preview">${themePreviewHTML(t.id)}</div>
      <div class="theme-name">${t.name}${t.id === curTheme ? " ✓" : ""}</div>
    </div>`).join("");

  $("#settings-cat-theme").innerHTML = `
    <div class="card" style="padding:18px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span class="section-label" style="color:var(--cta)">${_t("set.theme.title","THEME")}</span>
      </div>
      <div class="theme-grid">${cards}</div>
    </div>

    <div class="card" style="padding:18px">
      <div style="margin-bottom:14px"><span class="section-label" style="color:var(--cta)">${_t("set.lang.title","LANGUAGE")}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${[["en","English"],["fr","Français"],["es","Español"],["ko","한국어"],["ja","日本語"]].map(([l,name]) => `<button class="btn lang-btn" data-lang="${l}" style="height:32px;padding:0 16px">${name}</button>`).join("")}
      </div>
    </div>`;

  // Wire theme cards
  $$("[data-theme-card]").forEach(c => {
    c.addEventListener("click", async () => {
      const t = c.dataset.themeCard;
      await cfgSet("ui.theme", t);
      applyThemeClass(t);
      buildThemeCat();
      flashStatus(_t("set.theme.applied", "✅ Theme applied"));
    });
  });

  // Wire lang buttons
  const curLang = cfgGet("ui.language") || "en";
  $$(".lang-btn").forEach(b => {
    b.classList.toggle("primary", b.dataset.lang === curLang);
    b.addEventListener("click", async () => {
      const l = b.dataset.lang;
      await cfgSet("ui.language", l);
      $$(".lang-btn").forEach(x => x.classList.toggle("primary", x.dataset.lang === l));
      // Switch live : applique i18n partout + re-render les composants dynamiques
      if (window.I18N) {
        window.I18N.setLang(l);
        window.I18N.applyI18n();
      }
      rerenderAfterLangSwitch();
      flashStatus(window.I18N ? window.I18N.t("settings.lang_saved") : "✅ Language saved");
    });
  });
}

// applyI18n ne retraduit que ce qui porte un attribut data-i18n. Les sections
// construites en innerHTML avec _t() n'en ont pas : elles gardent le texte de
// la langue active au moment ou elles ont ete dessinees. Passer en coreen
// laissait donc du francais dans le nommage, l'agencement et la liste
// d'assets. Une seule liste, appelee par les deux endroits qui changent la
// langue, pour qu'elle ne puisse plus diverger.
function rerenderAfterLangSwitch() {
  const safe = (fn) => {
    try { if (typeof fn === "function") fn(); }
    catch (e) { console.warn("[i18n] re-render :", e); }
  };
  safe(renderStrata);
  safe(refreshStats);
  safe(refreshDCCStatus);
  safe(refreshProjectsCache);
  safe(buildSettingsPage);
  safe(buildLibraryPage);
  safe(buildStorePage);
  safe(renderNamingSection);
  safe(renderLayoutDesigner);
  safe(renderHouChain);
  safe(refreshAssetPreview);
  // Un panneau de configuration ouvert est du HTML deja genere : on le
  // reconstruit en le refermant et en le rouvrant.
  document.querySelectorAll('[data-expand].open').forEach(panel => {
    const id = panel.dataset.expand;
    const btn = document.querySelector(`[data-config="${id}"]`);
    if (btn) { toggleStrataExpand(id, btn); toggleStrataExpand(id, btn); }
  });
}

// ── PLACEHOLDER categories ─────────────────────────────────────────
// ── Pipeline defaults panel ────────────────────────────────────────
async function _buildPipelineDefaultsPanel() {
  let d;
  try { d = await eel.get_pipeline_defaults()(); }
  catch (e) { return; }
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const SEL = "height:30px;background:var(--bg-input);color:var(--fg);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 8px";
  const row = (label, html) => `
    <div style="display:grid;grid-template-columns:220px 1fr;align-items:center;gap:14px;padding:6px 0">
      <span class="faint" style="font-size:12px">${label}</span>${html}
    </div>`;
  const sec = (label) => `<div class="section-label" style="margin:18px 0 4px;font-size:10px">${label}</div>`;
  const select = (key, opts, width = 180) => `<select data-pd="${key}" style="${SEL};width:${width}px">${
    opts.map(([v, l]) => `<option value="${_esc(String(v))}" ${String(v) === String(d[key]) ? "selected" : ""}>${_esc(l)}</option>`).join("")}</select>`;
  const text = (key, width = 320) =>
    `<div class="input" style="width:${width}px;max-width:100%"><input data-pd="${key}" value="${_esc(d[key] ?? "")}" style="font-family:var(--font-mono);font-size:12px"></div>`;
  const sw = (key) => `<div class="switch${d[key] ? " on" : ""}" data-pd-switch="${key}"></div>`;

  const cap = window._TIER_MAX_RESOLUTION || 8192;
  const selR = Math.min(parseInt(d.resolution) || cap, cap);
  const resSel = `<select data-pd="resolution" style="${SEL};width:140px">${
    [512, 1024, 2048, 4096, 8192].map(r =>
      `<option value="${r}" ${r === selR ? "selected" : ""} ${r > cap ? "disabled" : ""}>${r} px${r > cap ? " 🔒" : ""}</option>`).join("")}</select>`;

  const lvl = (k) => _t("layout.level." + k, k);
  const layouts = [["variant"], ["variant", "style"], ["variant", "type"],
                   ["style", "variant"], ["style", "variant", "type"], ["type"], []];
  const curLayout = (d.output_layout_levels || ["variant"]).join(",");
  const layoutSel = `<select data-pd="output_layout_levels" style="${SEL};width:260px">${
    layouts.map(l => {
      const v = l.join(",");
      const label = l.length ? l.map(lvl).join(" › ") : _t("layout.none", "no subfolder");
      return `<option value="${v}" ${v === curLayout ? "selected" : ""}>${_esc(label)}</option>`;
    }).join("")}</select>`;

  $("#settings-cat-pipeline-def").innerHTML = `
    <div class="card" style="padding:18px">
      <div class="section-label" style="color:var(--cta);margin-bottom:6px">${_t("set.pd.title","PIPELINE DEFAULTS")}</div>
      <div class="faint" style="font-size:11px;margin-bottom:6px">${_t("set.pd.hint","Used when you create a new project. Existing projects are not affected.")}</div>

      ${sec("Gaea")}
      ${row(_t("set.pd.resolution","Resolution"), resSel)}
      ${row(_t("set.pd.seed","Seed mode"), select("seed_mode", [
        ["auto", _t("cfg.gaea.seed.auto", "Auto")],
        ["random", _t("cfg.gaea.seed.random", "Random")],
        ["custom", _t("cfg.gaea.seed.custom", "Custom")]], 140))}

      ${sec(_t("set.pd.sec.naming", "Naming"))}
      ${row(_t("set.pd.naming_on", "Rename files"), sw("naming_enabled"))}
      ${row(_t("set.pd.naming_mesh", "Meshes"), text("naming_mesh"))}
      ${row(_t("set.pd.naming_tex", "Textures"), text("naming_texture"))}

      ${sec(_t("set.pd.sec.layout", "Working folder layout"))}
      ${row(_t("set.pd.layout","Output layout"), layoutSel)}

      ${sec("Unreal")}
      ${row(_t("set.pd.ue_nanite","Unreal · Nanite"), sw("unreal_nanite"))}
      ${row(_t("cfg.engine.collision","Collision"), select("unreal_collision", [
        ["simple", "Simple"], ["complex", "Complex"], ["none", "None"]], 140))}
      ${row(_t("cfg.ue.master_mode","Master mode"), select("unreal_master_mode", [
        ["existing", _t("cfg.ue.master_mode.use", "Use existing")],
        ["create", _t("cfg.ue.master_mode.create", "Create if missing")]]))}
      ${row(_t("set.pd.ue_master", "Master material"), text("unreal_master_name", 220))}

      ${sec("Unity")}
      ${row(_t("set.pd.unity_rp","Unity · Render pipeline"), select("unity_render_pipeline", [
        ["URP", "URP"], ["HDRP", "HDRP"], ["Built-in", "Built-in"], ["Other", "Other"]], 140))}
      ${row(_t("cfg.unity.mat_from","Material from"), select("unity_material_from", [
        ["pipeline", _t("cfg.unity.from.pipeline", "Pipeline shader")],
        ["shadergraph", _t("cfg.unity.from.sg", "ShaderGraph")],
        ["material", _t("cfg.unity.from.mat", "Material")]]))}
      ${row(_t("cfg.unity.shader_name","ShaderGraph"), text("unity_shader_name", 220))}
      ${row(_t("cfg.engine.collision","Collision"), select("unity_collision", [
        ["mesh", "Mesh"], ["box", "Box"], ["none", "None"]], 140))}
      ${row(_t("set.pd.unity_prefab", "Generate prefab"), sw("unity_prefab"))}
    </div>`;

  const host = $("#settings-cat-pipeline-def");
  const saved = () => flashStatus(_t("set.pd.saved", "Default saved"));
  host.querySelectorAll("[data-pd]").forEach(el => {
    el.addEventListener("change", async () => {
      const key = el.dataset.pd;
      let v = el.value;
      if (key === "resolution") v = Math.min(parseInt(v) || 4096, cap);
      if (key === "output_layout_levels") v = v ? v.split(",") : [];
      await eel.set_pipeline_default(key, v)();
      saved();
    });
  });
  host.querySelectorAll("[data-pd-switch]").forEach(el => {
    el.addEventListener("click", async () => {
      const on = el.classList.toggle("on");
      await eel.set_pipeline_default(el.dataset.pdSwitch, on)();
      saved();
    });
  });
}

// ── Export & storage panel ─────────────────────────────────────────
async function _buildStoragePanel() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  let stats;
  try { stats = await eel.get_storage_stats()(); }
  catch (e) { return; }
  const fmt = (kb) => {
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    if (kb < 1024*1024) return `${(kb/1024).toFixed(1)} MB`;
    return `${(kb/1024/1024).toFixed(2)} GB`;
  };
  const ITEMS = [
    { k: "cache",      clearable: true },
    { k: "thumbnails", clearable: true },
    { k: "logs",       clearable: true },
    { k: "runs",       clearable: true },
    { k: "hda_cache",  clearable: true },
    { k: "projects",   clearable: false },
    { k: "presets",    clearable: false },
  ].map(it => ({
    ...it,
    label: _t("set.storage." + it.k, it.k),
    desc:  _t("set.storage." + it.k + ".d", ""),
  }));

  // stats peut arriver vide si l'appel backend echoue : sans ce filet, tout le
  // panneau Stockage plantait sur un rejet non capture, sans rien afficher.
  const items = (stats && stats.items) || {};
  const rows = ITEMS.map(it => {
    const s = items[it.k] || { size_kb: 0, file_count: 0, path: "" };
    return `
      <div class="storage-row">
        <div>
          <div class="storage-name">${it.label}</div>
          <div class="storage-desc">${it.desc}</div>
          <div class="storage-path" title="${_esc(s.path)}">${_esc(s.path)}</div>
        </div>
        <div class="storage-size">${fmt(s.size_kb)} · ${s.file_count} ${_t("set.storage.files","files")}</div>
        ${it.clearable
          ? `<button class="btn ghost" data-storage-clear="${it.k}" style="height:28px;padding:0 10px;font-size:11px;color:var(--err)">${_t("set.storage.clear","Clear")}</button>`
          : `<span class="faint" style="font-size:10.5px;font-family:var(--font-mono)">${_t("set.storage.protected","PROTECTED")}</span>`}
      </div>`;
  }).join("");

  $("#settings-cat-export").innerHTML = `
    <div class="card" style="padding:18px">
      <div class="section-label" style="color:var(--cta);margin-bottom:6px">${_t("set.storage.title","EXPORT &amp; STORAGE")}</div>
      <div class="faint" style="font-size:11px;margin-bottom:14px">${window.I18N ? window.I18N.t("set.storage.base", {path: `<code style="font-family:var(--font-mono);color:var(--accent)">${_esc(stats.base)}</code>`}) : `All Stratum data lives in ${_esc(stats.base)}.`}</div>
      <div class="storage-list">${rows}</div>
      <div class="storage-row" style="margin-top:8px">
        <div>
          <div class="storage-name">${_t("set.storage.cache_max", "Gaea cache limit")}</div>
          <div class="storage-desc">${_t("set.storage.cache_max.d", "Oldest entries are removed beyond this size, after each run. 0 = no limit.")}</div>
        </div>
        <div class="input" style="width:110px"><input id="cache-max-gb" type="number" min="0" step="1" value="${cfgGet("app.cache_max_gb") ?? 20}"><span class="key">GB</span></div>
      </div>
    </div>`;

  // La limite s'applique a la fin de chaque run qui remplit le cache.
  $("#cache-max-gb")?.addEventListener("change", async e => {
    const n = Math.max(0, parseFloat(e.target.value) || 0);
    e.target.value = n;
    await cfgSet("app.cache_max_gb", n);
    // Applique la limite tout de suite, sans attendre le prochain run.
    let r = null;
    try { r = await eel.prune_gaea_cache()(); } catch (err) { /* backend absent */ }
    flashStatus(r && r.freed_gb
      ? _t("set.storage.cache_max.freed", "{gb} GB freed").replace("{gb}", r.freed_gb)
      : _t("set.storage.cache_max.saved", "Cache limit saved"));
    if (r && r.freed_gb) _buildStoragePanel();
  });

  document.querySelectorAll("[data-storage-clear]").forEach(b => {
    b.addEventListener("click", async () => {
      const k = b.dataset.storageClear;
      if (!confirm(window.I18N.t("set.storage.confirm", {k}))) return;
      const r = await eel.clear_storage(k)();
      if (r.ok) {
        flashStatus(window.I18N.t("set.storage.cleared", {n: r.removed, k}));
        _buildStoragePanel();
      } else {
        flashStatus(r.error || _t("set.storage.clear_failed","Clear failed"), "var(--err)");
      }
    });
  });
}

// ── Shortcuts panel ────────────────────────────────────────────────
// Saisie d'un nouveau raccourci en cours : le gestionnaire global se tait.
let _scCapture = null;

function _scKeysHTML(combo) {
  return String(combo || "").split("+").map(k => `<kbd>${_esc(k)}</kbd>`).join(" + ");
}

function _buildShortcutsPanel() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const rows = SHORTCUTS.map(sc => `
    <div class="sc-row">
      <span class="sc-action">${_esc(_t(sc.label[0], sc.label[1]))}</span>
      <button class="btn ghost sc-bind" data-sc="${sc.id}" style="height:28px;padding:0 10px;font-size:11px">${_scKeysHTML(_scKeys(sc))}</button>
    </div>`).join("");
  const fixed = [
    [["Esc"], _t("set.sc.close", "Close modal / drawer")],
    [["Tab"], _t("set.sc.nav", "Navigate inputs / asset list")],
    [["Enter"], _t("set.sc.trigger", "Trigger focused item (asset → load 3D)")],
  ].map(([keys, label]) => `
    <div class="sc-row">
      <span class="sc-action">${_esc(label)}</span>
      <span class="sc-keys">${keys.map(k => `<kbd>${k}</kbd>`).join(" + ")}</span>
    </div>`).join("");

  $("#settings-cat-shortcuts").innerHTML = `
    <div class="card" style="padding:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span class="section-label" style="color:var(--cta)">${_t("set.sc.title","KEYBOARD SHORTCUTS")}</span>
        <button class="btn ghost" id="sc-reset" style="height:26px;padding:0 10px;font-size:11px">${_t("set.sc.reset", "Reset all")}</button>
      </div>
      <div class="faint" style="font-size:11px;margin-bottom:14px">${_t("set.sc.hint","Click a shortcut, then press the new keys. Esc cancels.")}</div>
      <div class="sc-list">${rows}</div>
      <div class="section-label" style="margin:16px 0 6px;font-size:10px">${_t("set.sc.fixed", "Fixed")}</div>
      <div class="sc-list">${fixed}</div>
    </div>`;

  $("#sc-reset")?.addEventListener("click", async () => {
    await cfgSet("ui.shortcuts", {});
    _buildShortcutsPanel();
    flashStatus(_t("set.sc.saved", "Shortcuts saved"));
  });

  document.querySelectorAll(".sc-bind").forEach(btn => {
    btn.addEventListener("click", () => {
      if (_scCapture) return;
      const id = btn.dataset.sc;
      btn.textContent = _t("set.sc.press", "Press keys…");
      btn.classList.add("primary");
      _scCapture = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") { done(); _buildShortcutsPanel(); return; }
        const combo = _comboOf(e);
        if (!combo) return;                     // modificateur seul : on attend
        const other = SHORTCUTS.find(o => o.id !== id && _scKeys(o) === combo);
        if (other) {
          flashStatus(`${_t("set.sc.taken", "Already used by")} : ${_t(other.label[0], other.label[1])}`, "var(--warn)");
          return;
        }
        done();
        const map = Object.assign({}, cfgGet("ui.shortcuts") || {});
        map[id] = combo;
        await cfgSet("ui.shortcuts", map);
        _buildShortcutsPanel();
        flashStatus(_t("set.sc.saved", "Shortcuts saved"));
      };
      const done = () => {
        window.removeEventListener("keydown", _scCapture, true);
        _scCapture = null;
      };
      window.addEventListener("keydown", _scCapture, true);
    });
  });
}

function buildOtherCats() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  _buildPipelineDefaultsPanel();
  _buildStoragePanel();
  _buildShortcutsPanel();
  // License panel = chargé async (depuis Python pour récupérer les tiers)
  $("#settings-cat-license").innerHTML = `<div class="faint" style="padding:20px">${_t("set.lic.loading","Loading license info…")}</div>`;
  _buildLicensePanel();
  $("#settings-cat-about").innerHTML = `
    <div class="card" style="padding:24px 22px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
        <img src="assets/logo.png" style="width:48px;height:48px">
        <div>
          <div style="font-family:var(--font-display);font-size:22px;font-weight:700;letter-spacing:0.06em">STRATUM</div>
          <div class="faint" style="font-size:11px">by Kalysteon · v<span class="app-version">${window._APP_VERSION || ""}</span></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:140px 1fr;row-gap:10px;font-size:13px">
        <span class="faint">${_t("set.about.version","Version")}</span><span class="app-version">${window._APP_VERSION || ""}</span>
        <span class="faint">${_t("set.about.ui_stack","UI stack")}</span><span>HTML/CSS/JS + Microsoft Edge WebView2</span>
        <span class="faint">${_t("set.about.backend","Backend")}</span><span>Python · pipeline runner inchangé</span>
        <span class="faint">${_t("set.about.studio","Studio")}</span><span>Kalysteon,<a href="#" style="color:var(--accent)">kalysteon.com</a></span>
      </div>
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line-soft);font-size:11px;color:var(--fg-dim)">
        ${_t("set.about.tagline","Pipeline automation for Gaea → Houdini → Unreal/Unity workflows.")}
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-soft);font-size:10.5px;color:var(--fg-faint);line-height:1.65">
        ${_t("set.about.trademarks", "Gaea, Houdini, Unreal Engine and Unity are trademarks of their respective owners. Stratum is an independent tool, not affiliated with, endorsed or sponsored by QuadSpinner, SideFX, Epic Games or Unity Technologies. It automates software you install and license yourself, and redistributes none of it.")}
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn ghost" id="about-replay-onb" style="height:30px;padding:0 14px;font-size:11.5px">${_t("set.onb.replay","Show welcome again")}</button>
        <button class="btn ghost" id="about-start-tour" style="height:30px;padding:0 14px;font-size:11.5px">${_t("tour.start","Start tutorial")}</button>
        <button class="btn ghost" id="about-report" style="height:30px;padding:0 14px;font-size:11.5px">${_t("set.about.report","Report a problem")}</button>
      </div>
    </div>`;

  const _replay = $("#about-replay-onb");
  if (_replay) _replay.addEventListener("click", () => { try { openOnboarding(); } catch (e) { console.warn(e); } });
  const _tour = $("#about-start-tour");
  if (_tour) _tour.addEventListener("click", () => { try { startTutorial(); } catch (e) { console.warn(e); } });
  const _report = $("#about-report");
  if (_report) _report.addEventListener("click", async () => {
    _report.disabled = true;
    try {
      const r = await eel.build_support_report()();
      flashStatus(r.ok ? _t("set.about.report_ok", "✅ Report created (see Explorer + email draft)")
                       : (r.error || _t("set.about.report_fail", "Report failed")), r.ok ? undefined : "var(--err)");
    } catch (e) { flashStatus(_t("set.about.report_fail", "Report failed"), "var(--err)"); }
    _report.disabled = false;
  });
}

// ── Navigation entre catégories Settings ───────────────────────────
function wireSettingsCatNav() {
  $$(".settings-nav-item").forEach(el => {
    el.addEventListener("click", () => {
      const cat = el.dataset.cat;
      $$(".settings-nav-item").forEach(x => x.classList.toggle("active", x === el));
      $$(".settings-cat").forEach(c => {
        c.style.display = (c.dataset.cat === cat) ? "" : "none";
      });
    });
  });
}

async function _buildLicensePanel() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  let data;
  try { data = await eel.get_license_info()(); }
  catch (e) { console.error("[license] fail", e); return; }
  const cur = data.current || "free";
  const tiers = data.tiers || {};
  const order = ["free", "indie", "studio"];

  // État d'activation (clé Lemon Squeezy)
  let status = { activated: false, tier: cur, tier_name: "", key_masked: "" };
  try { status = await eel.get_license_status()(); } catch (e) { /* défaut */ }

  // Changer de palier sans cle n'existe que dans les sources, pour tester.
  // Dans l'exe vendu le moteur Python le refuse : on ne montre pas un bouton
  // qui ne marcherait pas, et qui donnerait l'idee d'essayer.
  let devMode = true;
  try { devMode = !(await eel.app_info()()).frozen; } catch (e) { /* sources */ }

  const tierCards = order.map(key => {
    const t = tiers[key];
    if (!t) return "";
    const isCurrent = key === cur;
    const proj = t.max_projects === 0 ? _t("set.lic.unlimited","Unlimited") : String(t.max_projects);
    const vars_ = t.max_variants;
    const resmax = t.max_resolution ? `${t.max_resolution >= 1024 ? (t.max_resolution/1024) + "K" : t.max_resolution + "px"}` : "—";
    const commercial = t.commercial
      ? (t.commercial_cap
          ? (window.I18N ? window.I18N.t("set.lic.commercial_cap", {cap: (t.commercial_cap/1000).toFixed(0)}) : `Commercial (rev < $${(t.commercial_cap/1000).toFixed(0)}k/yr)`)
          : _t("set.lic.commercial_unlim","Commercial unlimited"))
      : _t("set.lic.noncommercial","Non-commercial only");
    // Label & blurb traduits par tier (le name reste la marque : Free/Indie & Pro/Studio)
    const tLabel = _t("set.lic.label."+key, t.label);
    const tBlurb = _t("set.lic.blurb."+key, t.blurb);
    return `
      <div class="lic-card ${isCurrent ? 'current' : ''}" style="border-color:${isCurrent ? t.color : 'var(--line)'}">
        <div class="lic-card-head">
          <div>
            <div class="lic-tier-name" style="color:${t.color}">${t.name}</div>
            <div class="lic-tier-label">${tLabel}</div>
          </div>
          ${isCurrent ? `<span class="chip accent" style="background:color-mix(in oklab, ${t.color} 18%, transparent);color:${t.color};border-color:color-mix(in oklab, ${t.color} 35%, transparent)">${_t("set.lic.current","CURRENT")}</span>` : ""}
        </div>
        <div class="lic-card-feat">
          <div><span class="lic-k">${_t("set.lic.projects","Projects")}</span><span class="lic-v">${proj}</span></div>
          <div><span class="lic-k">${_t("set.lic.variants","Variants/run")}</span><span class="lic-v">${vars_}</span></div>
          <div><span class="lic-k">${_t("set.lic.max_export","Max export")}</span><span class="lic-v">${resmax}</span></div>
          <div><span class="lic-k">${_t("set.lic.usage","Usage")}</span><span class="lic-v" style="font-size:11px">${commercial}</span></div>
        </div>
        <div class="lic-blurb">${tBlurb}</div>
        ${(isCurrent || !devMode) ? "" : `<button class="btn" data-lic-switch="${key}" style="height:30px;width:100%;margin-top:10px;font-size:11.5px">${window.I18N ? window.I18N.t("set.lic.switch_to", {name: t.name}) : "Switch to " + t.name}</button>`}
      </div>`;
  }).join("");

  const accent = tiers[status.tier]?.color || "var(--accent)";
  // Mises a jour incluses : date de fin, et renouvellement quand elle approche.
  const _fmtDay = iso => { try { return new Date(iso + "T00:00:00").toLocaleDateString(window.I18N?.getLang?.() || undefined); } catch (e) { return iso; } };
  const _until = status.updates_until || "";
  const _soon = _until && (new Date(_until + "T00:00:00") - Date.now()) < 45 * 86400000;
  const _I = (k, vars, fb) => (window.I18N ? window.I18N.t(k, vars) : fb);
  const updatesBlock = !status.activated ? "" : status.locked
    ? `<div style="margin-top:12px;padding:10px 12px;border:1px solid color-mix(in oklab,var(--warn) 40%,transparent);border-radius:8px;background:color-mix(in oklab,var(--warn) 10%,transparent);font-size:12px;color:var(--fg-mid)">
         ${_I("set.lic.locked", {d: _fmtDay(_until)}, "This version came out after your updates ended. Renew to unlock it.")}
         <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
           ${status.renew_url ? `<button class="btn primary" id="lic-renew" style="height:30px;padding:0 14px;font-size:12px">${_t("set.lic.renew","Renew updates")}</button>` : ""}
           <button class="btn ghost" id="lic-recheck" style="height:30px;padding:0 14px;font-size:12px">${_t("set.lic.recheck","I renewed, check again")}</button>
         </div>
       </div>`
    : (_until ? `<div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
         <span class="faint" style="font-size:11.5px">${_I("set.lic.updates_until", {d: _fmtDay(_until)}, "Updates included until " + _until)}</span>
         ${(_soon && status.renew_url) ? `<button class="btn" id="lic-renew" style="height:26px;padding:0 10px;font-size:11px">${_t("set.lic.renew","Renew updates")}</button>` : ""}
       </div>` : "");
  const activationCard = status.activated
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
         <div>
           <div style="font-size:14px">${_t("set.lic.activated_as","Activated")} · <strong style="color:${tiers[status.licensed_tier || status.tier]?.color || accent}">${status.licensed_name || status.tier_name}</strong></div>
           <div class="faint" style="font-size:11.5px;font-family:var(--font-mono);margin-top:3px">${_t("set.lic.key","Key")}: ${status.key_masked}</div>
         </div>
         <button class="btn ghost" id="lic-deactivate" style="height:32px;padding:0 14px;font-size:12px;color:var(--err)">${_t("set.lic.deactivate","Deactivate")}</button>
       </div>${updatesBlock}`
    : `<div class="faint" style="font-size:12px;margin-bottom:10px">${_t("set.lic.activate.hint","Paste the license key from your purchase email to unlock Indie & Pro or Studio.")}</div>
       <div style="display:flex;gap:8px;align-items:center">
         <div class="input" style="flex:1"><input id="lic-key-input" placeholder="${_t("set.lic.activate.ph","Paste your license key…")}" style="font-family:var(--font-mono);font-size:12px"></div>
         <button class="btn primary" id="lic-activate" style="height:36px;padding:0 18px;font-size:12.5px">${_t("set.lic.activate.btn","Activate")}</button>
       </div>
       <div id="lic-activate-msg" style="font-size:12px;margin-top:8px;display:none"></div>`;

  $("#settings-cat-license").innerHTML = `
    <div class="card" style="padding:18px;margin-bottom:14px">
      <div style="margin-bottom:14px">
        <span class="section-label" style="color:var(--cta)">${_t("set.lic.activate.title","ACTIVATE LICENSE")}</span>
        <div style="font-size:13px;color:var(--fg-mid);margin-top:4px">${_t("set.lic.current_tier","Current tier:")} <strong style="color:${tiers[cur]?.color}">${tiers[cur]?.name}</strong></div>
      </div>
      ${activationCard}
    </div>

    <div class="card" style="padding:18px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span class="section-label" style="color:var(--cta)">${_t("set.lic.title","LICENSE")}</span>
        ${devMode ? `<span class="faint" style="font-size:10.5px;font-family:var(--font-mono)">${_t("set.lic.dev_note","Dev override (test only,removed at release)")}</span>` : ""}
      </div>
      <div class="lic-cards">${tierCards}</div>
    </div>`;

  // Wire activation par clé
  const _activateBtn = $("#lic-activate");
  if (_activateBtn) {
    const doActivate = async () => {
      const input = $("#lic-key-input");
      const msg = $("#lic-activate-msg");
      const key = (input?.value || "").trim();
      if (!key) return;
      _activateBtn.disabled = true;
      _activateBtn.textContent = _t("set.lic.activate.busy", "Activating…");
      let res;
      try { res = await eel.activate_license(key)(); }
      catch (e) { res = { ok: false, error: "Unexpected error." }; }
      if (res.ok) {
        flashStatus(window.I18N.t("set.lic.activate.ok", { name: res.tier_name }));
        await _refreshAfterTierChange();
        _buildLicensePanel();
      } else {
        _activateBtn.disabled = false;
        _activateBtn.textContent = _t("set.lic.activate.btn", "Activate");
        if (msg) { msg.style.display = ""; msg.style.color = "var(--err)"; msg.textContent = res.error || "Activation failed."; }
      }
    };
    _activateBtn.addEventListener("click", doActivate);
    $("#lic-key-input")?.addEventListener("keydown", e => { if (e.key === "Enter") doActivate(); });
  }
  $("#lic-renew")?.addEventListener("click", () => { try { eel.open_url(status.renew_url)(); } catch (e) {} });
  const _recheckBtn = $("#lic-recheck");
  if (_recheckBtn) {
    _recheckBtn.addEventListener("click", async () => {
      _recheckBtn.disabled = true;
      let r = {};
      try { r = await eel.refresh_license_entitlement()(); } catch (e) { /* hors ligne */ }
      if (r.ok && !r.locked) {
        flashStatus(_t("set.lic.renewed_ok", "Updates unlocked. Thank you!"));
        await _refreshAfterTierChange();
      } else {
        flashStatus(_t("set.lic.renewed_not_yet", "No renewal found yet. Use the same email as your purchase."), "var(--warn)");
      }
      _buildLicensePanel();
    });
  }
  const _deactivateBtn = $("#lic-deactivate");
  if (_deactivateBtn) {
    _deactivateBtn.addEventListener("click", async () => {
      await eel.deactivate_license()();
      flashStatus(_t("set.lic.deactivated", "License deactivated,back to Free."), "var(--warn)");
      await _refreshAfterTierChange();
      _buildLicensePanel();
    });
  }

  document.querySelectorAll("[data-lic-switch]").forEach(b => {
    b.addEventListener("click", async () => {
      const res = await eel.set_license_tier(b.dataset.licSwitch)();
      if (res.ok) {
        flashStatus(window.I18N.t("set.lic.switched", {name: tiers[b.dataset.licSwitch].name}));
        await _refreshAfterTierChange();
        _buildLicensePanel();
      }
    });
  });
}

// Recharge les limites du tier courant (après activation/désactivation/switch),
// clampe la config stockée si elle dépasse le nouveau cap (downgrade), et
// re-render les strates + stats. NE rebuild PAS le panneau License (l'appelant
// s'en charge, pour éviter une récursion).
async function _refreshAfterTierChange() {
  try {
    const lim = await eel.get_tier_limits()();
    window._TIER_MAX_VARIANTS = lim.max_variants || 10;
    window._TIER_MAX_PROJECTS = lim.max_projects || 0;
    window._TIER_MAX_RESOLUTION = lim.max_resolution || 8192;
    window._TIER_KEY = lim.tier || "free";
  } catch (e) { /* garde les valeurs précédentes */ }
  const cap = window._TIER_MAX_RESOLUTION || 8192;
  if ((parseInt(cfgGet("pipeline.gaea.resolution")) || 0) > cap) {
    await cfgSet("pipeline.gaea.resolution", cap);
  }
  const vmax = window._TIER_MAX_VARIANTS || 10;
  if ((parseInt(cfgGet("pipeline.gaea.variants")) || 0) > vmax) {
    await cfgSet("pipeline.gaea.variants", vmax);
  }
  renderStrata();
  refreshStats();
}


function buildSettingsPage() {
  buildIntegrationsCat();
  buildThemeCat();
  buildOtherCats();
  wireSettingsCatNav();
}

// ── CONFIGURE INLINE (expansion dépliable) ─────────────────────────
const SEL_STYLE = "background:var(--bg-input);border:1px solid var(--line);border-radius:var(--r-md);height:32px;padding:0 var(--s-3);color:var(--fg);font-family:var(--font-ui);font-size:12.5px;outline:none";
const SELECT_FN = (id, values, current) => `
  <select id="${id}" style="${SEL_STYLE}">
    ${values.map(v => `<option value="${v}" ${String(v) === String(current) ? "selected" : ""}>${v}</option>`).join("")}
  </select>`;

// Select de résolution avec cap de tier : les options au-dessus de la limite
// du tier courant sont désactivées + marquées d'un cadenas. La valeur courante
// est clampée pour ne jamais sélectionner une option verrouillée.
const RES_SELECT_FN = (id, values, current) => {
  const cap = window._TIER_MAX_RESOLUTION || 8192;
  const sel = Math.min(parseInt(current) || cap, cap);
  return `
  <select id="${id}" style="${SEL_STYLE}">
    ${values.map(v => {
      const locked = v > cap;
      return `<option value="${v}" ${v === sel ? "selected" : ""} ${locked ? "disabled" : ""}>${v} px${locked ? " 🔒" : ""}</option>`;
    }).join("")}
  </select>`;
};

// Icône `?` qui affiche un tooltip au hover. tipKey est une clé i18n ;
// le texte d'aide se résout au moment du render → suit le switch EN/FR.
// Variante pour du texte deja compose (exemple calcule, liste de variables).
// infoIcon ne convient pas la : I18N.t renvoie la cle quand elle manque, donc
// son `fallback` n'est jamais atteint et la cle brute s'afficherait.
function infoText(text) {
  const tip = String(text || "").trim();
  if (!tip) return "";
  return `<span class="info-tip" data-tip="${tip.replace(/"/g, "&quot;")}">?</span>`;
}

// Meme pastille, mais a partir d'un texte deja compose. Sert aux libelles qui
// citent une vraie valeur du projet ("ici Mountain") : la cle seule ne peut pas
// la connaitre.
function infoIconText(text) {
  const tip = String(text || "").trim();
  if (!tip) return "";
  return `<span class="info-tip" data-tip="${tip.replace(/"/g, "&quot;")}">?</span>`;
}

function infoIcon(tipKey, fallback = "") {
  const tip = (window.I18N?.t(tipKey) || fallback || "").trim();
  if (!tip) return "";
  // Échape les " pour pouvoir mettre dans data-tip.
  const safe = tip.replace(/"/g, "&quot;");
  return `<span class="info-tip" data-tip="${safe}">?</span>`;
}

// ── Tooltip globale (échappe overflow:hidden des containers) ───────
// Un seul nœud .info-tip-bubble est attaché au body et réutilisé pour toutes
// les .info-tip. Positionné en `fixed` via getBoundingClientRect → flotte
// au-dessus de tout l'UI, peu importe le contexte parent.
(function _installInfoTipHandler() {
  let bubble = null;
  const ensureBubble = () => {
    if (bubble) return bubble;
    bubble = document.createElement("div");
    bubble.className = "info-tip-bubble";
    document.body.appendChild(bubble);
    return bubble;
  };
  const position = (icon) => {
    const b = ensureBubble();
    b.textContent = icon.dataset.tip || "";
    const r = icon.getBoundingClientRect();
    // Reset transform pour mesurer la vraie taille
    b.style.transform = "translate(-50%, -100%)";
    b.style.left = `${r.left + r.width / 2}px`;
    b.style.top  = `${r.top - 6}px`;
    b.classList.add("visible");
    // Si la bulle dépasse en haut, on flip en dessous de l'icône
    requestAnimationFrame(() => {
      const br = b.getBoundingClientRect();
      if (br.top < 4) {
        b.style.top = `${r.bottom + 14}px`;
        b.style.transform = "translate(-50%, 0)";
      }
      // Clamp horizontal
      if (br.left < 4) b.style.left = `${4 + b.offsetWidth / 2}px`;
      if (br.right > window.innerWidth - 4)
        b.style.left = `${window.innerWidth - 4 - b.offsetWidth / 2}px`;
    });
  };
  const hide = () => { if (bubble) bubble.classList.remove("visible"); };

  document.addEventListener("mouseover", e => {
    const icon = e.target.closest(".info-tip[data-tip]");
    if (icon) position(icon);
  });
  document.addEventListener("mouseout", e => {
    const icon = e.target.closest(".info-tip[data-tip]");
    if (icon) hide();
  });
  // Cache la bulle pendant un scroll (sinon elle reste au mauvais endroit)
  document.addEventListener("scroll", hide, true);
})();

function configRow(label, controlHTML, tipKey = "") {
  const tip = tipKey ? infoIcon(tipKey) : "";
  return `
    <div style="display:grid;grid-template-columns:140px 1fr;align-items:center;gap:14px;padding:4px 0">
      <span class="faint" style="font-size:12px;display:inline-flex;align-items:center">${label}${tip}</span>
      ${controlHTML}
    </div>`;
}

function configContentGaea() {
  const file = cfgGet("pipeline.gaea.file") || "";
  const res = cfgGet("pipeline.gaea.resolution") || 4096;
  const seedMode = cfgGet("pipeline.gaea.seed_mode") || "auto";
  const keepInProg = !!cfgGet("pipeline.gaea.keep_inprogress");
  const forceRebuild = !!cfgGet("pipeline.gaea.force_rebuild");

  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const seedLabels = {
    auto:   _t("cfg.gaea.seed.auto",   "Auto"),
    random: _t("cfg.gaea.seed.random", "Random"),
    custom: _t("cfg.gaea.seed.custom", "Custom"),
  };
  const seedHint = seedMode === "auto"
    ? _t("cfg.gaea.seed.hint_auto",   "Same seeds every run (1001, 2002, …). Reproducible.")
    : seedMode === "random"
      ? _t("cfg.gaea.seed.hint_random", "Random seeds at each run. Explore wildly different terrains.")
      : _t("cfg.gaea.seed.hint_custom", "Provide your own seeds below.");

  return `
    ${_cfgSectionHTML(_t("cfg.sec.terrain", "Terrain"), `
    ${configRow(_t("cfg.gaea.file", "Terrain file"), `
      <div class="input">
        <input id="gaea-file-input" value="${file}">
        <span class="key" style="cursor:pointer" id="gaea-file-browse">···</span>
      </div>`, "tip.gaea.file")}
    ${configRow(_t("cfg.gaea.resolution", "Resolution"), RES_SELECT_FN("gaea-res", [512, 1024, 2048, 4096, 8192], res), "tip.gaea.resolution")}
    <div id="gaea-vps-warning" style="font-size:11px;color:var(--warn);display:none;padding-left:154px;margin-top:-2px"></div>
    ${configRow(_t("cfg.gaea.variants", "Variants"),
      `<div id="gaea-variants-grid"></div>`, "tip.gaea.variants")}
    ${configRow(_t("cfg.gaea.seed_mode", "Seed mode"), `
      <div style="display:flex;gap:6px" id="gaea-seed-modes">
        ${["auto", "random", "custom"].map(m => `
          <button class="btn seed-mode-btn${m === seedMode ? " primary" : ""}" data-seed="${m}" style="height:30px;padding:0 12px;font-size:11.5px">${seedLabels[m]}</button>`).join("")}
      </div>`)}
    <div style="padding-left:154px;margin-top:-4px;font-size:10.5px;color:var(--fg-dim);font-style:italic" id="gaea-seed-hint">${seedHint}</div>
    `, "gaea.terrain")}

    ${_cfgSectionHTML(_t("cfg.gaea.nodes_section", "Nodes to export"), `
      <div id="gaea-nodes-area">
        <div class="faint" style="font-size:11px;font-style:italic">${_t("cfg.gaea.nodes_empty", "— select a .terrain file to load nodes —")}</div>
      </div>
    `, "gaea.nodes")}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:10px;border-top:1px solid var(--line-soft)" title="${_t("cfg.gaea.force_rebuild_hint", "Bypass cache")}">
      <span class="faint" style="font-size:12px">${_t("cfg.gaea.force_rebuild", "Force rebuild (ignore cache)")}</span>
      <div class="switch${forceRebuild ? ' on' : ''}" id="gaea-force-rebuild"></div>
    </div>`;
}

// Traduction avec repli, utilisable hors des fonctions qui declarent leur
// propre `_t` local.
function _tt(key, fallback) {
  const v = window.I18N ? window.I18N.t(key) : "";
  return (v && v !== key) ? v : fallback;
}

// ── Grille des variantes ───────────────────────────────────────────────
// Une regle, une seule, et la meme pour les quatre strates : ce qui est coche
// est ce qui sera traite. Sur Gaea, cocher une lettre existante la refait et
// cocher une lettre libre l'ajoute. Sur Houdini et les moteurs, cocher choisit
// ce qui passe. "Ecraser ou ajouter" et "combien de variantes importer"
// cessent d'etre des reglages a comprendre : c'est l'etat de la grille.
//
// Gaea CREE des variantes, les trois autres CONSOMMENT celles qui existent :
// leur grille n'affiche donc que ce qui est sur le disque, et porte en plus un
// interrupteur "toutes" qui court-circuite la selection.

function _varSelected(id) {
  return (cfgGet(`pipeline.${id}.variants_run`) || []).slice();
}

function _varAll(id) {
  if (id === "gaea") return false;          // Gaea n'a pas d'interrupteur
  const v = cfgGet(`pipeline.${id}.variants_all`);
  return v === undefined ? true : !!v;
}

function _varKnown() {
  const known = {};
  ((_gaeaVarData || {}).variants || []).forEach(v => { known[v.name] = v; });
  return known;
}

function _varChipHTML(id, name, info, selected, seedMode, locked = false) {
  const exists = !!(info && info.exists);
  // "Perimee" doit parler de LA strate dont on lit la grille. Elle affichait
  // n'importe quelle etape en retard : on voyait "perimee" dans la carte
  // Unreal alors que c'etait l'import Unity qui datait.
  const enRetard = (info && info.stale) || [];
  const stale = (id === "gaea") ? enRetard.length > 0
                                : enRetard.includes(id);
  let cls = "var-chip";
  let note;
  if (selected) {
    cls += " on";
    // Le verbe dit ce que CETTE strate va faire de la variante. "Refaire" est
    // vrai pour Gaea, qui la regenere ; Houdini la modifie et les moteurs
    // l'importent. Garder le mot du generateur partout donnait l'impression
    // d'un copier-coller mal relu, et surtout d'une action fausse.
    if (id === "houdini") note = _tt("cfg.var.verb.modify", "modifier");
    else if (id === "unreal" || id === "unity") note = _tt("cfg.var.verb.import", "importer");
    else note = exists ? _tt("cfg.gaea.var.redo", "refaire")
                       : _tt("cfg.gaea.var.add", "créer");
  } else if (!exists && locked) {
    // La licence borne le projet : cette lettre en ferait une de trop.
    cls += " free locked";
    note = _tt("cfg.gaea.var.locked", "limite");
  } else if (!exists) {
    cls += " free";
    note = _tt("cfg.gaea.var.free", "libre");
  } else if (stale) {
    cls += " stale";
    note = _tt("cfg.gaea.var.stale", "périmée");
  } else {
    note = (info && info.seed != null) ? String(info.seed) : "ok";
  }
  // L'infobulle nomme les etapes en retard, toutes strates confondues : on
  // masque le mot, pas l'information.
  const title = (!selected && !exists && locked)
    ? _tt("cfg.gaea.var.locked_tip", "Limite de variantes du projet atteinte pour ta licence.")
    : enRetard.length
      ? _tt("cfg.gaea.var.stale_tip", "Refaite depuis : ") + enRetard.join(", ")
      : "";

  // Le seed ne se saisit que la ou il sert, c'est-a-dire au generateur, et
  // seulement en mode Custom. Une liste positionnelle ne disait pas quel
  // nombre allait ou ; le placeholder montre la valeur Auto qui s'appliquera
  // si le champ reste vide, pour que le repli soit visible plutot que devine.
  let seedField = "";
  if (id === "gaea" && seedMode === "custom") {
    const idx = name.charCodeAt(3) - 64;   // "VarA" -> 1
    const cur = (cfgGet("pipeline.gaea.seeds_by_variant") || {})[name];
    seedField = `<input class="var-seed" data-var="${name}" type="number"
      value="${cur == null ? "" : cur}" placeholder="${idx * 1001}">`;
  }

  // Le champ n'est pas un bouton : la pastille devient un conteneur quand il
  // est la, sinon un clic dans le champ cocherait la variante.
  const tag = seedField ? "div" : "button";
  return `<${tag} class="${cls}" data-var="${name}" title="${title}">
    <span class="var-chip-letter" data-var="${name}">${name.replace("Var", "")}</span>
    <span class="var-chip-note" data-var="${name}">${note}</span>
    ${seedField}
  </${tag}>`;
}

function _varGridHTML(id) {
  const data = _gaeaVarData || { letters: [], variants: [] };
  const letters = data.letters || [];
  if (!letters.length) return "";
  const known = _varKnown();
  const selected = _varSelected(id);
  const isGaea = (id === "gaea");

  let visible;
  if (isGaea) {
    // Le generateur montre en plus quatre lettres libres derriere : de quoi en
    // ajouter sans noyer la carte sous vingt-six boutons.
    let last = -1;
    letters.forEach((n, i) => {
      if ((known[n] && known[n].exists) || selected.includes(n)) last = i;
    });
    visible = letters.slice(0, Math.min(letters.length, Math.max(last + 5, 6)));
  } else {
    // Une strate aval ne peut rien faire d'une lettre qui n'existe pas.
    visible = letters.filter(n => known[n] && known[n].exists);
  }

  if (!visible.length) {
    return `<div class="faint" style="font-size:11px;font-style:italic">${
      _tt("cfg.var.empty", "aucune variante dans le dossier d'export")}</div>`;
  }

  const seedMode = cfgGet("pipeline.gaea.seed_mode") || "auto";
  // Une lettre libre se verrouille quand la creer ferait depasser la limite
  // du projet, ou celle du run. Meme regle que license.project_targets.
  const limit = isGaea ? (data.limit || 0) : 0;
  const nExistAll = Object.values(known).filter(v => v.exists).length;
  const nNewSel = selected.filter(n => !(known[n] && known[n].exists)).length;
  const full = !!limit && (nExistAll + nNewSel >= limit || selected.length >= limit);
  const chips = visible
    .map(n => _varChipHTML(id, n, known[n], selected.includes(n), seedMode, full))
    .join("");

  const bits = [];
  if (isGaea) {
    const nExist = Object.values(known).filter(v => v.exists).length;
    const nStale = Object.values(known)
      .filter(v => v.exists && v.stale && v.stale.length).length;
    const nAdd = selected.filter(n => !(known[n] && known[n].exists)).length;
    const nRedo = selected.length - nAdd;
    if (nExist) bits.push(`${nExist} ${_tt("cfg.gaea.var.existing", "existantes")}`);
    if (nAdd) bits.push(`${nAdd} ${_tt("cfg.gaea.var.to_add", "à créer")}`);
    if (nRedo) bits.push(`${nRedo} ${_tt("cfg.gaea.var.to_redo", "à refaire")}`);
    if (nStale) bits.push(`${nStale} ${_tt("cfg.gaea.var.stale", "périmée")}`);
    if (limit) bits.push(`${_tt("cfg.gaea.var.quota", "projet")} ${nExist + nAdd}/${limit}`);
  } else {
    bits.push(selected.length
      ? `${selected.length} ${_tt("cfg.var.selected", "sélectionnée(s)")}`
      : _tt("cfg.var.none_selected", "aucune, cette étape sera ignorée"));
  }

  // Supprimer efface des fichiers : c'est la seule action irreversible de la
  // grille, elle reste au generateur et garde son bouton a part.
  const foot = isGaea
    ? `<button class="btn ghost var-del" ${
        selected.some(n => known[n] && known[n].exists) ? "" : "disabled"}>${
        _tt("cfg.gaea.var.delete", "Supprimer")}</button>`
    : `<button class="btn ghost var-pick-all">${
        _tt("cfg.var.pick_all", "Tout cocher")}</button>`;

  return `
    <div class="var-grid">${chips}</div>
    <div class="var-foot">
      <span class="faint">${bits.join(" · ") || _tt("cfg.gaea.var.none", "aucune variante")}</span>
      ${foot}
    </div>`;
}

async function renderVariantGrid(id, refetch = true) {
  const box = document.getElementById(`${id}-variants-grid`);
  if (!box) return;
  if (refetch || !_gaeaVarData) {
    try { _gaeaVarData = await eel.list_variants()(); } catch (e) { _gaeaVarData = null; }
  }
  // Interrupteur "toutes" allume : la selection ne sert a rien, on ne montre
  // pas une grille dont les clics n'auraient aucun effet.
  box.innerHTML = _varAll(id) ? "" : _varGridHTML(id);
  _wireVariantGrid(id);
}

// Compatibilite : l'ancien nom est appele depuis le bootstrap et la fin de run.
function renderGaeaVariants(refetch = true) {
  return renderVariantGrid("gaea", refetch);
}

// Miroir de license.project_targets : refaire une variante presente est
// toujours permis, une nouvelle ne passe que s'il reste de la place dans le
// projet, et le run ne depasse jamais la limite. Le runner applique la meme
// regle ; ici on evite juste de cocher ce qui serait refuse.
function _projectAllowed(list) {
  const limit = (_gaeaVarData && _gaeaVarData.limit) || 0;
  const ordered = Array.from(new Set(list)).sort();
  if (!limit) return ordered;
  const known = _varKnown();
  let room = Math.max(0, limit - Object.values(known).filter(v => v.exists).length);
  const kept = [];
  for (const v of ordered) {
    const exists = !!(known[v] && known[v].exists);
    if ((exists || room > 0) && kept.length < limit) {
      if (!exists) room--;
      kept.push(v);
    }
  }
  return kept;
}

async function _setVarSelected(id, list) {
  let clean = Array.from(new Set(list)).sort();
  if (id === "gaea") {
    const allowed = _projectAllowed(clean);
    if (allowed.length < clean.length) {
      flashStatus(_tt("cfg.gaea.var.locked_tip",
        "Limite de variantes du projet atteinte pour ta licence."), "var(--warn)");
    }
    clean = allowed;
  }
  await cfgSet(`pipeline.${id}.variants_run`, clean);
  if (id === "gaea") {
    // `variants` reste le nombre de variantes du prochain run : l'estimateur
    // le lit, il doit rester d'accord avec la grille plutot que vivre sa vie.
    await cfgSet("pipeline.gaea.variants", clean.length);
    const gaeaCard = document.querySelector('[data-strata="gaea"]');
    const chip = gaeaCard && gaeaCard.querySelector(".chip.accent");
    if (chip) chip.textContent = `${clean.length}× ${_tt("strata.variants", "variants")}`;
    refreshStats();
  } else {
    // La pastille "N variantes" de la carte vit en dehors du panneau : sans ce
    // redessin, elle garderait le compte d'avant le clic.
    renderStrata();
  }
  renderVariantGrid(id, false);
}

function _wireVariantGrid(id) {
  const root = document.getElementById(`${id}-variants-grid`);
  if (!root) return;

  // Selection au glisse. Un clic simple est un glisse d'une seule pastille,
  // donc il n'y a qu'un mecanisme a maintenir, pas deux.
  let enCours = null;      // true = on coche, false = on decoche
  let choix = null;        // Set, tenu a jour pendant le glisse

  const marquer = (chip) => {
    // Une lettre verrouillee par la licence ne se coche pas, meme au glisse.
    if (enCours && chip.classList.contains("locked")) return;
    const nom = chip.dataset.var;
    if (enCours) choix.add(nom); else choix.delete(nom);
    // On repeint la pastille sans redessiner la grille : un innerHTML sous le
    // curseur casserait le glisse en cours.
    chip.classList.toggle("on", enCours);
    const info = _varKnown()[nom];
    chip.classList.toggle("free", !enCours && !(info && info.exists));
  };

  const finir = async () => {
    if (enCours === null) return;
    const liste = Array.from(choix);
    enCours = null;
    choix = null;
    document.removeEventListener("mouseup", finir);
    await _setVarSelected(id, liste);
  };

  root.querySelectorAll(".var-chip").forEach(b => {
    b.addEventListener("mousedown", (e) => {
      // Le champ de seed vit dans la pastille : y cliquer ne doit pas la
      // cocher, sinon on ne peut pas corriger un nombre sans tout basculer.
      if (e.target && e.target.classList.contains("var-seed")) return;
      e.preventDefault();
      // Le sens vient de la PREMIERE pastille touchee et ne change plus :
      // sans ca, repasser sur une pastille l'inverserait sans arret.
      choix = new Set(_varSelected(id));
      enCours = !choix.has(b.dataset.var);
      marquer(b);
      document.addEventListener("mouseup", finir);
    });
    b.addEventListener("mouseenter", () => {
      if (enCours !== null) marquer(b);
    });
  });

  // Le seed s'enregistre au "change" (sortie du champ ou Entree) et surtout on
  // NE redessine PAS : re-rendre a chaque frappe ferait perdre le focus au
  // milieu d'un nombre.
  root.querySelectorAll(".var-seed").forEach(inp => {
    inp.addEventListener("change", async () => {
      const table = Object.assign({}, cfgGet("pipeline.gaea.seeds_by_variant") || {});
      const raw = (inp.value || "").trim();
      const n = parseInt(raw, 10);
      // Vide ou illisible : on retire l'entree, et la variante retombe sur la
      // valeur Auto que le placeholder annonce.
      if (!raw || isNaN(n)) delete table[inp.dataset.var];
      else table[inp.dataset.var] = n;
      await cfgSet("pipeline.gaea.seeds_by_variant", table);
    });
    inp.addEventListener("click", e => e.stopPropagation());
  });

  const pick = root.querySelector(".var-pick-all");
  if (pick) pick.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const known = _varKnown();
    const all = Object.keys(known).filter(n => known[n].exists);
    const sel = _varSelected(id);
    // Le bouton bascule : tout coche, ou tout decoche si c'etait deja le cas.
    await _setVarSelected(id, sel.length >= all.length ? [] : all);
  });

  const del = root.querySelector(".var-del");
  if (del && !del.disabled) {
    del.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const known = _varKnown();
      const doomed = _varSelected("gaea").filter(n => known[n] && known[n].exists);
      if (!doomed.length) return;
      // Effacer des fichiers ne se rattrape pas : on nomme ce qui va partir.
      if (!confirm(_tt("cfg.gaea.var.delete_confirm",
          "Move the files of these variants to the Recycle Bin: ") + doomed.join(", ") + " ?")) return;
      const res = await eel.delete_variants(doomed)();
      if (res && res.ok) {
        flashStatus(`${res.removed} ${_tt("cfg.gaea.var.deleted", "file(s) moved to the Recycle Bin")}`);
        await _setVarSelected("gaea", _varSelected("gaea").filter(n => !doomed.includes(n)));
        renderVariantGrid("gaea", true);
      } else if (res && res.error) {
        flashStatus(res.error);
      }
    });
  }
}

// Bloc reutilisable pour les strates aval : l'interrupteur "toutes" et la
// grille qu'il commande. Meme geste sur Houdini, Unreal et Unity.
function variantScopeBlockHTML(id) {
  const all = _varAll(id);
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0">
      <span class="faint" style="font-size:12px">${
        _tt("cfg.var.all", "Toutes les variantes")}</span>
      <div class="switch${all ? " on" : ""}" id="${id}-variants-all"></div>
    </div>
    <div id="${id}-variants-grid"></div>`;
}

function wireVariantScope(id) {
  const sw = document.getElementById(`${id}-variants-all`);
  if (sw) sw.addEventListener("click", async () => {
    const on = sw.classList.toggle("on");
    await cfgSet(`pipeline.${id}.variants_all`, on);
    renderStrata();
    renderVariantGrid(id, false);
  });
  renderVariantGrid(id, true);
}


function _gaeaNodesSectionsHTML(data) {
  const nodes = data.nodes || [];
  if (!nodes.length) {
    return `<div class="faint" style="font-size:11px;font-style:italic">${window.I18N?.t("cfg.gaea.nodes_none") || "no export node found (Output node or F3 pin)"}</div>`;
  }
  const groups = { mesh: [], color: [], other: [] };
  nodes.forEach(n => (groups[n.kind] || groups.other).push(n));
  const saved = cfgGet("pipeline.gaea.nodes_enabled") || {};

  const section = (kind, label, color) => {
    const items = groups[kind];
    if (!items.length) return "";
    return `
      <div class="nodes-section" data-kind="${kind}" style="background:var(--bg-panel);border:1px solid var(--line-soft);border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:8px;height:14px;background:${color};border-radius:2px"></span>
          <span class="section-label" style="color:${color}">${label} · ${items.length}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">
          ${items.map(n => {
            const on = saved[n.name] !== false;
            // D'ou vient ce node : node de la categorie Output (il exporte
            // tout seul) ou pin F3 pose a la main. Sans ca on se demande
            // pourquoi tel node est liste et pas tel autre.
            const badge = n.silent ? "AUTO" : (n.type === "Pinned" ? "F3" : (n.type || ""));
            // Node sans export configure dans Gaea : il serait calcule sans
            // rien ecrire. Stratum pose l'export sur sa copie de travail, donc
            // le fichier sort quand meme. On l'indique pour que la difference
            // avec le .terrain d'origine ne soit pas une surprise.
            const badgeTitle = n.silent
              ? (window.I18N?.t("cfg.gaea.node_silent") ||
                 `${n.type}: no export configured in Gaea. Stratum adds it automatically (EXR) for this run. Your .terrain is not modified.`)
              : (n.type === "Pinned" ? "Pinned for export (F3)" : `Gaea Output node (${n.type})`);
            const badgeStyle = n.silent
              ? "color:var(--accent);border-color:var(--accent)"
              : "color:var(--fg-faint);border-color:var(--line-soft)";
            return `<label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--fg);cursor:pointer">
              <input type="checkbox" class="gaea-node" data-node="${n.name}" ${on ? "checked" : ""} style="accent-color:${color};width:14px;height:14px;cursor:pointer">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.name}</span>
              <span title="${badgeTitle}" style="font-family:var(--font-mono);font-size:8.5px;letter-spacing:0.06em;border:1px solid;border-radius:3px;padding:0 3px;flex-shrink:0;${badgeStyle}">${badge}</span>
            </label>`;
          }).join("")}
        </div>
      </div>`;
  };

  return section("mesh", "MESH", "var(--accent)")
       + section("color", "COLOR", "var(--cta)")
       + section("other", "OTHER", "var(--fg-dim)");
}

function _updateGaeaVpsWarning(data) {
  const w = $("#gaea-vps-warning");
  if (!w || !data) return;
  const res = parseInt(cfgGet("pipeline.gaea.resolution") || 4096);
  const vpsNodes = data.vps_per_node || {};
  const affected = Object.entries(vpsNodes).filter(([, v]) => v > res);
  if (!affected.length) { w.style.display = "none"; return; }
  affected.sort((a, b) => b[1] - a[1]);
  const names = affected.slice(0, 4).map(x => x[0]).join(", ") + (affected.length > 4 ? "…" : "");
  w.textContent = `⚠ ${affected.length} mesh(es) won't export (VPS > ${res}): ${names}. Max required: ${data.vps_max}.`;
  w.style.display = "block";
}

async function _loadGaeaNodes() {
  const file = cfgGet("pipeline.gaea.file") || "";
  const area = $("#gaea-nodes-area");
  if (!area) return;
  if (!file) {
    area.innerHTML = `<div class="faint" style="font-size:11px;font-style:italic">— select a .terrain file to load nodes —</div>`;
    return;
  }
  area.innerHTML = `<div class="faint" style="font-size:11px;font-style:italic">loading…</div>`;
  try {
    const data = await eel.get_terrain_nodes(file)();
    // Reference pour l'estimateur : nodes_enabled ne retient que les cases
    // que l'utilisateur a touchees, il ne suffit pas a compter les actifs.
    await cfgSet("pipeline.gaea.nodes_known", (data.nodes || []).map(n => n.name));
    area.innerHTML = _gaeaNodesSectionsHTML(data);
    // Le nombre de nodes est un facteur direct de la duree : sans ca,
    // l'estimation restait celle d'avant le chargement du terrain, et il
    // fallait toucher un autre reglage pour la reveiller.
    refreshStats();
    _updateGaeaVpsWarning(data);
    area.querySelectorAll(".gaea-node").forEach(cb => {
      cb.addEventListener("change", async () => {
        const all = cfgGet("pipeline.gaea.nodes_enabled") || {};
        all[cb.dataset.node] = cb.checked;
        await cfgSet("pipeline.gaea.nodes_enabled", all);
        refreshStats();
      });
    });
  } catch (e) {
    area.innerHTML = `<div class="faint" style="font-size:11px">error : ${e}</div>`;
  }
}

function wireConfigGaea() {
  wireCfgSections($('[data-expand="gaea"]'));
  const file = cfgGet("pipeline.gaea.file") || "";
  $("#gaea-file-input").addEventListener("change", async e => {
    await cfgSet("pipeline.gaea.file", e.target.value);
    _loadGaeaNodes();
    renderStrata();
  });
  $("#gaea-file-browse").addEventListener("click", async () => {
    const p = await eel.pick_file("Select Gaea .terrain", [["Terrain", "*.terrain"]], cfgGet("pipeline.gaea.file") || "")();
    if (p) {
      $("#gaea-file-input").value = p;
      await cfgSet("pipeline.gaea.file", p);
      _loadGaeaNodes();
      renderStrata();
    }
  });
  $("#gaea-res").addEventListener("change", async e => {
    let val = parseInt(e.target.value);
    const cap = window._TIER_MAX_RESOLUTION || 8192;
    if (val > cap) {
      val = cap;
      e.target.value = String(cap);
      flashStatus(`Tier limit: max ${cap}px export. Upgrade for higher resolution.`, "var(--warn)");
    }
    await cfgSet("pipeline.gaea.resolution", val);
    refreshStats();
    _loadGaeaNodes();
  });
  renderVariantGrid("gaea", true);

  // Seed mode : boutons toggle
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const hints = {
    auto:   _t("cfg.gaea.seed.hint_auto",   "Same seeds every run (1001, 2002, …). Reproducible."),
    random: _t("cfg.gaea.seed.hint_random", "Random seeds at each run. Explore wildly different terrains."),
    custom: _t("cfg.gaea.seed.hint_custom", "Provide your own seeds below."),
  };
  document.querySelectorAll(".seed-mode-btn").forEach(b => {
    b.addEventListener("click", async () => {
      const m = b.dataset.seed;
      document.querySelectorAll(".seed-mode-btn").forEach(x => x.classList.toggle("primary", x === b));
      await cfgSet("pipeline.gaea.seed_mode", m);
      const hint = $("#gaea-seed-hint");
      if (hint) hint.textContent = hints[m];
      // Les champs de seed vivent sur les pastilles : changer de mode les fait
      // apparaitre ou disparaitre, donc la grille doit etre redessinee.
      renderGaeaVariants(false);
    });
  });

  $("#gaea-force-rebuild")?.addEventListener("click", async (e) => {
    const sw = e.currentTarget;
    const on = sw.classList.toggle("on");
    await cfgSet("pipeline.gaea.force_rebuild", on);
  });
  _loadGaeaNodes();
}

function configContentHoudini() {
  const overwrite = cfgGet("pipeline.houdini.overwrite_original");
  const overOn = (overwrite === undefined) ? true : !!overwrite;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  return `
    ${_cfgSectionHTML(_t("cfg.hou.modifiers", "Modifiers"), `
      ${configRow(_t("cfg.hou.modifiers", "Modifiers"),
        `<div id="hou-chain-area" style="flex:1;min-width:0"></div>`, "tip.hou.file")}
      ${configRow(_t("cfg.hou.overwrite", "Overwrite original"), `<div class="switch${overOn ? " on" : ""}" id="hou-overwrite" data-on="${overOn}"></div>`, "tip.hou.overwrite")}
      <div id="hou-promote-row"></div>
    `, "houdini.modifiers")}

    ${_cfgSectionHTML(_t("cfg.hou.variants", "Variants to modify"),
      variantScopeBlockHTML("houdini"), "houdini.variants")}

    ${_cfgSectionHTML(_t("cfg.hou.params_section", "HDA parameters"), `
      <div id="hou-params-area">
        <div class="faint" style="font-size:11px;font-style:italic">${_t("cfg.hou.params_empty", "— select an .hda or .hiplc file —")}</div>
      </div>
    `, "houdini.params")}`;
}

// -- VALIDER LES VERSIONS NETTOYEES ---------------------------------
// "Ecraser l'original" coupe, Houdini pose sa sortie a cote de l'entree avec
// le suffixe _cleaned : on compare avant/apres. Une fois la comparaison faite,
// il faut trancher, et le faire a la main dans l'explorateur sur vingt
// fichiers n'est pas une reponse.
//
// La ligne n'existe que s'il y a des candidats : rien a valider, rien a
// afficher.
// Bande "a remettre a jour". Elle n'apparait que quand une variante a ete
// refaite et que le travail pose apres elle n'a pas suivi. L'utilisateur ne
// decide pas de ce qui est perime : il decide de le rattraper ou non.
async function refreshStaleRow() {
  const row = $("#stale-row");
  if (!row) return;
  let res = null;
  try { res = await eel.list_stale()(); } catch (e) { /* backend absent */ }
  if (!res || !res.ok || !res.count) { row.innerHTML = ""; return; }

  const n = res.count;
  const label = (n > 1
    ? _tt("stale.n", "{n} variantes à remettre à jour")
    : _tt("stale.one", "1 variante à remettre à jour")).replace("{n}", n);
  const names = Object.keys(res.variants).sort().join(", ");
  // Le detail PAR etape, pas leur union : Houdini peut etre perime sur deux
  // variantes et l'import Unreal sur une seule. Annoncer "houdini + unreal"
  // laissait croire que tout serait refait partout.
  const parEtape = {};
  Object.entries(res.variants).forEach(([v, etapes]) =>
    etapes.forEach(e => (parEtape[e] = parEtape[e] || []).push(v)));
  const what = res.stages
    .map(e => `${e} ${(parEtape[e] || []).length}`).join(" · ");

  row.innerHTML = `
    <div class="stale-strip" title="${_esc(Object.entries(res.variants)
        .map(([v, e]) => v + " : " + e.join(", ")).join(" | "))}">
      <span class="promote-lbl">${_esc(label)}
        <span class="faint" style="font-family:var(--font-mono);font-size:10px">${_esc(what)}</span>
      </span>
      <button class="btn ghost" id="stale-btn">${_tt("stale.btn", "Rattraper")}</button>
    </div>`;

  $("#stale-btn")?.addEventListener("click", async () => {
    // Un rattrapage EST un run : il doit passer par la meme mise en scene que
    // le bouton principal. Sans elle, la barre de progression s'animait pendant
    // qu'on pouvait relancer par-dessus, le bouton affichant toujours LANCER.
    window._RUN_STATS = {};
    $(`.tab[data-tab="console"]`)?.click();
    clearConsole();
    resetStrataStatus();
    _setRunBtn("running");

    const res2 = await eel.run_catchup()();
    if (res2 && res2.ok) {
      row.innerHTML = "";
    } else if (res2 && res2.preflight_errors) {
      _setRunBtn("idle");
      // Meme porte de sortie que le run normal : on ne contourne pas le prevol.
      flashStatus(res2.preflight_errors[0]?.msg || _tt("stale.blocked", "Prévol bloqué"),
                  "var(--warn)");
    } else if (res2 && res2.error) {
      _setRunBtn("idle");
      appendConsole(`⚠ ${res2.error}`, "WARN");
      flashStatus(res2.error, "var(--warn)");
    } else {
      // Reponse inattendue : on ne laisse pas le bouton bloque sur "running".
      _setRunBtn("idle");
    }
  });
}

async function refreshPromoteRow() {
  const row = $("#hou-promote-row");
  if (!row) return;
  let res = null;
  try { res = await eel.list_cleaned_versions()(); } catch (e) { /* backend absent */ }
  if (!res || !res.ok || !res.count) { row.innerHTML = ""; return; }

  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const n = res.count;
  const label = n > 1
    ? _t("cfg.hou.promote.n", "{n} cleaned versions waiting").replace("{n}", n)
    : _t("cfg.hou.promote.one", "1 cleaned version waiting");

  row.innerHTML = `
    <div class="promote-strip">
      <span class="promote-lbl">${_esc(label)}${infoIcon("tip.hou.promote")}</span>
      <button class="btn ghost" id="hou-promote-btn">${_t("cfg.hou.promote.btn", "Validate")}</button>
    </div>`;

  $("#hou-promote-btn")?.addEventListener("click", () => _confirmPromote(res));
}

// La confirmation nomme ce qui disparait. Un "Etes-vous sur ?" sur une
// suppression de plusieurs centaines de Mo ne dit rien d'utile.
function _confirmPromote(res) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const lines = res.items.slice(0, 12).map(it => `
    <div style="display:flex;gap:8px;align-items:baseline;padding:2px 0;font-family:var(--font-mono);font-size:10.5px">
      <span style="color:var(--fg-mid);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${_esc(it.name)}</span>
      <span style="color:var(--fg-faint)">&rarr;</span>
      <span style="color:var(--ok, var(--accent));flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${_esc(it.target)}</span>
    </div>
    ${it.originals.length ? `<div style="padding:0 0 4px 12px;font-family:var(--font-mono);font-size:10px;color:var(--err)">
        &minus; ${it.originals.map(o => _esc(o)).join(", ")}</div>` : ""}`).join("");
  const more = res.items.length > 12
    ? `<div class="faint" style="font-size:11px;margin-top:6px">+ ${res.items.length - 12}</div>` : "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:520px;max-width:620px">
      <div class="modal-head">
        <div class="modal-title">${_t("cfg.hou.promote.title", "Validate cleaned versions")}</div>
        <div class="modal-sub">${_t("cfg.hou.promote.sub",
          "The originals are deleted and the _cleaned suffix is dropped. This cannot be undone.")}</div>
      </div>
      <div class="modal-body" style="max-height:320px;overflow:auto">${lines}${more}</div>
      <div class="modal-foot" style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn ghost" id="promote-cancel">${_t("btn.cancel", "Cancel")}</button>
        <button class="btn primary" id="promote-go">${_t("cfg.hou.promote.go", "Delete and rename")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  $("#promote-cancel").addEventListener("click", close);
  $("#promote-go").addEventListener("click", async () => {
    close();
    let out = null;
    try { out = await eel.promote_cleaned_versions()(); } catch (e) { /* backend absent */ }
    if (!out || !out.ok) {
      flashStatus(_t("cfg.hou.promote.failed", "Validation failed"), "var(--err)");
      return;
    }
    flashStatus(`${out.promoted} ${_t("cfg.hou.promote.done", "validated")}, `
              + `${out.deleted} ${_t("cfg.hou.promote.removed", "removed")}`);
    await refreshPromoteRow();
    // Les fichiers ont change de nom : la liste d'assets ment tant qu'elle
    // n'a pas rescanne.
    window._firstAssetLoaded = false;
    refreshAssetPreview();
  });
}

// Nettoyage d'un moteur : ce que Stratum a pose dans le projet Unreal ou
// Unity, variante par variante. La page n'envoie que des lettres : le moteur
// Python recalcule l'inventaire au moment d'agir, aucun chemin ne vient d'ici.
const _ENGINE_LABEL = { unreal: "Unreal", unity: "Unity" };

async function openCleanupModal(engine) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const name = _ENGINE_LABEL[engine] || engine;
  let inv = null;
  try { inv = await eel.engine_cleanup_inventory(engine)(); } catch (e) { /* backend absent */ }
  if (!inv || !inv.ok) {
    flashStatus(inv && inv.error === "no_target"
      ? _t("cfg.clean.no_target", "No target project.")
      : _t("cfg.clean.failed", "Cleanup failed"), "var(--err)");
    return;
  }
  if (!inv.total) {
    flashStatus(_t("cfg.clean.empty", "Nothing from Stratum here."));
    return;
  }

  // Le survol d'une ligne montre ses fichiers : la liste complete tiendrait
  // mal dans la fenetre, et on veut pouvoir verifier avant d'envoyer.
  const rows = inv.variants.map(v => `
    <label title="${_esc(v.files.join("\n"))}" style="display:flex;gap:10px;align-items:center;padding:4px 0;cursor:pointer">
      <input type="checkbox" data-clean-var="${_esc(v.name)}" checked>
      <span style="font-family:var(--font-mono);font-size:12px;min-width:48px">${_esc(v.name)}</span>
      <span class="faint" style="font-size:11px">${v.count} ${_t("cfg.clean.files", "files")}</span>
    </label>`).join("");
  const shared = inv.shared.length
    ? `<div class="faint" id="clean-shared" title="${_esc(inv.shared.join("\n"))}" style="font-size:11px;margin-top:8px">
        + ${inv.shared.length} ${_t("cfg.clean.shared", "shared materials, only if all is checked")}</div>` : "";
  const running = inv.running
    ? `<div style="color:var(--err);font-size:12px;margin-top:10px">${_esc(
        _t("cfg.clean.running", "Close {engine} first.").replace("{engine}", name))}</div>` : "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:420px;max-width:520px">
      <div class="modal-head">
        <div class="modal-title">${_esc(_t("cfg.clean.title", "Remove from {engine}").replace("{engine}", name))}</div>
        <div class="modal-sub">${_t("cfg.clean.sub", "Placed by Stratum for this project. They go to the Recycle Bin.")}</div>
      </div>
      <div class="modal-body" style="max-height:320px;overflow:auto">${rows}${shared}${running}</div>
      <div class="modal-foot" style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn ghost" id="clean-cancel">${_t("btn.cancel", "Cancel")}</button>
        <button class="btn primary" id="clean-go">${_t("cfg.clean.go", "Move to Recycle Bin")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const boxes = [...overlay.querySelectorAll("[data-clean-var]")];
  const go = overlay.querySelector("#clean-go");
  const sharedEl = overlay.querySelector("#clean-shared");
  const update = () => {
    const n = boxes.filter(b => b.checked).length;
    go.disabled = inv.running || !n;
    // Les materiaux communs ne partent qu'avec la derniere variante.
    if (sharedEl) sharedEl.style.opacity = n === boxes.length ? "1" : "0.45";
  };
  boxes.forEach(b => b.addEventListener("change", update));
  update();

  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("#clean-cancel").addEventListener("click", close);
  go.addEventListener("click", async () => {
    const chosen = boxes.filter(b => b.checked).map(b => b.dataset.cleanVar);
    close();
    let out = null;
    try { out = await eel.engine_cleanup_apply(engine, chosen)(); } catch (e) { /* backend absent */ }
    if (!out || !out.ok) {
      flashStatus(out && out.error === "running"
        ? _t("cfg.clean.running", "Close {engine} first.").replace("{engine}", name)
        : _t("cfg.clean.failed", "Cleanup failed"), "var(--err)");
      return;
    }
    flashStatus(`${out.removed} ${_t("cfg.clean.done", "file(s) moved to the Recycle Bin")}`);
    // La memoire du projet a oublie ces imports : la grille doit le montrer.
    if (typeof renderVariantGrid === "function") renderVariantGrid(engine, true);
    refreshCleanupSection(engine);
  });
}

// La section n'apparait que si ce projet a deja quelque chose dans le moteur :
// sans rien a montrer, le bouton ne menerait nulle part.
async function refreshCleanupSection(engine) {
  const box = document.querySelector(`[data-clean-section="${engine}"]`);
  if (!box) return;
  let res = null;
  try { res = await eel.engine_cleanup_count(engine)(); } catch (e) { /* backend absent */ }
  const n = res && res.ok ? res.total : 0;
  box.hidden = !n;
  const c = box.querySelector(`[data-clean-count="${engine}"]`);
  if (c) c.textContent = n
    ? ` · ${n} ${window.I18N ? window.I18N.t("cfg.clean.files") : "files"}` : "";
}

// Un seul ecouteur pour les deux moteurs : le panneau est redessine souvent,
// un ecouteur pose sur le bouton se perdrait a chaque rendu.
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-clean-engine]");
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  openCleanupModal(b.dataset.cleanEngine);
});

// Verificateur de contrat. Deux regles : une entree, une sortie. Affiche des
// que le HDA est selectionne, pour ne pas decouvrir le probleme en plein run.
function _hdaContractHTML(h, ref) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const c = h && h.contract;
  if (!c) return "";
  const line = (ok, label, detail, fix) => `
    <div class="hda-check ${ok ? "ok" : "ko"}">
      <span class="hda-check-icon">${ok ? "✓" : "✕"}</span>
      <span class="hda-check-lbl">${label}</span>
      <span class="hda-check-detail">${_esc(detail)}</span>
      ${ok ? "" : `<span class="hda-check-fix">${_esc(fix)}</span>`}
    </div>`;

  const i = c.input;
  const o = c.output;
  const inDetail = !i ? _t("hda.none", "not found")
    : (i.kind === "param" ? `paramètre '${i.name}'` : `File SOP '${i.name}'`);
  const outDetail = !o ? _t("hda.none", "not found")
    : (o.named ? `rop_fbx '${o.name}'`
               : `rop_fbx '${o.name}'` + (o.count > 1
                  ? ` (${o.count} ${_t("hda.rops_found", "ROPs found, none named OUT")})` : ""));

  // Quand le contrat est rempli, il n'y a rien a corriger : une ligne discrete
  // suffit. Le detail complet ne sert qu'a celui qui doit reparer son HDA.
  if (c.ok) {
    // Un modificateur livre avec Stratum est conforme par construction : la
    // ligne verte n'apprend rien et mange de la place. Elle ne sert qu'a
    // celui qui branche son propre HDA et doit le reparer.
    if (_builtinEntry(ref)) return "";
    return `<div class="hda-contract ok-compact" title="${_esc(inDetail)} → ${_esc(outDetail)}">
      <span class="hda-check-icon">✓</span>
      <span>${_t("hda.ok", "Contract OK")}</span>
      <span class="hda-check-detail">${_esc(inDetail)} → ${_esc(outDetail)}</span>
    </div>`;
  }

  return `
    <div class="hda-contract ko">
      ${line(!!i, _t("hda.input", "Input"), inDetail,
             _t("hda.fix_input", "Add a File SOP named 'IN' inside the HDA"))}
      ${line(!!o, _t("hda.output", "Output"), outDetail,
             _t("hda.fix_output", "Add an FBX ROP named 'OUT'"))}
      ${(o && !o.named && o.count > 1)
        ? `<div class="hda-check warn"><span class="hda-check-icon">!</span>
             <span class="hda-check-detail">${_t("hda.rop_ambiguous",
               "Several outputs and none named OUT: rename yours to remove the ambiguity.")}</span></div>`
        : ""}
    </div>`;
}

function _hdaId(h) {
  // Identifier unique pour un HDA dans le fichier
  return h.node_path || h.type_name || h.label || "?";
}

function _hdaParamControlHTML(p, savedValue) {
  const cur = (savedValue !== undefined) ? savedValue : p.default;
  const name = p.name;
  const type = (p.type || "").toLowerCase();

  if (type === "toggle") {
    return `<div class="switch${cur ? " on" : ""}" data-hda-param="${name}" data-hda-type="toggle"></div>`;
  }
  if (type === "menu" || type === "stringmenu") {
    const items = p.menu_items || [];
    const labels = p.menu_labels && p.menu_labels.length === items.length ? p.menu_labels : items;
    return `<select data-hda-param="${name}" data-hda-type="menu" style="${SEL_STYLE};width:100%">
      ${items.map((v, i) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${labels[i]}</option>`).join("")}
    </select>`;
  }
  if (type === "int" || type === "float") {
    const step = type === "int" ? "1" : "any";
    // Un parametre borne se manipule au curseur : la valeur chiffree reste
    // editable a cote pour les reglages precis.
    const hasRange = Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min;
    const val = (cur !== undefined && cur !== null) ? cur : (hasRange ? p.min : 0);
    if (hasRange) {
      const sstep = (type === "int") ? 1 : ((p.max - p.min) / 200);
      return `<div class="hda-slider">
        <input type="range" min="${p.min}" max="${p.max}" step="${sstep}" value="${val}" data-hda-slider="${name}">
        <div class="input" style="width:72px"><input type="number" step="${step}" min="${p.min}" max="${p.max}" data-hda-param="${name}" data-hda-type="${type}" value="${val}"></div>
      </div>`;
    }
    return `<div class="input" style="width:120px"><input type="number" step="${step}" data-hda-param="${name}" data-hda-type="${type}" value="${val}"></div>`;
  }
  // string ou fallback
  return `<div class="input" style="flex:1;min-width:0"><input data-hda-param="${name}" data-hda-type="string" value="${cur ?? ""}"></div>`;
}

// Beaucoup de HDA declinent le meme reglage pour chaque style :
// steps_realistic, steps_cartoon, etc. Quinze lignes separees noient
// l'interface et repetent cinq fois les memes libelles. On les regroupe en une
// seule ligne de cinq cases, aux couleurs des styles.
const _STYLE_KEYS = ["realistic", "stylized", "polygonal", "cartoon", "retro"];
// Meme valeur que manifest.DEFAULT_STYLE cote Python : c'est celle que le HDA
// lira quand aucun style n'est detecte.
const DEFAULT_STYLE_KEY = "realistic";
const _STYLE_RE = new RegExp("^(.+)_(" + _STYLE_KEYS.join("|") + ")$", "i");

function _prettyBase(base) {
  return String(base).split(/[_\s]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function _groupHdaParams(params) {
  const seen = new Map();
  const items = [];
  for (const p of params) {
    const m = _STYLE_RE.exec(p.name || "");
    if (!m) { items.push({ kind: "single", p }); continue; }
    const base = m[1];
    let g = seen.get(base);
    if (!g) {
      // L'ordre d'apparition du premier membre fixe la place du groupe : la
      // liste reste dans l'ordre voulu par l'auteur du HDA.
      g = { kind: "style", base, label: _prettyBase(base), byStyle: {} };
      seen.set(base, g);
      items.push(g);
    }
    g.byStyle[m[2].toLowerCase()] = p;
  }
  // Un seul style ne fait pas une declinaison : ca reste une ligne normale.
  // Et si le projet n'a aucun style, un groupe entier se replie sur la seule
  // valeur qui sera lue a l'execution, sous le nom du reglage.
  const useStyles = _projectUsesStyles();
  const out = [];
  for (const it of items) {
    if (it.kind !== "style") { out.push(it); continue; }
    const members = Object.keys(it.byStyle);
    if (members.length < 2) {
      Object.values(it.byStyle).forEach(p => out.push({ kind: "single", p }));
    } else if (!useStyles) {
      const p = it.byStyle[DEFAULT_STYLE_KEY] || it.byStyle[members[0]];
      // Le libelle vient du groupe ("Ratio"), pas du membre ("Realistic") :
      // afficher "Realistic" ici affirmerait un style que rien ne justifie.
      out.push({ kind: "single", p: Object.assign({}, p, { label: it.label }) });
    } else {
      out.push(it);
    }
  }
  return out;
}

// Dans une case de groupe, le curseur passe SOUS le chiffre et non a cote :
// cinq curseurs pleine largeur cote a cote seraient illisibles, mais sans
// jauge on perd la lecture d'un coup d'oeil de "ou en est ce reglage".
function _styleCellHTML(p, saved) {
  const type = (p.type || "").toLowerCase();
  const cur = (saved !== undefined) ? saved : p.default;
  if (type === "int" || type === "float") {
    const step = type === "int" ? "1" : "any";
    const hasRange = Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min;
    const val = (cur !== undefined && cur !== null) ? cur : (hasRange ? p.min : 0);
    const bounds = hasRange ? ` min="${p.min}" max="${p.max}"` : "";
    const num = `<div class="input"><input type="number" step="${step}"${bounds}
      data-hda-param="${p.name}" data-hda-type="${type}" value="${val}"></div>`;
    if (!hasRange) return num;
    const sstep = (type === "int") ? 1 : ((p.max - p.min) / 200);
    return num + `<input class="hda-mini-range" type="range" min="${p.min}" max="${p.max}"
      step="${sstep}" value="${val}" data-hda-slider="${p.name}">`;
  }
  return _hdaParamControlHTML(p, saved);
}

function _hdaStyleGroupHTML(g, savedValues) {
  const cells = _STYLE_KEYS.filter(k => g.byStyle[k]).map(k => {
    const p = g.byStyle[k];
    const tip = p.label || p.name;
    return `<div class="hda-style-cell" style="--chip:${_KIND_COLORS[k] || "var(--fg-dim)"}" title="${_esc(tip)}">
      <span class="hda-style-cell-lbl">${k}</span>
      ${_styleCellHTML(p, savedValues[p.name])}
    </div>`;
  }).join("");
  return `<div class="hda-style-group">
    <span class="hda-param-lbl">${_esc(g.label)}</span>
    <div class="hda-style-cells">${cells}</div>
  </div>`;
}

function _renderHdaCard(hda, savedValues, file) {
  const params = hda.params || [];
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  // Compte ce qui est reellement surcharge : c'est ce que le bouton effacera.
  const touched = Object.keys(savedValues || {}).length;
  const resetTip = touched
    ? `${_t("cfg.hou.reset_params", "Reset to the HDA defaults")} (${touched})`
    : _t("cfg.hou.reset_none", "Nothing changed: these are the HDA defaults");
  return `
    <div class="hda-card" style="background:var(--bg-panel);border:1px solid var(--line-soft);border-radius:var(--r-md);padding:12px 14px;margin-top:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-family:var(--font-display);font-weight:600;color:var(--accent);font-size:13px">${hda.label || hda.type_name || "HDA"}</span>
        ${hda.node_path ? `<span class="faint" style="font-family:var(--font-mono);font-size:9px">${hda.node_path}</span>` : ""}
        <div style="flex:1"></div>
        <button class="hda-reset${touched ? "" : " empty"}" data-hda-reset="${_esc(file || "")}"
                ${touched ? "" : "disabled"} title="${_esc(resetTip)}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
          <span>${_t("cfg.hou.reset", "Reset")}</span>
        </button>
      </div>
      ${_hdaContractHTML(hda, file)}
      ${params.length === 0
        ? `<div class="faint" style="font-size:11px;font-style:italic">no parameter exposed</div>`
        : _groupHdaParams(params).map(g => g.kind === "style"
            ? _hdaStyleGroupHTML(g, savedValues)
            : `<div class="hda-param-row">
                 <span class="hda-param-lbl">${_esc(g.p.label || g.p.name)}</span>
                 <div style="flex:1;min-width:0">${_hdaParamControlHTML(g.p, savedValues[g.p.name])}</div>
               </div>`).join("")}
    </div>`;
}

function _wireHdaParams(area, file, hdaId, rerender) {
  // L'etat du bouton dit si ce HDA est regle ou d'origine : il doit donc
  // suivre chaque modification, pas seulement les re-rendus.
  const resetBtn = area.querySelector("[data-hda-reset]");
  const syncReset = () => {
    if (!resetBtn) return;
    const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
    const n = Object.keys((cfgGet("pipeline.houdini.hda_params") || {})[file] || {}).length;
    resetBtn.disabled = !n;
    resetBtn.classList.toggle("empty", !n);
    resetBtn.title = n
      ? `${_t("cfg.hou.reset_params", "Reset to the HDA defaults")} (${n})`
      : _t("cfg.hou.reset_none", "Nothing changed: these are the HDA defaults");
  };

  // Remise a zero : on efface les surcharges, on ne reecrit rien. Les valeurs
  // par defaut sont celles que l'introspection a lues dans le HDA, donc elles
  // reapparaissent d'elles-memes au re-rendu, sans relancer hython.
  area.querySelector("[data-hda-reset]")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const all = cfgGet("pipeline.houdini.hda_params") || {};
    if (!all[file]) return;
    delete all[file];
    await cfgSet("pipeline.houdini.hda_params", all);
    if (typeof rerender === "function") rerender();
    flashStatus(window.I18N?.t("cfg.hou.reset_done") || "HDA parameters reset",
                "var(--ok)");
  });

  // Toggle switches
  area.querySelectorAll('[data-hda-type="toggle"]').forEach(el => {
    el.addEventListener("click", async () => {
      const on = el.classList.toggle("on");
      const all = cfgGet("pipeline.houdini.hda_params") || {};
      if (!all[file]) all[file] = {};
      all[file][el.dataset.hdaParam] = on;
      await cfgSet("pipeline.houdini.hda_params", all);
      syncReset();
    });
  });
  // Curseurs : ils pilotent le champ chiffre, qui reste seul responsable de
  // la sauvegarde. Un seul chemin d'ecriture, pas deux a garder en phase.
  area.querySelectorAll('input[data-hda-slider]').forEach(sl => {
    const num = area.querySelector(`input[data-hda-param="${sl.dataset.hdaSlider}"]`);
    if (!num) return;
    sl.addEventListener("input", () => { num.value = sl.value; });
    sl.addEventListener("change", () => {
      num.value = sl.value;
      num.dispatchEvent(new Event("change"));
    });
    num.addEventListener("input", () => { sl.value = num.value; });
  });
  // Menu / int / float / string
  area.querySelectorAll('select[data-hda-param], input[data-hda-param]').forEach(el => {
    el.addEventListener("change", async () => {
      const type = el.dataset.hdaType;
      let value = el.value;
      if (type === "int")   value = parseInt(value) || 0;
      if (type === "float") value = parseFloat(value) || 0.0;
      const all = cfgGet("pipeline.houdini.hda_params") || {};
      if (!all[file]) all[file] = {};
      all[file][el.dataset.hdaParam] = value;
      await cfgSet("pipeline.houdini.hda_params", all);
      syncReset();
    });
  });
}

// Un bloc de parametres par maillon de la chaine. Avant, seul le premier HDA
// etait reglable : la chaine acceptait trois modificateurs mais deux d'entre
// eux restaient muets, sans que rien ne le dise.
// Les cinq styles connus de Stratum, dans l'ordre du site.
// Ce projet met-il des styles graphiques en jeu ? On repond par les fichiers
// deja produits, jamais par une preference. Tant que rien n'a ete scanne, on
// ne conclut pas : afficher les styles est le choix sur.
function _projectUsesStyles() {
  const assets = (typeof ASSETS_CACHE !== "undefined" && Array.isArray(ASSETS_CACHE))
    ? ASSETS_CACHE : [];
  if (!assets.length) return true;
  return assets.some(a => a && a.kind && _STYLE_KEYS.includes(String(a.kind).toLowerCase()));
}

const _STYLES = ["Realistic", "Stylized", "Polygonal", "Cartoon", "Retro"];

function _hdaStyles(file) {
  const all = cfgGet("pipeline.houdini.files_styles") || {};
  const v = all[file];
  return Array.isArray(v) ? v : [];
}

async function _setHdaStyles(file, list) {
  const all = cfgGet("pipeline.houdini.files_styles") || {};
  // Les cinq coches revient a "tous" : on stocke une liste vide pour que le
  // sens reste "aucune restriction" meme si on ajoute un style plus tard.
  all[file] = (list.length === _STYLES.length) ? [] : list;
  await cfgSet("pipeline.houdini.files_styles", all);
}

// Le filtre vit dans Stratum, pas dans le HDA : un modificateur Blender ne
// pourra jamais lire stratum_style, mais Stratum saura toujours quel style
// porte un mesh.
function _hdaStylesHTML(file) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  // Rien a filtrer quand tous les meshes sont sans style : la ligne de
  // pastilles ne ferait que suggerer une distinction qui n'existe pas ici.
  if (!_projectUsesStyles()) return "";
  const on = new Set(_hdaStyles(file).map(x => String(x).toLowerCase()));
  const tous = on.size === 0;
  const chips = _STYLES.map(st => {
    const actif = tous || on.has(st.toLowerCase());
    return `<span class="style-chip${actif ? " on" : ""}" data-style-chip="${st}"
      style="--chip:${_KIND_COLORS[st.toLowerCase()] || "var(--fg-dim)"}"
      >${st}</span>`;
  }).join("");
  return `
    <div class="hda-styles" data-styles-for="${_esc(file)}">
      <span class="hda-styles-lbl">${_t("cfg.hou.applies_to", "Applies to")}</span>
      ${chips}
      <span class="hda-styles-state">${tous
        ? _t("cfg.hou.styles_all", "all styles")
        : `${on.size}/${_STYLES.length}`}</span>
    </div>`;
}

function _wireHdaStyles(host, file) {
  const box = host.querySelector(".hda-styles");
  if (!box) return;

  // Rafraichit les pastilles et le compteur sans toucher au reste du DOM :
  // la position de defilement, les champs en cours d'edition et les autres
  // maillons de la chaine restent exactement ou ils sont.
  const paint = () => {
    const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
    const on = new Set(_hdaStyles(file).map(x => String(x).toLowerCase()));
    const tous = on.size === 0;
    box.querySelectorAll("[data-style-chip]").forEach(c => {
      c.classList.toggle("on", tous || on.has(c.dataset.styleChip.toLowerCase()));
    });
    const state = box.querySelector(".hda-styles-state");
    if (state) {
      state.textContent = tous
        ? _t("cfg.hou.styles_all", "all styles")
        : `${on.size}/${_STYLES.length}`;
    }
  };

  box.querySelectorAll("[data-style-chip]").forEach(chip => {
    chip.addEventListener("click", async () => {
      const cur = _hdaStyles(file);
      // Partir de "tous" et cliquer un style veut dire "seulement celui-la".
      let next = cur.length ? cur.slice() : _STYLES.slice();
      const st = chip.dataset.styleChip;
      const i = next.findIndex(x => String(x).toLowerCase() === st.toLowerCase());
      if (i >= 0) next.splice(i, 1); else next.push(st);
      // Tout decocher n'aurait aucun sens : le maillon ne servirait jamais.
      if (!next.length) next = _STYLES.slice();
      // cfgSet met CFG a jour de facon synchrone avant de partir vers Python :
      // on peut donc repeindre tout de suite, sans attendre l'aller-retour et
      // sans dupliquer ici la regle "les cinq coches valent tous les styles".
      const saved = _setHdaStyles(file, next);
      paint();
      await saved;
    });
  });
}

async function _renderHdaBlock(file, host) {
  if (!host) return;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const body = (inner) => { host.innerHTML = inner; };

  body(`<div class="faint" style="font-size:11px;font-style:italic">⏳ ${_t("cfg.hou.inspecting", "introspecting HDA (first time can take 5-10s)…")}</div>`);
  let result;
  try {
    result = await eel.inspect_hda(file)();
  } catch (e) {
    body(`<div style="font-size:11px;color:var(--err)">Error: ${e}</div>`);
    return;
  }
  if (result.error) {
    body(`<div style="font-size:11px;color:var(--warn);padding:8px;background:color-mix(in oklab,var(--warn) 8%,transparent);border-radius:var(--r-sm)">⚠ ${_esc(result.error)}</div>`);
    return;
  }
  const hdas = result.hdas || [];
  // Memorise le contrat pour que la liste de maillons puisse afficher ses
  // badges sans relancer une introspection.
  if (hdas[0] && hdas[0].contract) {
    _HOU_CONTRACTS.set(file, hdas[0].contract);
    renderHouChain();
  }
  // Le vrai nom du modificateur est conserve dans la config : le resume de la
  // carte Houdini peut alors afficher "Smooth Edges" au lieu du nom de
  // fichier, sans avoir a relancer une introspection au demarrage.
  const lbl = hdas[0] && (hdas[0].label || hdas[0].type_name);
  if (lbl) {
    const labels = cfgGet("pipeline.houdini.files_labels") || {};
    if (labels[file] !== lbl) {
      labels[file] = lbl;
      await cfgSet("pipeline.houdini.files_labels", labels);
      refreshStrataSummary("houdini");
    }
  }
  if (!hdas.length) {
    body(`<div class="faint" style="font-size:11px;font-style:italic">${_t("cfg.hou.no_hda", "no HDA found in this file")}</div>`);
    return;
  }

  const selectedAll = cfgGet("pipeline.houdini.selected_hda") || {};
  let selectedIdx = 0;
  const savedSelected = selectedAll[file];
  if (savedSelected) {
    const idx = hdas.findIndex(h => _hdaId(h) === savedSelected);
    if (idx >= 0) selectedIdx = idx;
  }
  const savedParams = (cfgGet("pipeline.houdini.hda_params") || {})[file] || {};

  let html = "";
  if (hdas.length > 1) {
    html += `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
        <span style="font-size:12px;color:var(--cta);font-family:var(--font-mono);letter-spacing:0.08em;text-transform:uppercase;font-weight:600">Active HDA · ${hdas.length} detected</span>
        <select data-hda-selector style="${SEL_STYLE};flex:1;border-color:color-mix(in oklab,var(--cta) 30%,transparent)">
          ${hdas.map((h, i) => `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${_esc(h.label || h.type_name || "?")}${h.node_path ? " · " + _esc(h.node_path) : ""}</option>`).join("")}
        </select>
      </div>`;
  }
  html += _hdaStylesHTML(file);
  html += `<div data-hda-card-wrap></div>`;
  body(html);
  _wireHdaStyles(host, file);

  const wrap = host.querySelector("[data-hda-card-wrap]");
  const renderActive = (idx) => {
    // Relu a chaque rendu : apres une remise a zero, l'instantane pris au
    // chargement du bloc contiendrait encore les anciennes valeurs.
    const saved = (cfgGet("pipeline.houdini.hda_params") || {})[file] || {};
    wrap.innerHTML = _renderHdaCard(hdas[idx], saved, file);
    _wireHdaParams(wrap, file, _hdaId(hdas[idx]), () => renderActive(idx));
  };
  renderActive(selectedIdx);

  const selector = host.querySelector("[data-hda-selector]");
  if (selector) {
    selector.addEventListener("change", async (e) => {
      const idx = parseInt(e.target.value);
      const all = cfgGet("pipeline.houdini.selected_hda") || {};
      all[file] = _hdaId(hdas[idx]);
      await cfgSet("pipeline.houdini.selected_hda", all);
      renderActive(idx);
    });
  } else {
    const all = cfgGet("pipeline.houdini.selected_hda") || {};
    all[file] = _hdaId(hdas[0]);
    await cfgSet("pipeline.houdini.selected_hda", all);
  }
}

async function _loadHdaParams() {
  const area = $("#hou-params-area");
  if (!area) return;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const chain = _houChain();
  if (!chain.length) {
    area.innerHTML = `<div class="faint" style="font-size:11px;font-style:italic">${_t("cfg.hou.params_empty", "select an .hda or .hiplc file")}</div>`;
    return;
  }
  area.innerHTML = chain.map((f, i) => `<div class="hda-file-block" id="hda-block-${i}"></div>`).join("");
  // En serie : chaque introspection lance un hython, les paralleliser
  // ferait tourner trois Houdini en meme temps sur la machine de l'user.
  for (let i = 0; i < chain.length; i++) {
    await _renderHdaBlock(chain[i], document.getElementById(`hda-block-${i}`));
  }
}

// Chaine de modificateurs : plusieurs HDA appliques dans l'ordre sur chaque
// mesh, cuisines dans une seule session Houdini. Le premier maillon reste le
// champ principal, les suivants s'ajoutent ici.
function _houChain() {
  const files = cfgGet("pipeline.houdini.files");
  if (Array.isArray(files) && files.length) return files.slice();
  const one = cfgGet("pipeline.houdini.file") || "";
  return one ? [one] : [];
}

function _houDisabled() {
  const d = cfgGet("pipeline.houdini.files_disabled");
  return new Set(Array.isArray(d) ? d : []);
}

async function _setHouDisabled(set) {
  await cfgSet("pipeline.houdini.files_disabled", [...set]);
  renderHouChain();
}

async function _setHouChain(list) {
  const clean = list.filter(Boolean);
  await cfgSet("pipeline.houdini.files", clean);
  // `file` reste ecrit pour les configs anterieures et pour l'affichage de la
  // carte de strate ; c'est `files` qui fait foi.
  await cfgSet("pipeline.houdini.file", clean[0] || "");
  // Un maillon retire ne doit pas laisser son nom dans la liste des eteints.
  const off = _houDisabled();
  const orphan = [...off].filter(f => !clean.includes(f));
  if (orphan.length) {
    orphan.forEach(f => off.delete(f));
    await cfgSet("pipeline.houdini.files_disabled", [...off]);
  }
  renderHouChain();
  // Ajouter ou retirer un maillon change la liste des blocs de parametres.
  _loadHdaParams();
}

// Contrat du HDA, lu depuis le cache d'introspection deja rempli par
// _renderHdaBlock. Sert a afficher l'etat d'un maillon sans relancer hython.
const _HOU_CONTRACTS = new Map();

function renderHouChain() {
  const host = document.getElementById("hou-chain-area");
  if (!host) return;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const chain = _houChain();
  const off = _houDisabled();

  if (!chain.length) {
    host.innerHTML = `
      <div class="hou-chain-empty">${_t("cfg.hou.chain_empty",
        "No modifier. The mesh goes through Houdini untouched.")}</div>
      ${_houAddBtn(_t)}`;
    _wireHouChain();
    return;
  }

  // Tous les maillons sont egaux : le premier n'a plus de champ a part. C'est
  // ce qui permet de le deplacer comme les autres.
  const rows = chain.map((f, i) => {
    const on = !off.has(f);
    const c = _HOU_CONTRACTS.get(f);
    const name = _modifierName(f);
    const locked = !_modifierAllowed(f);
    // Un badge n'apparait que s'il dit quelque chose de vrai : rien tant que
    // le HDA n'a pas ete inspecte, un avertissement s'il est casse.
    let badge = "";
    if (locked) {
      badge = `<span class="hou-chain-badge ko" title="${_esc(
        _t("hda.pick.locked_tip", "Available with the Indie or Studio license."))}">!</span>`;
    } else if (c && !c.ok) {
      badge = `<span class="hou-chain-badge ko" title="${_esc(
        _t("cfg.hou.badge_ko_tip", "Missing input or output. Open the parameters below to see what to fix."))}">!</span>`;
    } else if (c && c.style) {
      badge = `<span class="hou-chain-badge style" title="${_esc(
        _t("cfg.hou.badge_style_tip", "Reads the mesh style: adapts to Realistic, Stylized, Polygonal, Cartoon, Retro."))}">STYLE</span>`;
    }
    return `
      <div class="hou-chain-row${on ? "" : " off"}" data-hou-idx="${i}" data-hou-path="${_esc(f)}">
        <span class="hou-chain-grip" title="${_esc(_t("layout.drag_hint", "Drag to reorder"))}">⋮⋮</span>
        <span class="hou-chain-num">${i + 1}</span>
        <span class="hou-chain-path" title="${_esc(f)}">${_esc(name)}</span>
        ${badge}
        <div class="switch${on ? " on" : ""}" data-hou-toggle="${i}"></div>
        <button class="btn ghost hou-chain-del" data-hou-del="${i}" title="${_esc(
          _t("cfg.hou.remove", "Remove this modifier"))}">✕</button>
      </div>`;
  }).join("");

  host.innerHTML = `
    <div class="hou-chain-rows" id="hou-chain-rows">${rows}</div>
    ${_houAddBtn(_t)}
    <div class="faint" style="font-size:10.5px;margin-top:4px">${_t("cfg.hou.chain_hint",
      "Applied in order on each mesh, in a single Houdini session.")}</div>`;
  _wireHouChain();
  _wireHouChainDnD();
}

function _houAddBtn(_t) {
  return `<div class="hou-chain-actions">
      <button class="btn ghost" id="hou-chain-add" style="height:26px;padding:0 10px;font-size:11px">
        + ${_t("cfg.hou.add_modifier", "Add a modifier")}</button>
      <button class="hda-doc-link" id="hou-doc-link" type="button">${
        _t("hda.doc.open", "How to make your own HDA")}</button>
    </div>`;
}

const _TIER_LABEL = { free: "Free", indie: "Indie", studio: "Studio" };

// Choisir un modificateur sans quitter Stratum. Les trois livres sont dans la
// liste ; le seul bouton qui ouvre l'explorateur est celui de SON HDA, et il
// demande une licence Indie ou Studio.
async function openHdaPicker() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const info = await loadBuiltinHdas();
  const chain = _houChain();
  const rows = (info.items || []).map(it => {
    const added = chain.includes(it.ref);
    const off = added || !it.allowed || !it.present;
    const note = !it.present ? _t("hda.pick.missing", "Missing from this installation.")
      : !it.allowed ? _t("hda.pick.locked_tip", "Available with the Indie or Studio license.")
      : added ? _t("hda.pick.in_chain", "Already added")
      : _t("hda.builtin." + it.id, "");
    return `<button class="hda-pick-row${off ? " off" : ""}" data-pick="${_esc(it.ref)}" ${off ? "disabled" : ""}>
        <span class="hda-pick-name">${_esc(it.label)}</span>
        <span class="hda-pick-note">${_esc(note)}</span>
        ${it.allowed ? "" : `<span class="hda-pick-tier">${_esc(_TIER_LABEL[it.tier] || it.tier)}</span>`}
      </button>`;
  }).join("");
  const own = info.custom_allowed;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:440px;max-width:520px">
      <div class="modal-head">
        <div class="modal-title">${_t("hda.pick.title", "Add a modifier")}</div>
        <div class="modal-sub">${_t("hda.pick.sub", "Pick one from Stratum, or bring your own.")}</div>
      </div>
      <div class="modal-body">
        <div class="hda-pick-head">${_t("hda.pick.builtin_head", "Included with Stratum")}</div>
        ${rows}
        <div class="hda-pick-head">${_t("hda.pick.custom_head", "Yours")}</div>
        <button class="hda-pick-row${own ? "" : " off"}" data-pick-own ${own ? "" : "disabled"}>
          <span class="hda-pick-name">${_t("hda.pick.custom", "My own HDA")}</span>
          <span class="hda-pick-note">${own
            ? _t("hda.pick.custom_sub", "Pick an .hda or .hiplc file on your disk.")
            : _t("hda.pick.locked_tip", "Available with the Indie or Studio license.")}</span>
          ${own ? "" : `<span class="hda-pick-tier">Indie</span>`}
        </button>
        <button class="hda-doc-link" data-pick-doc type="button" style="margin-top:10px">${
          _t("hda.doc.open", "How to make your own HDA")}</button>
      </div>
      <div class="modal-foot" style="display:flex;justify-content:flex-end">
        <button class="btn ghost" data-pick-close>${_t("btn.close", "Close")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-pick-close]").addEventListener("click", close);
  overlay.querySelector("[data-pick-doc]").addEventListener("click", () => { close(); openHdaDoc(); });
  overlay.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", async () => {
    close();
    await _setHouChain([..._houChain(), b.dataset.pick]);
  }));
  overlay.querySelector("[data-pick-own]").addEventListener("click", async () => {
    close();
    const p = await eel.pick_file("Select HDA / .hiplc",
      [["Houdini", "*.hda;*.hdalc;*.hiplc;*.hip"], ["All", "*.*"]], "")();
    if (p) await _setHouChain([..._houChain(), p]);
  });
}

// Ce qu'il faut savoir pour ecrire un HDA que Stratum sait faire tourner.
function openHdaDoc() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const steps = ["in", "out", "save", "parms", "style", "check"].map(k => `
    <div class="hda-doc-step">
      <div class="hda-doc-t">${_t("hda.doc." + k + "_t", "")}</div>
      <div class="hda-doc-b">${_t("hda.doc." + k + "_b", "")}</div>
    </div>`).join("");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:480px;max-width:600px">
      <div class="modal-head">
        <div class="modal-title">${_t("hda.doc.title", "Make an HDA for Stratum")}</div>
        <div class="modal-sub">${_t("hda.doc.sub", "Two rules, then the details.")}</div>
      </div>
      <div class="modal-body" style="max-height:60vh;overflow:auto">${steps}</div>
      <div class="modal-foot" style="display:flex;justify-content:flex-end">
        <button class="btn ghost" data-doc-close>${_t("btn.close", "Close")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-doc-close]").addEventListener("click", close);
}

function _wireHouChain() {
  const host = document.getElementById("hou-chain-area");
  if (!host) return;

  host.querySelector("#hou-chain-add")?.addEventListener("click", openHdaPicker);
  host.querySelector("#hou-doc-link")?.addEventListener("click", openHdaDoc);

  host.querySelectorAll("[data-hou-del]").forEach(b => {
    b.addEventListener("click", async e => {
      e.stopPropagation();
      const c = _houChain();
      c.splice(parseInt(b.dataset.houDel), 1);
      await _setHouChain(c);
    });
  });

  host.querySelectorAll("[data-hou-toggle]").forEach(sw => {
    sw.addEventListener("click", async e => {
      e.stopPropagation();
      const f = _houChain()[parseInt(sw.dataset.houToggle)];
      if (!f) return;
      const off = _houDisabled();
      if (off.has(f)) off.delete(f); else off.add(f);
      await _setHouDisabled(off);
    });
  });
}

// Reordonner a la souris, meme mecanique que les niveaux d'agencement : le
// drag HTML5 natif se declenche mal dans la WebView.
function _wireHouChainDnD() {
  const box = document.getElementById("hou-chain-rows");
  if (!box) return;
  let row = null, rows = [], step = 0;
  let startY = 0, fromIdx = 0, toIdx = 0, moved = false;

  const applyShift = () => {
    rows.forEach((r, i) => {
      if (r === row) return;
      let shift = 0;
      if (fromIdx < toIdx && i > fromIdx && i <= toIdx) shift = -step;
      else if (fromIdx > toIdx && i >= toIdx && i < fromIdx) shift = step;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };

  const onMove = (e) => {
    if (!row) return;
    const dy = e.clientY - startY;
    if (!moved) {
      if (Math.abs(dy) < 4) return;   // un clic tremblant n'est pas un drag
      moved = true;
      row.classList.add("dragging");
    }
    row.style.transform = `translateY(${dy}px)`;
    if (step > 0) {
      let idx = Math.round(fromIdx + dy / step);
      idx = Math.max(0, Math.min(rows.length - 1, idx));
      if (idx !== toIdx) { toIdx = idx; applyShift(); }
    }
  };

  const onUp = async () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (!row) return;
    const dragged = row;
    row = null;
    dragged.classList.remove("dragging");
    rows.forEach(r => { r.style.transform = ""; r.style.zIndex = ""; });
    if (!moved || toIdx === fromIdx) return;
    const next = rows.map(r => r.dataset.houPath);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragged.dataset.houPath);
    await _setHouChain(next);
  };

  box.querySelectorAll(".hou-chain-row").forEach(el => {
    el.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      if (e.target.closest("[data-hou-toggle]") || e.target.closest("[data-hou-del]")) return;
      e.preventDefault();
      row = el;
      rows = [...box.querySelectorAll(".hou-chain-row")];
      fromIdx = toIdx = rows.indexOf(el);
      step = rows.length > 1
        ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
        : 0;
      startY = e.clientY;
      moved = false;
      el.style.zIndex = "5";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

function wireConfigHoudini() {
  // La liste se cable elle-meme (ajout, suppression, interrupteurs, drag) :
  // elle est reconstruite a chaque changement, un cablage externe se perdrait.
  renderHouChain();

  // Le nommage a quitte cette strate : c'est une etape de Stratum
  // (voir renderNamingSection), elle s'applique avec ou sans Houdini.

  const wireToggle = (selector, cfgPath) => {
    const sw = $(selector);
    if (!sw) return;
    sw.addEventListener("click", async () => {
      const newOn = !(sw.dataset.on === "true");
      sw.dataset.on = newOn;
      sw.classList.toggle("on", newOn);
      await cfgSet(cfgPath, newOn);
    });
  };

  wireToggle("#hou-overwrite", "pipeline.houdini.overwrite_original");

  wireVariantScope("houdini");
  wireCfgSections($('[data-expand="houdini"]'));
  refreshPromoteRow();
  _loadHdaParams();
}

// Ordre commun UE/Unity :
// 1) Master/Shader   2) Master mode/Shader name   3) Collision
// 4) Auto LODs      5) Performance (Nanite UE / Read-Write Unity)
// 6) Prefab (Unity only)   7) Variants to import
// Bloc "Transform fix" (Gaea direct) : import normal + fix rotation/scale.
// p = préfixe d'id (ue/unity), ck = clé config (pipeline.unreal / pipeline.unity).
function transformFixRows(p, ck) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const onB = v => (v === undefined ? true : !!v);
  const rot = cfgGet(`${ck}.rotation_xyz`) || [0, 0, 0];
  const sc = cfgGet(`${ck}.scale_factor`); const scv = (sc === undefined ? 100 : sc);
  const numI = (id, val, w = 52) => `<input id="${id}" type="number" value="${val}" style="width:${w}px;height:28px;background:var(--bg-input);color:var(--fg);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 6px;font-family:var(--font-mono);font-size:11px">`;
  return `
    ${configRow(_t("cfg.fix.rotation", "Fix rotation"), `<div style="display:flex;align-items:center;gap:8px"><div class="switch${onB(cfgGet(`${ck}.fix_rotation`)) ? " on" : ""}" id="${p}-fix-rot"></div>${numI(`${p}-rot-x`, rot[0])}${numI(`${p}-rot-y`, rot[1])}${numI(`${p}-rot-z`, rot[2])}<span class="faint" style="font-size:10px">X Y Z</span></div>`, "tip.fix.rotation")}
    ${configRow(_t("cfg.fix.scale", "Fix scale"), `<div style="display:flex;align-items:center;gap:8px"><div class="switch${onB(cfgGet(`${ck}.fix_scale`)) ? " on" : ""}" id="${p}-fix-scale"></div>${numI(`${p}-scale`, scv, 68)}</div>`, "tip.fix.scale")}`;
}

function wireTransformFix(p, ck) {
  const tog = (sel, path) => { const sw = $(sel); if (!sw) return; sw.addEventListener("click", async () => { await cfgSet(path, sw.classList.toggle("on")); }); };
  tog(`#${p}-fix-rot`,       `${ck}.fix_rotation`);
  tog(`#${p}-fix-scale`,     `${ck}.fix_scale`);
  const setRot = async () => {
    const x = parseFloat($(`#${p}-rot-x`)?.value) || 0;
    const y = parseFloat($(`#${p}-rot-y`)?.value) || 0;
    const z = parseFloat($(`#${p}-rot-z`)?.value) || 0;
    await cfgSet(`${ck}.rotation_xyz`, [x, y, z]);
  };
  [`#${p}-rot-x`, `#${p}-rot-y`, `#${p}-rot-z`].forEach(s => $(s)?.addEventListener("change", setRot));
  $(`#${p}-scale`)?.addEventListener("change", async e => { await cfgSet(`${ck}.scale_factor`, parseFloat(e.target.value) || 1); });
}

// ── Panneau de moteur, construit une fois pour tous ─────────────────
// Ce que chaque moteur a de particulier tient dans cette table. Tout le reste
// (materiaux, collision, LODs, variantes, transformations, rangement) est
// commun et n'est ecrit qu'une fois.
const ENGINE_DEFS = {
  unreal: {
    cfg: "pipeline.unreal",
    idp: "ue",
    matName: { key: "master_material_name", def: "M_Landscape",
               label: ["cfg.ue.master", "Master material"], tip: "tip.ue.master" },
    collision: [["simple", "Simple"], ["complex", "Complex"], ["none", "None"]],
    collisionDef: "simple",
    // Reglages qui n'existent que chez ce moteur.
    extra: [
      { id: "nanite",   key: "nanite",   def: true,
        label: ["cfg.ue.nanite", "Nanite"], tip: "tip.ue.nanite" },
      { id: "lightmap", key: "generate_lightmap_uvs", def: false,
        label: ["cfg.ue.lightmap", "Lightmap UVs"], tip: "tip.ue.lightmap" },
    ],
  },
  unity: {
    cfg: "pipeline.unity",
    idp: "unity",
    collision: [["mesh", "Mesh (exact)"], ["capsule", "Capsule"],
                ["box", "Box"], ["none", "None"]],
    collisionDef: "mesh",
    extra: [
      { id: "prefab", key: "generate_prefab", def: true,
        label: ["cfg.unity.prefab", "Generate Prefab"], tip: "tip.unity.prefab" },
      { id: "rw", key: "read_write_mesh", def: false,
        label: ["cfg.unity.rw", "Read/Write mesh"], tip: "tip.unity.rw" },
    ],
  },
};

// Sections repliables d'un panneau de configuration.
// `key` identifie la section pour se souvenir de son etat. Sans clef, la
// section reste ouverte et n'affiche pas de chevron : certaines n'ont pas
// assez de contenu pour meriter un volet.
const CFG_FOLD_KEY = "stratum.cfgFolded";

function _cfgFolded() {
  try {
    const raw = localStorage.getItem(CFG_FOLD_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  } catch (e) {
    // Navigation privee, stockage refuse : on repart d'un etat neutre plutot
    // que de casser le rendu du panneau.
    return {};
  }
}

function _cfgSetFolded(key, folded) {
  const all = _cfgFolded();
  if (folded) all[key] = 1; else delete all[key];
  try { localStorage.setItem(CFG_FOLD_KEY, JSON.stringify(all)); }
  catch (e) { /* pas de stockage : l'etat vaut pour cette session */ }
}

function _cfgSectionHTML(label, rowsHTML, key) {
  if (!key) {
    return `
    <div class="cfg-section">
      <div class="cfg-section-label">${label}</div>
      ${rowsHTML}
    </div>`;
  }
  const folded = !!_cfgFolded()[key];
  return `
    <div class="cfg-section foldable${folded ? " folded" : ""}" data-cfg-section="${key}">
      <button class="cfg-section-head" data-cfg-fold="${key}">
        <span class="cfg-section-chev">${ICON_CHEV}</span>
        <span class="cfg-section-label">${label}</span>
      </button>
      <div class="cfg-section-body">${rowsHTML}</div>
    </div>`;
}

// Un seul ecouteur pose sur le panneau : les sections sont reconstruites a
// chaque rendu, et rattacher un ecouteur par en-tete les accumulerait.
function wireCfgSections(root) {
  const host = root || document;
  host.querySelectorAll("[data-cfg-fold]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const sec = btn.closest(".cfg-section");
      if (!sec) return;
      const folded = sec.classList.toggle("folded");
      _cfgSetFolded(btn.dataset.cfgFold, folded);
    });
  });
}

// LODs auto. Nanite remplace le systeme de LOD : l'importer ignore la case
// quand il est allume, et le faisait jusqu'ici sans le dire. La ligne s'eteint
// donc et porte la raison, comme un niveau de destination neutralise.
function lodsRow(engine, d, g, onB) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const key = engine === "unreal" ? "lods_auto" : "generate_lods";
  const on = onB(g(key));
  const dead = (engine === "unreal") && onB(g("nanite"));
  const tag = dead
    ? `<span class="layout-row-tag" style="margin-right:8px">${_t("cfg.ue.lods_nanite", "replaced by Nanite")}</span>`
    : "";
  return configRow(_t("cfg.engine.lods", "Auto LODs"),
    `<div style="display:flex;align-items:center;gap:0;${dead ? "opacity:.5" : ""}">
      ${tag}<div class="switch${on && !dead ? " on" : ""}" id="${d.idp}-lods"></div>
    </div>`,
    dead ? "tip.ue.lods_nanite" : "tip.lods");
}

function configContentEngine(engine) {
  const d = ENGINE_DEFS[engine];
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const g = k => cfgGet(`${d.cfg}.${k}`);
  const onB = v => (v === undefined ? true : !!v);
  const onF = v => (v === undefined ? false : !!v);
  const sw = (id, on) => `<div class="switch${on ? " on" : ""}" id="${d.idp}-${id}"></div>`;
  const sel = (id, opts, cur) => `<select id="${d.idp}-${id}" style="${SEL_STYLE};width:150px">
      ${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("")}
    </select>`;

  const matOn = onB(g("create_material"));

  // ── Materiaux : la partie qui differe le plus entre moteurs ──────
  let matRows = "";
  if (engine === "unreal") {
    const mode = g("master_material_mode") || "existing";
    matRows =
      configRow(_t(...d.matName.label),
        `<div class="input"><input id="ue-master" value="${_esc(g(d.matName.key) || d.matName.def)}"></div>`,
        d.matName.tip) +
      configRow(_t("cfg.ue.master_mode", "Master mode"),
        `<select id="ue-master-mode" style="${SEL_STYLE};width:170px">
          <option value="existing" ${mode === "existing" ? "selected" : ""}>${_t("cfg.ue.master_mode.use", "Use existing")}</option>
          <option value="create"   ${mode === "create"   ? "selected" : ""}>${_t("cfg.ue.master_mode.create", "Create if missing")}</option>
        </select>`, "tip.ue.master_mode");
  } else {
    const rp = g("render_pipeline") || "URP";
    const from = g("material_from") || "pipeline";
    // Deux questions independantes. Le pipeline decrit le PROJET ; la
    // provenance decrit ce que Stratum pose sur les meshes. Les melanger
    // faisait perdre le pipeline des qu'on choisissait son propre graphe.
    const fromOpts = [
      ["pipeline", _t("cfg.unity.from.pipeline", "Pipeline shader")],
      ["shadergraph", _t("cfg.unity.from.sg", "ShaderGraph")],
      ["material", _t("cfg.unity.from.mat", "Material")],
    ];
    matRows =
      configRow(_t("cfg.unity.pipeline", "Render pipeline"),
        SELECT_FN("unity-pipeline", ["URP", "HDRP", "Built-in", "Other"], rp),
        "tip.unity.pipeline") +
      configRow(_t("cfg.unity.mat_from", "Material from"),
        `<select id="unity-mat-from" style="${SEL_STYLE};width:150px">
          ${fromOpts.map(([v, l]) => `<option value="${v}" ${from === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>`, "tip.unity.mat_from") +
      `<div id="unity-shader-row" style="${from === "shadergraph" ? "" : "display:none"}">
        ${configRow(_t("cfg.unity.shader_name", "ShaderGraph"),
          `<div class="input" style="flex:1;min-width:0">
            <input id="unity-shader-name" value="${_esc(g("shader_name") || "SG_Landscape_{Style}")}"
                   placeholder="SG_Landscape_{Style}" style="min-width:0">
            <span class="key" id="unity-shader-browse" style="cursor:pointer;flex-shrink:0">···</span>
          </div>`,
          "tip.unity.shader_name")}
      </div>
      <div id="unity-matname-row" style="${from === "material" ? "" : "display:none"}">
        ${configRow(_t("cfg.unity.mat_name", "Material name"),
          `<div class="input" style="flex:1;min-width:0">
            <input id="unity-mat-name" value="${_esc(g("material_name") || "")}"
                   placeholder="M_Landscape_{Style}" style="min-width:0">
          </div>`, "tip.unity.mat_name")}
      </div>`;
  }
  matRows += configRow(_t("cfg.fix.normal", "Import normal map"),
    sw("import-normal", onB(g("import_normal"))), "tip.fix.normal");

  const extraRows = d.extra.map(x =>
    configRow(_t(...x.label), sw(x.id, x.def ? onB(g(x.key)) : onF(g(x.key))), x.tip)).join("");

  // Le projet cible d'abord : sans lui, rien de ce qui suit ne sert.
  const targetVal = cfgGet(`paths.${engine}_project`) || "";
  const targetRow = configRow(_t("cfg.engine.target", "Target project"),
    `<div class="input" style="flex:1;min-width:0">
      <input id="${d.idp}-target" value="${_esc(targetVal)}" placeholder="${_esc(
        engine === "unreal" ? _t("cfg.engine.target.ph_ue", ".uproject file")
                            : _t("cfg.engine.target.ph_unity", "project folder"))}" style="min-width:0">
      <span class="key" id="${d.idp}-target-browse" style="cursor:pointer;flex-shrink:0">···</span>
    </div>`, "tip.engine.target");

  return `
    ${_cfgSectionHTML(_t("cfg.sec.destination", "Destination"),
      targetRow +
      destDesignerHTML(engine),
      `${engine}.destination`)}

    ${_cfgSectionHTML(_t("cfg.engine.variants", "Variants to import"),
      variantScopeBlockHTML(engine), `${engine}.variants`)}

    <div data-clean-section="${engine}" hidden>
    ${_cfgSectionHTML(_t("cfg.clean.section", "Cleanup"), `
      <div class="promote-strip">
        <span class="promote-lbl">${_t("cfg.clean.lbl", "Stratum's assets in this project")}<span class="faint" data-clean-count="${engine}"></span>${infoIcon("tip.clean")}</span>
        <button class="btn ghost" data-clean-engine="${engine}">${_t("cfg.clean.btn", "Review contents")}</button>
      </div>`, `${engine}.cleanup`)}
    </div>

    ${_cfgSectionHTML(_t("cfg.sec.mesh", "Mesh"),
      configRow(_t("cfg.engine.collision", "Collision"),
        sel("collision", d.collision, g("collision") || d.collisionDef), "tip.collision") +
      lodsRow(engine, d, g, onB) +
      extraRows +
      transformFixRows(d.idp, d.cfg),
      `${engine}.mesh`)}

    ${_cfgSectionHTML(_t("cfg.sec.materials", "Materials"),
      configRow(_t("cfg.engine.create_mat", "Handle materials"),
        sw("create-mat", matOn), engine === "unreal" ? "tip.ue.create_mat" : "tip.unity.create_mat") +
      `<div id="${d.idp}-material-section" style="${matOn ? "" : "display:none"}">${matRows}</div>`,
      `${engine}.materials`)}`;
}

function wireConfigEngine(engine) {
  const d = ENGINE_DEFS[engine];
  refreshCleanupSection(engine);
  const tog = (id, key) => {
    const el = $(`#${d.idp}-${id}`);
    if (!el) return;
    el.addEventListener("click", async () => {
      await cfgSet(`${d.cfg}.${key}`, el.classList.toggle("on"));
    });
  };

  // Creer les materiaux : replie la section quand c'est coupe, parce que tous
  // les reglages qu'elle contient deviennent sans effet.
  const cm = $(`#${d.idp}-create-mat`);
  if (cm) {
    cm.addEventListener("click", async () => {
      const on = cm.classList.toggle("on");
      await cfgSet(`${d.cfg}.create_material`, on);
      const sec = $(`#${d.idp}-material-section`);
      if (sec) sec.style.display = on ? "" : "none";
    });
  }

  $(`#${d.idp}-collision`)?.addEventListener("change", e =>
    cfgSet(`${d.cfg}.collision`, e.target.value));
  tog("import-normal", "import_normal");
  tog("lods", engine === "unreal" ? "lods_auto" : "generate_lods");
  d.extra.forEach(x => tog(x.id, x.key));

  // Nanite decide du sort de la ligne LODs : on la repeint sur place.
  if (engine === "unreal") {
    $(`#${d.idp}-nanite`)?.addEventListener("click", () => {
      const host = $(`#${d.idp}-lods`)?.closest("div[style*='grid-template-columns']");
      if (!host) return;
      const g = k => cfgGet(`${d.cfg}.${k}`);
      const onB = v => (v === undefined ? true : !!v);
      host.outerHTML = lodsRow(engine, d, g, onB);
      $(`#${d.idp}-lods`)?.addEventListener("click", async () => {
        const el = $(`#${d.idp}-lods`);
        await cfgSet(`${d.cfg}.lods_auto`, el.classList.toggle("on"));
      });
      refreshStrataSummary(engine);
    });
  }

  if (engine === "unreal") {
    $("#ue-master")?.addEventListener("change", e => {
      cfgSet("pipeline.unreal.master_material_name", e.target.value);
      refreshStrataSummary("unreal");
    });
    $("#ue-master-mode")?.addEventListener("change", e =>
      cfgSet("pipeline.unreal.master_material_mode", e.target.value));
  } else {
    $("#unity-pipeline")?.addEventListener("change", e => {
      cfgSet("pipeline.unity.render_pipeline", e.target.value);
      refreshStrataSummary("unity");
    });
    $("#unity-mat-from")?.addEventListener("change", async e => {
      const v = e.target.value;
      await cfgSet("pipeline.unity.material_from", v);
      const sgRow = $("#unity-shader-row");
      const nameRow = $("#unity-matname-row");
      if (sgRow) sgRow.style.display = (v === "shadergraph") ? "" : "none";
      if (nameRow) nameRow.style.display = (v === "material") ? "" : "none";
      refreshStrataSummary("unity");
    });
    $("#unity-mat-name")?.addEventListener("change", e =>
      cfgSet("pipeline.unity.material_name", e.target.value.trim()));
    $("#unity-shader-name")?.addEventListener("change", e =>
      cfgSet("pipeline.unity.shader_name",
             e.target.value.trim() || "SG_Landscape_{Style}"));

    // Choisir le fichier evite d'avoir a en connaitre le nom exact. Le champ
    // reste editable : c'est lui qui accepte {Style} pour un graphe par style,
    // ce qu'un selecteur ne peut pas exprimer.
    $("#unity-shader-browse")?.addEventListener("click", async () => {
      let res = null;
      try { res = await eel.pick_unity_shader()(); } catch (e) { /* backend absent */ }
      if (!res) return;
      if (!res.ok) {
        if (res.error) flashStatus(res.error, "var(--err)");
        return;
      }
      const field = $("#unity-shader-name");
      if (field) field.value = res.path;
      await cfgSet("pipeline.unity.shader_name", res.path);
      refreshStrataSummary("unity");
    });
  }

  // Projet cible. Il est range dans `paths` et non dans `pipeline` parce que
  // c'est une machine, pas un reglage de projet : le prevol et le runner le
  // lisent la. Seul son affichage a bouge.
  const tgt = $(`#${d.idp}-target`);
  if (tgt) {
    const save = async (v) => {
      await cfgSet(`paths.${engine}_project`, v);
      refreshDCCStatus();
      // La carte Projet garde son champ tant qu'un ancien projet l'utilise.
      const legacy = $(`#input-${engine}-project`);
      if (legacy) legacy.value = v;
    };
    tgt.addEventListener("change", () => save(tgt.value.trim()));
    $(`#${d.idp}-target-browse`)?.addEventListener("click", async () => {
      const p = (engine === "unreal")
        ? await eel.pick_file("Select Unreal .uproject",
            [["uproject", "*.uproject"]], tgt.value || "")()
        : await eel.pick_folder("Select Unity project folder", tgt.value || "")();
      if (p) { tgt.value = p; await save(p); }
    });
  }

  wireVariantScope(engine);
  wireTransformFix(d.idp, d.cfg);
  wireDestDesigner(engine);
  wireCfgSections($(`[data-expand="${engine}"]`));
}

const configContentUnreal = () => configContentEngine("unreal");
const wireConfigUnreal    = () => wireConfigEngine("unreal");
const configContentUnity  = () => configContentEngine("unity");
const wireConfigUnity     = () => wireConfigEngine("unity");

// ── Bonus : popup de proposition de layout détecté ──────────────────
async function _maybeProposeLayout(engine, projectRoot) {
  if (!projectRoot) return;
  let res;
  try { res = await eel.detect_project_layout(engine, projectRoot)(); }
  catch (e) { return; }
  if (!res || !res.ok || !res.layout) return;
  const detected = res.layout;
  // On compare sur le dossier de base, seule chose que la detection sait dire.
  const [detRoot, detLevels] = _destPreset(engine, detected);
  if (_destRoot(engine) === detRoot) return;  // deja aligne, pas la peine

  // Mini-popup non-bloquante (style flashStatus mais avec bouton)
  const labels = {
    "kalysteon": "Kalysteon",
    "stratum_default": "Default",
    "flat": "Flat",
  };
  const detLabel = labels[detected] || detected;
  const msg = (window.I18N?.t("cfg.layout.detected") ||
               "I detected an existing layout in this project. Apply?")
              + ` (${detLabel})`;

  // Toast custom avec actions
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 10000;
    background: var(--bg-card); border: 1px solid var(--accent);
    border-radius: 8px; padding: 14px 16px; max-width: 360px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.4);
    display: flex; flex-direction: column; gap: 10px;
  `;
  toast.innerHTML = `
    <div style="font-size:12px;color:var(--fg);line-height:1.4">${msg}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn ghost" id="lp-dismiss" style="height:26px;padding:0 10px;font-size:11px">${window.I18N?.t("btn.cancel") || "No thanks"}</button>
      <button class="btn primary" id="lp-apply" style="height:26px;padding:0 10px;font-size:11px">${window.I18N?.t("cfg.layout.apply") || "Apply"}</button>
    </div>`;
  document.body.appendChild(toast);
  const close = () => toast.remove();
  setTimeout(close, 12000);  // auto-dismiss 12s
  toast.querySelector("#lp-dismiss").addEventListener("click", close);
  toast.querySelector("#lp-apply").addEventListener("click", async () => {
    await cfgSet(`pipeline.${engine}.dest_root`, detRoot);
    await cfgSet(`pipeline.${engine}.dest_levels`, detLevels);
    await cfgSet(`pipeline.${engine}.dest_order`, detLevels.concat(
      DEST_LEVELS_ALL.filter(l => !detLevels.includes(l))));
    close();
    flashStatus(`✅ Layout ${detLabel} appliqué`);
    renderStrata();
  });
}

// -- DESTINATION DANS LE PROJET MOTEUR (composeur) -------------------
// Meme geste que l'agencement du dossier d'export : un dossier de base, puis
// des niveaux de sous-dossiers qu'on ordonne et qu'on allume. Le chemin final
// est affiche litteralement en dessous.
//
// Ce composeur remplace trois systemes qui se contredisaient : le preset nomme
// (invisible depuis la refonte des moteurs, mais qui pilotait les chemins), les
// gabarits texte a placeholders, et le mode de routage auto/mapping/single qui
// jetait silencieusement les gabarits des qu'on quittait "auto".
//
// Non repris pour l'instant : envoyer un style vers un dossier existant au nom
// different (Cartoon vers "Mes assets toon"). Le dossier de base etant editable
// et acceptant {Style}, le cas courant est couvert ; un alias par style se
// rajouterait ici si le besoin apparait.
const DEST_LEVELS_ALL = ["style", "type", "project", "variant"];

// Miroir JS de layouts.DEST_FROM_PRESET : point de depart quand un projet
// enregistre n'a encore que son ancien preset.
const DEST_FROM_PRESET = {
  stratum_default: ["", ["style", "type", "project"], { style: "Assets_" }],
  kalysteon:       ["", ["style", "type", "project"], { style: "Assets " }],
  flat:            ["Stratum", ["type"], {}],
};

function _destPreset(engine, id) {
  const [root, levels, pfx] = DEST_FROM_PRESET[id] || DEST_FROM_PRESET.stratum_default;
  // Unreal refuse les espaces dans les chemins /Game/.
  const fix = v => (engine === "unreal" ? String(v).replace(/ /g, "_") : v);
  const out = {};
  for (const k of Object.keys(pfx)) out[k] = fix(pfx[k]);
  return [fix(root), levels.slice(), out];
}

function _destRoot(engine) {
  const v = cfgGet(`pipeline.${engine}.dest_root`);
  if (v === undefined || v === null) {
    return _destPreset(engine, cfgGet(`pipeline.${engine}.layout`))[0];
  }
  return String(v);
}

function _destClean(list) {
  const out = [];
  for (const l of (list || [])) {
    if (DEST_LEVELS_ALL.includes(l) && !out.includes(l)) out.push(l);
  }
  return out;
}

// Niveaux actifs. Une liste vide est une reponse valable : tout atterrit
// directement dans le dossier de base.
function _destLevels(engine) {
  const raw = cfgGet(`pipeline.${engine}.dest_levels`);
  if (Array.isArray(raw)) return _destClean(raw);
  return _destPreset(engine, cfgGet(`pipeline.${engine}.layout`))[1];
}

// Ordre d'affichage des quatre niveaux, allumes comme eteints, pour qu'un
// niveau coupe garde sa place au lieu de tomber en bas de la liste.
function _destOrder(engine) {
  const raw = cfgGet(`pipeline.${engine}.dest_order`);
  const out = [];
  if (Array.isArray(raw) && raw.length) {
    for (const l of raw) if (DEST_LEVELS_ALL.includes(l) && !out.includes(l)) out.push(l);
  } else {
    for (const l of _destLevels(engine)) if (!out.includes(l)) out.push(l);
  }
  for (const l of DEST_LEVELS_ALL) if (!out.includes(l)) out.push(l);
  return out;
}

async function _setDestOrder(engine, order, activeSet) {
  const active = activeSet || new Set(_destLevels(engine));
  await cfgSet(`pipeline.${engine}.dest_order`, order);
  await cfgSet(`pipeline.${engine}.dest_levels`, order.filter(l => active.has(l)));
  renderDestDesigner(engine);
  refreshStrataSummary(engine);
}

// Prefixe optionnel colle devant le dossier d'un niveau : Style prefixe par
// "Assets_" donne "Assets_Cartoon". C'est ce qui remplace l'ancien
// `Assets_{Style}` ecrit dans la racine, et qui rend au niveau Style sa liberte
// de mouvement : il redevient une ligne ordinaire.
function _destPrefixes(engine) {
  const raw = cfgGet(`pipeline.${engine}.dest_prefix`);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return _destPreset(engine, cfgGet(`pipeline.${engine}.layout`))[2];
}

function _destPrefixOf(engine, lvl) {
  return String(_destPrefixes(engine)[lvl] || "");
}

// Sous-dossier accroche a un niveau. Il s'ajoute APRES le dossier du niveau,
// et le suit quand on le deplace ou qu'on l'eteint.
function _destSubs(engine) {
  const raw = cfgGet(`pipeline.${engine}.dest_subfolder`);
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
}

function _destSubOf(engine, lvl) {
  return String(_destSubs(engine)[lvl] || "");
}

async function _setDestSub(engine, lvl, value) {
  const next = Object.assign({}, _destSubs(engine));
  if (value) next[lvl] = value; else delete next[lvl];
  await cfgSet(`pipeline.${engine}.dest_subfolder`, next);
  renderDestDesigner(engine);
  refreshStrataSummary(engine);
}

// Sous-dossier du niveau Type, par type. Le niveau devient plusieurs dossiers,
// donc un champ unique s'appliquerait aux quatre a la fois.
function _destTypeSubs(engine) {
  const raw = cfgGet(`pipeline.${engine}.dest_type_subfolder`);
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
}

async function _setDestTypeSub(engine, folder, value) {
  const next = Object.assign({}, _destTypeSubs(engine));
  if (value) next[folder] = value; else delete next[folder];
  await cfgSet(`pipeline.${engine}.dest_type_subfolder`, next);
  renderDestDesigner(engine);
  refreshStrataSummary(engine);
}

// Lignes dont le champ de sous-dossier est ouvert alors qu'il est encore vide.
// Etat d'affichage, jamais enregistre : un champ vide n'est pas un reglage.
const _DEST_SUB_OPEN = new Set();

async function _setDestPrefix(engine, lvl, value) {
  const next = Object.assign({}, _destPrefixes(engine));
  if (value) next[lvl] = value; else delete next[lvl];
  await cfgSet(`pipeline.${engine}.dest_prefix`, next);
  renderDestDesigner(engine);
  refreshStrataSummary(engine);
}

// Racine heritee d'avant le prefixe par niveau. La migration cote Python en
// vient a bout dans tous les cas qu'elle sait reproduire au chemin pres ; il
// reste les formes ou deux jetons partagent un segment, laissees telles quelles
// plutot que traduites de travers. Le niveau Style y demeure ignore.
function _destRootHasStyle(engine) {
  return /\{Style\}/i.test(_destRoot(engine));
}

const DEST_TYPE_NAMES = {
  unreal: { mesh: "Mesh", texture: "Texture" },
  unity:  { mesh: "Mesh", texture: "Texture" },
};

// Tous les dossiers que produit le niveau Type, dans l'ordre d'affichage.
// Miroir des valeurs de layouts.DEST_TYPE_NAMES : c'est la liste qu'on propose
// quand on ouvre un sous-dossier sur ce niveau.
const DEST_TYPE_FOLDERS = {
  unreal: ["Mesh", "Material", "MaterialInstance", "Texture"],
  unity:  ["Mesh", "Material", "Shader", "Texture", "Prefab"],
};

// Chemin effectif pour un type d'asset. Miroir de layouts.compose_dest : si les
// deux divergent, l'apercu ment.
function _destSegments(engine, typeName, style, variant, project) {
  const root = _destRoot(engine)
    .replace(/\\/g, "/")
    .replace(/\{Style\}/gi, style);
  const segs = root.split("/").filter(Boolean);
  let levels = _destLevels(engine);
  if (_destRootHasStyle(engine)) levels = levels.filter(l => l !== "style");
  const token = { style, type: typeName, project, variant };
  // Miroir exact de _pfx() cote Python : Unreal refuse l'espace dans un
  // chemin /Game/, Unity l'accepte. Sans cette ligne, l'apercu annoncerait
  // un dossier que le composeur ne creera jamais sous ce nom.
  const pfx = (l) => {
    const v = _destPrefixOf(engine, l);
    return engine === "unreal" ? v.replace(/[\\/ ]/g, "_") : v;
  };
  for (const l of levels) {
    if (token[l] === undefined) continue;
    segs.push(pfx(l) + token[l]);
    // Le sous-dossier peut lui-meme etre un chemin : on l'eclate plutot que de
    // creer un dossier dont le nom contient une barre.
    const raw = (l === "type") ? (_destTypeSubs(engine)[token[l]] || "")
                               : _destSubOf(engine, l);
    for (const extra of String(raw).replace(/\\/g, "/").split("/")) {
      if (extra) segs.push(engine === "unreal" ? extra.replace(/ /g, "_") : extra);
    }
  }
  return segs;
}

// Arborescence litterale. On fusionne les chemins des deux types d'asset pour
// montrer ce que l'utilisateur verra vraiment dans son projet.
function _destTree(engine) {
  const project = (cfgGet("pipeline.project") || "").trim() || "Project";
  let styles = ["Cartoon", "Realistic"];
  try {
    const found = [...new Set((_LIB_ASSETS || []).map(a => a.style).filter(Boolean))];
    if (found.length >= 2) styles = found.slice(0, 2);
    else if (found.length === 1) styles = [found[0]];
  } catch (e) { /* Library pas chargee : exemple generique */ }
  // Deux styles ne se justifient que si le chemin les separe vraiment.
  const splits = _destLevels(engine).includes("style") || _destRootHasStyle(engine);
  if (!splits) styles = styles.slice(0, 1);

  const T = DEST_TYPE_NAMES[engine] || DEST_TYPE_NAMES.unreal;
  const entries = [];
  for (const st of styles) {
    entries.push({ segs: _destSegments(engine, T.mesh, st, "VarA", project),
                   file: `SM_${project}_VarA.fbx` });
    entries.push({ segs: _destSegments(engine, T.texture, st, "VarA", project),
                   file: `T_${project}_VarA_Color.png` });
  }

  // Fusion en arbre : sans elle, les dossiers communs seraient affiches deux
  // fois et l'apercu ne ressemblerait plus a un explorateur.
  const root = { kids: new Map(), files: [] };
  for (const e of entries) {
    let n = root;
    for (const seg of e.segs) {
      if (!n.kids.has(seg)) n.kids.set(seg, { kids: new Map(), files: [] });
      n = n.kids.get(seg);
    }
    if (!n.files.includes(e.file)) n.files.push(e.file);
  }

  const out = [engine === "unreal" ? "/Game/" : "Assets/"];
  (function walk(node, prefix) {
    const items = [...node.kids.entries()].map(([name, n]) => ({ name: name + "/", node: n }))
      .concat(node.files.map(f => ({ name: f, node: null })));
    items.forEach((it, i) => {
      const last = i === items.length - 1;
      out.push(prefix + (last ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ") + it.name);
      if (it.node) walk(it.node, prefix + (last ? "    " : "\u2502   "));
    });
  })(root, "");
  return out;
}

// Les deux lignes inserees dans la section Destination du panneau moteur.
// Ce qu'est un niveau, pas ce qu'il fait. La difference n'est pas cosmetique :
// "un dossier par projet Stratum" n'apprend pas que Projet designe le nom du
// projet. On cite donc la valeur reelle du projet ouvert.
function _destLevelTip(lvl) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const project = (cfgGet("pipeline.project") || "").trim();
  let styles = [];
  try {
    styles = [...new Set((_LIB_ASSETS || []).map(a => a.style).filter(Boolean))];
  } catch (e) { /* Library pas chargee */ }
  const ex = {
    type:    _t("dest.ex.type", "Mesh, Material, Texture"),
    project: project || _t("dest.ex.project", "the project name"),
    variant: "VarA, VarB",
    style:   styles.length ? styles.slice(0, 3).join(", ") : "Cartoon, Realistic",
  }[lvl] || "";
  const base = _t("dest.tip." + lvl, "");
  return ex ? `${base} (${ex})` : base;
}

function destDesignerHTML(engine) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  return `<div style="padding:6px 0 2px">
      <span class="faint" style="font-size:12px;display:inline-flex;align-items:center">
        ${_t("cfg.dest.path", "Path inside the project")}${infoIcon("tip.dest.path")}
      </span>
      <div id="${engine}-dest-designer" style="margin-top:8px"></div>
    </div>`;
}

function renderDestDesigner(engine) {
  const host = $(`#${engine}-dest-designer`);
  if (!host) return;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const order = _destOrder(engine);
  const levels = _destLevels(engine);
  const active = new Set(levels);
  const rootStyle = _destRootHasStyle(engine);

  // La racine est la premiere ligne de la meme liste, mais elle ne se deplace
  // pas et ne s'eteint pas : c'est le point de depart du chemin, pas un niveau
  // parmi d'autres. Elle vit hors du conteneur que le glisser-deposer lit,
  // pour qu'aucun geste ne puisse la faire descendre.
  const prefix = engine === "unreal" ? "/Game/" : "Assets/";
  const rootRow = `
    <div class="layout-row dest-root-row">
      <span class="dest-root-prefix">${prefix}</span>
      <input id="${engine}-dest-root" value="${_esc(_destRoot(engine))}"
             placeholder="${_esc(_t("cfg.dest.root.ph", "Assets"))}" spellcheck="false">
      ${infoIcon("tip.dest.root")}
    </div>`;

  const rows = order.map(lvl => {
    const on = active.has(lvl);
    // Cas herite uniquement : une racine que la migration n'a pas su
    // decomposer contient encore le style. Sur une config normale, aucun
    // niveau n'est jamais bloque.
    const dead = (lvl === "style" && rootStyle);
    const live = on && !dead;
    const tip = dead
      ? _t("dest.tip.style_in_root", "Already part of the base folder name.")
      : _destLevelTip(lvl);
    const tag = dead
      ? `<span class="layout-row-tag">${_t("dest.in_root", "in base folder")}</span>`
      : "";
    // Le prefixe se saisit sur la ligne du niveau qu'il concerne, pas dans un
    // champ commun a l'autre bout : le reglage et son effet au meme endroit.
    const pfxField = dead ? "" : `<input class="dest-pfx" data-dest-pfx="${lvl}"
        value="${_esc(_destPrefixOf(engine, lvl))}"
        placeholder="${_esc(_t("dest.prefix.ph", "prefix"))}" spellcheck="false"
        title="${_esc(_t("tip.dest.prefix", "Optional text before this folder name."))}">`;
    // Le niveau Type se decline en plusieurs dossiers : une ligne par type,
    // pour pouvoir ranger les textures sans toucher aux meshes.
    const perType = (lvl === "type");
    const typeSubs = perType ? _destTypeSubs(engine) : null;
    const subVal = perType ? "" : _destSubOf(engine, lvl);
    const hasSub = perType
      ? (DEST_TYPE_FOLDERS[engine] || []).some(f => typeSubs[f])
      : !!subVal;
    const subOpen = !dead && (hasSub || _DEST_SUB_OPEN.has(`${engine}:${lvl}`));

    const subField = (attr, val, label) => `
        <div class="dest-sub-line">
          <span class="dest-sub-branch">&#9492;</span>
          ${label ? `<span class="dest-sub-label">${_esc(label)}</span>` : ""}
          <input class="dest-sub" ${attr} value="${_esc(val)}"
                 placeholder="${_esc(_t("dest.sub.ph", "subfolder"))}" spellcheck="false">
        </div>`;
    const subLines = !subOpen ? "" : (perType
      ? (DEST_TYPE_FOLDERS[engine] || []).map(f =>
          subField(`data-dest-type-sub="${_esc(f)}"`, typeSubs[f] || "", f)).join("")
      : subField(`data-dest-sub="${lvl}"`, subVal, ""));
    // Un seul bouton, toujours a la meme place : il ouvre, puis il referme.
    // La place reste reservee quand il n'y a pas de bouton, sinon la pastille
    // et l'interrupteur se decalent d'une ligne a l'autre.
    const subBtn = dead
      ? `<span class="dest-sub-slot"></span>`
      : (subOpen
          ? `<button class="dest-sub-add open" data-dest-sub-close="${lvl}"
               title="${_esc(_t("tip.dest.sub_close", "Remove the subfolder."))}">&minus;</button>`
          : `<button class="dest-sub-add" data-dest-sub-add="${lvl}"
               title="${_esc(_t("tip.dest.sub", "Add a subfolder under this level."))}">+</button>`);

    return `<div class="layout-row${live ? "" : " off"}${subOpen ? " has-sub" : ""}" data-layout-level="${lvl}">
        <div class="dest-row-main">
          <span class="layout-row-grip" title="${_t("layout.drag_hint", "Drag to reorder")}">&#8942;&#8942;</span>
          <span class="layout-row-name">${_t("dest.level." + lvl, lvl)}</span>
          ${tag}
          <span class="dest-row-gap"></span>
          ${pfxField}
          ${subBtn}
          ${infoIconText(tip)}
          <div class="switch${live ? " on" : ""}" data-layout-toggle="${lvl}"></div>
        </div>${subLines}
      </div>`;
  }).join("");

  host.innerHTML = `
    <div class="dest-chain">
      ${rootRow}
      <div class="layout-rows" id="${engine}-dest-rows">${rows}</div>
    </div>
    <pre class="layout-preview-tree">${_esc(_destTree(engine).join("\n"))}</pre>`;

  host.querySelectorAll("[data-layout-toggle]").forEach(sw => {
    sw.addEventListener("click", async e => {
      e.stopPropagation();
      const lvl = sw.dataset.layoutToggle;
      const next = new Set(active);
      if (next.has(lvl)) next.delete(lvl); else next.add(lvl);
      await _setDestOrder(engine, order, next);
    });
  });
  host.querySelectorAll("[data-dest-pfx]").forEach(inp => {
    inp.addEventListener("change", async () => {
      // Pas de .trim() global : un espace FINAL est justement ce qui
      // separe "Assets Cartoon" de "AssetsCartoon". Les dossiers Unity
      // acceptent les espaces, et un projet existant peut deja les nommer
      // ainsi ; les viser evite d'en creer un deuxieme a cote.
      let v = inp.value.replace(/^\s+/, "");
      if (/\s$/.test(v)) v = v.replace(/\s+$/, " ");
      // Un prefixe ne peut pas creer un dossier de plus : la barre oblique
      // appartient a la structure, pas au nom.
      v = v.replace(/[\\/]+/g, "_");
      // Unreal, lui, refuse les espaces dans ses chemins /Game/.
      if (engine === "unreal") v = v.trim().replace(/ /g, "_");
      await _setDestPrefix(engine, inp.dataset.destPfx, v);
      $(`#${engine}-dest-designer [data-dest-pfx="${inp.dataset.destPfx}"]`)?.focus();
    });
  });
  host.querySelectorAll("[data-dest-sub-add]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _DEST_SUB_OPEN.add(`${engine}:${btn.dataset.destSubAdd}`);
      renderDestDesigner(engine);
      $(`#${engine}-dest-designer [data-dest-sub="${btn.dataset.destSubAdd}"]`)?.focus();
    });
  });
  host.querySelectorAll("[data-dest-sub-close]").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const lvl = btn.dataset.destSubClose;
      _DEST_SUB_OPEN.delete(`${engine}:${lvl}`);
      if (lvl === "type") {
        await cfgSet(`pipeline.${engine}.dest_type_subfolder`, {});
        renderDestDesigner(engine);
        refreshStrataSummary(engine);
      } else {
        await _setDestSub(engine, lvl, "");
      }
    });
  });
  host.querySelectorAll("[data-dest-type-sub]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const folder = inp.dataset.destTypeSub;
      let v = inp.value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (engine === "unreal") v = v.replace(/ /g, "_");
      // La ligne reste ouverte tant qu'on y travaille, meme vidée.
      _DEST_SUB_OPEN.add(`${engine}:type`);
      await _setDestTypeSub(engine, folder, v);
      $(`#${engine}-dest-designer [data-dest-type-sub="${folder}"]`)?.focus();
    });
  });
  host.querySelectorAll("[data-dest-sub]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const lvl = inp.dataset.destSub;
      let v = inp.value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (engine === "unreal") v = v.replace(/ /g, "_");
      // La ligne reste ouverte tant qu'on y travaille : c'est le bouton qui
      // la referme. Sinon effacer le champ le faisait disparaitre sous le
      // curseur.
      _DEST_SUB_OPEN.add(`${engine}:${lvl}`);
      await _setDestSub(engine, lvl, v);
      $(`#${engine}-dest-designer [data-dest-sub="${lvl}"]`)?.focus();
    });
  });
  _wireLayoutDnD(`${engine}-dest-rows`, next => _setDestOrder(engine, next));
  _wireDestRoot(engine);
}

// Le champ de racine est reconstruit a chaque rendu, et un rendu suit chaque
// enregistrement : sans ca, valider avec Entree renvoyait le curseur ailleurs.
function _wireDestRoot(engine) {
  const input = $(`#${engine}-dest-root`);
  if (!input) return;
  input.addEventListener("change", async () => {
    let v = input.value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    // Unreal rejette les espaces dans /Game/ : on corrige tout de suite, plutot
    // que de laisser l'import echouer une heure plus tard.
    if (engine === "unreal" && v.includes(" ")) {
      v = v.replace(/ /g, "_");
      flashStatus(window.I18N?.t("cfg.dest.no_spaces")
        || "Unreal does not allow spaces in /Game/ paths, replaced with _");
    }
    const had = document.activeElement === input;
    await cfgSet(`pipeline.${engine}.dest_root`, v);
    renderDestDesigner(engine);
    refreshStrataSummary(engine);
    if (had) $(`#${engine}-dest-root`)?.focus();
  });
}

function wireDestDesigner(engine) {
  renderDestDesigner(engine);
}

const CONFIG_HANDLERS = {
  gaea:    { content: configContentGaea,    wire: wireConfigGaea },
  houdini: { content: configContentHoudini, wire: wireConfigHoudini },
  unreal:  { content: configContentUnreal,  wire: wireConfigUnreal },
  unity:   { content: configContentUnity,   wire: wireConfigUnity },
};

function toggleStrataExpand(id, btnEl) {
  const panel = document.querySelector(`[data-expand="${id}"]`);
  const chev = btnEl.querySelector(".config-chev");
  const label = btnEl.querySelector(".config-label");
  if (!panel) return;
  const isOpen = panel.classList.contains("open");

  if (isOpen) {
    // A l'ouverture on libere max-height pour ne pas couper les panneaux
    // longs. Il faut donc la remesurer ici, sinon la fermeture ne s'anime
    // plus : une transition ne part pas de la valeur "none".
    panel.style.overflow = "hidden";
    panel.style.maxHeight = panel.scrollHeight + "px";
    panel.offsetHeight;  // eslint-disable-line
    panel.style.maxHeight = "";
    panel.classList.remove("open");
    panel.style.marginTop = "0";
    panel.style.paddingTop = "0";
    panel.style.borderTop = "0";
    setTimeout(() => {
      if (!panel.classList.contains("open")) panel.innerHTML = "";
    }, 300);
    if (chev) chev.style.transform = "";
    if (label) label.textContent = window.I18N?.t("btn.configure") || "Configure";
  } else {
    const h = CONFIG_HANDLERS[id];
    if (!h) return;
    panel.innerHTML = h.content();
    panel.style.maxHeight = "";
    panel.style.overflow = "";
    // Force a reflow so the transition kicks in
    panel.offsetHeight;  // eslint-disable-line
    panel.classList.add("open");
    // La hauteur bornee du CSS n'existe que pour l'animation. Une fois
    // ouverte, on la retire : un panneau plus haut que la limite etait
    // coupe net, sans barre de defilement pour atteindre la suite.
    setTimeout(() => {
      if (panel.classList.contains("open")) {
        panel.style.maxHeight = "none";
        panel.style.overflow = "visible";
      }
    }, 380);
    panel.style.marginTop = "10px";
    panel.style.paddingTop = "14px";
    panel.style.borderTop = "1px dashed var(--line)";
    h.wire();
    if (chev) chev.style.transform = "rotate(90deg)";
    if (label) label.textContent = window.I18N?.t("btn.close") || "Close";
  }
}

// ── RUN PIPELINE / CONSOLE ─────────────────────────────────────────
let CONSOLE_FILTER = "all";

const DCC_TAG_MAP = {
  GAEA:    { cls: "gaea", label: "GAEA" },
  HOUDINI: { cls: "hou",  label: "HOU" },
  UNREAL:  { cls: "ue",   label: "UE" },
  UNITY:   { cls: "uni",  label: "UNI" },
  CLEANUP: { cls: "sys",  label: "SYS" },
  OUTPUT:  { cls: "sys",  label: "SYS" },
  LOG:     { cls: "sys",  label: "SYS" },
};

function parseLogLine(line, fallbackLevel) {
  // Format attendu : "[HH:MM:SS] [LEVEL] [DCC] message" ou variantes
  const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s\[(\w+)\]\s(.*)$/);
  let time = "", level = fallbackLevel || "INFO", body = line;
  if (m) {
    time = m[1];
    level = m[2];
    body = m[3];
  }
  // Tag DCC dans le body : "[GAEA] something"
  let tagCls = "sys", tagLabel = "SYS";
  const dm = body.match(/^\[(\w+)\]\s(.*)$/);
  if (dm && DCC_TAG_MAP[dm[1]]) {
    tagCls = DCC_TAG_MAP[dm[1]].cls;
    tagLabel = DCC_TAG_MAP[dm[1]].label;
    body = dm[2];
  }
  // Lignes "=" séparateurs visuels
  if (body.startsWith("=====")) {
    return { time, level, tagCls: "sys", tagLabel: "—", msg: "—", separator: true };
  }
  return { time, level, tagCls, tagLabel, msg: body };
}

function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightMsg(msg) {
  let s = escapeHTML(msg);
  // Status icons
  s = s.replace(/✅/g, '<span class="ok">✅</span>');
  s = s.replace(/❌/g, '<span class="err">❌</span>');
  s = s.replace(/⚠/g, '<span class="warn">⚠</span>');
  // Mots-clés
  s = s.replace(/\b(ok|OK|done|complete|successfully)\b/g, '<span class="ok">$1</span>');
  s = s.replace(/\b(error|ERROR|failed)\b/g, '<span class="err">$1</span>');
  // Nombres avec unité : 8192px, 12.4s, 4 LODs, 8192², 1024×1024
  s = s.replace(/\b(\d+(?:\.\d+)?(?:px|s|m|MB|KB|GB|²|×|x)?)\b/g, '<span class="num">$1</span>');
  return s;
}

function appendConsole(line, level) {
  const body = $("#console-body");
  if (!body) return;
  // Vire le placeholder "[waiting]" au premier vrai log
  const placeholder = body.querySelector(".faint");
  if (placeholder) placeholder.remove();

  const p = parseLogLine(line, level);
  const row = document.createElement("div");
  row.className = "log-entry";
  row.dataset.level = p.level;
  row.dataset.tagCls = p.tagCls;
  row.dataset.hasStatus = String(line.includes("✅") || line.includes("❌") || line.includes("⚠"));
  // La ligne brute, pour que "Copier" rende le journal tel qu'il a ete ecrit
  // et non tel qu'il est mis en forme.
  row.dataset.raw = line;

  if (p.separator) {
    row.innerHTML = `<span class="log-time"></span><span></span><span style="color:var(--line-hi);letter-spacing:.4em">────────────</span>`;
  } else {
    row.innerHTML = `
      <span class="log-time">${p.time}</span>
      <span class="log-tag ${p.tagCls}">${p.tagLabel}</span>
      <span class="log-msg">${highlightMsg(p.msg)}</span>`;
  }
  body.appendChild(row);
  applyConsoleFilter(row);
  body.scrollTop = body.scrollHeight;
}

function applyConsoleFilter(onlyRow) {
  const rows = onlyRow ? [onlyRow] : Array.from(document.querySelectorAll(".log-entry"));
  rows.forEach(row => {
    let show = true;
    if (CONSOLE_FILTER === "errors") {
      show = row.dataset.level === "ERROR" || row.dataset.level === "WARN";
    } else if (CONSOLE_FILTER === "diff") {
      // "Diff" = key events seulement (status icons ou separateurs)
      show = row.dataset.hasStatus === "true";
    }
    row.style.display = show ? "" : "none";
  });
}

function wireConsoleControls() {
  document.querySelectorAll(".ctab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".ctab").forEach(x => x.classList.toggle("active", x === t));
      CONSOLE_FILTER = t.dataset.filter;
      applyConsoleFilter();
    });
  });
  const clearBtn = $("#btn-console-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => clearConsole());
  }

  // Copier tout le journal. La console est une liste de noeuds, pas un champ
  // de texte : un clic maintenu n'en selectionne rien.
  $("#btn-console-copy")?.addEventListener("click", async () => {
    const body = $("#console-body");
    if (!body) return;
    // On copie la ligne BRUTE, telle que le sous-processus l'a ecrite, et
    // non le texte reconstruit depuis l'affichage : c'est celle-la qui sert
    // a diagnostiquer.
    const rows = [...body.querySelectorAll(".log-entry")]
      .map(el => el.dataset.raw || el.textContent.trim())
      .filter(Boolean);
    const text = (rows.length ? rows : [body.textContent]).join("\n");
    const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
    try {
      await navigator.clipboard.writeText(text);
      flashStatus(`${rows.length} ${_t("console.copied", "lines copied")}`);
    } catch (e) {
      // La WebView refuse parfois le presse-papier moderne : on retombe sur
      // une zone de texte temporaire, qui marche partout.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-9999px";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
      flashStatus(ok ? `${rows.length} ${_t("console.copied", "lines copied")}`
                     : _t("console.copy_failed", "Copy failed"),
                  ok ? undefined : "var(--err)");
    }
  });

  // Ouvrir le dossier du fichier de log. Son chemin defile hors de vue des que
  // le run avance : le retrouver demandait de remonter tout le journal.
  $("#btn-console-log")?.addEventListener("click", async () => {
    const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
    try {
      const res = await eel.open_log_folder()();
      if (!res || !res.ok) {
        flashStatus(_t("console.nolog", "No log file yet"), "var(--err)");
      }
    } catch (e) {
      flashStatus(_t("console.nolog", "No log file yet"), "var(--err)");
    }
  });
}

function clearConsole() {
  const body = $("#console-body");
  if (body) {
    body.innerHTML = `<div class="faint" style="padding:8px 16px;font-style:italic;font-size:11px">[cleared]</div>`;
  }
}

async function actuallyRun() {
  window._RUN_STATS = {};
  $(`.tab[data-tab="console"]`).click();
  clearConsole();
  resetStrataStatus();

  const res = await eel.run_pipeline(true)();  // skip preflight (déjà fait)
  if (res.ok) {
    _setRunBtn("running");
  } else {
    appendConsole(`❌ ${res.error}`, "ERROR");
    _setRunBtn("idle");
  }
}

function showPreflightModal(issues) {
  const errors = issues.filter(i => i.sev === "error");
  const warns  = issues.filter(i => i.sev === "warn");
  const infos  = issues.filter(i => i.sev === "info");

  const sevIcon = { error: "❌", warn: "⚠", info: "ⓘ" };
  const sevColor = { error: "var(--err)", warn: "var(--warn)", info: "var(--accent)" };

  const rows = issues.map(i => `
    <div style="display:flex;gap:10px;padding:8px 10px;background:color-mix(in oklab,${sevColor[i.sev]} 7%,transparent);border-left:2px solid ${sevColor[i.sev]};border-radius:4px;margin-bottom:6px">
      <span style="font-size:14px;flex-shrink:0">${sevIcon[i.sev]}</span>
      <div>
        <div style="font-size:11px;font-family:var(--font-mono);color:${sevColor[i.sev]};text-transform:uppercase;letter-spacing:0.06em">${i.cat}</div>
        <div style="font-size:12.5px;color:var(--fg)">${i.msg}</div>
      </div>
    </div>`).join("");

  const canRunAnyway = errors.length === 0;
  const ctaLabel = canRunAnyway ? "Run anyway" : "Fix issues";

  $("#modal-eyebrow").textContent = errors.length ? `PRE-FLIGHT · ${errors.length} ERROR(S)` : "PRE-FLIGHT · WARNINGS";
  $("#modal-title").textContent = errors.length ? "Cannot run yet" : "Ready to run with notes";
  $("#modal-body").innerHTML = `
    ${rows}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;padding-top:14px;border-top:1px solid var(--line-soft)">
      <button class="btn ghost" id="preflight-cancel">Cancel</button>
      ${canRunAnyway ? `<button class="btn primary" id="preflight-run">${ctaLabel}</button>` : ""}
    </div>`;
  $("#modal-backdrop").style.display = "flex";

  $("#preflight-cancel").addEventListener("click", () => $("#modal-backdrop").style.display = "none");
  if (canRunAnyway) {
    $("#preflight-run").addEventListener("click", () => {
      $("#modal-backdrop").style.display = "none";
      actuallyRun();
    });
  }
}

// État global du bouton RUN
let RUN_STATE = "idle"; // idle | running | stopping

// Pendant un run, la config est figee cote Python : changer un interrupteur
// ou de projet n'aurait aucun effet sur ce qui tourne, et ferait croire le
// contraire. On grise donc ces commandes plutot que de les laisser mentir.
function _applyRunLock() {
  const locked = RUN_STATE !== "idle";
  document.body.classList.toggle("run-locked", locked);
  const tip = locked
    ? (window.I18N?.t("run.locked_tip") || "Run in progress: locked until it ends.")
    : "";
  document.querySelectorAll('[data-toggle], #btn-projects, #btn-export-browse')
    .forEach(el => { if (locked) el.title = tip; else el.removeAttribute("title"); });
}

function runLocked() {
  if (RUN_STATE === "idle") return false;
  flashStatus(window.I18N?.t("run.locked_tip") || "Run in progress: locked until it ends.",
              "var(--warn)");
  return true;
}

function _setRunBtn(state) {
  RUN_STATE = state;
  _applyRunLock();
  const btn = $("#btn-run");
  if (state === "running") {
    btn.disabled = false;
    btn.style.background = "linear-gradient(180deg, #ff5572, #d63951)";
    btn.style.boxShadow = "0 1px 0 rgba(255,255,255,.2) inset, 0 8px 20px -10px var(--err)";
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> ${window.I18N?.t("btn.run_running") || "STOP PIPELINE"}`;
  } else if (state === "stopping") {
    btn.disabled = true;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg> Stopping…`;
  } else {
    btn.disabled = false;
    btn.style.background = "";
    btn.style.boxShadow = "";
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5 L19 12 L7 19 Z"/></svg> ${window.I18N?.t("btn.run_pipeline") || "RUN PIPELINE"}`;
  }
}

function wireRun() {
  const btn = $("#btn-run");
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    // STOP si on est déjà en train de runner
    if (RUN_STATE === "running") {
      _setRunBtn("stopping");
      appendConsole("[SYSTEM] Stop requested by user…", "WARN");
      await eel.stop_pipeline()();
      return;
    }
    // RUN sinon,pré-flight
    const res = await eel.run_pipeline()();
    if (res.ok) {
      _setRunBtn("running");
      window._RUN_STATS = {};
      $(`.tab[data-tab="console"]`).click();
      clearConsole();
      resetStrataStatus();
    } else if (res.preflight_errors) {
      showPreflightModal(res.preflight_all || res.preflight_errors);
    } else {
      appendConsole(`❌ ${res.error}`, "ERROR");
    }
  });

  // Wire ESC pour fermer modal preflight
  $("#modal-backdrop").addEventListener("click", e => {
    if (e.target.id === "modal-backdrop") $("#modal-backdrop").style.display = "none";
  });
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("#modal-backdrop").style.display !== "none") {
      $("#modal-backdrop").style.display = "none";
    }
  });
}

// ── Per-strata status during run ───────────────────────────────────
function resetStrataStatus() {
  Object.keys(RUN_ITEMS).forEach(k => delete RUN_ITEMS[k]);
  const gbar = document.getElementById("run-progress");
  if (gbar) {
    gbar.hidden = true;
    gbar.classList.remove("failed");
    gbar.querySelector(".run-progress-fill").style.width = "0%";
  }
  document.querySelectorAll(".strata-bar").forEach(b => {
    b.hidden = true;
    b.classList.remove("indeterminate", "failed");
    b.querySelector(".strata-bar-fill").style.width = "0%";
    b.querySelector(".strata-bar-count").textContent = "";
  });
  ["gaea", "houdini", "unreal", "unity"].forEach(id => {
    const card = document.querySelector(`[data-strata="${id}"]`);
    if (card) {
      card.classList.remove("strata-running", "strata-done", "strata-error", "strata-queued");
      const pill = card.querySelector(".chip.dot");
      if (pill && cfgGet(`pipeline.${id}.enabled`)) {
        pill.outerHTML = statusPill("active");
      }
    }
  });
}

eel.expose(frontend_strata);
function frontend_strata(strata_id, status, message) {
  // Trace pour le résumé de fin de run
  if (!window._RUN_STATS) window._RUN_STATS = {};
  window._RUN_STATS[strata_id] = { status, message };
  const card = document.querySelector(`[data-strata="${strata_id}"]`);
  if (!card) return;
  // Update visual status pill
  const pill = card.querySelector(".chip.dot");
  if (pill) {
    const mapStatus = { queued: "ready", running: "running", done: "active", error: "off" };
    pill.outerHTML = statusPill(mapStatus[status] || "off");
  }
  // Update card border/glow class
  card.classList.remove("strata-running", "strata-done", "strata-error", "strata-queued");
  card.classList.add(`strata-${status}`);
  const bar = card.querySelector(".strata-bar");
  if (bar) {
    if (status === "done") {
      // Une strate finie est a 100 % meme si elle n'a publie aucun element.
      bar.hidden = false;
      bar.classList.remove("indeterminate");
      bar.querySelector(".strata-bar-fill").style.width = "100%";
      const prev = RUN_ITEMS[strata_id];
      if (prev && prev.total) { prev.done = prev.total; }
      _renderGlobalProgress();
    } else if (status === "error") {
      // La barre s'arrete la ou elle en etait, en rouge : elle raconte alors
      // ou l'echec s'est produit au lieu de faire croire a une suite.
      bar.hidden = false;
      bar.classList.remove("indeterminate");
      bar.classList.add("failed");
      const it = RUN_ITEMS[strata_id];
      bar.querySelector(".strata-bar-fill").style.width =
        (it && it.total) ? Math.round(100 * Math.min(1, it.done / it.total)) + "%" : "100%";
    } else if (status === "queued" || status === "running") {
      bar.classList.remove("failed");
      bar.hidden = (status === "queued");
      if (status === "running" && !RUN_ITEMS[strata_id]) {
        // Tant qu'aucun element n'est annonce, on ne pretend pas savoir ou on
        // en est : barre indeterminee, pas de chiffre invente.
        bar.classList.add("indeterminate");
        bar.querySelector(".strata-bar-fill").style.width = "100%";
        bar.querySelector(".strata-bar-count").textContent = "";
      }
    }
  }
  if (status === "running") {
    card.style.borderColor = "var(--ok)";
    card.style.boxShadow = "0 0 0 1px var(--ok) inset, 0 0 24px -4px color-mix(in oklab, var(--ok) 35%, transparent)";
  } else if (status === "done") {
    card.style.borderColor = "var(--accent)";
    card.style.boxShadow = "";
  } else if (status === "error") {
    card.style.borderColor = "var(--err)";
    card.style.boxShadow = "0 0 0 1px var(--err) inset";
  } else {
    card.style.borderColor = "";
    card.style.boxShadow = "";
  }
}

// ── Callbacks exposés à Python (logger stream) ─────────────────────
eel.expose(frontend_log);
function frontend_log(line, level) {
  appendConsole(line, level);
}

// Avancement global : part des strates terminees, plus la fraction connue de
// celle qui tourne. Il n'y a pas de pondération par durée : Gaea est bien plus
// lent qu'Unity, mais prétendre le contraire ferait une barre qui accélère et
// ralentit sans raison visible. Un cran par strate, c'est lisible et vrai.
const RUN_ITEMS = {};

function _renderGlobalProgress() {
  const bar = document.getElementById("run-progress");
  if (!bar) return;
  const active = Object.keys(RUN_ITEMS);
  if (!active.length) { bar.hidden = true; return; }
  let sum = 0;
  for (const id of active) {
    const it = RUN_ITEMS[id];
    sum += (it.total > 0) ? Math.min(1, it.done / it.total) : (it.done > 0 ? 0.5 : 0);
  }
  const pct = Math.round(100 * sum / _runStrataCount());
  bar.hidden = false;
  bar.querySelector(".run-progress-fill").style.width = pct + "%";
  bar.querySelector(".run-progress-pct").textContent = pct + "%";
}

// Nombre de strates que ce run va traverser : le denominateur de la barre
// globale. Il vient de la config, pas d'un compteur qui grandirait en route.
function _runStrataCount() {
  const n = ["gaea", "houdini", "unreal", "unity"]
    .filter(id => cfgGet(`pipeline.${id}.enabled`)).length;
  return n || 1;
}

eel.expose(frontend_strata_item);
function frontend_strata_item(strata_id, done, total) {
  RUN_ITEMS[strata_id] = { done: done || 0, total: total || 0 };
  const bar = document.querySelector(`[data-bar="${strata_id}"]`);
  if (bar) {
    bar.hidden = false;
    const known = total > 0;
    bar.classList.toggle("indeterminate", !known);
    bar.querySelector(".strata-bar-fill").style.width =
      known ? Math.round(100 * Math.min(1, done / total)) + "%" : "100%";
    // Le compte brut plutot qu'un pourcentage : "12 / 40" dit aussi combien
    // il reste, ce qu'un "30 %" ne dit pas.
    bar.querySelector(".strata-bar-count").textContent =
      known ? `${done} / ${total}` : String(done);
  }
  _renderGlobalProgress();
}

eel.expose(frontend_progress);
function frontend_progress(value) {
  // Avancement de strate a strate, conserve comme filet : si une etape ne
  // publie aucun element (script tiers, sortie muette), la barre globale
  // avance quand meme a chaque strate terminee.
  const bar = document.getElementById("run-progress");
  if (!bar || Object.keys(RUN_ITEMS).length) return;
  const pct = Math.round(100 * Math.max(0, Math.min(1, value || 0)));
  bar.hidden = false;
  bar.querySelector(".run-progress-fill").style.width = pct + "%";
  bar.querySelector(".run-progress-pct").textContent = pct + "%";
}

eel.expose(frontend_done);
function frontend_done(success, elapsed) {
  _setRunBtn("idle");
  // L'etat du projet vient de changer : la bande de rattrapage et la grille
  // des variantes doivent le refleter sans que l'utilisateur ait a naviguer.
  refreshStaleRow();
  renderGaeaVariants(true);
  // Filet de securite : quel que soit le chemin de sortie (echec, arret
  // manuel, strate muette), plus rien ne doit s'animer une fois le run fini.
  document.querySelectorAll(".strata-bar.indeterminate").forEach(b => {
    b.classList.remove("indeterminate");
    if (!success) b.classList.add("failed");
    b.querySelector(".strata-bar-fill").style.width = success ? "100%" : "0%";
  });
  const gbar = document.getElementById("run-progress");
  if (gbar && !gbar.hidden) {
    gbar.classList.toggle("failed", !success);
    if (success) {
      gbar.querySelector(".run-progress-fill").style.width = "100%";
      gbar.querySelector(".run-progress-pct").textContent = "100%";
    }
  }
  if (elapsed) {
    appendConsole(`[STRATUM] Pipeline ${success ? "completed" : "failed"} in ${elapsed}.`, success ? "INFO" : "ERROR");
  }
  // Rafraîchit Library + scan des nouveaux assets pour preview 3D
  buildLibraryPage();
  if (success) {
    refreshAssetPreview();
  }
  try { showRunSummary(success, elapsed); } catch (e) { console.warn("run summary", e); }

  // Une barre pleine qui reste indefiniment se lit, au coup d'oeil suivant,
  // comme un run en cours. Elle tient quelques secondes pour qu'on voie
  // qu'elle est allee au bout, puis elle s'efface. En cas d'echec elle reste :
  // la ou ca s'est arrete est une information, pas une decoration.
  if (success) {
    setTimeout(() => {
      if (RUN_STATE !== "idle") return;   // un nouveau run a demarre entre-temps
      const g = document.getElementById("run-progress");
      if (g) {
        g.hidden = true;
        g.classList.remove("failed");
        const fill = g.querySelector(".run-progress-fill");
        const pct = g.querySelector(".run-progress-pct");
        if (fill) fill.style.width = "0%";
        if (pct) pct.textContent = "0%";
      }
      document.querySelectorAll(".strata-bar").forEach(b => {
        b.classList.remove("indeterminate", "failed");
        const f = b.querySelector(".strata-bar-fill");
        if (f) f.style.width = "0%";
      });
    }, 4000);
  }
}

// ── Résumé de fin de run (modale compacte) ──────────────────────────
function showRunSummary(success, elapsed) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const stats = window._RUN_STATS || {};
  const ids = Object.keys(stats);
  const icon = { done: "✅", error: "❌", running: "⏹", queued: "·", skipped: "·" };
  const rows = ids.map(id => {
    const s = stats[id];
    const def = DEF_BY_ID[id];
    const msg = s.status === "error" && s.message
      ? `<div class="faint" style="font-size:10.5px;color:var(--err);margin-top:2px">${_esc(String(s.message).slice(0, 140))}</div>` : "";
    return `<div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line-soft)">
      <span style="width:18px;text-align:center">${icon[s.status] || "·"}</span>
      <div style="flex:1"><span style="font-weight:600;font-size:12.5px">${def ? def.title : id}</span>${msg}</div>
      <span class="faint" style="font-family:var(--font-mono);font-size:10.5px">${s.status}</span>
    </div>`;
  }).join("");

  const exportRoot = cfgGet("pipeline.export") || "";
  const projName = cfgGet("pipeline.project") || "";
  const projDir = exportRoot && projName ? `${exportRoot}/${projName}` : exportRoot;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:440px;max-width:520px">
      <div class="modal-head">
        <div class="modal-title">${success ? "✅ " + _t("run.sum.ok", "Pipeline finished") : "❌ " + _t("run.sum.fail", "Pipeline failed")}</div>
        <div class="modal-sub">${projName ? _esc(projName) + " · " : ""}${elapsed || ""}</div>
      </div>
      <div class="modal-body">${rows || `<div class="faint" style="font-size:12px">${_t("run.sum.nostats", "No step details available.")}</div>`}</div>
      <div class="modal-foot">
        ${success ? "" : `<button class="btn ghost" data-sum-console style="font-size:11.5px">${_t("run.sum.console", "View console")}</button>`}
        <div style="flex:1"></div>
        ${projDir ? `<button class="btn ghost" data-sum-open style="font-size:11.5px">${_t("run.sum.open", "Open export folder")}</button>` : ""}
        <button class="btn primary" data-sum-close style="font-size:11.5px">${_t("btn.close", "Close")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-sum-close]").addEventListener("click", close);
  overlay.querySelector("[data-sum-open]")?.addEventListener("click", () => { try { eel.open_in_explorer(projDir)(); } catch (e) {} });
  overlay.querySelector("[data-sum-console]")?.addEventListener("click", () => { close(); $(`.tab[data-tab="console"]`)?.click(); });
}

// ─────────────────────────────────────────────
// LIBRARY PAGE (v2,asset catalogue cross-projet)
// ─────────────────────────────────────────────
let _LIB_ASSETS = [];
let _LIB_STATS = { total: 0, by_project: {}, by_style: {}, by_format: {} };
let _LIB_FILTERS = {
  search: "", project: "all", style: "all", format: "all",
  // Le tri est un reglage d'atelier : garde dans le navigateur, pas le projet.
  sort: (() => { try { return localStorage.getItem("stratum.libSort") || "recent"; }
                 catch (e) { return "recent"; } })(),
};

// Taille des vignettes, comme dans l'Explorateur : un curseur, retenu d'une
// session a l'autre.
function _libApplyCardSize(px) {
  const grid = $("#lib-grid");
  if (grid) grid.style.setProperty("--lib-card-min", `${parseInt(px) || 220}px`);
}
let _LIB_SELECTED = null;

function _libFmtSize(kb) {
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  if (kb < 1024 * 1024) return `${(kb/1024).toFixed(1)} MB`;
  return `${(kb/1024/1024).toFixed(2)} GB`;
}

function _libFmtMtime(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString();
}

function _libStyleColor(style) {
  const map = {
    Realistic: "var(--accent)",
    Stylized: "var(--cta)",
    Polygonal: "#a78bfa",
    Cartoon: "#7fe6a3",
    Retro: "#ffb854",
  };
  return map[style] || "var(--fg-dim)";
}

function _libCardHTML(a) {
  const col = _libStyleColor(a.style);
  const styleBadge = a.style ? `<span class="lib-card-style" style="background:color-mix(in oklab, ${col} 18%, transparent);color:${col};border-color:color-mix(in oklab, ${col} 35%, transparent)">${a.style}</span>` : "";
  const variantBadge = a.variant ? `<span class="lib-card-variant">${a.variant}</span>` : "";
  const texDot = a.has_texture ? `<span class="lib-card-tex-dot" title="Has texture"></span>` : "";
  // Badge "from Store" si l'asset vient d'un download Store
  const storeBadge = a.source === "store"
    ? `<span class="lib-card-source" title="From Store">📦</span>`
    : "";

  const thumbBg = a.thumb_url
    ? `background-image:url('${a.thumb_url}');background-size:cover;background-position:center`
    : `background:linear-gradient(135deg, color-mix(in oklab, ${col} 12%, var(--bg-card-hi)), var(--bg-card-hi))`;

  const thumbContent = a.thumb_url
    ? ""
    : `
      <svg class="lib-card-placeholder" width="42%" height="42%" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="1.2" stroke-linejoin="round" style="opacity:0.55">
        <path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/>
      </svg>
      <span class="lib-card-loading-dot"></span>`;

  // Tags compact (max 2 visibles + "+N")
  const tags = a.tags || [];
  const tagsHTML = tags.length === 0 ? "" : `
    <div class="lib-card-tags">
      ${tags.slice(0, 2).map(t => `<span class="lib-card-tag">${_esc(t)}</span>`).join("")}
      ${tags.length > 2 ? `<span class="lib-card-tag-more">+${tags.length - 2}</span>` : ""}
    </div>`;

  // Barre d'actions : 4 visibles + ⋯ menu
  // data-action sert au dispatcher unique (un seul listener délégué)
  const actionsHTML = `
    <div class="lib-card-actions" onclick="event.stopPropagation()">
      <button class="lib-act" data-action="preview"    title="Preview 3D">👁</button>
      <button class="lib-act" data-action="reimport"   title="Re-import to engine">▶</button>
      <button class="lib-act" data-action="copy-path"  title="Copy path">📋</button>
      <button class="lib-act lib-act-danger" data-action="delete" title="Delete">🗑</button>
      <button class="lib-act lib-act-menu" data-action="more" title="More actions">⋯</button>
    </div>`;

  return `
    <div class="lib-card" data-lib-id="${_esc(a.id)}" data-thumb-key="${_esc(a.thumb_key || "")}" data-has-thumb="${a.has_thumb ? "1" : "0"}">
      <div class="lib-card-thumb" style="${thumbBg}">
        ${thumbContent}
        <span class="lib-card-fmt" style="color:${col}">${a.format}</span>
        ${texDot}
        ${storeBadge}
      </div>
      <div class="lib-card-body">
        <div class="lib-card-name" title="${_esc(a.name)}">${_esc(a.name)}</div>
        <div class="lib-card-meta">
          ${variantBadge}
          ${styleBadge}
        </div>
        ${tagsHTML}
        <div class="lib-card-stats">${_libFmtSize(a.size_kb)} · ${_libFmtMtime(a.mtime)}</div>
        ${actionsHTML}
      </div>
    </div>`;
}

// Queue de génération de thumbnails optimisée :
// - Cards visibles d'abord (IntersectionObserver), le reste quand l'app est au repos
// - Cède le main thread entre chaque thumb (requestIdleCallback / setTimeout)
// - Renderer offscreen RÉUTILISÉ (côté viewer3d.js) pour éviter recréations coûteuses
let _LIB_THUMB_QUEUE_BUSY = false;
let _LIB_VISIBLE_IDS = new Set();
let _LIB_INTERSECT_OBSERVER = null;

function _libSetupIntersectionObserver() {
  if (_LIB_INTERSECT_OBSERVER) {
    _LIB_INTERSECT_OBSERVER.disconnect();
  }
  _LIB_INTERSECT_OBSERVER = new IntersectionObserver(entries => {
    let triggerQueue = false;
    entries.forEach(e => {
      const id = e.target.dataset.libId;
      if (!id) return;
      if (e.isIntersecting) {
        _LIB_VISIBLE_IDS.add(id);
        if (e.target.dataset.hasThumb === "0") triggerQueue = true;
      } else {
        _LIB_VISIBLE_IDS.delete(id);
      }
    });
    if (triggerQueue) _libProcessThumbQueue();
  }, { rootMargin: "200px" });  // pre-load un peu avant que la card soit visible

  document.querySelectorAll(".lib-card").forEach(c => _LIB_INTERSECT_OBSERVER.observe(c));
}

function _idle(ms = 16) {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: ms + 100 });
    } else {
      setTimeout(resolve, ms);
    }
  });
}

// Parser un gros mesh bloque l'interface une ou deux secondes. Les cartes a
// l'ecran passent tout de suite ; le reste de la bibliotheque se fait en fond,
// seulement quand personne ne touche a l'app depuis quelques secondes et
// qu'aucun run ne tourne. La bibliotheque est construite au demarrage et apres
// chaque run : a l'ouverture, les vignettes sont deja la.
const _LIB_IDLE_MS = 4000;
let _LIB_LAST_INPUT = 0;
["pointerdown", "keydown", "wheel"].forEach(ev =>
  window.addEventListener(ev, () => { _LIB_LAST_INPUT = performance.now(); },
                          { passive: true, capture: true }));

function _libUserIdle() {
  return RUN_STATE === "idle" && performance.now() - _LIB_LAST_INPUT > _LIB_IDLE_MS;
}

async function _libProcessThumbQueue() {
  if (_LIB_THUMB_QUEUE_BUSY) return;
  _LIB_THUMB_QUEUE_BUSY = true;

  while (true) {
    const pending = Array.from(document.querySelectorAll(".lib-card[data-has-thumb='0']"));
    if (pending.length === 0) break;
    const visible = pending.filter(c => _LIB_VISIBLE_IDS.has(c.dataset.libId));
    let card = visible[0];
    if (!card) {
      if (!_libUserIdle()) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      card = pending[0];
    }
    const later = visible.find(c => c !== card) || pending.find(c => c !== card);
    const id = card.dataset.libId;
    const key = card.dataset.thumbKey;
    const asset = _LIB_ASSETS.find(a => a.id === id);
    if (!asset || !key) {
      card.dataset.hasThumb = "1";
      continue;
    }

    try {
      if (!window.Viewer3D?.renderThumbnail) {
        card.dataset.hasThumb = "1";
        continue;
      }
      // Pendant ce rendu, la carte suivante lit deja son mesh et sa texture.
      const nextAsset = later && _LIB_ASSETS.find(a => a.id === later.dataset.libId);
      if (nextAsset) {
        window.Viewer3D.prefetchThumbnail?.({
          meshUrl: nextAsset.mesh_url, textureUrl: nextAsset.texture_url, ext: nextAsset.format,
        });
      }
      const dataUrl = await window.Viewer3D.renderThumbnail({
        meshUrl: asset.mesh_url,
        textureUrl: asset.texture_url,
        ext: asset.format,
        size: 256,
      });
      await eel.save_thumbnail(key, dataUrl)();
      const thumb = card.querySelector(".lib-card-thumb");
      if (thumb) {
        thumb.style.background = `url('${dataUrl}') center/cover`;
        const ph = thumb.querySelector(".lib-card-placeholder");
        if (ph) ph.remove();
        const dot = thumb.querySelector(".lib-card-loading-dot");
        if (dot) dot.remove();
      }
      card.dataset.hasThumb = "1";
      asset.has_thumb = true;
      asset.thumb_url = `/api/thumb/${key}`;
    } catch (e) {
      console.warn("[lib-thumb] fail", asset.name, e);
      card.dataset.hasThumb = "1";  // évite la boucle infinie
      const dot = card.querySelector(".lib-card-loading-dot");
      if (dot) dot.style.background = "var(--err)";
    }

    // Cède le main thread pour laisser l'UI respirer
    await _idle(20);
  }

  _LIB_THUMB_QUEUE_BUSY = false;
}

async function buildLibraryPage() {
  // Load
  try {
    const data = await eel.list_library_assets()();
    _LIB_ASSETS = data.assets || [];
    _LIB_STATS = data.stats || { total: 0 };
  } catch (e) {
    console.error("[lib] load fail", e);
    _LIB_ASSETS = [];
    _LIB_STATS = { total: 0 };
  }

  _libRenderHeader();
  _libRenderFilters();
  _libRenderGrid();
  _libProcessThumbQueue();
}

function _libRenderHeader() {
  const count = _LIB_STATS.total || 0;
  const totalSize = _LIB_ASSETS.reduce((s, a) => s + (a.size_kb || 0), 0);
  $("#lib-count") && ($("#lib-count").textContent = `${count} asset${count !== 1 ? "s" : ""}`);
  $("#lib-size")  && ($("#lib-size").textContent = _libFmtSize(totalSize));
}

function _libRenderFilters() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const projects = Object.keys(_LIB_STATS.by_project || {}).sort();
  const styles   = Object.keys(_LIB_STATS.by_style   || {}).sort();
  const formats  = Object.keys(_LIB_STATS.by_format  || {}).sort();

  const buildSelect = (sel, items, key, allLabel) => {
    if (!sel) return;
    const cur = _LIB_FILTERS[key];
    sel.innerHTML = `<option value="all">${allLabel}</option>` +
      items.map(v => `<option value="${_esc(v)}" ${v === cur ? "selected" : ""}>${_esc(v)} (${_LIB_STATS["by_" + key]?.[v] || ""})</option>`).join("");
    sel.value = cur;
    sel.onchange = () => { _LIB_FILTERS[key] = sel.value; _libRenderGrid(); };
  };
  buildSelect($("#lib-filter-project"), projects, "project", _t("lib.all_projects", "All projects"));
  buildSelect($("#lib-filter-style"),   styles,   "style",   _t("lib.all_styles",   "All styles"));
  buildSelect($("#lib-filter-format"),  formats,  "format",  _t("lib.all_formats",  "All formats"));

  const searchEl = $("#lib-search");
  if (searchEl) {
    searchEl.value = _LIB_FILTERS.search;
    searchEl.oninput = () => { _LIB_FILTERS.search = searchEl.value; _libRenderGrid(); };
  }

  const sortEl = $("#lib-sort");
  if (sortEl) {
    const opts = [
      ["recent",  _t("lib.sort.recent",  "Most recent")],
      ["name",    _t("lib.sort.name",    "Name")],
      ["variant", _t("lib.sort.variant", "Variant")],
      ["style",   _t("lib.sort.style",   "Style")],
    ];
    sortEl.innerHTML = opts.map(([v, l]) =>
      `<option value="${v}" ${v === _LIB_FILTERS.sort ? "selected" : ""}>${_esc(l)}</option>`).join("");
    sortEl.onchange = () => {
      _LIB_FILTERS.sort = sortEl.value;
      try { localStorage.setItem("stratum.libSort", sortEl.value); } catch (e) {}
      _libRenderGrid();
    };
  }
  const sizeEl = $("#lib-size-slider");
  if (sizeEl) {
    let px = 220;
    try { px = parseInt(localStorage.getItem("stratum.libCard")) || 220; } catch (e) {}
    sizeEl.value = px;
    sizeEl.title = _t("lib.thumb_size", "Thumbnail size");
    _libApplyCardSize(px);
    sizeEl.oninput = () => {
      _libApplyCardSize(sizeEl.value);
      try { localStorage.setItem("stratum.libCard", sizeEl.value); } catch (e) {}
    };
  }
}

function _libRenderGrid() {
  const grid = $("#lib-grid");
  if (!grid) return;
  const q = _LIB_FILTERS.search.toLowerCase().trim();
  const filtered = _LIB_ASSETS.filter(a => {
    if (_LIB_FILTERS.project !== "all" && a.project !== _LIB_FILTERS.project) return false;
    if (_LIB_FILTERS.style   !== "all" && a.style   !== _LIB_FILTERS.style)   return false;
    if (_LIB_FILTERS.format  !== "all" && a.format  !== _LIB_FILTERS.format)  return false;
    if (q) {
      const hay = (a.name + " " + a.project + " " + (a.tags || []).join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // "Recent" garde l'ordre du serveur (date decroissante).
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
  const cmp = {
    name: byName,
    variant: (a, b) => (a.variant || "~").localeCompare(b.variant || "~")
      || (a.style || "").localeCompare(b.style || "") || byName(a, b),
    style: (a, b) => (a.style || "~").localeCompare(b.style || "~")
      || (a.variant || "").localeCompare(b.variant || "") || byName(a, b),
  }[_LIB_FILTERS.sort];
  if (cmp) filtered.sort(cmp);

  const countEl = $("#lib-result-count");
  if (countEl) {
    const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
    countEl.textContent = `${filtered.length} ${_t("lib.results", "result(s)")}`;
  }

  if (filtered.length === 0) {
    const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
    grid.innerHTML = `<div class="faint" style="font-style:italic;padding:40px;text-align:center;font-size:12px">${_t("lib.empty", "No asset found. Run a pipeline to populate your library.")}</div>`;
    return;
  }

  // Grouper par projet (ordre = ordre du tri par mtime décroissant,le projet le
  // plus récemment touché remonte en premier)
  const groups = new Map();
  for (const a of filtered) {
    const key = a.project || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const fromStore = (assets) => assets.some(a => a.source === "store");
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);

  const sections = Array.from(groups.entries()).map(([project, assets]) => {
    const sourceBadge = fromStore(assets) ? `<span class="lib-proj-source">📦 ${_t("lib.from_store", "from Store")}</span>` : "";
    return `
      <div class="lib-project-section">
        <div class="lib-project-head">
          <span class="lib-project-name">${_esc(project)}</span>
          <span class="lib-project-count">${assets.length} ${_t("lib.assets", "assets")}</span>
          ${sourceBadge}
        </div>
        <div class="lib-cards-grid">${assets.map(_libCardHTML).join("")}</div>
      </div>`;
  }).join("");

  grid.innerHTML = sections;

  // Click sur card (mais PAS sur la barre d'actions) → drawer
  grid.querySelectorAll(".lib-card").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".lib-card-actions")) return;
      _libOpenDrawer(el.dataset.libId);
    });
  });
  // Click dans la barre d'actions → dispatch
  grid.querySelectorAll(".lib-card-actions [data-action]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".lib-card");
      _libHandleAction(btn.dataset.action, card?.dataset.libId, btn);
    });
  });

  _LIB_VISIBLE_IDS.clear();
  _libSetupIntersectionObserver();
}

// ── Library v2 : action dispatcher ──────────────────────────────────
// Tous les boutons d'action des cards passent par ici. Garde la logique
// d'action séparée du rendering,facile à étendre.
async function _libHandleAction(action, id, btnEl) {
  const a = _LIB_ASSETS.find(x => x.id === id);
  if (!a) return;
  switch (action) {
    case "preview":   return _libActionPreview(a);
    case "reimport":  return _libActionReimport(a);
    case "copy-path": return _libActionCopyPath(a);
    case "delete":    return _libActionDelete(a);
    case "more":      return _libOpenMoreMenu(a, btnEl);
  }
}

function _libActionPreview(a) {
  // Reuse le drawer existant qui contient déjà le viewer 3D
  _libOpenDrawer(a.id);
}

async function _libActionCopyPath(a) {
  try {
    await navigator.clipboard.writeText(a.path || "");
    flashStatus(`📋 ${a.name}`);
  } catch (e) {
    flashStatus("Copy failed", "var(--err)");
  }
}

async function _libActionDelete(a) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  if (!confirm(_t("lib.confirm_delete", "Delete this asset? This cannot be undone.") + `\n\n${a.name}`)) return;
  try {
    const res = await eel.delete_files([a.path])();
    if (res && res.ok) {
      flashStatus(`🗑 ${a.name}`);
      buildLibraryPage();  // refresh la liste
    } else {
      flashStatus("Delete failed", "var(--err)");
    }
  } catch (e) { flashStatus("Delete failed", "var(--err)"); }
}

async function _libActionReimport(a) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  // Modale légère pour choisir l'engine. Plus propre qu'un prompt() natif.
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:380px">
      <div class="modal-head">
        <div class="modal-title">${_t("lib.reimport.title", "Re-import to engine")}</div>
        <div class="modal-sub">${_esc(a.project)} · ${_t("lib.reimport.hint", "Skips Gaea/Houdini, only runs the engine import")}</div>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:10px">
          <button class="btn primary" data-engine="unreal" style="flex:1;padding:14px;display:flex;flex-direction:column;align-items:center;gap:6px">
            <span style="font-size:18px">🟣</span>
            <span style="font-weight:700">Unreal Engine</span>
          </button>
          <button class="btn primary" data-engine="unity" style="flex:1;padding:14px;display:flex;flex-direction:column;align-items:center;gap:6px">
            <span style="font-size:18px">🔵</span>
            <span style="font-weight:700">Unity</span>
          </button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>${_t("btn.cancel", "Cancel")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-close]").addEventListener("click", close);
  overlay.querySelectorAll("[data-engine]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const engine = btn.dataset.engine;
      close();
      flashStatus(`▶ Re-importing ${a.project} to ${engine}…`);
      try {
        const res = await eel.reimport_to_engine(a.project, engine)();
        if (!res || !res.ok) {
          flashStatus(res?.error || "Re-import failed", "var(--err)");
          return;
        }
        // Le pipeline s'est lancé en background. Bascule vers la page Pipeline
        // pour que l'user voit le progrès (logs, strata status, etc.)
        showPage("pipeline");
      } catch (e) {
        flashStatus("Re-import failed: " + e.message, "var(--err)");
      }
    });
  });
}

// ── Menu "More",tags / notes / regen / pack ────────────────────────
function _libOpenMoreMenu(a, btnEl) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  // Petit popover positionné sous le bouton
  document.querySelectorAll(".lib-more-menu").forEach(m => m.remove());
  const r = btnEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "lib-more-menu";
  menu.style.cssText = `position:fixed;left:${r.right - 180}px;top:${r.bottom + 4}px;z-index:9000`;
  menu.innerHTML = `
    <button data-more="tags">📝 ${_t("lib.more.tags", "Tags & notes")}</button>
    <button data-more="regen">🔄 ${_t("lib.more.regen", "Re-generate")}</button>
    <button data-more="pack">📦 ${_t("lib.more.pack", "Pack & export")}</button>
    <button data-more="explorer">📂 ${_t("lib.more.explorer", "Open in Explorer")}</button>
  `;
  document.body.appendChild(menu);
  const close = () => menu.remove();
  setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
  menu.querySelectorAll("[data-more]").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
      const act = b.dataset.more;
      if (act === "tags") _libOpenTagsModal(a);
      else if (act === "regen") _libActionRegenerate(a);
      else if (act === "pack")  _libActionPackExport(a);
      else if (act === "explorer") {
        try { eel.open_in_explorer(a.path)(); } catch(_) {}
      }
    });
  });
}

// Modale Tags + Notes,fonctionnelle (persiste via metadata API)
function _libOpenTagsModal(a) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const tags = Array.isArray(a.tags) ? a.tags.join(", ") : "";
  const notes = a.notes || "";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:480px">
      <div class="modal-head">
        <div class="modal-title">${_t("lib.tags.title", "Tags & notes")}</div>
        <div class="modal-sub">${_esc(a.name)}</div>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
          <label style="font-size:11px;color:var(--fg-faint);text-transform:uppercase;letter-spacing:.05em">${_t("lib.tags.label", "Tags (comma-separated)")}</label>
          <input id="lib-tags-input" value="${_esc(tags)}" placeholder="snowy, low-poly, hero-asset" style="height:32px;background:var(--bg-input);color:var(--fg);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 10px;font-size:12px"/>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-size:11px;color:var(--fg-faint);text-transform:uppercase;letter-spacing:.05em">${_t("lib.notes.label", "Notes")}</label>
          <textarea id="lib-notes-input" rows="4" placeholder="Used in Wintervale demo, redo with seed 4242" style="background:var(--bg-input);color:var(--fg);border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 10px;font-size:12px;resize:vertical;font-family:var(--font-body)">${_esc(notes)}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>${_t("btn.cancel", "Cancel")}</button>
        <button class="btn primary" id="lib-tags-save">${_t("btn.save", "Save")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-close]").addEventListener("click", close);
  $("#lib-tags-save").addEventListener("click", async () => {
    const newTags = $("#lib-tags-input").value.split(",").map(s => s.trim()).filter(Boolean);
    const newNotes = $("#lib-notes-input").value;
    try {
      const res = await eel.set_library_asset_meta(a.path, newTags, newNotes)();
      if (res && res.ok) {
        flashStatus("✅ Saved");
        // Mise à jour locale pour éviter un re-fetch complet
        a.tags = newTags;
        a.notes = newNotes;
        _libRenderGrid();
        close();
      } else {
        flashStatus("Save failed", "var(--err)");
      }
    } catch (e) { flashStatus("Save failed", "var(--err)"); }
  });
}

// Re-generate : on switch sur le projet de l'asset et on navigue vers la
// page Pipeline avec une bannière qui guide l'user. On NE touche pas à la
// config,l'user pousse Run quand il veut.
async function _libActionRegenerate(a) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  // Trouve le slug du projet par name
  let slug = null;
  try {
    const projects = await eel.list_projects()();
    for (const p of (projects || [])) {
      if (p.name === a.project || p.slug === a.project) { slug = p.slug; break; }
    }
  } catch (e) {}
  if (!slug) {
    flashStatus(`Project "${a.project}" not found in projects list`, "var(--err)");
    return;
  }
  // Switch et bascule sur la page Pipeline
  try {
    const res = await eel.switch_project(slug)();
    if (!res || !res.ok) {
      flashStatus("Switch project failed", "var(--err)");
      return;
    }
    _currentSlug = res.slug;
    // Recharge la config pour avoir les nouveaux paramètres dans CFG
    CFG = await eel.get_config()();
    renderStrata();
    refreshStats();
    refreshProjectInputsAfterSwitch();
    _refreshPreviewForProject();
    flashStatus(`🔄 Switched to "${a.project}",adjust seed in Gaea and Run`);
    showPage("pipeline");
  } catch (e) {
    flashStatus("Re-generate setup failed: " + e.message, "var(--err)");
  }
}

// Helper : refresh les inputs du Project card après un switch_project.
// Fallback safe,si la fonction n'existe pas (cas dev mode), no-op.
function refreshProjectInputsAfterSwitch() {
  try {
    const inp = $("#input-project");
    if (inp) inp.value = cfgGet("pipeline.project") || "";
    const exp = $("#input-export");
    if (exp) exp.value = cfgGet("pipeline.export") || "";
    if (typeof refreshProjectSummary === "function") {
      // refreshProjectSummary est défini dans wireProjectInputs(),pas global
      // donc on triggere un re-render plus simple :
    }
    const nameLbl = $("#project-name");
    if (nameLbl) nameLbl.textContent = inp?.value || "—";
  } catch (e) {}
}

// Changer de projet change le dossier d'apercu : la liste et le mesh affiches
// appartenaient a l'ancien. On repart de zero, sur le dossier du nouveau.
function _refreshPreviewForProject() {
  window._firstAssetLoaded = false;
  try { window.Viewer3D?.clearAsset(); } catch (e) { /* vue pas encore creee */ }
  refreshAssetPreview();
}

// Pack & export : demande d'abord le scope (1 asset / 1 variant / 1 style / tout
// le projet) puis le dossier de destination, puis zip.
async function _libActionPackExport(a) {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);

  // Modale de choix du scope
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const styleLabel = a.style || "—";
  const variantLabel = a.variant || "—";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:460px">
      <div class="modal-head">
        <div class="modal-title">${_t("lib.pack.title", "Pack & export")}</div>
        <div class="modal-sub">${_esc(a.name)}</div>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="scope-radio">
            <input type="radio" name="pack-scope" value="asset" checked>
            <div>
              <div class="scope-title">${_t("lib.pack.scope.asset", "Just this asset")}</div>
              <div class="scope-desc">${_esc(a.name)} + textures liées</div>
            </div>
          </label>
          <label class="scope-radio">
            <input type="radio" name="pack-scope" value="variant">
            <div>
              <div class="scope-title">${_t("lib.pack.scope.variant", "This variant")}</div>
              <div class="scope-desc">${_esc(styleLabel)} / ${_esc(variantLabel)} (all files in this variant)</div>
            </div>
          </label>
          <label class="scope-radio">
            <input type="radio" name="pack-scope" value="style">
            <div>
              <div class="scope-title">${_t("lib.pack.scope.style", "All variants of this style")}</div>
              <div class="scope-desc">${_esc(styleLabel)},every variant (VarA, VarB, …)</div>
            </div>
          </label>
          <label class="scope-radio">
            <input type="radio" name="pack-scope" value="project">
            <div>
              <div class="scope-title">${_t("lib.pack.scope.project", "Entire project")}</div>
              <div class="scope-desc">${_esc(a.project)},all styles + variants</div>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>${_t("btn.cancel", "Cancel")}</button>
        <button class="btn primary" id="pack-go">${_t("lib.pack.continue", "Continue →")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-close]").addEventListener("click", close);

  $("#pack-go").addEventListener("click", async () => {
    const scope = overlay.querySelector("input[name='pack-scope']:checked")?.value || "asset";
    close();

    let dest;
    try {
      dest = await eel.pick_folder(_t("lib.pack.pick_dest", "Pick destination folder for the .zip"), "")();
    } catch (e) { return; }
    if (!dest) return;

    flashStatus(`📦 Packing (scope: ${scope})…`);
    try {
      const res = await eel.export_project_pack(
        a.project, dest, scope,
        a.variant || null, a.style || null, a.path || null
      )();
      if (!res || !res.ok) {
        flashStatus(res?.error || "Pack failed", "var(--err)");
        return;
      }
      const mb = Math.round(res.size_kb / 1024 * 10) / 10;
      flashStatus(`✅ Packed ${res.file_count} files (${mb} MB)`);
      // Petit toast confirmation avec bouton "Open folder"
      const t = document.createElement("div");
      t.style.cssText = `
        position:fixed;bottom:20px;right:20px;z-index:10000;
        background:var(--bg-card);border:1px solid var(--accent);
        border-radius:8px;padding:12px 14px;max-width:380px;
        box-shadow:0 6px 22px rgba(0,0,0,0.4);
        display:flex;flex-direction:column;gap:8px`;
      t.innerHTML = `
        <div style="font-size:12px">📦 ${_esc(res.path.split(/[\\/]/).pop())} <span class="faint" style="font-family:var(--font-mono);font-size:10px">(${res.scope})</span></div>
        <div style="display:flex;justify-content:flex-end;gap:6px">
          <button class="btn ghost" id="pack-dismiss" style="height:24px;padding:0 10px;font-size:11px">OK</button>
          <button class="btn primary" id="pack-open" style="height:24px;padding:0 10px;font-size:11px">Open folder</button>
        </div>`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 15000);
      t.querySelector("#pack-dismiss").addEventListener("click", () => t.remove());
      t.querySelector("#pack-open").addEventListener("click", () => {
        try { eel.open_in_explorer(res.path)(); } catch(_) {}
        t.remove();
      });
    } catch (e) {
      flashStatus("Pack failed: " + e.message, "var(--err)");
    }
  });
}

function _libOpenDrawer(id) {
  const a = _LIB_ASSETS.find(x => x.id === id);
  if (!a) return;
  _LIB_SELECTED = a;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const col = _libStyleColor(a.style);

  $("#lib-drawer-title").textContent = a.name;
  $("#lib-drawer-eyebrow").textContent = (a.format || "?").toUpperCase() + " · " + (a.style || "ASSET").toUpperCase();

  const body = $("#lib-drawer-body");
  body.innerHTML = `
    <div id="lib-drawer-viewer" style="aspect-ratio:4/3;border-radius:var(--r-md);overflow:hidden;background:#0a1620;margin-bottom:8px;position:relative">
      <div id="lib-drawer-viewer-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:11px;color:var(--accent);pointer-events:none">Loading 3D…</div>
      <span style="position:absolute;bottom:8px;right:10px;font-family:var(--font-mono);font-size:10px;color:${col};letter-spacing:0.08em;text-transform:uppercase;background:rgba(8,19,28,0.6);padding:2px 6px;border-radius:4px;pointer-events:none">${a.format}</span>
    </div>
    <div id="lib-drawer-stats-bar" class="faint" style="font-family:var(--font-mono);font-size:10px;text-align:center;margin-bottom:14px">—</div>

    <div class="lib-drawer-stats">
      <div class="lib-stat"><span class="lib-stat-k">${_t("lib.project", "Project")}</span><span class="lib-stat-v">${_esc(a.project)}</span></div>
      <div class="lib-stat"><span class="lib-stat-k">${_t("lib.variant", "Variant")}</span><span class="lib-stat-v">${_esc(a.variant || "—")}</span></div>
      <div class="lib-stat"><span class="lib-stat-k">${_t("lib.style", "Style")}</span><span class="lib-stat-v" style="color:${col}">${_esc(a.style || "—")}</span></div>
      <div class="lib-stat"><span class="lib-stat-k">${_t("lib.format", "Format")}</span><span class="lib-stat-v">${a.format.toUpperCase()}</span></div>
      <div class="lib-stat"><span class="lib-stat-k">${_t("lib.size", "Size")}</span><span class="lib-stat-v">${_libFmtSize(a.size_kb)}</span></div>
      <div class="lib-stat"><span class="lib-stat-k">${_t("lib.modified", "Modified")}</span><span class="lib-stat-v">${_libFmtMtime(a.mtime)}</span></div>
      <div class="lib-stat"><span class="lib-stat-k">${_t("lib.texture", "Texture")}</span><span class="lib-stat-v" style="color:${a.has_texture ? 'var(--ok)' : 'var(--fg-faint)'}">${a.has_texture ? "✓ " + _t("lib.linked", "linked") : "—"}</span></div>
    </div>

    <div style="margin-top:16px">
      <div class="page-eyebrow" style="font-size:9.5px">${_t("lib.path", "Path")}</div>
      <div style="font-family:var(--font-mono);font-size:10.5px;color:var(--fg-dim);word-break:break-all;margin-top:4px;padding:8px 10px;background:var(--bg-card-hi);border-radius:var(--r-sm);border:1px solid var(--line-soft)">${_esc(a.path)}</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;margin-top:18px">
      <button class="btn" id="lib-action-preview" style="height:34px;justify-content:center;display:inline-flex;align-items:center;gap:8px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5 L19 12 L7 19 Z"/></svg>
        ${_t("lib.send_to_preview", "Send to 3D Preview")}
      </button>
      <button class="btn ghost" id="lib-action-explorer" style="height:32px">${_t("files.open_explorer", "Open in Explorer")}</button>
      <button class="btn ghost" id="lib-action-copy" style="height:32px">${_t("lib.copy_path", "Copy path")}</button>
    </div>
  `;

  // Wire actions
  $("#lib-action-preview")?.addEventListener("click", async () => {
    // Force le preview source sur le projet de l'asset, switch tab, charge l'asset
    try {
      const root = a.path.replace(/[\\\/][^\\\/]+$/, "");
      await eel.set_preview_source(root)();
    } catch (e) {}
    _libCloseDrawer();
    // Switch sur Pipeline page + Preview tab
    document.querySelectorAll("[data-nav]").forEach(el =>
      el.classList.toggle("active", el.dataset.nav === "pipeline"));
    document.querySelectorAll(".page").forEach(p =>
      p.style.display = (p.dataset.page === "pipeline") ? "flex" : "none");
    const previewTab = document.querySelector('[data-tab="preview"]');
    if (previewTab) previewTab.click();
    // Refresh assets et charge celui-ci
    setTimeout(async () => {
      await refreshAssetPreview();
      const idx = ASSETS_CACHE.findIndex(x => x.mesh_url === a.mesh_url);
      if (idx >= 0) loadAssetInViewer(idx);
    }, 300);
  });
  $("#lib-action-explorer")?.addEventListener("click", () =>
    eel.open_in_explorer(a.path)());
  $("#lib-action-copy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(a.path).then(() =>
      flashStatus("✅ Path copied"));
  });

  // Show drawer
  const drawer = $("#lib-drawer");
  const backdrop = $("#lib-drawer-backdrop");
  if (drawer) drawer.style.right = "0";
  if (backdrop) backdrop.style.display = "block";

  // Lance le mini viewer 3D dans le drawer (interactif, orbit controls)
  const viewerContainer = $("#lib-drawer-viewer");
  if (viewerContainer && window.Viewer3D?.createMiniViewer) {
    window.Viewer3D.createMiniViewer(viewerContainer, {
      meshUrl: a.mesh_url,
      textureUrl: a.texture_url,
      ext: a.format,
    }).then(stats => {
      const loadingEl = $("#lib-drawer-viewer-loading");
      if (loadingEl) loadingEl.style.display = "none";
      const bar = $("#lib-drawer-stats-bar");
      if (bar && stats) {
        bar.textContent = `${stats.vertices.toLocaleString()} verts · ${stats.triangles.toLocaleString()} tris${stats.hasTexture ? " · textured" : ""}`;
      }
    }).catch(err => {
      const loadingEl = $("#lib-drawer-viewer-loading");
      if (loadingEl) {
        loadingEl.textContent = "3D load failed";
        loadingEl.style.color = "var(--err)";
      }
      console.error("[lib-drawer] viewer fail", err);
    });
  }
}

function _libCloseDrawer() {
  const drawer = $("#lib-drawer");
  const backdrop = $("#lib-drawer-backdrop");
  if (drawer) drawer.style.right = "-540px";
  if (backdrop) backdrop.style.display = "none";
  _LIB_SELECTED = null;
  // Détruit le mini viewer pour libérer la GPU
  if (window.Viewer3D?.destroyMiniViewer) {
    window.Viewer3D.destroyMiniViewer();
  }
}

function wireLibrary() {
  $("#lib-drawer-close")?.addEventListener("click", _libCloseDrawer);
  $("#lib-drawer-backdrop")?.addEventListener("click", _libCloseDrawer);
  $("#btn-lib-refresh")?.addEventListener("click", buildLibraryPage);
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && _LIB_SELECTED) _libCloseDrawer();
  });
}

// ─────────────────────────────────────────────
// LEGACY library (runs history),désactivé, gardé pour compat
// ─────────────────────────────────────────────
// Anciennes constantes Library (runs history mock) supprimées.
// Library v2 = asset-catalogue (défini plus haut).
// libHeightmapSVG est encore utilisé par Store, on le garde minimal.

const _STORE_PALETTES = [
  ["#052c36", "#0a6470", "#14a5b0", "#5ed3d8", "#f29870"],
  ["#0a3320", "#1a5f3f", "#2dba6a", "#7fe6a3", "#e8835b"],
  ["#251a06", "#5a4319", "#a8742c", "#e8b06b", "#f29870"],
  ["#1a0c2c", "#3a1d5a", "#6a3a9c", "#a78bfa", "#e8835b"],
  ["#0a4854", "#0a808d", "#2dc1c6", "#9ce6ea", "#e8835b"],
];

function libHeightmapSVG(seed, palette = 0) {
  const p = _STORE_PALETTES[palette % _STORE_PALETTES.length];
  const gid = `lib-${seed}-${palette}`;
  return `
    <svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="${gid}-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${p[3]}"/>
          <stop offset="0.5" stop-color="${p[2]}"/>
          <stop offset="1" stop-color="${p[0]}"/>
        </linearGradient>
      </defs>
      <rect width="320" height="240" fill="url(#${gid}-bg)"/>
    </svg>`;
}

function _whenFromTs(ts) {
  // ts format : "YYYYMMDD_HHMMSS"
  if (!ts || ts.length < 13) return "—";
  const d = new Date(
    parseInt(ts.slice(0, 4)), parseInt(ts.slice(4, 6)) - 1, parseInt(ts.slice(6, 8)),
    parseInt(ts.slice(9, 11)), parseInt(ts.slice(11, 13)), parseInt(ts.slice(13, 15) || 0)
  );
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

// ── PRESETS UI ─────────────────────────────────────────────────────
function _closeModal() {
  const m = $("#modal-backdrop");
  if (m) m.style.display = "none";
}

async function showPresetsModal() {
  const _t = (k, fb, vars) => (window.I18N ? window.I18N.t(k, vars) : fb);
  const presets = await eel.list_presets()();
  const items = presets.length === 0
    ? `<div class="faint" style="font-size:12px;font-style:italic;padding:14px 0">${_t("presets.empty", "No preset saved yet. Save your current strata config below.")}</div>`
    : presets.map(p => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--bg-card-hi);margin-bottom:6px">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${p.label}</div>
            <div class="faint" style="font-size:10.5px;font-family:var(--font-mono)">${p.saved || ""}</div>
          </div>
          <button class="btn" data-load-preset="${p.name}" style="height:26px;padding:0 10px;font-size:11px">${_t("presets.btn_load", "Load")}</button>
          <button class="btn ghost" data-del-preset="${p.name}" style="width:26px;height:26px;padding:0;color:var(--err)" title="${_t("presets.delete_title", "Delete")}">×</button>
        </div>`).join("");

  $("#modal-eyebrow").textContent = _t("presets.eyebrow", "PRESETS");
  $("#modal-title").textContent   = _t("presets.title",   "Saved configurations");
  $("#modal-body").innerHTML = `
    ${items}
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line-soft)">
      <div class="faint" style="font-size:11px;margin-bottom:8px">${_t("presets.save_hint", "Save current strata configuration as a new preset:")}</div>
      <div style="display:flex;gap:8px">
        <div class="input" style="flex:1"><input id="preset-name-input" placeholder="${_t("presets.name_placeholder", "Preset name (e.g. 'Production 4K Stylized')")}"></div>
        <button class="btn primary" id="preset-save" style="height:32px">${_t("presets.btn_save", "Save")}</button>
      </div>
    </div>`;
  $("#modal-backdrop").style.display = "flex";

  document.querySelectorAll("[data-load-preset]").forEach(b => {
    b.addEventListener("click", async () => {
      const r = await eel.load_preset(b.dataset.loadPreset)();
      if (r.ok) {
        CFG = await eel.get_config()();
        renderStrata();
        refreshStats();
        _closeModal();
        flashStatus(_t("presets.loaded_ok", "✅ Preset loaded"));
      } else {
        flashStatus(_t("presets.load_failed", "Preset load failed"), "var(--err)");
      }
    });
  });
  document.querySelectorAll("[data-del-preset]").forEach(b => {
    b.addEventListener("click", async () => {
      const msg = _t("presets.confirm_delete", `Delete preset "${b.dataset.delPreset}"?`, { name: b.dataset.delPreset });
      if (confirm(msg)) {
        await eel.delete_preset(b.dataset.delPreset)();
        showPresetsModal();
      }
    });
  });
  $("#preset-save").addEventListener("click", async () => {
    const name = $("#preset-name-input").value.trim();
    if (!name) { flashStatus(_t("presets.enter_name", "Enter a name first"), "var(--warn)"); return; }
    const r = await eel.save_preset(name, name)();
    if (r.ok) {
      flashStatus(_t("presets.saved_ok", "✅ Preset saved"));
      showPresetsModal();
    }
  });
}

function wirePresets() {
  const btn = $("#btn-presets");
  if (btn) btn.addEventListener("click", showPresetsModal);

  // Wire du bouton X (close) du header modal,manquait avant, d'où le bug "X
  // ne marche pas". Centralisé ici pour tous les usages du modal-backdrop
  // (presets, preflight, log).
  const closeX = $("#modal-close");
  if (closeX) closeX.addEventListener("click", _closeModal);
}

// ── Keyboard shortcuts ─────────────────────────────────────────────
// Une table, une seule : le gestionnaire la parcourt, le panneau des Reglages
// l'affiche et permet de changer chaque combinaison (ui.shortcuts). Les
// actions cliquent les memes controles que la souris, pour que le clavier et
// la souris ne puissent pas diverger.
async function _gaeaSelectAllVariants(on) {
  if (!_gaeaVarData) { try { _gaeaVarData = await eel.list_variants()(); } catch (e) {} }
  const known = _varKnown();
  await _setVarSelected("gaea", on ? Object.keys(known).filter(n => known[n].exists) : []);
}

async function _cycleSeedMode() {
  const modes = ["auto", "random", "custom"];
  const cur = cfgGet("pipeline.gaea.seed_mode") || "auto";
  const next = modes[(modes.indexOf(cur) + 1) % modes.length];
  await cfgSet("pipeline.gaea.seed_mode", next);
  renderStrata();
  flashStatus(`Seed : ${_tt("cfg.gaea.seed." + next, next)}`);
}

const _toggleStrataKey = (id) => () => document.querySelector(`[data-toggle="${id}"]`)?.click();

// Raccourcis par defaut choisis pour se faire d'une main : une touche seule
// quand c'est possible (active hors des champs de saisie), F5 pour lancer
// comme dans la plupart des logiciels, Alt + chiffre pour les strates. Plus de
// Ctrl+Maj+lettre, qui demandait un grand ecart.
const SHORTCUTS = [
  { id: "run",          keys: "F5",           label: ["set.sc.run", "Run pipeline"],               fn: () => $("#btn-run")?.click() },
  { id: "stop",         keys: "Shift+F5",     label: ["set.sc.stop", "Stop pipeline"],             fn: () => eel.stop_pipeline()() },
  { id: "folder",       keys: "O",            label: ["set.sc.folder", "Open working folder"],     fn: () => eel.open_in_explorer("")() },
  { id: "pick_folder",  keys: "Shift+O",      label: ["set.sc.pick_folder", "Choose working folder"], fn: () => $("#btn-export-browse")?.click() },
  { id: "toggle_gaea",    keys: "Alt+1", label: ["set.sc.toggle_gaea", "Gaea on / off"],       fn: _toggleStrataKey("gaea") },
  { id: "toggle_houdini", keys: "Alt+2", label: ["set.sc.toggle_houdini", "Houdini on / off"], fn: _toggleStrataKey("houdini") },
  { id: "toggle_unreal",  keys: "Alt+3", label: ["set.sc.toggle_unreal", "Unreal on / off"],   fn: _toggleStrataKey("unreal") },
  { id: "toggle_unity",   keys: "Alt+4", label: ["set.sc.toggle_unity", "Unity on / off"],     fn: _toggleStrataKey("unity") },
  { id: "seed",         keys: "S",            label: ["set.sc.seed", "Next seed mode"],            fn: _cycleSeedMode },
  { id: "var_all",      keys: "A",            label: ["set.sc.var_all", "Check every existing variant"], fn: () => _gaeaSelectAllVariants(true) },
  { id: "var_none",     keys: "N",            label: ["set.sc.var_none", "Uncheck all variants"],  fn: () => _gaeaSelectAllVariants(false) },
  { id: "rotate",       keys: "R",            label: ["set.sc.rotate", "Auto-rotate on / off"],
    fn: () => document.querySelector('.viewer-tool[data-tool="rotate"]')?.click() },
  { id: "preview",      keys: "P",            label: ["set.sc.preview", "Open preview window"],    fn: () => eel.open_preview_window()() },
  { id: "presets",      keys: "Ctrl+S",       label: ["set.sc.presets", "Presets"],                fn: () => showPresetsModal() },
  { id: "page_pipeline", keys: "1", label: ["set.sc.page_pipeline", "Go to Pipeline"], fn: () => showPage("pipeline") },
  { id: "page_library",  keys: "2", label: ["set.sc.page_library", "Go to Library"],   fn: () => showPage("library") },
  { id: "page_store",    keys: "3", label: ["set.sc.page_store", "Go to Store"],       fn: () => showPage("store") },
  { id: "page_settings", keys: "4", label: ["set.sc.page_settings", "Go to Settings"], fn: () => showPage("settings") },
];

function _scKeys(sc) {
  return (cfgGet("ui.shortcuts") || {})[sc.id] || sc.keys;
}

// Combinaison lisible depuis un evenement. On lit e.code pour la touche : avec
// Shift, e.key change de caractere ("O" au lieu de "o", "!" au lieu de "1"),
// et la meme combinaison ne se reconnaitrait plus d'une frappe a l'autre.
function _comboOf(e) {
  if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(e.key)) return "";
  const code = e.code || "";
  let main;
  if (/^Key[A-Z]$/.test(code)) main = code.slice(3);
  else if (/^(Digit|Numpad)\d$/.test(code)) main = code.slice(-1);
  else {
    main = ({ Period: ".", Comma: ",", Slash: "/", Semicolon: ";", Minus: "-",
              Equal: "=", Space: "Space", Escape: "Esc", NumpadEnter: "Enter",
              Backquote: "`", BracketLeft: "[", BracketRight: "]" })[code] || e.key;
  }
  if (!main) return "";
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(main.length === 1 ? main.toUpperCase() : main);
  return parts.join("+");
}

function wireKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (_scCapture) return;
    const combo = _comboOf(e);
    if (!combo) return;
    // En tapant dans un champ, seuls les raccourcis avec Ctrl ou Alt restent
    // actifs : un chiffre ou une lettre doit aller dans le champ.
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = ["input", "textarea", "select"].includes(tag) || e.target.isContentEditable;
    // F5 recharge la page dans la WebView : jamais, meme si rien n'y est lie.
    if (/^(Ctrl\+)?F5$/.test(combo)) e.preventDefault();
    // Les touches de fonction (F5 lancer, Maj+F5 arreter) marchent aussi
    // pendant la saisie : elles n'ecrivent rien dans un champ.
    if (typing && !/^(Ctrl|Alt)\+|^(Shift\+)?F\d+$/.test(combo)) return;
    const sc = SHORTCUTS.find(x => _scKeys(x) === combo);
    if (!sc) return;
    e.preventDefault();
    try { sc.fn(); } catch (err) { console.warn("[shortcut]", sc.id, err); }
  });
}

// ── Log viewer modal (pour les vrais runs depuis Library) ──────────
function showLogModal(title, when, logContent) {
  $("#modal-eyebrow").textContent = `RUN LOG · ${when}`;
  $("#modal-title").textContent = title;
  const escaped = (logContent || "(empty log)").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  $("#modal-body").innerHTML = `
    <div class="input" style="margin-bottom:10px">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="log-search" placeholder="Search in log…">
    </div>
    <pre id="log-content" style="background:var(--bg-input);border:1px solid var(--line);border-radius:var(--r-md);padding:12px;font-family:var(--font-mono);font-size:11px;line-height:1.6;max-height:50vh;overflow:auto;white-space:pre-wrap;margin:0">${escaped}</pre>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
      <button class="btn" id="log-copy">Copy</button>
      <button class="btn primary" id="log-close">Close</button>
    </div>`;
  $("#modal-backdrop").style.display = "flex";

  // Search in log
  $("#log-search").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const pre = $("#log-content");
    if (!q) { pre.innerHTML = escaped; return; }
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    pre.innerHTML = escaped.replace(re, '<mark style="background:var(--warn);color:var(--bg-deep);padding:0 2px">$1</mark>');
  });

  $("#log-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(logContent);
      flashStatus("✅ Log copied to clipboard");
    } catch (e) { flashStatus("clipboard error", "var(--err)"); }
  });
  $("#log-close").addEventListener("click", () => $("#modal-backdrop").style.display = "none");
}


// ── STORE ─────────────────────────────────────────────────────────
// En preparation : la page affiche un panneau fixe, sans catalogue. Le code
// du catalogue factice (packs, prix, telechargements inventes) est retire ;
// la distribution reelle viendra avec une mise a jour.
function buildStorePage() {}


// ── FILES TAB ───────────────────────────────────────────────────────
let _FILES_CACHE = { files: [], stats: {by_category:{}}, root: "" };
let _FILES_VARIANT = "all";   // "all" | "VarA" | "VarB"...
let _FILES_TYPE = "all";      // "all" | "mesh" | "texture" | ...
let _FILES_SEARCH = "";
let _FILES_SELECTED = new Set(); // set of paths

const _FILES_EMPTY = { files: [], stats: { by_category: {} }, root: "" };

async function refreshFilesTab() {
  let data = null;
  try {
    data = await eel.list_all_files()();
  } catch (e) {
    console.warn("[files] list_all_files a echoue :", e);
  }
  // Le catch ne couvrait que l'exception. Une reponse vide ou de forme
  // inattendue passait au travers et cassait tout le rendu sur un .map
  // d'undefined. On normalise la forme, quelle que soit la reponse.
  _FILES_CACHE = {
    ..._FILES_EMPTY,
    ...(data && typeof data === "object" ? data : {}),
  };
  if (!Array.isArray(_FILES_CACHE.files)) _FILES_CACHE.files = [];
  if (!_FILES_CACHE.stats || typeof _FILES_CACHE.stats !== "object") {
    _FILES_CACHE.stats = { by_category: {} };
  }
  _renderFilesTab();
}

// Seule mise en forme des tailles : onglet Fichiers ET liste d'assets. Il en a
// existe deux versions un temps, dont une qui ne s'executait jamais parce que
// la seconde declaration ecrasait la premiere en silence.
function _fmtSize(kb) {
  const n = Number(kb) || 0;
  if (n < 1024) return `${n.toFixed(1)} KB`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024).toFixed(2)} GB`;
}

function _fmtMtime(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString();
}

function _catIcon(cat) {
  const c = _KIND_COLORS[cat] || _KIND_COLORS.mesh;
  if (cat === "mesh") return `<span class="files-icon" style="color:${c}">🎲</span>`;
  if (cat === "texture") return `<span class="files-icon" style="color:${c}">🖼</span>`;
  if (cat === "heightmap") return `<span class="files-icon" style="color:#8db4d4">⛰</span>`;
  if (cat === "scene") return `<span class="files-icon" style="color:#a78bfa">🎬</span>`;
  if (cat === "log") return `<span class="files-icon" style="color:var(--fg-dim)">📜</span>`;
  return `<span class="files-icon" style="color:var(--fg-dim)">📄</span>`;
}

function _renderFilesTab() {
  const _t = (k, fb, vars) => (window.I18N ? window.I18N.t(k, vars) : fb);
  const stats = _FILES_CACHE.stats || {by_category:{}};

  // Header
  const root = _FILES_CACHE.root || "—";
  const totalCount = stats.total_count || 0;
  const totalSize  = _fmtSize(stats.total_kb || 0);
  $("#files-stats-header").textContent = `${totalCount} files · ${totalSize}`;
  $("#files-stats-header").title = root;
  const cats = stats.by_category || {};
  const catParts = Object.keys(cats).sort().map(c => `${cats[c]} ${c}`).join(" · ");
  $("#files-stats-detail").textContent = catParts || root;

  // Variant tabs
  const variants = [...new Set(_FILES_CACHE.files.map(f => f.variant).filter(Boolean))].sort();
  const tabsEl = $("#files-variant-tabs");
  if (tabsEl) {
    const allLabel = _t("files.tab_all", "All");
    tabsEl.innerHTML = `
      <div class="tab ${_FILES_VARIANT === "all" ? "active" : ""}" data-fvariant="all">${allLabel} (${_FILES_CACHE.files.length})</div>
      ${variants.map(v => `
        <div class="tab ${_FILES_VARIANT === v ? "active" : ""}" data-fvariant="${v}">${v} (${_FILES_CACHE.files.filter(f => f.variant === v).length})</div>
      `).join("")}
    `;
    tabsEl.querySelectorAll("[data-fvariant]").forEach(el => {
      el.addEventListener("click", () => {
        _FILES_VARIANT = el.dataset.fvariant;
        _renderFilesTab();
      });
    });
  }

  // Filtre la liste
  const q = _FILES_SEARCH.toLowerCase().trim();
  const filtered = _FILES_CACHE.files.filter(f => {
    if (_FILES_VARIANT !== "all" && f.variant !== _FILES_VARIANT) return false;
    if (_FILES_TYPE !== "all" && f.category !== _FILES_TYPE) return false;
    if (q && !f.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // Liste
  const list = $("#files-list");
  if (!list) return;
  if (filtered.length === 0) {
    list.innerHTML = `<div class="faint" style="font-size:11.5px;font-style:italic;padding:20px;text-align:center">${_t("files.empty", "No file in this folder.")}</div>`;
  } else {
    list.innerHTML = filtered.map(f => {
      const checked = _FILES_SELECTED.has(f.path) ? "checked" : "";
      const variantBadge = f.variant
        ? `<span class="files-variant-badge">${f.variant}</span>`
        : "";
      return `
        <div class="files-row ${checked ? 'selected' : ''}" data-file-path="${_esc(f.path)}">
          <input type="checkbox" class="files-checkbox" ${checked}>
          ${_catIcon(f.category)}
          <span class="files-ext">${f.ext}</span>
          ${variantBadge}
          <span class="files-name" title="${_esc(f.path)}">${_esc(f.name)}</span>
          <span class="files-meta">${_fmtSize(f.size_kb)} · ${_fmtMtime(f.mtime)}</span>
          <button class="files-action-btn" data-action="show-explorer" title="Show in Explorer">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
          </button>
        </div>`;
    }).join("");

    // Wire checkboxes
    list.querySelectorAll(".files-row").forEach(row => {
      const cb = row.querySelector(".files-checkbox");
      const path = row.dataset.filePath;
      cb.addEventListener("click", e => {
        e.stopPropagation();
        if (cb.checked) _FILES_SELECTED.add(path);
        else _FILES_SELECTED.delete(path);
        row.classList.toggle("selected", cb.checked);
        _updateBulkBar();
      });
      // Click sur la row toggle aussi
      row.addEventListener("click", e => {
        if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("click"));
      });
      // Action button → show in explorer
      row.querySelector(".files-action-btn").addEventListener("click", async e => {
        e.stopPropagation();
        await eel.open_in_explorer(path)();
      });
    });
  }
  _updateBulkBar();
}

function _updateBulkBar() {
  const bar = $("#files-bulk-bar");
  const countEl = $("#files-selected-count");
  if (!bar || !countEl) return;
  const n = _FILES_SELECTED.size;
  bar.style.display = n > 0 ? "flex" : "none";
  countEl.textContent = `${n} selected`;
}

function wireFilesTab() {
  $("#btn-files-open-folder")?.addEventListener("click", async () => {
    await eel.open_in_explorer("")();
  });
  $("#files-search")?.addEventListener("input", e => {
    _FILES_SEARCH = e.target.value;
    _renderFilesTab();
  });
  $("#files-type-filter")?.addEventListener("change", e => {
    _FILES_TYPE = e.target.value;
    _renderFilesTab();
  });
  $("#btn-files-deselect")?.addEventListener("click", () => {
    _FILES_SELECTED.clear();
    _renderFilesTab();
  });
  $("#btn-files-delete")?.addEventListener("click", async () => {
    const n = _FILES_SELECTED.size;
    if (n === 0) return;
    const _t = (k, fb, vars) => (window.I18N ? window.I18N.t(k, vars) : fb);
    if (!confirm(_t("files.confirm_delete", `Delete ${n} file(s)?`, { n }))) return;
    const paths = Array.from(_FILES_SELECTED);
    const res = await eel.delete_files(paths)();
    _FILES_SELECTED.clear();
    flashStatus(_t("files.deleted_ok", `✅ ${res.deleted} file(s) deleted`, { n: res.deleted }));
    await refreshFilesTab();
    // Refresh aussi le preview qui partage la source
    refreshAssetPreview();
  });
}


// ── PROJECTS UI ─────────────────────────────────────────────────────
let _projectsCache = [];
let _currentSlug = "";

async function refreshProjectsCache() {
  try {
    _projectsCache = await eel.list_projects()();
    _currentSlug = await eel.current_project()();
  } catch (e) {
    console.error("[projects] refresh fail", e);
    _projectsCache = [];
  }
  const current = _projectsCache.find(p => p.slug === _currentSlug);
  const nameEl = $("#btn-projects-name");
  if (nameEl) nameEl.textContent = current ? current.name : "—";
}

function _esc(s) {
  return (s || "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

function _fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
    return d.toLocaleDateString();
  } catch (e) { return iso; }
}

// Au-dela, la liste devient trop longue pour l'oeil : un champ de recherche
// apparait. En dessous, il ne ferait qu'encombrer.
const _PROJ_SEARCH_FROM = 8;

function renderProjectsList() {
  const list = $("#projects-list");
  if (!list) return;
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  const box = document.getElementById("projects-search-box");
  if (box) box.hidden = _projectsCache.length <= _PROJ_SEARCH_FROM;
  const q = box && !box.hidden
    ? (document.getElementById("projects-search")?.value || "").trim().toLowerCase() : "";
  const shown = q
    ? _projectsCache.filter(p => `${p.name} ${p.slug}`.toLowerCase().includes(q))
    : _projectsCache;
  if (_projectsCache.length === 0) {
    list.innerHTML = `<div class="faint" style="text-align:center;padding:24px;font-size:12px">${window.I18N?.t("projects.empty") || "No project yet. Create one above ↑"}</div>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<div class="faint" style="text-align:center;padding:24px;font-size:12px">${
      _t("projects.no_match", "No project matches this search.")}</div>`;
    return;
  }
  list.innerHTML = shown.map(p => {
    const isCurrent = p.slug === _currentSlug;
    // La ligne entiere ouvre le projet : un bouton "Ouvrir" en plus du clic
    // n'apprenait rien et poussait les autres actions vers la droite.
    return `
      <div class="proj-row ${isCurrent ? "current" : " clickable"}" data-slug="${_esc(p.slug)}"
           title="${isCurrent ? "" : _esc(_t("projects.open_hint", "Click to open this project"))}">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(p.name)}</div>
            ${isCurrent ? `<span class="chip accent" style="height:18px;padding:0 6px;font-size:9px">${window.I18N?.t("projects.current") || "CURRENT"}</span>` : ""}
          </div>
          <div class="faint" style="font-size:10px;font-family:var(--font-mono);margin-top:2px">
            ${_esc(p.slug)} · modified ${_fmtDate(p.modified)}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn ghost proj-action" data-action="duplicate" data-slug="${_esc(p.slug)}" style="height:24px;padding:0 8px;font-size:10px">${window.I18N?.t("btn.duplicate") || "Dup"}</button>
          <button class="btn ghost proj-action" data-action="rename" data-slug="${_esc(p.slug)}" style="height:24px;padding:0 8px;font-size:10px">${window.I18N?.t("btn.rename") || "Rename"}</button>
          <button class="btn ghost proj-action" data-action="delete" data-slug="${_esc(p.slug)}" style="height:24px;padding:0 8px;font-size:10px;color:var(--err)">${window.I18N?.t("btn.delete") || "Del"}</button>
        </div>
      </div>`;
  }).join("");

  // Ouvrir se fait en cliquant la ligne ; les boutons d'action arretent la
  // propagation pour ne pas ouvrir le projet qu'on voulait juste renommer.
  list.querySelectorAll(".proj-row.clickable").forEach(row => {
    row.addEventListener("click", () => handleProjectAction("switch", row.dataset.slug));
  });

  // Wire actions
  list.querySelectorAll(".proj-action").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      handleProjectAction(btn.dataset.action, btn.dataset.slug);
    });
  });
}

async function handleProjectAction(action, slug) {
  if (action === "switch") {
    const res = await eel.switch_project(slug)();
    if (res.ok) {
      // Recharge la config + UI
      CFG = await eel.get_config()();
      await refreshProjectsCache();
      renderStrata();
      wireProjectInputs();
      refreshStats();
      closeProjectsModal();
      _refreshPreviewForProject();
      flashStatus(window.I18N?.t("projects.switched") || "Switched to project");
    }
  } else if (action === "duplicate") {
    const cur = _projectsCache.find(p => p.slug === slug);
    const name = prompt("New project name:", `${cur?.name || slug} copy`);
    if (!name) return;
    const res = await eel.duplicate_project(slug, name)();
    if (res.ok) {
      await refreshProjectsCache();
      renderProjectsList();
    } else {
      flashStatus(`Duplicate failed: ${res.error}`, "var(--err)");
    }
  } else if (action === "rename") {
    const cur = _projectsCache.find(p => p.slug === slug);
    const name = prompt("New name:", cur?.name || slug);
    if (!name) return;
    const res = await eel.rename_project(slug, name)();
    if (res.ok) {
      // Si on a renommé le projet courant, recharge la config
      if (slug === _currentSlug || res.slug === _currentSlug) {
        CFG = await eel.get_config()();
      }
      await refreshProjectsCache();
      renderProjectsList();
    }
  } else if (action === "delete") {
    if (_projectsCache.length <= 1) {
      flashStatus(window.I18N?.t("projects.cannot_delete_last") || "Cannot delete the last project", "var(--err)");
      return;
    }
    const cur = _projectsCache.find(p => p.slug === slug);
    const msg = window.I18N?.t("projects.confirm_delete", { name: cur?.name || slug })
                || `Delete project "${cur?.name || slug}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    const res = await eel.delete_project(slug)();
    if (res.ok) {
      // Si on a supprimé le courant, le backend a basculé → recharge
      CFG = await eel.get_config()();
      _refreshPreviewForProject();
      await refreshProjectsCache();
      renderStrata();
      wireProjectInputs();
      refreshStats();
      renderProjectsList();
    }
  }
}

function openProjectsModal() {
  if (runLocked()) return;
  refreshProjectsCache().then(() => {
    renderProjectsList();
    const m = $("#projects-modal");
    if (m) m.style.display = "flex";
    const sq = $("#projects-search");
    if (sq) sq.value = "";
    const nm = $("#projects-newname");
    if (nm) { nm.value = ""; nm.focus(); }
  });
}

function closeProjectsModal() {
  const m = $("#projects-modal");
  if (m) m.style.display = "none";
}

function wireProjectsUI() {
  refreshProjectsCache();

  const openBtn = $("#btn-projects");
  if (openBtn) openBtn.addEventListener("click", openProjectsModal);

  const search = $("#projects-search");
  if (search) search.addEventListener("input", renderProjectsList);

  const closeBtn = $("#projects-close");
  if (closeBtn) closeBtn.addEventListener("click", closeProjectsModal);

  // Click backdrop to close
  const modal = $("#projects-modal");
  if (modal) modal.addEventListener("click", e => {
    if (e.target === modal) closeProjectsModal();
  });

  // Create new project
  const createBtn = $("#projects-create");
  const newInput = $("#projects-newname");
  const doCreate = async () => {
    const name = (newInput?.value || "").trim();
    if (!name) { newInput?.focus(); return; }
    const res = await eel.create_project(name)();
    if (res.ok) {
      CFG = await eel.get_config()();
      await refreshProjectsCache();
      renderStrata();
      wireProjectInputs();
      refreshStats();
      renderProjectsList();
      if (newInput) newInput.value = "";
      _refreshPreviewForProject();
      flashStatus(window.I18N?.t("projects.created", { name }) || `Project "${name}" created`);
    } else if (res.tier_limit) {
      flashStatus(res.error, "var(--warn)");
    } else if (res.error) {
      flashStatus(res.error, "var(--err)");
    }
  };
  if (createBtn) createBtn.addEventListener("click", doCreate);
  if (newInput) newInput.addEventListener("keydown", e => {
    if (e.key === "Enter") doCreate();
  });
}


// ── BOOTSTRAP ──────────────────────────────────────────────────────
// ── ONBOARDING (premier lancement) ──────────────────────────────────
// Wizard modal 4 étapes : Welcome → Connect tools → Export folder → Done.
// Déclenché au boot si app.onboarded est falsy. Réutilise le pattern modal.
function openOnboarding() {
  const _t = (k, fb, vars) => (window.I18N ? window.I18N.t(k, vars) : fb);
  const STEPS = ["welcome", "tools", "export", "done"];
  let step = 0;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="min-width:560px;max-width:600px">
      <div class="modal-head">
        <div class="modal-title" id="onb-title"></div>
        <div class="modal-sub" id="onb-step"></div>
      </div>
      <div class="modal-body" id="onb-body"></div>
      <div class="modal-foot" id="onb-foot"></div>
    </div>`;
  document.body.appendChild(overlay);

  const finish = async () => {
    await cfgSet("app.onboarded", true);
    overlay.remove();
    renderStrata();
    refreshStats();
    refreshDCCStatus();
    showPage("pipeline");
  };

  const toolRow = (d) => {
    const ok = !!(cfgGet(`paths.${d.key}`) || "").trim();
    const req = d.key === "gaea_exe"
      ? ` <span style="color:var(--cta);font-size:10px">• required</span>` : "";
    return `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line-soft)">
      <div class="strata-app-icon" style="color:${d.color};background:color-mix(in oklab,${d.color} 14%,transparent)">${d.icon}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${d.name}${req}</div>
        <div class="faint" style="font-size:11px;color:${ok ? 'var(--ok)' : 'var(--fg-faint)'}">${ok ? "✓ " + _t("set.onb.tools.found","Found") : _t("set.onb.tools.missing","Not set")}</div>
      </div>
      <button class="btn ghost" data-onb-set="${d.key}" style="height:28px;padding:0 12px;font-size:11.5px">${_t("set.onb.tools.set","Set…")}</button>
    </div>`;
  };

  function render() {
    const name = STEPS[step];
    $("#onb-title").textContent = _t(`set.onb.${name}.title`, name);
    $("#onb-step").textContent = _t("set.onb.step", `Step ${step+1} of ${STEPS.length}`, { n: step + 1, total: STEPS.length });
    const body = $("#onb-body");
    const foot = $("#onb-foot");

    if (name === "welcome") {
      body.innerHTML = `<div style="text-align:center;padding:8px 0 4px">
        <img src="assets/logo.png" style="width:60px;height:60px;margin-bottom:14px">
        <p style="font-size:13.5px;color:var(--fg-mid);line-height:1.6">${_t("set.onb.welcome.body","")}</p>
      </div>`;
      foot.innerHTML = `<button class="btn ghost" data-onb-skip>${_t("set.onb.skip","Skip for now")}</button>
        <button class="btn primary" data-onb-next>${_t("set.onb.start","Get started")} →</button>`;
    } else if (name === "tools") {
      body.innerHTML = `<p class="faint" style="font-size:12.5px;margin-bottom:10px">${_t("set.onb.tools.body","")}</p>
        <button class="btn" id="onb-detect" style="height:34px;width:100%;margin-bottom:12px">${_t("set.onb.tools.detect","Auto-detect")}</button>
        <div>${DCC_DEFS.map(toolRow).join("")}</div>
        <div class="faint" style="font-size:11px;margin-top:12px;line-height:1.5">${_t("set.onb.tools.note","")}</div>`;
      foot.innerHTML = `<button class="btn ghost" data-onb-back>← ${_t("set.onb.back","Back")}</button>
        <button class="btn primary" data-onb-next>${_t("set.onb.next","Next")} →</button>`;
      $("#onb-detect").addEventListener("click", async (e) => {
        e.target.disabled = true;
        e.target.textContent = _t("set.onb.tools.detecting","Detecting…");
        try { await eel.auto_detect_software()(); await _refreshDCCVersions(); CFG = await eel.get_config()(); }
        catch (err) { console.warn("onb detect", err); }
        render();
      });
      body.querySelectorAll("[data-onb-set]").forEach(b => {
        b.addEventListener("click", async () => {
          const d = DCC_DEFS.find(x => x.key === b.dataset.onbSet);
          const p = await eel.pick_file(d.name, d.filetypes, cfgGet(`paths.${d.key}`) || "")();
          if (p) { await cfgSet(`paths.${d.key}`, p); render(); }
        });
      });
    } else if (name === "export") {
      const exp = cfgGet("pipeline.export") || "";
      body.innerHTML = `<p class="faint" style="font-size:12.5px;margin-bottom:12px">${_t("set.onb.export.body","")}</p>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="input" style="flex:1"><input id="onb-export" readonly value="${_esc(exp)}" placeholder="${_t("set.onb.export.none","No folder selected yet")}"></div>
          <button class="btn" id="onb-export-btn" style="height:36px;padding:0 16px">${_t("set.onb.export.choose","Choose folder")}</button>
        </div>`;
      foot.innerHTML = `<button class="btn ghost" data-onb-back>← ${_t("set.onb.back","Back")}</button>
        <button class="btn primary" data-onb-next>${_t("set.onb.next","Next")} →</button>`;
      $("#onb-export-btn").addEventListener("click", async () => {
        const folder = await eel.pick_folder("Select export folder", cfgGet("pipeline.export") || "")();
        if (folder) { await cfgSet("pipeline.export", folder); render(); }
      });
    } else if (name === "done") {
      body.innerHTML = `<div style="text-align:center;padding:14px 0">
        <div style="font-size:38px;margin-bottom:8px">🎉</div>
        <p style="font-size:13.5px;color:var(--fg-mid);line-height:1.6">${_t("set.onb.done.body","")}</p>
      </div>`;
      foot.innerHTML = `<button class="btn ghost" data-onb-back>← ${_t("set.onb.back","Back")}</button>
        <div style="flex:1"></div>
        <button class="btn ghost" data-onb-tour>${_t("tour.take","Take a quick tour")}</button>
        <button class="btn primary" data-onb-finish>${_t("set.onb.finish","Finish")}</button>`;
    }

    foot.querySelector("[data-onb-next]")?.addEventListener("click", () => { step++; render(); });
    foot.querySelector("[data-onb-back]")?.addEventListener("click", () => { step--; render(); });
    foot.querySelector("[data-onb-skip]")?.addEventListener("click", finish);
    foot.querySelector("[data-onb-finish]")?.addEventListener("click", finish);
    foot.querySelector("[data-onb-tour]")?.addEventListener("click", async () => {
      await cfgSet("app.onboarded", true);
      overlay.remove();
      try { startTutorial(); } catch (e) { console.warn(e); }
    });
  }

  render();
}


// ── TUTORIEL (tour guidé par bulles) ────────────────────────────────
// Spotlight sur un élément + bulle explicative, étape par étape. JS pur.
// Lançable à la demande (bouton dans About), skippable, rejouable.
function startTutorial() {
  const _t = (k, fb) => (window.I18N ? window.I18N.t(k) : fb);
  showPage("pipeline");
  const STEPS = [
    { sel: "#project-card",        key: "project"  },
    { sel: "#strata-list",         key: "strata"   },
    // La grille de lettres est le geste central de Stratum : une lettre = un
    // terrain, cochee = produite par ce run. Sans cette etape, le tutoriel
    // n'en disait rien.
    { sel: '[data-strata="gaea"]', key: "variants" },
    { sel: "#btn-run",             key: "run"      },
    { sel: "#output-content",      key: "output"   },
    { sel: '[data-nav="library"]', key: "library"  },
    { sel: '[data-nav="settings"]',key: "settings" },
  ];
  let i = 0;

  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";
  overlay.innerHTML = `<div class="tour-spot"></div><div class="tour-bubble"></div>`;
  document.body.appendChild(overlay);
  const spot = overlay.querySelector(".tour-spot");
  const bubble = overlay.querySelector(".tour-bubble");

  const end = () => {
    overlay.remove();
    window.removeEventListener("resize", render);
    window.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") end(); };

  function positionBubble(r) {
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, gap = 12, m = 10;
    const fits = (t, l) => t >= m && l >= m && t + bh <= vh - m && l + bw <= vw - m;
    // Essaie plusieurs placements, garde le 1er qui rentre entièrement.
    const cands = [
      { t: r.bottom + gap, l: r.left },          // dessous, aligné gauche
      { t: r.bottom + gap, l: r.right - bw },     // dessous, aligné droite
      { t: r.top - gap - bh, l: r.left },         // dessus, aligné gauche
      { t: r.top - gap - bh, l: r.right - bw },   // dessus, aligné droite
      { t: r.top, l: r.right + gap },             // à droite
      { t: r.top, l: r.left - gap - bw },         // à gauche
      // pour un élément plus haut que l'écran : colle en haut, sur un côté libre
      { t: m, l: (r.right + gap + bw <= vw - m) ? r.right + gap : r.left - gap - bw },
    ];
    const pick = cands.find(c => fits(c.t, c.l)) || cands[0];
    bubble.style.top  = Math.max(m, Math.min(pick.t, vh - bh - m)) + "px";
    bubble.style.left = Math.max(m, Math.min(pick.l, vw - bw - m)) + "px";
  }

  function render() {
    const step = STEPS[i];
    const el = document.querySelector(step.sel);
    if (!el) { if (i < STEPS.length - 1) { i++; return render(); } return end(); }
    el.scrollIntoView({ block: "center", behavior: "auto" });
    const r = el.getBoundingClientRect();
    const pad = 6;
    spot.style.left = (r.left - pad) + "px";
    spot.style.top = (r.top - pad) + "px";
    spot.style.width = (r.width + pad * 2) + "px";
    spot.style.height = (r.height + pad * 2) + "px";
    const isLast = i === STEPS.length - 1;
    bubble.innerHTML = `
      <div class="tour-step-n">${i + 1}/${STEPS.length}</div>
      <div class="tour-title">${_t("tour." + step.key + ".title", step.key)}</div>
      <div class="tour-body">${_t("tour." + step.key + ".body", "")}</div>
      <div class="tour-foot">
        <button class="btn ghost" data-tour-skip style="height:30px;padding:0 12px;font-size:11.5px">${_t("tour.skip", "Skip")}</button>
        <div style="flex:1"></div>
        ${i > 0 ? `<button class="btn ghost" data-tour-back style="height:30px;padding:0 12px;font-size:11.5px">${_t("tour.back", "Back")}</button>` : ""}
        <button class="btn primary" data-tour-next style="height:30px;padding:0 14px;font-size:11.5px">${isLast ? _t("tour.done", "Done") : _t("tour.next", "Next")}</button>
      </div>`;
    positionBubble(r);
    bubble.querySelector("[data-tour-next]").addEventListener("click", () => { if (isLast) end(); else { i++; render(); } });
    bubble.querySelector("[data-tour-back]")?.addEventListener("click", () => { i--; render(); });
    bubble.querySelector("[data-tour-skip]").addEventListener("click", end);
  }

  window.addEventListener("resize", render);
  window.addEventListener("keydown", onKey);
  render();
}


async function bootstrap() {
  // App desktop : pas de menu contextuel navigateur. On le garde uniquement
  // sur les champs texte (copier/coller au clic droit).
  document.addEventListener("contextmenu", e => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    e.preventDefault();
  });

  // Charge la config depuis Python
  try {
    CFG = await eel.get_config()();
  } catch (e) {
    console.error("Failed to load config:", e);
    CFG = {};
  }

  // Version affichee = celle du code (app/version.py), jamais un texte en
  // dur : l'ecran disait 0.1.0 alors que l'exe etait en 1.0.0.
  try {
    window._APP_VERSION = (await eel.app_info()()).version || "";
    document.querySelectorAll("#app-version, .app-version").forEach(el => { el.textContent = window._APP_VERSION; });
  } catch (e) { /* sans backend */ }

  // Applique le theme
  applyThemeClass(cfgGet("ui.theme") || "dark");

  // Applique la langue avant le wiring (les fonctions utiliseront window.I18N.t)
  const lang = cfgGet("ui.language") || "en";
  if (window.I18N) {
    window.I18N.setLang(lang);
    window.I18N.applyI18n();
  }

  // Charge les limites du tier de license AVANT le premier render des strata
  // (sinon le select de résolution s'affiche sans cap pendant un instant).
  try {
    const lim = await eel.get_tier_limits()();
    window._TIER_MAX_VARIANTS = lim.max_variants || 10;
    window._TIER_MAX_PROJECTS = lim.max_projects || 0;
    window._TIER_MAX_RESOLUTION = lim.max_resolution || 8192;
    window._TIER_KEY = lim.tier || "free";
  } catch (e) {
    window._TIER_MAX_VARIANTS = 10;
    window._TIER_MAX_RESOLUTION = 8192;
  }

  await loadBuiltinHdas();
  wireProjectInputs();
  renderStrata();
  refreshStats();
  refreshDCCStatus();
  wireTabs();
  wireViewerTools();
  wireFilesTab();
  wireLibrary();
  wireNav();
  wireRun();
  wirePresets();
  wireProjectsUI();
  wireConsoleControls();
  wireKeyboardShortcuts();
  wireSelectPopups();
  await _refreshDCCVersions();
  buildSettingsPage();
  buildLibraryPage();
  buildStorePage();

  // Onboarding au tout premier lancement (flag app.onboarded absent/falsy).
  if (!cfgGet("app.onboarded")) {
    try { openOnboarding(); } catch (e) { console.warn("onboarding", e); }
  }

  // Check de mise à jour (différé, non bloquant, silencieux si offline).
  setTimeout(async () => {
    try {
      const u = await eel.check_updates()();
      if (!u || !u.ok || !u.update) return;
      const renew = u.covered === false && u.renew_url;
      const foot = document.querySelector(".sidebar-foot");
      if (!foot || $("#update-banner")) return;
      const el = document.createElement("div");
      el.id = "update-banner";
      el.style.cssText = "margin:8px 0;padding:7px 10px;border:1px solid color-mix(in oklab,var(--accent) 35%,transparent);border-radius:6px;background:color-mix(in oklab,var(--accent) 10%,transparent);font-size:11px;color:var(--accent);cursor:pointer;text-align:center;font-family:var(--font-mono)";
      el.textContent = renew
        ? (window.I18N ? window.I18N.t("update.renew", { v: u.latest }) : `v${u.latest} out: renew your updates`)
        : (window.I18N ? window.I18N.t("update.available", { v: u.latest }) : `Update available: v${u.latest}`);
      if (u.notes) el.title = u.notes;
      el.addEventListener("click", () => { try { eel.open_url(renew ? u.renew_url : u.url)(); } catch (e) {} });
      foot.prepend(el);
    } catch (e) { /* silencieux */ }
  }, 2500);

  // Bouton Rescan assets (dans Preview tab)
  const rescanBtn = $("#btn-refresh-assets");
  if (rescanBtn) rescanBtn.addEventListener("click", () => {
    window._firstAssetLoaded = false;
    refreshAssetPreview();
  });

  // Bouton Refresh (icône circulaire dans la barre Source)
  const refreshBtn = $("#btn-preview-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", () => {
    window._firstAssetLoaded = false;
    refreshAssetPreview();
  });

  // Boutons Source picker (Browse / Reset)
  const browseBtn = $("#btn-preview-browse");
  if (browseBtn) browseBtn.addEventListener("click", async () => {
    const cur = (await eel.get_preview_source()()).path || "";
    const folder = await eel.pick_folder("Select preview folder", cur)();
    if (folder) {
      await eel.set_preview_source(folder)();
      window._firstAssetLoaded = false;
      refreshAssetPreview();
    }
  });
  const resetBtn = $("#btn-preview-reset");
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    await eel.set_preview_source("")();
    window._firstAssetLoaded = false;
    refreshAssetPreview();
  });

  // Scan initial des assets après load
  setTimeout(() => refreshAssetPreview(), 800);
  // La bande de rattrapage se decide sur le disque, pas sur la config : elle
  // doit donc etre calculee au demarrage et pas seulement apres un run.
  refreshStaleRow();
}

window.addEventListener("DOMContentLoaded", bootstrap);

// Désactive le menu contextuel natif du browser (clic-droit),sauf dans les
// inputs/textareas où c'est utile (paste / undo). Évite le menu Edge "Masquer
// le menu / Plus d'actions" qui apparait en mode --app.
window.addEventListener("contextmenu", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
  e.preventDefault();
});

// Désactive aussi le drag de sélection texte et le browser zoom Ctrl+wheel
window.addEventListener("dragstart", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag !== "img" && tag !== "a") e.preventDefault();
});
