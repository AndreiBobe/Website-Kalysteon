// Geometrie d'un FBX binaire pour les vignettes de la bibliotheque, lue hors
// du fil de l'interface.
//
// Le FBXLoader de three.js construit chaque sommet dans des tableaux JS : 8 s
// d'interface gelee pour un mesh realiste de 65 Mo. Ici on ne lit que ce qu'une
// vignette affiche (positions, normales, UV), en tableaux types, et la
// decompression passe par le decodeur natif du navigateur.
//
// Tout ce qui sort du cas simple (FBX ASCII, axe Z vers le haut, rotation ou
// echelle sur le modele, mapping inconnu) repond { fallback: true } : la page
// repasse alors par le FBXLoader, qui sait tout lire.
"use strict";

const ARRAYS = { f: Float32Array, d: Float64Array, l: BigInt64Array, i: Int32Array, b: Int8Array };
const SCALAR = { Y: 2, C: 1, I: 4, F: 4, D: 8, L: 8 };
// Au-dela, les normales exactes du fichier (une par coin de triangle)
// triplent la memoire : on passe en geometrie indexee, normales moyennees.
const MAX_CORNERS_EXACT = 1000000;
const TRANSFORM = /^(Lcl (Translation|Rotation|Scaling)|Geometric(Translation|Rotation|Scaling)|PreRotation|PostRotation)$/;

const utf8 = new TextDecoder();

function readProps(dv, u8, pos, n) {
  const props = [];
  for (let k = 0; k < n; k++) {
    const t = String.fromCharCode(u8[pos]);
    pos += 1;
    if (t in SCALAR) {
      let v;
      if (t === "Y") v = dv.getInt16(pos, true);
      else if (t === "C") v = u8[pos] !== 0;
      else if (t === "I") v = dv.getInt32(pos, true);
      else if (t === "F") v = dv.getFloat32(pos, true);
      else if (t === "D") v = dv.getFloat64(pos, true);
      else v = dv.getBigInt64(pos, true);
      props.push(v);
      pos += SCALAR[t];
    } else if (t in ARRAYS) {
      const len = dv.getUint32(pos, true);
      const enc = dv.getUint32(pos + 4, true);
      const clen = dv.getUint32(pos + 8, true);
      props.push({ arr: t, len, enc, off: pos + 12, clen });
      pos += 12 + clen;
    } else if (t === "S" || t === "R") {
      const len = dv.getUint32(pos, true);
      props.push(t === "S" ? utf8.decode(u8.subarray(pos + 4, pos + 4 + len)) : null);
      pos += 4 + len;
    } else {
      throw new Error("FBX: type de propriete inconnu " + t);
    }
  }
  return props;
}

function readNodes(dv, u8, start, end, v64, out) {
  const head = v64 ? 25 : 13;
  let pos = start;
  while (pos + head <= end) {
    const endOff = v64 ? Number(dv.getBigUint64(pos, true)) : dv.getUint32(pos, true);
    if (endOff === 0) break;  // enregistrement nul : fin de la liste
    const nProps = v64 ? Number(dv.getBigUint64(pos + 8, true)) : dv.getUint32(pos + 4, true);
    const propLen = v64 ? Number(dv.getBigUint64(pos + 16, true)) : dv.getUint32(pos + 8, true);
    const nameLen = u8[pos + head - 1];
    const nameAt = pos + head;
    const node = {
      name: utf8.decode(u8.subarray(nameAt, nameAt + nameLen)),
      props: readProps(dv, u8, nameAt + nameLen, nProps),
      children: [],
    };
    const kidsAt = nameAt + nameLen + propLen;
    if (kidsAt < endOff) readNodes(dv, u8, kidsAt, endOff, v64, node.children);
    out.push(node);
    pos = endOff;
  }
  return out;
}

const child = (node, name) => node.children.find(c => c.name === name);
const value = (node, name) => { const c = node && child(node, name); return c ? c.props[0] : undefined; };

async function array(u8, p) {
  let bytes = u8.subarray(p.off, p.off + p.clen);
  if (p.enc === 1) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    bytes = bytes.slice();  // copie alignee
  }
  return new ARRAYS[p.arr](bytes.buffer, 0, p.len);
}

// Couche de normales ou d'UV : a quel element de `data` correspond un coin.
async function layer(u8, el, dataName, indexName) {
  if (!el) return null;
  const map = value(el, "MappingInformationType");
  const ref = value(el, "ReferenceInformationType");
  const d = child(el, dataName);
  if (!d) return null;
  if (map !== "ByPolygonVertex" && map !== "ByVertice" && map !== "ByVertex") return undefined;
  if (ref !== "Direct" && ref !== "IndexToDirect") return undefined;
  const idx = ref === "IndexToDirect" ? child(el, indexName) : null;
  if (ref === "IndexToDirect" && !idx) return undefined;
  return {
    byCorner: map === "ByPolygonVertex",
    data: await array(u8, d.props[0]),
    index: idx ? await array(u8, idx.props[0]) : null,
  };
}

function at(lay, corner, vertex) {
  const k = lay.byCorner ? corner : vertex;
  return lay.index ? lay.index[k] : k;
}

function modelsAreNeutral(objects) {
  for (const m of objects.children) {
    if (m.name !== "Model") continue;
    const p70 = child(m, "Properties70");
    for (const p of (p70 ? p70.children : [])) {
      const key = p.props[0];
      if (!TRANSFORM.test(key)) continue;
      const neutral = key.includes("Scaling") ? 1 : 0;
      if (p.props.slice(4).some(v => Math.abs(Number(v) - neutral) > 1e-6)) return false;
    }
  }
  return true;
}

async function parse(buf) {
  const u8 = new Uint8Array(buf);
  if (utf8.decode(u8.subarray(0, 18)) !== "Kaydara FBX Binary") return null;
  const dv = new DataView(buf);
  const top = readNodes(dv, u8, 27, u8.length, dv.getUint32(23, true) >= 7500, []);

  const gs = top.find(n => n.name === "GlobalSettings");
  const p70 = gs && child(gs, "Properties70");
  const up = p70 && p70.children.find(p => p.props[0] === "UpAxis");
  if (up && Number(up.props[4]) !== 1) return null;

  const objects = top.find(n => n.name === "Objects");
  if (!objects || !modelsAreNeutral(objects)) return null;

  const parts = [];
  for (const g of objects.children) {
    if (g.name !== "Geometry" || g.props[2] !== "Mesh") continue;
    const v = child(g, "Vertices"), p = child(g, "PolygonVertexIndex");
    if (!v || !p) continue;
    const normal = await layer(u8, child(g, "LayerElementNormal"), "Normals", "NormalsIndex");
    const uv = await layer(u8, child(g, "LayerElementUV"), "UV", "UVIndex");
    if (normal === undefined || uv === undefined) return null;
    parts.push({ V: await array(u8, v.props[0]), P: await array(u8, p.props[0]), normal, uv });
  }
  if (!parts.length) return null;

  let corners = 0, tris = 0;
  for (const { P } of parts) {
    let size = 0;
    for (let c = 0; c < P.length; c++) {
      size++;
      if (P[c] < 0) { tris += Math.max(0, size - 2); size = 0; }
    }
    corners += P.length;
  }
  const exact = corners <= MAX_CORNERS_EXACT && parts.every(p => p.normal && p.normal.byCorner);
  return exact ? byCorner(parts, tris) : indexed(parts, tris);
}

// Un sommet par coin de triangle, normales du fichier telles quelles : les
// facettes d'un style Polygonal restent nettes.
function byCorner(parts, tris) {
  const position = new Float32Array(tris * 9);
  const normal = new Float32Array(tris * 9);
  const uv = parts.every(p => p.uv) ? new Float32Array(tris * 6) : null;
  let o = 0;
  for (const { V, P, normal: N, uv: U } of parts) {
    const emit = k => {
      const v = P[k] < 0 ? ~P[k] : P[k];
      position[o * 3] = V[v * 3]; position[o * 3 + 1] = V[v * 3 + 1]; position[o * 3 + 2] = V[v * 3 + 2];
      const n = at(N, k, v);
      normal[o * 3] = N.data[n * 3]; normal[o * 3 + 1] = N.data[n * 3 + 1]; normal[o * 3 + 2] = N.data[n * 3 + 2];
      if (uv) { const u = at(U, k, v); uv[o * 2] = U.data[u * 2]; uv[o * 2 + 1] = U.data[u * 2 + 1]; }
      o++;
    };
    let start = 0;
    for (let c = 0; c < P.length; c++) {
      if (P[c] >= 0) continue;
      for (let j = start + 1; j < c; j++) { emit(start); emit(j); emit(j + 1); }
      start = c + 1;
    }
  }
  return { position, normal, uv, index: null };
}

// Sommets partages : 4 fois moins de memoire pour un gros mesh. Les normales
// du fichier sont moyennees par sommet, ou calculees s'il n'en a pas.
function indexed(parts, tris) {
  let nV = 0;
  for (const p of parts) nV += p.V.length / 3;
  const position = new Float32Array(nV * 3);
  const normal = new Float32Array(nV * 3);
  const uv = parts.every(p => p.uv) ? new Float32Array(nV * 2) : null;
  const index = new Uint32Array(tris * 3);
  let base = 0, t = 0;
  for (const { V, P, normal: N, uv: U } of parts) {
    for (let i = 0; i < V.length; i++) position[base * 3 + i] = V[i];
    let start = 0;
    for (let c = 0; c < P.length; c++) {
      const v = P[c] < 0 ? ~P[c] : P[c];
      const g = base + v;
      if (uv) { const u = at(U, c, v); uv[g * 2] = U.data[u * 2]; uv[g * 2 + 1] = U.data[u * 2 + 1]; }
      if (N) {
        const n = at(N, c, v);
        normal[g * 3] += N.data[n * 3]; normal[g * 3 + 1] += N.data[n * 3 + 1]; normal[g * 3 + 2] += N.data[n * 3 + 2];
      }
      if (P[c] >= 0) continue;
      const a = base + (P[start] < 0 ? ~P[start] : P[start]);
      for (let j = start + 1; j < c; j++) {
        const b = base + (P[j] < 0 ? ~P[j] : P[j]);
        const d = base + (P[j + 1] < 0 ? ~P[j + 1] : P[j + 1]);
        index[t++] = a; index[t++] = b; index[t++] = d;
        if (!N) {
          const ux = position[b * 3] - position[a * 3], uy = position[b * 3 + 1] - position[a * 3 + 1], uz = position[b * 3 + 2] - position[a * 3 + 2];
          const wx = position[d * 3] - position[a * 3], wy = position[d * 3 + 1] - position[a * 3 + 1], wz = position[d * 3 + 2] - position[a * 3 + 2];
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          for (const q of [a, b, d]) { normal[q * 3] += nx; normal[q * 3 + 1] += ny; normal[q * 3 + 2] += nz; }
        }
      }
      start = c + 1;
    }
    base += V.length / 3;
  }
  for (let i = 0; i < normal.length; i += 3) {
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    normal[i] /= l; normal[i + 1] /= l; normal[i + 2] /= l;
  }
  return { position, normal, uv, index };
}

self.onmessage = async e => {
  const { id, url } = e.data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const geo = await parse(await r.arrayBuffer());
    if (!geo) { self.postMessage({ id, fallback: true }); return; }
    const transfer = [geo.position.buffer, geo.normal.buffer];
    if (geo.uv) transfer.push(geo.uv.buffer);
    if (geo.index) transfer.push(geo.index.buffer);
    self.postMessage({ id, geo }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
