// Photos de presentation, partagees par la fenetre principale et la grande
// fenetre d'apercu.
//
// Le rendu vient de Viewer3D.capture, la mise en page (fond couleur ou
// degrade, textes, logo) d'un canvas 2D, l'enregistrement de Python : les
// fichiers arrivent dans un dossier connu, ranges par style, prets a poser sur
// une fiche produit sans passer par Photoshop.
(function () {
  const DEFAULTS = {
    bg: "scene", shadow: true, format: "3840x2160", grid: false,
    bg_color: "#1b2430", bg_color2: "#05080c",
    ov_name: false, ov_stats: false, ov_logo: false,
  };

  // Reglages relus a chaque photo : ils se changent aussi bien depuis la
  // fenetre principale que depuis la grande fenetre.
  async function settings() {
    try {
      const cfg = await eel.get_config()();
      const ui = (cfg && cfg.ui) || {};
      return Object.assign({}, DEFAULTS, ui.photo || {}, { scope: ui.photo_scope || "all" });
    } catch (e) {
      return Object.assign({}, DEFAULTS, { scope: "all" });
    }
  }

  // Tailles exactes, celles qu'attendent les boutiques. "window" garde la
  // forme de la fenetre, avec 3840 pixels sur le grand cote.
  const FORMATS = ["3840x2160", "2560x1440", "1920x1080", "2048x2048", "window"];

  function formatSize(fmt) {
    const m = /^(\d+)x(\d+)$/.exec(String(fmt || ""));
    return m ? { width: +m[1], height: +m[2] } : { longEdge: 3840 };
  }

  function frame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function _plate(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
    g.fill();
  }

  // Mise en page finale. Les textes sont poses sur une plaque sombre
  // translucide : lisibles sur un fond clair, sombre, dans le brouillard ou
  // sur du transparent, sans avoir a choisir leur couleur a chaque fois.
  async function compose(shot, s, asset, stats) {
    const flat = s.bg === "color" || s.bg === "gradient";
    const lines = [];
    if (s.ov_name && asset && asset.name) lines.push({ text: asset.name, strong: true });
    if (s.ov_stats && stats) {
      lines.push({ text: `${stats.vertices.toLocaleString()} verts · ${stats.triangles.toLocaleString()} tris` });
    }
    if (!flat && !lines.length && !s.ov_logo) return shot.dataUrl;

    const img = await loadImage(shot.dataUrl);
    const c = document.createElement("canvas");
    c.width = shot.width;
    c.height = shot.height;
    const g = c.getContext("2d");
    if (s.bg === "color") {
      g.fillStyle = s.bg_color || DEFAULTS.bg_color;
      g.fillRect(0, 0, c.width, c.height);
    } else if (s.bg === "gradient") {
      const gr = g.createLinearGradient(0, 0, 0, c.height);
      gr.addColorStop(0, s.bg_color || DEFAULTS.bg_color);
      gr.addColorStop(1, s.bg_color2 || DEFAULTS.bg_color2);
      g.fillStyle = gr;
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(img, 0, 0);

    const unit = c.height / 100;
    const pad = Math.round(unit * 2.4);
    if (lines.length) {
      const sizes = lines.map(l => Math.round(unit * (l.strong ? 2.6 : 1.9)));
      const font = (l, i) => `${l.strong ? 700 : 500} ${sizes[i]}px Inter, "Segoe UI", system-ui, sans-serif`;
      let w = 0;
      lines.forEach((l, i) => { g.font = font(l, i); w = Math.max(w, g.measureText(l.text).width); });
      const gap = Math.round(unit * 0.7);
      const inner = Math.round(unit * 1.4);
      const h = sizes.reduce((a, b) => a + b, 0) + gap * (lines.length - 1) + inner * 2;
      const x = pad;
      const y = c.height - pad - h;
      g.fillStyle = "rgba(6, 10, 14, 0.58)";
      _plate(g, x, y, w + inner * 2, h, Math.round(unit * 1.2));
      let cy = y + inner;
      g.textBaseline = "top";
      lines.forEach((l, i) => {
        g.font = font(l, i);
        g.fillStyle = l.strong ? "#ffffff" : "rgba(235, 242, 248, 0.86)";
        g.fillText(l.text, x + inner, cy);
        cy += sizes[i] + gap;
      });
    }
    if (s.ov_logo) {
      try {
        const logo = await loadImage("assets/logo.png");
        const h = unit * 7;
        const w = logo.width * h / logo.height;
        g.globalAlpha = 0.92;
        g.drawImage(logo, c.width - pad - w, c.height - pad - h, w, h);
        g.globalAlpha = 1;
      } catch (e) { /* logo absent : la photo part sans */ }
    }
    return c.toDataURL("image/png");
  }

  async function shoot(asset, opts) {
    const V = window.Viewer3D;
    if (!V || !V.capture || !asset) return { ok: false, error: "no_asset" };
    const s = opts || await settings();
    // Laisse la scene afficher le mesh qui vient d'arriver avant de figer.
    await frame();
    const shot = V.capture(Object.assign(formatSize(FORMATS.includes(s.format) ? s.format : DEFAULTS.format), {
      transparent: s.bg !== "scene",
      shadow: s.shadow !== false,
      grid: !!s.grid,
    }));
    if (!shot) return { ok: false, error: "capture" };
    let dataUrl = shot.dataUrl;
    try {
      dataUrl = await compose(shot, s, asset, V.getStats ? V.getStats() : null);
    } catch (e) {
      console.warn("[photo] mise en page", e);
    }
    let saved = null;
    try {
      saved = await eel.save_photo({
        name: asset.name || "asset",
        style: asset.kind || "",
        variant: asset.variant || "",
      }, dataUrl)();
    } catch (e) {
      saved = { ok: false, error: String(e) };
    }
    return Object.assign({ width: shot.width, height: shot.height }, saved || { ok: false });
  }

  // Charge puis photographie chaque asset, dans l'ordre de la liste. `load`
  // vient de la fenetre : la principale passe par sa selection pour que la
  // liste et le titre suivent, la grande fenetre charge directement.
  async function shootAll(assets, load, onStep, cancelled) {
    const s = await settings();
    const list = (assets || []).filter(a => a && a.mesh_url);
    let ok = 0;
    let folder = "";
    for (let i = 0; i < list.length; i++) {
      if (cancelled && cancelled()) break;
      if (onStep) onStep(i, list.length, list[i]);
      try {
        await load(list[i], i);
        // Deux images : le mesh entre dans la scene, puis son ombre se calcule.
        await frame();
        await frame();
        const r = await shoot(list[i], s);
        if (r && r.ok) {
          ok++;
          folder = r.root || folder;
        }
      } catch (e) {
        console.warn("[photo]", list[i].name, e);
      }
    }
    return { ok, total: list.length, folder };
  }

  // Reglages de la photo, dessines a l'identique dans les deux fenetres et
  // enregistres a chaque changement. `t(cle, repli)` traduit les libelles.
  async function renderSettings(host, t) {
    if (!host) return;
    const tt = t || ((k, fb) => fb);
    const s = await settings();
    host.innerHTML = `
      <div class="ps-row">
        <span class="ps-lbl">${tt("viewer.photo.bg", "Background")}</span>
        <select data-ps="bg" class="ps-select">
          <option value="scene">${tt("viewer.photo.bg_scene", "Scene")}</option>
          <option value="transparent">${tt("viewer.photo.bg_transparent", "Transparent")}</option>
          <option value="color">${tt("viewer.photo.bg_color", "Color")}</option>
          <option value="gradient">${tt("viewer.photo.bg_gradient", "Gradient")}</option>
        </select>
        <input type="color" data-ps="bg_color" class="ps-color">
        <input type="color" data-ps="bg_color2" class="ps-color">
      </div>
      <label class="ps-chk"><input type="checkbox" data-ps="grid"> ${tt("viewer.photo.grid", "Grid")}</label>
      <label class="ps-chk" data-ps-shadow><input type="checkbox" data-ps="shadow"> ${tt("viewer.photo.shadow", "Keep ground shadow")}</label>
      <div class="ps-row">
        <span class="ps-lbl">${tt("viewer.photo.res", "Resolution")}</span>
        <select data-ps="format" class="ps-select">
          <option value="3840x2160">4K · 3840×2160</option>
          <option value="2560x1440">QHD · 2560×1440</option>
          <option value="1920x1080">Full HD · 1920×1080</option>
          <option value="2048x2048">${tt("viewer.photo.fmt_square", "Square")} · 2048×2048</option>
          <option value="window">${tt("viewer.photo.fmt_window", "Window shape")} · 4K</option>
        </select>
      </div>
      <div class="ps-hint">${tt("viewer.photo.fmt_hint",
        "Exact sizes: stores like Fab crop anything that is not 16:9.")}</div>
      <div class="ps-sub">${tt("viewer.photo.overlay", "On the photo")}</div>
      <label class="ps-chk"><input type="checkbox" data-ps="ov_name"> ${tt("viewer.photo.ov_name", "Mesh name")}</label>
      <label class="ps-chk"><input type="checkbox" data-ps="ov_stats"> ${tt("viewer.photo.ov_stats", "Vertices and triangles")}</label>
      <label class="ps-chk"><input type="checkbox" data-ps="ov_logo"> ${tt("viewer.photo.ov_logo", "Stratum logo")}</label>
      <div class="ps-hint">${tt("viewer.photo.window_hint",
        "The photo comes from the window you click in: each window has its own camera.")}</div>`;

    const $ = (k) => host.querySelector(`[data-ps="${k}"]`);
    $("bg").value = ["scene", "transparent", "color", "gradient"].includes(s.bg) ? s.bg : "scene";
    $("bg_color").value = s.bg_color || DEFAULTS.bg_color;
    $("bg_color2").value = s.bg_color2 || DEFAULTS.bg_color2;
    $("format").value = FORMATS.includes(s.format) ? s.format : DEFAULTS.format;
    ["grid", "shadow", "ov_name", "ov_stats", "ov_logo"].forEach(k => { $(k).checked = !!s[k]; });
    if (s.shadow == null) $("shadow").checked = true;

    const sync = () => {
      const bg = $("bg").value;
      $("bg_color").hidden = !(bg === "color" || bg === "gradient");
      $("bg_color2").hidden = bg !== "gradient";
      // Sur un fond de scene, l'ombre est de toute facon dans le decor.
      host.querySelector("[data-ps-shadow]").classList.toggle("off", bg === "scene");
      $("shadow").disabled = bg === "scene";
    };
    const save = async () => {
      sync();
      const out = {
        bg: $("bg").value, bg_color: $("bg_color").value, bg_color2: $("bg_color2").value,
        grid: $("grid").checked, shadow: $("shadow").checked, format: $("format").value,
        ov_name: $("ov_name").checked, ov_stats: $("ov_stats").checked, ov_logo: $("ov_logo").checked,
      };
      try { await eel.save_field("ui.photo", out)(); } catch (e) { /* hors app */ }
    };
    host.querySelectorAll("[data-ps]").forEach(el => {
      el.addEventListener(el.type === "color" ? "input" : "change", save);
    });
    sync();
  }

  // Portee d'une serie : tout, un style, ou une variante. 60 photos d'un coup
  // ne servent pas toujours : on refait souvent un seul style, ou toutes les
  // VarA pour une planche de comparaison.
  const STYLE_LABELS = { realistic: "Realistic", stylized: "Stylized",
                         polygonal: "Polygonal", cartoon: "Cartoon", retro: "Retro" };

  function _usable(assets) {
    return (assets || []).filter(a => a && a.mesh_url);
  }

  function _style(a) {
    return String((a && a.kind) || "").toLowerCase();
  }

  function scopeOptions(assets) {
    const list = _usable(assets);
    const styles = [...new Set(list.map(_style).filter(k => STYLE_LABELS[k]))].sort();
    const variants = [...new Set(list.map(a => a.variant).filter(Boolean))].sort();
    const opts = [{ value: "all", label: "", count: list.length }];
    styles.forEach(k => opts.push({
      value: "style:" + k, label: STYLE_LABELS[k],
      count: list.filter(a => _style(a) === k).length }));
    variants.forEach(v => opts.push({
      value: "variant:" + v, label: v,
      count: list.filter(a => a.variant === v).length }));
    return opts;
  }

  function filterAssets(assets, scope) {
    const list = _usable(assets);
    const sc = String(scope || "all");
    if (sc.startsWith("style:")) return list.filter(a => _style(a) === sc.slice(6));
    if (sc.startsWith("variant:")) return list.filter(a => a.variant === sc.slice(8));
    return list;
  }

  window.StratumPhoto = { settings, shoot, shootAll, compose, renderSettings, formatSize, FORMATS,
                          scopeOptions, filterAssets, DEFAULTS };
})();
