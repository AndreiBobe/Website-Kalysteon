// ─────────────────────────────────────────────
// Stratum 3D viewer — Three.js wrapped pour usage simple depuis app.js
// Exposé sur window.Viewer3D
// ─────────────────────────────────────────────
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";

let scene, camera, renderer, controls, container;
let currentAsset = null;
// Jeton du chargement en cours. clearAsset() s'execute avant le await du
// loader : pendant qu'un OBJ de 400 Mo arrive, un second clic lance un
// chargement dont le clearAsset() ne trouve rien a supprimer. Les deux meshes
// finissaient alors dans la scene, seul le dernier restant reference, et le
// premier n'en sortait plus jamais. A chaque reprise apres un await on
// verifie donc qu'on est toujours le chargement legitime.
let _loadToken = 0;
let initialized = false;

// État options
let _texture = null;            // dernière texture chargée (pour toggle)
let _textureEnabled = true;
let _normalMap = null;          // normal map détectée à côté du mesh
// Desactivee par defaut : la carte du TextureBaker de Gaea sert a restituer
// le relief perdu par la decimation d'un LOD. Sur le mesh plein, qui porte
// deja tout ce relief dans sa geometrie, elle n'ajoute qu'une perturbation
// quasi neutre qui se lit comme du bruit. Le bouton NRM reste la pour ceux
// qui previsualisent un LOD decime.
let _normalEnabled = false;
let _normalScale = 1.0;
let _wireframe = false;
let _autoRotate = false;
// Angle de rotation du sujet, tenu par le viewer et non par le mesh. Il
// vivait sur le mesh lui-meme : chaque changement d'asset repartait donc de
// zero, et une serie de photos cadree sous un angle choisi se retrouvait
// prise de face. Seul le bouton de recadrage le remet a zero.
let _yaw = 0;
let _grid = null;
let _lights = { key: null, fill: null, rim: null, ambient: null, hemi: null };
let _envMap = null;          // eclairage d'environnement (IBL)
// Force de l'IBL. Elle doit etre appliquee materiau par materiau : la
// propriete globale scene.environmentIntensity n'existe qu'a partir de
// Three r163, et on tourne en r159. On la reglait donc dans le vide, l'IBL
// restait a fond et noyait tout l'eclairage directionnel. C'est ce qui
// aplatissait le relief et effacait l'ombre du mesh sur lui-meme.
// Roche et terre : surfaces mates. A 0.78 de rugosite le lobe speculaire
// reste large et chaque facette plate le renvoie d'un bloc, ce qui donne
// l'aspect plastique sur un terrain bas poly. Et une metalness non nulle sur
// un dielectrique n'a aucun sens physique : elle ne fait qu'ajouter un
// vernis. Le sol de la grille etait deja a 0.96, les deux suivent maintenant
// la meme regle.
const MAT_ROUGHNESS = 0.95;
const MAT_METALNESS = 0.0;

let _envIntensity = 1.0;
let _exposure = 1.0;         // exposition, reglable depuis l'UI
let _presetName = "studio";
// Position du soleil en coordonnees spheriques. Bouger l'azimut change le
// sens des ombres, baisser la hauteur les allonge : c'est ce qui revele le
// relief d'un terrain, un eclairage zenithal l'aplatit.
let _sun = { az: 45, el: 40, dist: 12 };
// Force des ombres, facon Unreal. 1 = valeurs du preset. En dessous les
// ombres sont debouchees, au-dessus elles se creusent jusqu'au noir.
let _shadowStrength = 1.0;
let _shadowRadius = 1.6;   // rayon du sujet, sert a cadrer la camera d'ombre
let _shadowFloor = null;   // couche d'ombre portee, opacite reglable
let _ground = null;        // sol visible : donne un support a l'ombre
// Brouillard d'ambiance. Coupe, la scene garde le leger fondu d'horizon qui
// evite une grille coupee net (il commence a 8 unites, le sujet est a 4 : il
// ne le touche pas). Allume, un brouillard exponentiel enveloppe le sujet
// lui-meme, les parties lointaines du terrain se fondent : c'est ce qui donne
// de la profondeur aux photos de presentation. color "" = couleur du fond.
let _fog = { on: false, density: 0.35, color: "" };
let _initialCamPos = null;

const ACCENT = 0x2dc1c6;
const CTA = 0xe8835b;

// Attention aux intensites : au-dela d'environ 1.5 sur la key, un terrain
// clair sature et tout le degrade se tasse contre le blanc. Les ombres sont
// bien calculees mais deviennent invisibles, ce qui donne un rendu plat.
const LIGHTING_PRESETS = {
  // Trois ambiances franchement differentes, pour juger un asset d'un coup
  // d'oeil sans rien regler. La position du soleil reste modifiable ensuite.
  //   ambientColor : teinte de la lumiere d'ambiance, donc la couleur que
  //          prennent les zones a l'ombre (le soleil n'y arrive pas).
  //   hemi : [intensite, couleur ciel, couleur sol]
  //   env  : force de l'eclairage d'environnement (reflets, lumiere indirecte)
  //   key  : [intensite, couleur, [x, y, z]] -> la hauteur y donne l'angle
  //          du soleil, donc la longueur des ombres.

  // NEUTRE : lumiere blanche, aucune teinte. Sert de reference pour juger
  // les vraies couleurs d'une texture (aucun appoint colore ici, sinon on
  // jugerait la lumiere et pas l'asset).
  studio:  { ambient: 0.016, ambientColor: 0xffffff, exposure: 1.05, env: 0.21,
             hemi: [0.14, 0xeef1f4, 0x33373b],
             key:  [1.45, 0xffffff, [5, 8, 5]],
             fill: [0.05, 0xffffff, [-5, 2, -4]],
             rim:  [0.10, 0xffffff, [0, 4, -6]] },

  // JOUR BLEUTE : grand ciel bleu, soleil chaud. Tout ce qui remplit les
  // ombres est franchement bleu et l'environnement neutre est reduit au
  // minimum, sinon il delave la teinte. Le contraste chaud/froid entre le
  // soleil et l'ombre est ce qui fait ressortir les volumes.
  showcase:{ ambient: 0.07, ambientColor: 0x2f7fe0, exposure: 1.10, env: 0.04,
             hemi: [0.40, 0x2f92f0, 0x06182e],
             key:  [1.90, 0xffe0ae, [7, 5, 4]],
             fill: [0.20, 0x2f78c8, [-6, 1, -3]],
             rim:  [0.34, 0x6fbcff, [-1, 3, -8]] },

  // CREPUSCULE : soleil rasant orange, ambiance sombre. Le rasant allonge
  // les ombres, c'est la vue qui revele le mieux le relief d'un terrain.
  dramatic:{ ambient: 0.012, ambientColor: 0x2e1b3d, exposure: 1.00, env: 0.05,
             hemi: [0.06, 0xff8a5c, 0x080610],
             key:  [2.0, 0xff9a4d, [8, 2.2, 3]],
             fill: [0.02, 0x3a2a4a, [-5, 0, -2]],
             rim:  [0.29, 0xff6a2a, [0, 2, -7]] },
};

// A appeler apres tout ce qui change l'ombre : chargement, soleil, preset,
// theme. Sans ca la shadow map resterait celle d'avant (autoUpdate = false).
function _touchShadows() {
  if (renderer) renderer.shadowMap.needsUpdate = true;
}

// Cadre la camera d'ombre sur l'objet plutot que sur un volume fixe. Le
// budget de texels est constant : plus le cadre est serre, plus l'ombre est
// fine. Avec un cadre de 10 unites pour un mesh de 3, on gaspillait les 3/4.
function _fitShadowCamera(obj) {
  if (!_lights.key || !obj) return;
  const sphere = new THREE.Box3().setFromObject(obj)
    .getBoundingSphere(new THREE.Sphere());
  _shadowRadius = Math.max(0.5, sphere.radius * 1.08);
  const cam = _lights.key.shadow.camera;
  const r = _shadowRadius;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 0.1;
  cam.far = _sun.dist + r * 2;
  cam.updateProjectionMatrix();
  _touchShadows();
}

function _themeColors() {
  // Lit le thème depuis <html class="theme-…"> pour adapter le viewer.
  const cl = document.documentElement.classList;
  if (cl.contains("theme-light")) {
    return { bg: 0xf4ede0, fog: 0xe6dbc6, gridA: 0xc8bb9f, gridB: 0xddd0b2,
             fallback: 0x4a6677, ground: 0xd9cfbb };
  }
  // Sombres derives : le fond du viewer suit le gris ou le noir choisi, au
  // lieu de rester bleu nuit au milieu d'une interface grise.
  if (cl.contains("theme-ash")) {
    return { bg: 0x3a3c40, fog: 0x303236, gridA: 0x6c7076, gridB: 0x505358,
             fallback: 0x6ad6e9, ground: 0x46494e };
  }
  if (cl.contains("theme-graphite")) {
    return { bg: 0x16181b, fog: 0x111214, gridA: 0x3f464f, gridB: 0x272b31,
             fallback: 0x6ad6e9, ground: 0x22262b };
  }
  if (cl.contains("theme-midnight")) {
    return { bg: 0x03070a, fog: 0x000000, gridA: 0x22394a, gridB: 0x101b23,
             fallback: 0x6ad6e9, ground: 0x0b141b };
  }
  return { bg: 0x0a1620, fog: 0x050d14, gridA: 0x264a63, gridB: 0x15293a,
           fallback: 0x6ad6e9, ground: 0x1b3243 };
}

// Vrai des qu'un asset a cadre la vue. Avant, chaque chargement rappelait
// resetView() : comparer deux variantes sous le meme angle etait impossible,
// et le bouton Reset ne servait a rien puisque tout se remettait a zero tout
// seul. On cadre au premier, on ne touche plus ensuite.
let _viewFramed = false;

function init(target) {
  if (initialized) return;
  container = target;
  const w = container.clientWidth || 600;
  const h = container.clientHeight || 360;

  const tc = _themeColors();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(tc.bg);
  _applyFog();

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
  camera.position.set(2.5, 1.8, 3.5);
  camera.lookAt(0, 0, 0);
  _initialCamPos = camera.position.clone();
  // Le premier asset cadre la vue ; les suivants la laissent ou elle est.
  _viewFramed = false;

  // alpha : sans lui, une photo sans fond sortait quand meme opaque. Tant
  // que la scene a un fond, l'affichage ne change pas.
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true,
                                        preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // ACES Filmic : courbe de rendu cinema. Evite les hautes lumieres cramees
  // et donne des degrades bien plus riches qu'un rendu lineaire brut.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = _exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // La scene ne bouge pas : inutile de recalculer la shadow map a chaque
  // frame. On la recalcule sur demande, ce qui permet de monter a 4096 sans
  // ramer meme sur un terrain a plusieurs millions de triangles.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  container.appendChild(renderer.domElement);

  // Eclairage d'environnement (IBL) genere a la volee : donne aux materiaux
  // PBR une lumiere indirecte et des reflets credibles, sans fichier HDRI a
  // embarquer. C'est ce qui sort le mesh du rendu "plastique".
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    _envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = _envMap;
    pmrem.dispose();
  } catch (e) {
    console.warn("[viewer] environnement indisponible:", e);
  }

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  // Lights — instanciés une fois puis ré-utilisés (presets ajustent les valeurs)
  _lights.ambient = new THREE.AmbientLight(0xffffff, 0.10);
  scene.add(_lights.ambient);
  _lights.hemi = new THREE.HemisphereLight(0xbcd8ee, 0x2b3440, 0.55);
  scene.add(_lights.hemi);
  _lights.key  = new THREE.DirectionalLight(0xffffff, 1.2);
  _lights.key.castShadow = true;
  _lights.key.shadow.mapSize.set(4096, 4096);
  _lights.key.shadow.camera.near = 0.1;
  _lights.key.shadow.camera.far = 40;
  _lights.key.shadow.bias = -0.00015;
  // normalBias decale le point teste le long de la normale pour tuer l'acne.
  // Trop haut, il efface aussi les vraies ombres : sur un terrain les ravines
  // font 0.01 unite, un biais de 0.02 les gommait entierement.
  _lights.key.shadow.normalBias = 0.004;
  _lights.key.shadow.radius = 1.4;        // bord franc : c'est lui qui contraste
  scene.add(_lights.key);
  _lights.fill = new THREE.DirectionalLight(ACCENT, 0.4);    scene.add(_lights.fill);
  _lights.rim  = new THREE.DirectionalLight(CTA, 0.25);      scene.add(_lights.rim);
  applyLightingPreset("studio");

  // Grid
  _grid = new THREE.GridHelper(20, 40, tc.gridA, tc.gridB);
  _grid.position.y = -0.001;
  scene.add(_grid);

  // Plan invisible au sol pour recevoir l'ombre (matériel ShadowMaterial)
  // Sol visible. Sans lui l'ombre portee (noire) tombait sur le fond sombre
  // de la scene : elle existait mais ne se voyait pas. Un sol legerement plus
  // clair lui donne un support sur lequel elle contraste vraiment, et ancre
  // le mesh au lieu de le laisser flotter dans le vide.
  _ground = new THREE.Mesh(
    // 600 unites : assez loin pour que le brouillard le fonde avant sa
    // lisiere. A 60, on la voyait se decouper net sur le fond.
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: tc.ground, roughness: 0.96, metalness: 0.0,
                                      envMapIntensity: _envIntensity })
  );
  _ground.rotation.x = -Math.PI / 2;
  _ground.position.y = -0.002;    // juste sous la grille, qui reste lisible
  _ground.receiveShadow = true;
  scene.add(_ground);

  _shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.68 })
  );
  _shadowFloor.rotation.x = -Math.PI / 2;
  _shadowFloor.position.y = 0;
  _shadowFloor.receiveShadow = true;
  scene.add(_shadowFloor);

  // Resize observer
  new ResizeObserver(() => {
    if (!container) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  }).observe(container);

  function animate() {
    requestAnimationFrame(animate);
    if (_autoRotate && currentAsset) {
      _yaw += 0.005;
      currentAsset.rotation.y = _yaw;
      _touchShadows();   // l'objet tourne, son ombre doit suivre
    }
    controls.update();
    _renderFrame();
  }
  animate();
  initialized = true;
}

function _disposeTree(root) {
  if (!root) return;
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function clearAsset() {
  _touchShadows();
  if (currentAsset) {
    scene.remove(currentAsset);
    _disposeTree(currentAsset);
    currentAsset = null;
  }
  if (_texture) { _texture.dispose(); _texture = null; }
  if (_normalMap) { _normalMap.dispose(); _normalMap = null; }
}

// La normale de Gaea sort souvent en EXR : TextureLoader ne sait pas la lire
// (il passe par une balise <img>), il faut EXRLoader.
//
// Attention : les assets sont servis par /api/asset/<token>, une URL opaque
// qui ne se termine par aucune extension. Se fier a la fin de l'URL echouait
// donc systematiquement et l'EXR partait vers le mauvais chargeur. Le serveur
// ajoute l'extension en parametre, c'est elle qui fait foi.
function _isExr(url) {
  const [path, query = ""] = String(url).split("?");
  return path.toLowerCase().endsWith(".exr") || /(^|&)ext=exr(&|$)/i.test(query);
}

// Extension d'un asset : celle fournie par l'appelant, sinon le parametre
// pose par le serveur, sinon la fin de l'URL. Le token opaque n'en a pas.
function _urlExt(url, explicit) {
  if (explicit) return String(explicit).toLowerCase().replace(/^\./, "");
  const [path, query = ""] = String(url).split("?");
  const m = /(?:^|&)ext=([a-z0-9]+)/i.exec(query);
  return (m ? m[1] : path.split(".").pop()).toLowerCase();
}

// Retourne une texture ligne par ligne, dans la donnee elle-meme.
//
// Pourquoi pas un simple repeat.y = -1 : Three.js calcule le repere tangent
// dans lequel il interprete la normale a partir des UV d'origine, pas de la
// lecture transformee. Retourner la lecture desalignait donc la donnee et son
// repere, et le relief contredisait la geometrie au lieu de la suivre. En
// retournant la donnee, les UV restent intacts et tout reste coherent.
function _flipTextureRows(tex) {
  const img = tex.image;
  const data = img && img.data;
  if (!data || !img.width || !img.height) return false;
  const w = img.width, h = img.height;
  const stride = data.length / (w * h);
  if (!Number.isInteger(stride)) return false;
  const rowLen = w * stride;
  const tmp = data.slice(0, rowLen);
  for (let y = 0; y < (h >> 1); y++) {
    const a = y * rowLen, b = (h - 1 - y) * rowLen;
    tmp.set(data.subarray(a, a + rowLen));
    data.copyWithin(a, b, b + rowLen);
    data.set(tmp, b);
  }
  tex.needsUpdate = true;
  return true;
}

async function _loadTexture(url) {
  if (_isExr(url)) return await new EXRLoader().loadAsync(url);
  return await new THREE.TextureLoader().loadAsync(url);
}

// Vrai si les normales sont plates : les 3 sommets d'une face partagent la
// meme. OBJLoader appelle computeVertexNormals() quand le fichier ne fournit
// pas de normales indexees, ce qui est le cas des OBJ de Gaea ("f v/vt"), et
// sur une geometrie non indexee ca produit du plat par triangle.
// Angle au dela duquel une arete reste vive. 0 = tout facette, 90 = tout
// lisse. Autour de 35 les pentes sont douces et les cassures de roche
// restent franches.
let _creaseAngle = 35;

function _hasFlatNormals(g) {
  const nrm = g.attributes.normal;
  if (!nrm || g.index) return false;
  const faces = nrm.count / 3;
  let flat = 0, tested = 0;
  for (let s = 0; s < 40 && s < faces; s++) {
    const f = Math.floor(faces * s / 40) * 3;
    const same =
      Math.abs(nrm.getX(f) - nrm.getX(f+1)) < 1e-6 &&
      Math.abs(nrm.getY(f) - nrm.getY(f+1)) < 1e-6 &&
      Math.abs(nrm.getX(f) - nrm.getX(f+2)) < 1e-6;
    if (same) flat++;
    tested++;
  }
  return tested > 0 && flat / tested > 0.9;
}

// Normales lisses sur une geometrie non indexee : on soude les sommets qui
// partagent la meme position, puis on moyenne les normales de face. Sans ca,
// computeVertexNormals donne du plat par triangle, et un normal map pose sur
// une base facettee est incoherent (son repere saute a chaque facette).
function _computeSmoothNormals(g, creaseDeg = _creaseAngle) {
  const pos = g.attributes.position;
  const n = pos.count;
  const p = pos.array;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const q = (min, max) => 65535 / Math.max(1e-9, max - min);
  const qx = q(bb.min.x, bb.max.x), qy = q(bb.min.y, bb.max.y), qz = q(bb.min.z, bb.max.z);

  const map = new Map();
  const ids = new Int32Array(n);
  let uniq = 0;
  for (let i = 0; i < n; i++) {
    const kx = Math.round((p[i*3]   - bb.min.x) * qx);
    const ky = Math.round((p[i*3+1] - bb.min.y) * qy);
    const kz = Math.round((p[i*3+2] - bb.min.z) * qz);
    const key = kx * 4294967296 + ky * 65536 + kz;   // 3 x 16 bits, exact
    let id = map.get(key);
    if (id === undefined) { id = uniq++; map.set(key, id); }
    ids[i] = id;
  }

  const acc = new Float32Array(uniq * 3);
  for (let f = 0; f < n; f += 3) {
    const a = f*3, b = a+3, c = a+6;
    const ax = p[b]-p[a], ay = p[b+1]-p[a+1], az = p[b+2]-p[a+2];
    const bx = p[c]-p[a], by = p[c+1]-p[a+1], bz = p[c+2]-p[a+2];
    const nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
    for (let k = 0; k < 3; k++) {
      const o = ids[f+k] * 3;
      acc[o] += nx; acc[o+1] += ny; acc[o+2] += nz;
    }
  }

  // Normalise la moyenne par sommet
  for (let u = 0; u < uniq; u++) {
    const o = u * 3;
    const len = Math.hypot(acc[o], acc[o+1], acc[o+2]) || 1;
    acc[o] /= len; acc[o+1] /= len; acc[o+2] /= len;
  }

  // Angle de cassure : on ne lisse que la ou la surface est reellement
  // continue. Si la face s'ecarte trop de la moyenne du sommet, c'est une
  // vraie arete (bord de falaise, strate) et on garde la normale de face.
  // Tout lisser aplatit le relief, ne rien lisser facette tout.
  const cosMax = Math.cos(creaseDeg * Math.PI / 180);
  const out = new Float32Array(n * 3);
  for (let f = 0; f < n; f += 3) {
    const a = f*3, b = a+3, c = a+6;
    const ax = p[b]-p[a], ay = p[b+1]-p[a+1], az = p[b+2]-p[a+2];
    const bx = p[c]-p[a], by = p[c+1]-p[a+1], bz = p[c+2]-p[a+2];
    let fx = ay*bz - az*by, fy = az*bx - ax*bz, fz = ax*by - ay*bx;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    for (let k = 0; k < 3; k++) {
      const o = ids[f+k] * 3, w = (f+k) * 3;
      const sx = acc[o], sy = acc[o+1], sz = acc[o+2];
      const smooth = (fx*sx + fy*sy + fz*sz) >= cosMax;
      out[w]   = smooth ? sx : fx;
      out[w+1] = smooth ? sy : fy;
      out[w+2] = smooth ? sz : fz;
    }
  }
  g.setAttribute("normal", new THREE.BufferAttribute(out, 3));
}

async function loadAsset(meshUrl, textureUrl, explicitExt, normalUrl) {
  const token = ++_loadToken;
  const superseded = () => token !== _loadToken;
  clearAsset();
  const ext = _urlExt(meshUrl, explicitExt);

  let loaded;
  if (ext === "obj") {
    loaded = await new OBJLoader().loadAsync(meshUrl);
  } else if (ext === "fbx") {
    loaded = await new FBXLoader().loadAsync(meshUrl);
  } else if (ext === "glb" || ext === "gltf") {
    const gltf = await new GLTFLoader().loadAsync(meshUrl);
    loaded = gltf.scene;
  } else {
    throw new Error("Unsupported mesh type: " + ext);
  }

  // Un clic plus recent a pris la main pendant le telechargement : ce mesh
  // n'a plus lieu d'exister, et surtout il ne doit pas entrer dans la scene.
  if (superseded()) { _disposeTree(loaded); return null; }

  // Compte vertices et triangles avant fitting
  let verts = 0, tris = 0, rebuiltNormals = 0;
  loaded.traverse(obj => {
    if (obj.isMesh && obj.geometry) {
      const g = obj.geometry;
      if (g.attributes.position) verts += g.attributes.position.count;
      tris += (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
      // Sans normales, toute la surface recoit la meme quantite de lumiere :
      // le mesh s'affiche uniformement eclaire, sans relief ni auto-ombrage,
      // quelle que soit la position du soleil. Gaea ecrit bien un bloc "vn"
      // dans ses OBJ mais ses faces ne le referencent pas ("f v/vt" au lieu
      // de "f v/vt/vn"), donc le loader repart sans aucune normale.
      if (!g.attributes.normal) {
        g.computeVertexNormals();
        rebuiltNormals++;
      } else if (_hasFlatNormals(g)) {
        _computeSmoothNormals(g);
        rebuiltNormals++;
      }
    }
  });
  if (rebuiltNormals) {
    console.log(`[viewer] normales recalculees sur ${rebuiltNormals} mesh(es)`);
  }

  // Texture couleur
  if (textureUrl) {
    try {
      const tex = await _loadTexture(textureUrl);
      // _texture est global : un chargement perime l'ecraserait au nez du
      // chargement en cours.
      if (superseded()) { tex.dispose(); _disposeTree(loaded); return null; }
      _texture = tex;
      _texture.colorSpace = THREE.SRGBColorSpace;
    } catch (e) {
      console.warn("Texture load failed:", e);
      _texture = null;
    }
  }

  // Normal map : donnees, pas couleur. La passer en sRGB fausserait les
  // vecteurs et le relief partirait de travers.
  if (normalUrl) {
    try {
      const nrm = await _loadTexture(normalUrl);
      if (superseded()) { nrm.dispose(); _disposeTree(loaded); return null; }
      _normalMap = nrm;
      _normalMap.colorSpace = THREE.NoColorSpace;
      // Un EXR arrive en DataTexture (flipY = false) alors qu'un PNG arrive
      // retourne (flipY = true). Sans correction la normale tomberait a
      // l'envers de la couleur. On retourne la donnee, pas la lecture, pour
      // que le repere tangent reste coherent avec elle.
      if (_isExr(normalUrl) && !_flipTextureRows(_normalMap)) {
        // Repli si la donnee n'est pas manipulable : au moins l'alignement
        // spatial est correct, quitte a devoir inverser le vert a la main.
        _normalMap.wrapS = _normalMap.wrapT = THREE.RepeatWrapping;
        _normalMap.repeat.y = -1;
        _normalMap.offset.y = 1;
      }
    } catch (e) {
      console.warn("Normal map load failed:", e);
      _normalMap = null;
    }
  }

  // Material setup — respecte les toggles courants
  loaded.traverse(obj => {
    if (obj.isMesh) {
      obj.material = new THREE.MeshStandardMaterial({
        map: (_texture && _textureEnabled) ? _texture : null,
        envMapIntensity: _envIntensity,
        normalMap: (_normalMap && _normalEnabled) ? _normalMap : null,
        normalScale: new THREE.Vector2(
          _normalScale, _normalFlipY ? -_normalScale : _normalScale),
        color: (_texture && _textureEnabled) ? 0xffffff : _themeColors().fallback,
        roughness: MAT_ROUGHNESS,
        metalness: MAT_METALNESS,
        side: THREE.DoubleSide,
        // Piege : avec side = DoubleSide, Three.js n'ecrit que les faces
        // ARRIERE dans la shadow map (pour eviter l'acne sur les volumes
        // fermes). Un terrain est une nappe ouverte : vue du soleil elle ne
        // presente que des faces AVANT, donc elle n'ecrivait rien du tout et
        // ne projetait aucune ombre. C'est la vraie raison des ombres plates.
        shadowSide: THREE.DoubleSide,
        wireframe: _wireframe,
      });
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // Fit camera : center et scale a ~3 unites max dim
  const box = new THREE.Box3().setFromObject(loaded);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 3 / maxDim;
  loaded.scale.setScalar(scale);
  loaded.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  // Dernier controle juste avant d'entrer dans la scene.
  if (superseded()) { _disposeTree(loaded); return null; }

  // Le nouveau sujet reprend l'angle du precedent.
  loaded.rotation.y = _yaw;
  scene.add(loaded);
  currentAsset = loaded;
  _fitShadowCamera(loaded);
  // Seulement au premier asset : passer de l'un a l'autre doit garder l'angle
  // et la distance, c'est tout l'interet de les comparer. Le bouton Reset
  // reste la pour reprendre la main.
  if (!_viewFramed) {
    resetView();
    _viewFramed = true;
  }

  return {
    vertices: Math.floor(verts),
    triangles: Math.floor(tris),
    hasTexture: !!_texture,
    hasNormal: !!_normalMap,
    rebuiltNormals,
  };
}

// ── Options API ─────────────────────────────────────────────────────
function _eachMat(fn) {
  if (!currentAsset) return;
  currentAsset.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(fn);
  });
}

function setTextureEnabled(on) {
  _textureEnabled = !!on;
  _eachMat(m => {
    m.map = (_texture && _textureEnabled) ? _texture : null;
    m.color.set((_texture && _textureEnabled) ? 0xffffff : _themeColors().fallback);
    m.needsUpdate = true;
  });
}

function setNormalEnabled(on) {
  _normalEnabled = !!on;
  _eachMat(m => {
    m.normalMap = (_normalMap && _normalEnabled) ? _normalMap : null;
    m.needsUpdate = true;
  });
}

// Sens du canal vert. OpenGL et DirectX le stockent a l'envers l'un de
// l'autre et rien dans le fichier ne dit lequel : si le relief semble creuse
// la ou il devrait ressortir, c'est ce reglage.
let _normalFlipY = false;

function _applyNormalScale() {
  const y = _normalFlipY ? -_normalScale : _normalScale;
  _eachMat(m => {
    if (m.normalScale) m.normalScale.set(_normalScale, y);
    m.needsUpdate = true;
  });
}

function setNormalScale(v) {
  _normalScale = Math.max(0, Math.min(3, parseFloat(v) || 0));
  _applyNormalScale();
  return _normalScale;
}

function setNormalFlipY(on) {
  _normalFlipY = !!on;
  _applyNormalScale();
  return _normalFlipY;
}

function getNormalSettings() {
  return { scale: _normalScale, flipY: _normalFlipY, has: !!_normalMap };
}

function hasNormal() { return !!_normalMap; }

function setWireframe(on) {
  _wireframe = !!on;
  _eachMat(m => { m.wireframe = _wireframe; m.needsUpdate = true; });
  _touchShadows();
}

function setGrid(on) {
  if (_grid) _grid.visible = !!on;
}

function setAutoRotate(on) {
  _autoRotate = !!on;
}

function applyLightingPreset(name) {
  const p = LIGHTING_PRESETS[name];
  if (!p || !_lights.ambient) return;
  _presetName = name;
  if (_lights.hemi && p.hemi) {
    const [, sky, ground] = p.hemi;
    _lights.hemi.color.set(sky);
    _lights.hemi.groundColor.set(ground);
  }
  _lights.ambient.color.set(p.ambientColor ?? 0xffffff);
  _exposure = p.exposure ?? 1.0;
  if (renderer) renderer.toneMappingExposure = _exposure;
  const [[ki, kc, kp], [fi, fc, fp], [ri, rc, rp]] = [p.key, p.fill, p.rim];
  _lights.key.intensity  = ki; _lights.key.color.set(kc);
  const [kx, ky, kz] = kp;
  const kr = Math.hypot(kx, ky, kz) || 12;
  _sun.dist = kr;
  _sun.el = Math.asin(Math.max(-1, Math.min(1, ky / kr))) * 180 / Math.PI;
  _sun.az = Math.atan2(kx, kz) * 180 / Math.PI;
  if (_sun.az < 0) _sun.az += 360;
  _applySunPosition();
  _lights.fill.color.set(fc); _lights.fill.position.set(...fp);
  _lights.rim.intensity  = ri; _lights.rim.color.set(rc);  _lights.rim.position.set(...rp);
  // Intensites de ce qui eclaire les zones a l'ombre : pilotees par la force.
  _applyShadowStrength();
}

// Force des ombres. Un seul curseur pour les quatre leviers qui decident de
// la profondeur d'une ombre : ambiante, lumiere ciel/sol, appoint (fill) et
// environnement. Les regler separement demanderait de comprendre lequel fait
// quoi ; ici 0 = ombres deboucheees, 1 = reglage du preset, 2 = ombres noires.
function _applyShadowStrength() {
  const p = LIGHTING_PRESETS[_presetName];
  if (!p || !_lights.ambient) return;
  const s = _shadowStrength;
  // Courbe asymetrique : le remplissage utile est faible face au soleil, donc
  // une simple soustraction ne se voyait pas. Vers 0 on le multiplie fort pour
  // vraiment deboucher les ombres, vers 2 on l'annule pour du noir franc.
  const lift = s <= 1 ? 1 + (1 - s) * 4 : Math.max(0, 2 - s);
  _lights.ambient.intensity = p.ambient * lift;
  if (_lights.hemi && p.hemi) _lights.hemi.intensity = p.hemi[0] * lift;
  if (_lights.fill && p.fill) _lights.fill.intensity = p.fill[0] * lift;
  _envIntensity = (p.env ?? 1.0) * lift;
  _applyEnvIntensity();
  // Ombre portee : deux leviers, l'opacite ET la nettete. Une ombre floue
  // reste molle meme opaque ; c'est le bord franc qui donne le contraste.
  if (_shadowFloor) _shadowFloor.material.opacity = Math.min(1, 0.9 * s);
  if (_lights.key) {
    _lights.key.shadow.radius = Math.max(0.2, 2.8 - s * 1.4);  // douce -> dure
  }
  _touchShadows();
}

// Applique la force de l'IBL a tous les materiaux du sujet et au sol.
function _applyEnvIntensity() {
  _eachMat(m => { m.envMapIntensity = _envIntensity; });
  if (_ground) _ground.material.envMapIntensity = _envIntensity;
}

function setShadowStrength(v) {
  _shadowStrength = Math.max(0, Math.min(2, parseFloat(v) ?? 1));
  _applyShadowStrength();
  return _shadowStrength;
}

// Exposition : le reglage le plus utile au quotidien. Un terrain sombre ou
// une texture trop claire se rattrapent ici sans changer de preset.
function setExposure(v) {
  _exposure = Math.max(0.2, Math.min(2.5, parseFloat(v) || 1));
  if (renderer) renderer.toneMappingExposure = _exposure;
  return _exposure;
}

function getLighting() {
  return { preset: _presetName, exposure: _exposure, shadow: _shadowStrength,
           az: Math.round(_sun.az), el: Math.round(_sun.el) };
}

function _applySunPosition() {
  if (!_lights.key) return;
  const az = _sun.az * Math.PI / 180;
  const el = _sun.el * Math.PI / 180;
  const r = _sun.dist || 12;
  const horiz = Math.cos(el) * r;
  _lights.key.position.set(Math.sin(az) * horiz, Math.sin(el) * r, Math.cos(az) * horiz);
  _lights.key.target?.updateMatrixWorld?.();
  // Le soleil a bouge : le fond du frustum doit toujours couvrir le sujet,
  // sinon l'ombre se coupe net. On reutilise le rayon mesure au chargement,
  // remesurer traverserait tous les sommets a chaque mouvement du curseur.
  const cam = _lights.key.shadow.camera;
  cam.far = r + _shadowRadius * 2;
  cam.updateProjectionMatrix();
  _touchShadows();
}

// Direction du soleil. az : 0-360 autour du sujet. el : 5-89, plus c'est bas
// plus les ombres s'allongent et plus le relief ressort.
function setSun(az, el) {
  if (az !== undefined && az !== null) _sun.az = ((parseFloat(az) || 0) % 360 + 360) % 360;
  if (el !== undefined && el !== null) _sun.el = Math.max(5, Math.min(89, parseFloat(el) || 40));
  _applySunPosition();
  return { az: _sun.az, el: _sun.el };
}

function resetView() {
  if (!camera || !controls) return;
  camera.position.set(2.55, 1.65, 2.55);
  controls.target.set(0, 0.5, 0);
  controls.update();
  // Recadrer, c'est aussi remettre le sujet de face.
  _yaw = 0;
  if (currentAsset) {
    currentAsset.rotation.y = 0;
    _touchShadows();
  }
}

function _applyFog() {
  if (!scene) return;
  const tc = _themeColors();
  if (!_fog.on) {
    scene.fog = new THREE.Fog(tc.fog, 8, 30);
    scene.background = new THREE.Color(tc.bg);
    return;
  }
  const col = new THREE.Color(_fog.color || tc.bg);
  // 0..1 vers une densite exponentielle. A 1, le centre d'un terrain cadre a
  // 4 unites est a moitie noye et son bord lointain presque entierement.
  scene.fog = new THREE.FogExp2(col, _fog.density * 0.22);
  // Le brouillard ne touche pas le fond : un brouillard clair sous le ciel
  // sombre du theme dessinait une ligne d'horizon nette. Le ciel prend donc
  // sa couleur, et le sol s'y fond jusqu'a disparaitre.
  scene.background = col.clone();
}

function setFog(opts) {
  const o = opts || {};
  if (o.on != null) _fog.on = !!o.on;
  if (o.density != null) {
    const d = parseFloat(o.density);
    _fog.density = Math.max(0, Math.min(1, isNaN(d) ? 0 : d));
  }
  if (o.color != null) _fog.color = String(o.color || "");
  _applyFog();
  return getFog();
}

function getFog() {
  const tc = _themeColors();
  return {
    on: _fog.on, density: _fog.density, color: _fog.color,
    // Couleur reellement utilisee, pour qu'un selecteur de couleur affiche
    // la bonne teinte meme quand on suit le fond.
    effective: "#" + new THREE.Color(_fog.color || tc.bg).getHexString(),
  };
}

// Photo de presentation. La scene est rendue une fois a la taille voulue,
// avec exactement les reglages visibles (exposition, tone mapping, brouillard,
// soleil) : on agrandit le tampon de dessin du canvas le temps d'une image, sa
// taille a l'ecran ne bouge pas. Fond transparent : ciel, sol et grille
// disparaissent ; l'ombre portee peut rester pour poser le mesh dans une
// composition.
function capture({ longEdge = 0, width = 0, height = 0, transparent = false,
                   shadow = true, grid = null, ao = null } = {}) {
  if (!renderer || !scene || !camera) return null;
  const size = renderer.getSize(new THREE.Vector2());
  const cssW = size.x || 1;
  const cssH = size.y || 1;
  const prevRatio = renderer.getPixelRatio();
  const maxPx = renderer.capabilities.maxTextureSize || 8192;
  const wanted = longEdge > 0 ? longEdge : Math.max(cssW, cssH) * prevRatio;
  const ratio = Math.min(wanted, maxPx) / Math.max(cssW, cssH);

  const saved = {
    bg: scene.background,
    grid: _grid ? _grid.visible : false,
    ground: _ground ? _ground.visible : false,
    floor: _shadowFloor ? _shadowFloor.visible : false,
    clear: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    aspect: camera.aspect,
  };
  // Taille exacte demandee (1920x1080, 3840x2160...). La photo ne suit plus
  // la forme de la fenetre : une image en 3840x2018 etait recadree par Fab,
  // qui n'accepte que du 16:9, et le logo tombait dans la marge coupee. La
  // camera prend le rapport de la photo : la hauteur de champ ne change pas,
  // seule la largeur visible s'ajuste. Rien n'est rogne apres coup.
  const exact = width > 0 && height > 0;
  try {
    if (transparent) {
      scene.background = null;
      if (_grid) _grid.visible = false;
      if (_ground) _ground.visible = false;
      if (_shadowFloor) _shadowFloor.visible = !!shadow;
      renderer.setClearColor(0x000000, 0);
    }
    // Grille de la photo : choisie a part, l'ecran garde la sienne.
    if (grid !== null && _grid) _grid.visible = !!grid;
    if (exact) {
      const k = Math.min(1, maxPx / Math.max(width, height));
      const W = Math.round(width * k);
      const H = Math.round(height * k);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
    } else {
      renderer.setPixelRatio(ratio);
      renderer.setSize(cssW, cssH, false);
    }
    _touchShadows();
    // La photo reprend l'occlusion reglee dans le panneau Lumiere.
    const aoK = typeof ao === "number" ? ao : (ao === false || !_ao.on ? 0 : _ao.strength);
    if (aoK > 0 && currentAsset) _renderAO(aoK);
    else renderer.render(scene, camera);
    return {
      dataUrl: renderer.domElement.toDataURL("image/png"),
      width: renderer.domElement.width,
      height: renderer.domElement.height,
    };
  } finally {
    scene.background = saved.bg;
    if (_grid) _grid.visible = saved.grid;
    if (_ground) _ground.visible = saved.ground;
    if (_shadowFloor) _shadowFloor.visible = saved.floor;
    renderer.setClearColor(saved.clear, saved.clearAlpha);
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(cssW, cssH, false);
    _renderFrame();
  }
}

// Occlusion ambiante et rebond de lumiere. L'image normale est dessinee telle
// quelle (couleurs, fond, anticrenelage), puis l'occlusion calculee a part est
// multipliee dessus : seuls les creux et le pied du mesh s'assombrissent. Le
// rebond eclaire le dessous avec une teinte de sol, comme la lumiere qui
// remonte. En direct, l'occlusion est calculee a demi-resolution pour garder
// la previsu fluide ; la photo la calcule en pleine taille.
let _ao = { on: true, strength: 0.5 };
let _aoLive = null;

function _makeAOPass(w, h) {
  return new SSAOPass(scene, camera, w, h, 32);
}

function _drawAO(pass, strength) {
  const hemi = _lights.hemi;
  const saved = hemi ? { ground: hemi.groundColor.clone(), k: hemi.intensity } : null;
  try {
    if (hemi) {
      hemi.groundColor.lerp(new THREE.Color(0x8a7a66), 0.45 * Math.min(1, strength * 2));
      hemi.intensity = saved.k * (1 + 0.25 * Math.min(1, strength * 2));
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  } finally {
    if (hemi) {
      hemi.groundColor.copy(saved.ground);
      hemi.intensity = saved.k;
    }
  }
  if (strength <= 0) return;
  // Tailles en unites de la scene, calees sur le rayon du mesh : un terrain
  // de 2 m et un de 200 m recoivent le meme ombrage relatif.
  const R = _shadowRadius || 5;
  const k = strength * 0.6;
  const span = Math.max(1e-3, camera.far - camera.near);
  const u = pass.ssaoMaterial.uniforms;
  // La camera change (fenetre redimensionnee, format de photo) : le pass ne
  // relit sa projection qu'a sa creation, on la lui redonne a chaque image.
  u.cameraNear.value = camera.near;
  u.cameraFar.value = camera.far;
  u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
  u.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
  u.kernelRadius.value = R * k;
  u.minDistance.value = 0.00002;
  u.maxDistance.value = (R * k * 2) / span;
  // Les memes etapes que SSAOPass.render, sans son image de fond : normales
  // et profondeur, occlusion, flou, puis multiplication sur le canvas.
  pass.overrideVisibility();
  pass.renderOverride(renderer, pass.normalMaterial, pass.normalRenderTarget, 0x7777ff, 1.0);
  pass.restoreVisibility();
  pass.renderPass(renderer, pass.ssaoMaterial, pass.ssaoRenderTarget);
  pass.renderPass(renderer, pass.blurMaterial, pass.blurRenderTarget);
  pass.copyMaterial.uniforms.tDiffuse.value = pass.blurRenderTarget.texture;
  pass.copyMaterial.blending = THREE.CustomBlending;
  pass.renderPass(renderer, pass.copyMaterial, null);
  renderer.setRenderTarget(null);
}

function _disposeAO(pass) {
  if (!pass) return;
  pass.dispose();
  if (pass.noiseTexture) pass.noiseTexture.dispose();
}

// Image de la previsu : avec occlusion si elle est active et qu'un mesh est la.
function _renderFrame() {
  if (!_ao.on || _ao.strength <= 0 || !currentAsset) {
    renderer.render(scene, camera);
    return;
  }
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, Math.round(buf.x / 2));
  const h = Math.max(1, Math.round(buf.y / 2));
  if (!_aoLive) _aoLive = _makeAOPass(w, h);
  else if (_aoLive.width !== w || _aoLive.height !== h) _aoLive.setSize(w, h);
  _drawAO(_aoLive, _ao.strength);
}

function _renderAO(strength) {
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  const pass = _makeAOPass(Math.max(1, Math.round(buf.x)), Math.max(1, Math.round(buf.y)));
  try {
    _drawAO(pass, strength);
  } finally {
    _disposeAO(pass);
  }
}

function setAO(opts) {
  const o = opts || {};
  if (o.on != null) _ao.on = !!o.on;
  if (o.strength != null) {
    const s = parseFloat(o.strength);
    _ao.strength = Math.max(0, Math.min(1, isNaN(s) ? 0 : s));
  }
  return getAO();
}

function getAO() {
  return { on: _ao.on, strength: _ao.strength };
}

function getStats() {
  if (!currentAsset) return null;
  let v = 0, t = 0;
  currentAsset.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const n = g.attributes.position ? g.attributes.position.count : 0;
    v += n;
    t += (g.index ? g.index.count : n) / 3;
  });
  return { vertices: Math.floor(v), triangles: Math.floor(t) };
}

function screenshot() {
  const shot = capture();
  return shot ? shot.dataUrl : null;
}

function applyTheme() {
  if (!scene) return;
  const tc = _themeColors();
  scene.background = new THREE.Color(tc.bg);
  _applyFog();
  if (_grid) {
    scene.remove(_grid);
    _grid.geometry.dispose();
    _grid = new THREE.GridHelper(20, 40, tc.gridA, tc.gridB);
    _grid.position.y = -0.001;
    scene.add(_grid);
  }
  if (_ground) _ground.material.color.set(tc.ground);
  // Met à jour la couleur fallback si pas de texture
  _eachMat(m => {
    if (!m.map) m.color.set(tc.fallback);
  });
}

// ── Offscreen thumbnail rendering ─────────────────────────────────────
// Rend un mesh dans un canvas offscreen (256x256 par défaut) et retourne
// une dataURL PNG. Utilisé par la Library pour générer les thumbnails.
// Renderer offscreen RÉUTILISÉ entre tous les thumbs (créer/disposer un
// WebGLRenderer est très coûteux — on le garde en cache pour la session)
let _thumbRenderer = null;
let _thumbCanvas = null;

function _getThumbRenderer(w, h) {
  if (!_thumbRenderer) {
    _thumbCanvas = document.createElement("canvas");
    _thumbCanvas.width = w; _thumbCanvas.height = h;
    _thumbRenderer = new THREE.WebGLRenderer({
      canvas: _thumbCanvas, antialias: true, alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    _thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    _thumbRenderer.shadowMap.enabled = true;
    _thumbRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  if (_thumbCanvas.width !== w || _thumbCanvas.height !== h) {
    _thumbRenderer.setSize(w, h, false);
  }
  return _thumbRenderer;
}

// Une vignette fait 256 px : charger la texture 4K entiere (decodage sur le
// fil de l'interface, puis envoi de 64 Mpx a la carte graphique) coutait plus
// que le mesh lui-meme. createImageBitmap decode hors du fil de l'interface et
// rend directement une image de 512 px. Deja retournee : WebGL ignore flipY
// pour une ImageBitmap.
const THUMB_TEX = 512;
const _thumbPrefetch = new Map();  // meshUrl -> Promise<[ArrayBuffer, Texture|null]>

async function _thumbTexture(url) {
  if (!url || _isExr(url)) return null;  // EXR couleur : rendu sans texture
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, {
      resizeWidth: THUMB_TEX, resizeHeight: THUMB_TEX,
      resizeQuality: "medium", imageOrientation: "flipY",
    });
    const tex = new THREE.Texture(bmp);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch (_) {
    return null;
  }
}

function _disposeThumbTex(tex) {
  if (!tex) return;
  tex.dispose();
  if (tex.image && typeof tex.image.close === "function") tex.image.close();
}

// Le FBX se lit dans thumb_worker.js : l'interface ne gele plus, et deux
// workers laissent la vignette suivante se preparer pendant la courante.
const _THUMB_WORKERS = 2;
let _workers = null;
let _workerSeq = 0;
const _workerWaiting = new Map();  // id -> { done, worker }

function _nextWorker() {
  if (!_workers) {
    _workers = [];
    for (let i = 0; i < _THUMB_WORKERS; i++) {
      try {
        const w = new Worker(new URL("./thumb_worker.js", import.meta.url));
        w.onmessage = e => {
          const job = _workerWaiting.get(e.data.id);
          if (job) { _workerWaiting.delete(e.data.id); job.done(e.data); }
        };
        w.onerror = () => {
          for (const [id, job] of _workerWaiting) {
            if (job.worker === w) { _workerWaiting.delete(id); job.done({ fallback: true }); }
          }
        };
        _workers.push(w);
      } catch (_) { /* pas de worker : chargeur classique */ }
    }
  }
  return _workers.length ? _workers[_workerSeq % _workers.length] : null;
}

function _workerGeometry(url) {
  const worker = _nextWorker();
  if (!worker) return Promise.resolve({ fallback: true });
  const id = ++_workerSeq;
  return new Promise(done => {
    _workerWaiting.set(id, { done, worker });
    worker.postMessage({ id, url: new URL(url, location.href).href });
  });
}

// { geo } depuis le worker, sinon { object } depuis les chargeurs three.js
// (OBJ, glTF, et tout FBX que le worker ne sait pas lire).
async function _thumbMesh(meshUrl, ext) {
  if (ext === "fbx") {
    const r = await _workerGeometry(meshUrl);
    if (r.geo) return r;
    if (r.error) console.warn("[thumb] worker :", r.error);
  }
  const res = await fetch(meshUrl);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return { object: await _parseMesh(await res.arrayBuffer(), ext) };
}

function _geoToObject(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(geo.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(geo.normal, 3));
  if (geo.uv) g.setAttribute("uv", new THREE.BufferAttribute(geo.uv, 2));
  if (geo.index) g.setIndex(new THREE.BufferAttribute(geo.index, 1));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g));
  return group;
}

function _thumbInputs(meshUrl, textureUrl, ext) {
  let p = _thumbPrefetch.get(meshUrl);
  if (!p) {
    const texP = _thumbTexture(textureUrl);
    p = _thumbMesh(meshUrl, _urlExt(meshUrl, ext)).then(
      m => texP.then(t => [m, t]),
      err => texP.then(t => { _disposeThumbTex(t); throw err; }));
    p.catch(() => {});
    _thumbPrefetch.set(meshUrl, p);
  }
  return p;
}

// Mesh et texture de la vignette SUIVANTE, prepares pendant le rendu de la
// courante. Une seule d'avance.
function prefetchThumbnail({ meshUrl, textureUrl, ext }) {
  if (!meshUrl || _thumbPrefetch.has(meshUrl)) return;
  for (const [k, old] of _thumbPrefetch) {
    _thumbPrefetch.delete(k);
    old.then(([, t]) => _disposeThumbTex(t), () => {});
  }
  _thumbInputs(meshUrl, textureUrl, ext);
}

async function _parseMesh(buf, ext) {
  if (ext === "fbx") return new FBXLoader().parse(buf, "");
  if (ext === "obj") return new OBJLoader().parse(new TextDecoder().decode(buf));
  if (ext === "glb" || ext === "gltf") return (await new GLTFLoader().parseAsync(buf, "")).scene;
  throw new Error("Unsupported: " + ext);
}

async function renderThumbnail({ meshUrl, textureUrl, ext, size = 256 }) {
  const w = size, h = size;
  const tmpScene = new THREE.Scene();
  tmpScene.background = new THREE.Color(0x0a1620);

  const tmpCam = new THREE.PerspectiveCamera(38, w / h, 0.1, 200);
  // Vue 3/4 plongeante pour bien voir le volume
  tmpCam.position.set(3.0, 2.4, 3.2);
  tmpCam.lookAt(0, 0.3, 0);

  // Lighting neutre + contrasté pour faire ressortir les volumes (sans
  // dominante jaune/orange : key blanche, fill teal subtile, rim minimal)
  tmpScene.add(new THREE.AmbientLight(0xb8c8d4, 0.20));
  const key = new THREE.DirectionalLight(0xffffff, 1.65);
  key.position.set(4, 8, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0005;
  tmpScene.add(key);
  const fill = new THREE.DirectionalLight(0x6ad6e9, 0.22);
  fill.position.set(-4, 2, -2);
  tmpScene.add(fill);
  // Pas de rim orange agressif — juste un touch très subtil pour le contour
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(-1, 3, -5);
  tmpScene.add(rim);

  // Renderer offscreen RÉUTILISÉ (gros gain de perf)
  const tmpRenderer = _getThumbRenderer(w, h);
  const canvas = tmpRenderer.domElement;

  // Octets du mesh et texture reduite, deja en route si la bibliotheque les a
  // demandes pendant la vignette precedente. Un echec ne touche pas au
  // renderer : il est partage, le liberer cassait toutes les vignettes
  // suivantes de la session.
  const inputs = _thumbInputs(meshUrl, textureUrl, ext);
  _thumbPrefetch.delete(meshUrl);
  const [mesh, tex] = await inputs;
  const loaded = mesh.object || _geoToObject(mesh.geo);

  loaded.traverse(obj => {
    if (obj.isMesh) {
      // Meme cas que dans loadAsset : sans normales, tout est eclaire a plat.
      if (obj.geometry && !obj.geometry.attributes.normal) {
        obj.geometry.computeVertexNormals();
      }
      obj.material = new THREE.MeshStandardMaterial({
        map: tex,
        color: tex ? 0xffffff : 0x6ad6e9,
        roughness: MAT_ROUGHNESS,
        metalness: MAT_METALNESS,
        side: THREE.DoubleSide,
      });
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // Center + scale
  const box = new THREE.Box3().setFromObject(loaded);
  const sz = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
  const scale = 3 / maxDim;
  loaded.scale.setScalar(scale);
  loaded.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  // Plan au sol pour recevoir l'ombre — fait ressortir la silhouette
  const floorGeo = new THREE.PlaneGeometry(12, 12);
  const floorMat = new THREE.ShadowMaterial({ opacity: 0.55 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  tmpScene.add(floor);

  tmpScene.add(loaded);
  tmpRenderer.render(tmpScene, tmpCam);
  const dataUrl = canvas.toDataURL("image/png");

  // Cleanup
  loaded.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
  floor.geometry.dispose();
  floor.material.dispose();
  _disposeThumbTex(tex);
  // Pas de dispose ici : le renderer est partagé pour la session.
  // On le libère seulement à la fermeture de l'app.

  return dataUrl;
}

// ── Mini viewer instance dédiée (pour le drawer Library) ────────────
// Chaque appel à createMiniViewer() détruit l'ancienne instance et en
// crée une nouvelle. Léger, sans presets de lighting (un seul mode neutre),
// orbit controls activés, animation continue.
let _miniScene, _miniCam, _miniRenderer, _miniControls;
let _miniCurrent = null;
let _miniRafId = null;
let _miniContainer = null;
let _miniResizeObs = null;

function _miniDestroy() {
  if (_miniRafId) cancelAnimationFrame(_miniRafId);
  _miniRafId = null;
  if (_miniCurrent) {
    _miniScene.remove(_miniCurrent);
    _miniCurrent.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    _miniCurrent = null;
  }
  if (_miniRenderer) {
    _miniRenderer.dispose();
    if (_miniContainer && _miniRenderer.domElement.parentNode === _miniContainer) {
      _miniContainer.removeChild(_miniRenderer.domElement);
    }
    _miniRenderer = null;
  }
  if (_miniResizeObs) {
    _miniResizeObs.disconnect();
    _miniResizeObs = null;
  }
  _miniScene = null;
  _miniCam = null;
  _miniControls = null;
  _miniContainer = null;
}

async function createMiniViewer(container, { meshUrl, textureUrl, ext }) {
  _miniDestroy();
  _miniContainer = container;
  const w = container.clientWidth || 480;
  const h = container.clientHeight || 360;

  _miniScene = new THREE.Scene();
  _miniScene.background = new THREE.Color(0x0a1620);

  _miniCam = new THREE.PerspectiveCamera(40, w / h, 0.1, 200);
  _miniCam.position.set(3.2, 2.2, 3.2);
  _miniCam.lookAt(0, 0.3, 0);

  _miniRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  _miniRenderer.setPixelRatio(window.devicePixelRatio || 1);
  _miniRenderer.setSize(w, h);
  _miniRenderer.outputColorSpace = THREE.SRGBColorSpace;
  _miniRenderer.shadowMap.enabled = true;
  _miniRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(_miniRenderer.domElement);

  _miniControls = new OrbitControls(_miniCam, _miniRenderer.domElement);
  _miniControls.enableDamping = true;
  _miniControls.dampingFactor = 0.08;
  _miniControls.target.set(0, 0.4, 0);

  // Lighting neutre (cohérent avec les thumbs)
  _miniScene.add(new THREE.AmbientLight(0xb8c8d4, 0.22));
  const k = new THREE.DirectionalLight(0xffffff, 1.55);
  k.position.set(4, 8, 3);
  k.castShadow = true;
  k.shadow.mapSize.set(1024, 1024);
  k.shadow.camera.left = -4; k.shadow.camera.right = 4;
  k.shadow.camera.top = 4; k.shadow.camera.bottom = -4;
  k.shadow.camera.near = 0.1; k.shadow.camera.far = 20;
  k.shadow.bias = -0.0004;
  _miniScene.add(k);
  const f = new THREE.DirectionalLight(0x6ad6e9, 0.22);
  f.position.set(-4, 2, -2);
  _miniScene.add(f);
  const r = new THREE.DirectionalLight(0xffffff, 0.30);
  r.position.set(-1, 3, -5);
  _miniScene.add(r);

  // Shadow floor
  const sf = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.42 })
  );
  sf.rotation.x = -Math.PI / 2;
  sf.receiveShadow = true;
  _miniScene.add(sf);

  // Grid subtile
  const grid = new THREE.GridHelper(20, 40, 0x264a63, 0x15293a);
  grid.position.y = -0.001;
  _miniScene.add(grid);

  // Load mesh
  const e = _urlExt(meshUrl, ext);
  let loaded;
  if (e === "obj") loaded = await new OBJLoader().loadAsync(meshUrl);
  else if (e === "fbx") loaded = await new FBXLoader().loadAsync(meshUrl);
  else if (e === "glb" || e === "gltf") {
    const gltf = await new GLTFLoader().loadAsync(meshUrl);
    loaded = gltf.scene;
  } else throw new Error("Unsupported: " + e);

  // Texture
  let tex = null;
  if (textureUrl) {
    try {
      tex = await new THREE.TextureLoader().loadAsync(textureUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
    } catch (err) {}
  }

  loaded.traverse(o => {
    if (o.isMesh) {
      if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.material = new THREE.MeshStandardMaterial({
        map: tex, color: tex ? 0xffffff : 0x6ad6e9,
        roughness: MAT_ROUGHNESS, metalness: MAT_METALNESS, side: THREE.DoubleSide,
      });
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // Center + scale
  const box = new THREE.Box3().setFromObject(loaded);
  const sz = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
  const scale = 3 / maxDim;
  loaded.scale.setScalar(scale);
  loaded.position.set(-c.x * scale, -box.min.y * scale, -c.z * scale);

  _miniScene.add(loaded);
  _miniCurrent = loaded;

  // Resize observer
  _miniResizeObs = new ResizeObserver(() => {
    if (!_miniContainer || !_miniRenderer) return;
    const W = _miniContainer.clientWidth, H = _miniContainer.clientHeight;
    if (W > 0 && H > 0) {
      _miniCam.aspect = W / H;
      _miniCam.updateProjectionMatrix();
      _miniRenderer.setSize(W, H);
    }
  });
  _miniResizeObs.observe(_miniContainer);

  // Animation loop
  function tick() {
    _miniRafId = requestAnimationFrame(tick);
    if (_miniControls) _miniControls.update();
    if (_miniRenderer && _miniScene && _miniCam) {
      _miniRenderer.render(_miniScene, _miniCam);
    }
  }
  tick();

  // Count stats
  let verts = 0, tris = 0;
  loaded.traverse(o => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      if (g.attributes.position) verts += g.attributes.position.count;
      tris += (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
    }
  });

  return {
    vertices: Math.floor(verts),
    triangles: Math.floor(tris),
    hasTexture: !!tex,
  };
}

function destroyMiniViewer() { _miniDestroy(); }

window.Viewer3D = {
  init, loadAsset, clearAsset,
  setTextureEnabled, setNormalEnabled, setNormalScale, hasNormal,
  setNormalFlipY, getNormalSettings,
  setWireframe, setGrid, setAutoRotate,
  applyLightingPreset, setExposure, setSun, setShadowStrength, getLighting,
  resetView, screenshot, capture, getStats, setFog, getFog, setAO, getAO, applyTheme,
  renderThumbnail, prefetchThumbnail,
  createMiniViewer, destroyMiniViewer,
};
