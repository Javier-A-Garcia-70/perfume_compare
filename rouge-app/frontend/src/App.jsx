import { useState, useEffect, useRef } from "react";
import { Search, Menu, X, Heart, Camera, ChevronRight, ArrowLeft, Sparkles, ExternalLink, LogIn, LogOut } from "lucide-react";
import { useAuth } from "./hooks/useAuth";
import { useFavoritos } from "./hooks/useFavoritos";

const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL      || "";
const SUPABASE_KEY    = import.meta.env.VITE_SUPABASE_ANON_KEY  || "";

// Backend FastAPI — la key nunca llega al browser
const BACKEND_URL       = import.meta.env.VITE_BACKEND_URL || "http://localhost:8001";
const ANTHROPIC_URL     = `${BACKEND_URL}/api/claude`;
const ANTHROPIC_HEADERS = { "Content-Type": "application/json" };

const TIENDAS = {
  rouge:      { label: "Rouge",      color: "#c9393e", bg: "#2a0a0a" },
  juleriaque: { label: "Juleriaque", color: "#1a5fa8", bg: "#0a1a2a" },
};

const MOCK = [
  { id:1, marca:"Versace", nombre_base:"Blue Jeans", tipo:"Eau de Toilette", tamaño:"75 ml", genero:"Masculino", imagen:"https://rougeb2car.vteximg.com.br/arquivos/ids/219961/8018365260757.jpg", descripcion:"Notas cítricas, bergamota, lavanda, vainilla, sándalo.", rouge_precio:79990, rouge_precio_lista:159980, rouge_descuento:50, rouge_link:"https://www.perfumeriasrouge.com", juleriaque_precio:85000, juleriaque_precio_lista:85000, juleriaque_descuento:0, juleriaque_link:"https://www.juleriaque.com.ar", en_rouge:true, en_juleriaque:true, tiene_oferta:true, precio_min:79990 },
  { id:2, marca:"Dior", nombre_base:"Sauvage", tipo:"Eau de Toilette", tamaño:"100 ml", genero:"Masculino", imagen:"https://rougeb2car.vteximg.com.br/arquivos/ids/219961/8018365260757.jpg", descripcion:"Bergamota, pimienta, lavanda, ambroxan.", rouge_precio:224000, rouge_precio_lista:320000, rouge_descuento:30, rouge_link:"https://www.perfumeriasrouge.com", juleriaque_precio:210000, juleriaque_precio_lista:300000, juleriaque_descuento:30, juleriaque_link:"https://www.juleriaque.com.ar", en_rouge:true, en_juleriaque:true, tiene_oferta:true, precio_min:210000 },
  { id:3, marca:"Dior", nombre_base:"Sauvage", tipo:"Eau de Toilette", tamaño:"200 ml", genero:"Masculino", imagen:"https://rougeb2car.vteximg.com.br/arquivos/ids/219961/8018365260757.jpg", descripcion:"Bergamota, pimienta, lavanda, ambroxan.", rouge_precio:320000, rouge_precio_lista:450000, rouge_descuento:29, rouge_link:"https://www.perfumeriasrouge.com", juleriaque_precio:null, juleriaque_precio_lista:null, juleriaque_descuento:0, juleriaque_link:null, en_rouge:true, en_juleriaque:false, tiene_oferta:true, precio_min:320000 },
  { id:4, marca:"Chanel", nombre_base:"Coco Mademoiselle", tipo:"Eau de Parfum", tamaño:"100 ml", genero:"Femenino", imagen:"https://rougeb2car.vteximg.com.br/arquivos/ids/219961/8018365260757.jpg", descripcion:"Naranja, rosa, jazmín, pachulí.", rouge_precio:280000, rouge_precio_lista:280000, rouge_descuento:0, rouge_link:"https://www.perfumeriasrouge.com", juleriaque_precio:null, juleriaque_precio_lista:null, juleriaque_descuento:0, juleriaque_link:null, en_rouge:true, en_juleriaque:false, tiene_oferta:false, precio_min:280000 },
];

// ─── HELPERS ────────────────────────────────────────────────────
async function sbFetch(path) {
  if (!SUPABASE_URL) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return r.json();
}

function agruparVariantes(data) {
  const grupos = {};
  data.forEach(p => {
    const clave = `${p.marca}||${p.nombre_base}||${p.tipo}`;
    if (!grupos[clave]) {
      grupos[clave] = { ...p, variantes: [p] };
    } else {
      grupos[clave].variantes.push(p);
      // Usar imagen del primero que tenga
      if (!grupos[clave].imagen && p.imagen) grupos[clave].imagen = p.imagen;
      // Flags acumulados
      if (p.en_rouge)      grupos[clave].en_rouge = true;
      if (p.en_juleriaque) grupos[clave].en_juleriaque = true;
      if (p.tiene_oferta)  grupos[clave].tiene_oferta = true;
      // Precio mínimo global
      const pm = p.precio_min || Math.min(...[p.rouge_precio, p.juleriaque_precio].filter(Boolean));
      const gm = grupos[clave].precio_min || Infinity;
      if (pm < gm) grupos[clave].precio_min = pm;
      // Máximo descuento
      const md = Math.max(p.rouge_descuento || 0, p.juleriaque_descuento || 0);
      const gd = Math.max(grupos[clave].rouge_descuento || 0, grupos[clave].juleriaque_descuento || 0);
      if (md > gd) {
        grupos[clave].rouge_descuento      = p.rouge_descuento;
        grupos[clave].juleriaque_descuento = p.juleriaque_descuento;
      }
    }
  });
  return Object.values(grupos);
}

async function buscarConIA(query, productos) {
  const q = query.toLowerCase();
  const palabras = q.split(/\s+/).filter(Boolean);

  // Texto: todas las palabras de la query deben aparecer en marca+nombre combinados
  const textMatches = new Set(
    productos.flatMap(p => (p.variantes || [p]))
      .filter(v => {
        const haystack = `${v.marca || ""} ${v.nombre_base || ""}`.toLowerCase();
        return palabras.every(w => haystack.includes(w));
      })
      .map(v => v.id)
  );

  // Detectar género en la query para usarlo como filtro SQL
  let filtroGenero = "";
  if (/\b(masculin\w*|hombre|para hombre|caballero)\b/i.test(query)) filtroGenero = "Masculino";
  else if (/\b(femenin\w*|mujer|para mujer|dama)\b/i.test(query))     filtroGenero = "Femenino";

  try {
    const res = await fetch(`${BACKEND_URL}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 100, filtro_genero: filtroGenero }),
    });
    const data = await res.json();
    const porSimilitud = Object.fromEntries((data.results || []).map(r => [r.id, r.similarity]));

    // Log: qué modo se usa y top resultados vectoriales
    const idAProducto = Object.fromEntries(
      productos.flatMap(p => (p.variantes || [p])).map(v => [v.id, `${v.marca} ${v.nombre_base}`])
    );
    console.group(`[búsqueda] "${query}"`);
    console.log("modo:", textMatches.size > 0 ? `texto exacto (${textMatches.size} matches)` : "vectorial semántico");
    if (filtroGenero) console.log("filtro género:", filtroGenero);
    if (textMatches.size === 0) {
      console.log("top vectorial:");
      (data.results || []).slice(0, 10).forEach(r =>
        console.log(`  ${r.similarity?.toFixed(3)}  ${idAProducto[r.id] || r.id}`)
      );
    }
    console.groupEnd();

    // Si hay matches de texto, usamos solo esos (búsqueda por nombre/marca)
    // Si no hay texto, usamos los vectoriales (búsqueda semántica)
    const todosIds = textMatches.size > 0
      ? textMatches
      : new Set((data.results || []).map(r => r.id));

    return productos
      .filter(p => (p.variantes || [p]).some(v => todosIds.has(v.id)))
      .sort((a, b) => {
        const vars = vs => (vs.variantes || [vs]).map(v => v.id);
        const aTexto = vars(a).some(id => textMatches.has(id)) ? 1 : 0;
        const bTexto = vars(b).some(id => textMatches.has(id)) ? 1 : 0;
        if (bTexto !== aTexto) return bTexto - aTexto;
        const simA = Math.max(...vars(a).map(id => porSimilitud[id] || 0));
        const simB = Math.max(...vars(b).map(id => porSimilitud[id] || 0));
        return simB - simA;
      });
  } catch {
    // Fallback solo texto
    return productos.filter(p =>
      (p.variantes || [p]).some(v =>
        v.nombre_base?.toLowerCase().includes(q) ||
        v.marca?.toLowerCase().includes(q) ||
        (v.descripcion||"").toLowerCase().includes(q)
      )
    );
  }
}

async function buscarPorImagen(base64, productos) {
  const prompt = `Identificá el perfume en esta imagen. Devolvé SOLO un JSON con estos tres campos:
{"marca": "nombre de la marca", "nombre": "nombre base del perfume SIN el tipo", "tipo": "el tipo exacto que figura en el frasco (Eau de Parfum, Parfum, Elixir, etc.) o null si no se ve"}
Ejemplo: {"marca": "Dior", "nombre": "Sauvage", "tipo": "Eau de Toilette"}
Sin texto extra.`;
  let media_type = "image/jpeg";
  if (base64.startsWith("iVBORw"))      media_type = "image/png";
  else if (base64.startsWith("UklGR"))  media_type = "image/webp";
  else if (base64.startsWith("R0lGOD")) media_type = "image/gif";
  try {
    const res = await fetch(ANTHROPIC_URL, { method:"POST", headers:ANTHROPIC_HEADERS, body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:120, messages:[{role:"user", content:[{type:"image",source:{type:"base64",media_type,data:base64}},{type:"text",text:prompt}]}] }) });
    const data = await res.json();
    const info = JSON.parse(data.content?.[0]?.text?.replace(/```json|```/g,"").trim() || "{}");
    const marca  = (info.marca  || "").toLowerCase();
    const nombre = (info.nombre || "").toLowerCase();
    const tipo   = (info.tipo   || "").toLowerCase();
    console.log("[imagen] Claude identificó:", info);
    if (!marca && !nombre) return { productos: [], titulo: "búsqueda por imagen" };

    const palabras = nombre.split(/\s+/).filter(Boolean);
    const nombreMostrado = `${info.marca} ${info.nombre}${info.tipo ? ` ${info.tipo}` : ""}`;

    const exactos = productos
      .filter(p => {
        const pm = p.marca?.toLowerCase() || "";
        const pn = p.nombre_base?.toLowerCase() || "";
        const pnLimpio = pn.replace(marca, "").trim();
        const marcaOk  = pm.includes(marca);
        const nombreOk = pnLimpio.includes(nombre) || nombre.includes(pnLimpio)
                      || pn.includes(nombre)        || nombre.includes(pn);
        return marcaOk && nombreOk;
      })
      .sort((a, b) => {
        const tipoA = tipo && (a.tipo?.toLowerCase() || "").includes(tipo) ? 1 : 0;
        const tipoB = tipo && (b.tipo?.toLowerCase() || "").includes(tipo) ? 1 : 0;
        if (tipoB !== tipoA) return tipoB - tipoA;
        const score = n => palabras.filter(w => n.includes(w)).length;
        return score(b.nombre_base?.toLowerCase() || "") - score(a.nombre_base?.toLowerCase() || "");
      })
      .slice(0, 6);

    if (exactos.length > 0)
      return { productos: exactos, titulo: nombreMostrado };

    // Fallback: misma marca
    const mismaMarca = productos
      .filter(p => p.marca?.toLowerCase().includes(marca))
      .slice(0, 8);

    const tituloFallback = mismaMarca.length > 0
      ? `"${nombreMostrado}" no encontrado — quizás te interese:`
      : `"${nombreMostrado}" no encontrado`;

    return { productos: mismaMarca, titulo: tituloFallback };
  } catch (e) {
    console.error("[imagen] error:", e);
    return { productos: [], titulo: "No se pudo identificar la imagen, reintentá" };
  }
}

// ─── OFERTA DOTS ────────────────────────────────────────────────
function OfertaDots({ perfume }) {
  if (!perfume.rouge_descuento && !perfume.juleriaque_descuento) return null;
  return (
    <div style={{ display:"flex", gap:"3px", position:"absolute", top:"8px", left:"8px", zIndex:2 }}>
      {perfume.rouge_descuento > 0 && <div title={`Rouge -${perfume.rouge_descuento}%`} style={{ width:"8px", height:"8px", borderRadius:"50%", background:TIENDAS.rouge.color }} />}
      {perfume.juleriaque_descuento > 0 && <div title={`Juleriaque -${perfume.juleriaque_descuento}%`} style={{ width:"8px", height:"8px", borderRadius:"50%", background:TIENDAS.juleriaque.color }} />}
    </div>
  );
}

// ─── PRECIO BADGE ───────────────────────────────────────────────
function PrecioBadge({ tienda, precio, precioLista, descuento, link }) {
  const t = TIENDAS[tienda];
  if (!precio) return null;
  return (
    <a href={link} target="_blank" rel="noopener noreferrer"
      style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderRadius:"10px", background:t.bg, border:`1px solid ${t.color}22`, textDecoration:"none", transition:"border-color 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = t.color}
      onMouseLeave={e => e.currentTarget.style.borderColor = `${t.color}22`}>
      <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
        <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:t.color }} />
        <span style={{ color:"#aaa", fontSize:"0.78rem", fontWeight:600 }}>{t.label}</span>
        {descuento > 0 && <span style={{ background:t.color, color:"#fff", fontSize:"0.65rem", fontWeight:800, padding:"1px 6px", borderRadius:"10px" }}>-{descuento}%</span>}
      </div>
      <div style={{ display:"flex", alignItems:"baseline", gap:"6px" }}>
        <span style={{ color:"#fff", fontWeight:700, fontSize:"0.95rem" }}>${precio.toLocaleString("es-AR")}</span>
        {precioLista > precio && <span style={{ color:"#444", textDecoration:"line-through", fontSize:"0.72rem" }}>${precioLista.toLocaleString("es-AR")}</span>}
        <ExternalLink size={11} color={t.color} />
      </div>
    </a>
  );
}

// ─── SEGUIMIENTO MODAL ──────────────────────────────────────────
function SeguimientoModal({ perfume, onConfirm, onClose }) {
  const [semanas, setSemanas] = useState(1);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(6px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#0f0f0f", border:"1px solid #c9a84c", borderRadius:"16px", padding:"32px", maxWidth:"340px", width:"90%", textAlign:"center" }}>
        <div style={{ fontSize:"1.8rem", marginBottom:"8px" }}>🔔</div>
        <h3 style={{ color:"#c9a84c", fontFamily:"'Playfair Display',serif", fontSize:"1rem", marginBottom:"8px" }}>Seguir este perfume</h3>
        <p style={{ color:"#666", fontSize:"0.8rem", marginBottom:"20px" }}>{perfume.marca} — {perfume.nombre_base}</p>
        <p style={{ color:"#aaa", fontSize:"0.82rem", marginBottom:"14px" }}>Recibís alerta si cambia el precio en alguna tienda</p>
        <div style={{ display:"flex", gap:"10px", justifyContent:"center", marginBottom:"20px" }}>
          {[1,2].map(s => (
            <button key={s} onClick={() => setSemanas(s)}
              style={{ padding:"9px 22px", borderRadius:"8px", border:`1.5px solid ${semanas===s?"#c9a84c":"#2a2a2a"}`, background:semanas===s?"#c9a84c":"transparent", color:semanas===s?"#000":"#888", fontWeight:600, cursor:"pointer", fontSize:"0.82rem" }}>
              {s} semana{s>1?"s":""}
            </button>
          ))}
        </div>
        <button onClick={() => onConfirm(semanas)} style={{ width:"100%", padding:"12px", background:"#c9a84c", color:"#000", border:"none", borderRadius:"8px", fontWeight:700, cursor:"pointer", marginBottom:"8px" }}>Activar seguimiento</button>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#444", cursor:"pointer", fontSize:"0.8rem" }}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── PRODUCT DETAIL ─────────────────────────────────────────────
function ProductDetail({ perfume, favoritos, onToggleFav, onBack }) {
  const esFav = favoritos.has(perfume.id);
  const [showModal, setShowModal] = useState(false);
  const [varianteActiva, setVarianteActiva] = useState(perfume.variantes?.[0] || perfume);
  const variantes = perfume.variantes || [perfume];

  const precioMin = Math.min(...[varianteActiva.rouge_precio, varianteActiva.juleriaque_precio].filter(p => p != null && p > 0));
  const precioMax = Math.max(...[varianteActiva.rouge_precio, varianteActiva.juleriaque_precio].filter(p => p != null && p > 0));
  const hayDif = varianteActiva.en_rouge && varianteActiva.en_juleriaque && precioMin !== precioMax && isFinite(precioMin) && isFinite(precioMax);
  const tiendaMasBarata = varianteActiva.rouge_precio === precioMin ? "Rouge" : "Juleriaque";

  return (
    <div style={{ minHeight:"100vh", background:"#080808" }}>
      <button onClick={onBack} style={{ position:"fixed", top:"72px", left:"16px", zIndex:10, background:"rgba(0,0,0,0.7)", border:"1px solid #222", borderRadius:"50%", width:"40px", height:"40px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
        <ArrowLeft size={18} color="#fff" />
      </button>

      <div style={{ maxWidth:"480px", margin:"0 auto", padding:"80px 16px 48px" }}>
        {/* Imagen */}
        <div style={{ background:"#111", borderRadius:"20px", aspectRatio:"1", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:"24px", position:"relative" }}>
          <OfertaDots perfume={varianteActiva} />
          <img src={perfume.imagen || varianteActiva.imagen} alt={perfume.nombre_base}
            style={{ width:"65%", height:"65%", objectFit:"contain" }}
            onError={e => e.target.style.display="none"} />
          <button onClick={() => { if(!esFav) setShowModal(true); else onToggleFav(perfume, null); }}
            style={{ position:"absolute", top:"14px", right:"14px", background:"rgba(0,0,0,0.5)", border:"none", borderRadius:"50%", width:"42px", height:"42px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
            <Heart size={19} fill={esFav?"#e63329":"none"} color={esFav?"#e63329":"#fff"} />
          </button>
        </div>

        {/* Info */}
        <p style={{ color:"#c9a84c", fontSize:"0.72rem", fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"4px" }}>{perfume.marca}</p>
        <h1 style={{ color:"#fff", fontFamily:"'Playfair Display',serif", fontSize:"1.5rem", lineHeight:1.2, marginBottom:"8px" }}>{perfume.nombre_base}</h1>
        <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"20px" }}>
          {[perfume.tipo, perfume.genero].map(t => (
            <span key={t} style={{ background:"#141414", color:"#666", fontSize:"0.72rem", padding:"3px 10px", borderRadius:"20px", border:"1px solid #1e1e1e" }}>{t}</span>
          ))}
        </div>

        {/* Selector de tamaño */}
        {variantes.length > 1 && (
          <div style={{ marginBottom:"20px" }}>
            <p style={{ color:"#444", fontSize:"0.72rem", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"10px" }}>Tamaño</p>
            <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
              {variantes.map(v => (
                <button key={v.id} onClick={() => setVarianteActiva(v)}
                  style={{ padding:"8px 16px", borderRadius:"8px", border:`1.5px solid ${varianteActiva.id===v.id?"#c9a84c":"#222"}`, background:varianteActiva.id===v.id?"rgba(201,168,76,0.08)":"transparent", color:varianteActiva.id===v.id?"#c9a84c":"#666", cursor:"pointer", fontSize:"0.82rem", fontWeight:varianteActiva.id===v.id?700:400, transition:"all 0.15s" }}>
                  {v.tamaño}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Precios por tienda */}
        <div style={{ marginBottom:"20px" }}>
          <p style={{ color:"#444", fontSize:"0.72rem", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"10px" }}>Precio por tienda</p>
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            <PrecioBadge tienda="rouge"      precio={varianteActiva.rouge_precio}      precioLista={varianteActiva.rouge_precio_lista}      descuento={varianteActiva.rouge_descuento}      link={varianteActiva.rouge_link} />
            <PrecioBadge tienda="juleriaque" precio={varianteActiva.juleriaque_precio} precioLista={varianteActiva.juleriaque_precio_lista} descuento={varianteActiva.juleriaque_descuento} link={varianteActiva.juleriaque_link} />
          </div>
          {hayDif && (
            <p style={{ color:"#4caf7d", fontSize:"0.78rem", marginTop:"10px", textAlign:"center" }}>
              Ahorrás ${(precioMax - precioMin).toLocaleString("es-AR")} comprando en {tiendaMasBarata}
            </p>
          )}
        </div>

        {/* Notas olfativas */}
        {perfume.descripcion && (
          <div style={{ background:"#0d0d0d", borderRadius:"14px", padding:"18px", marginBottom:"20px", border:"1px solid #1a1a1a" }}>
            <p style={{ color:"#c9a84c", fontSize:"0.7rem", fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"10px" }}>Notas olfativas</p>
            <p style={{ color:"#666", fontSize:"0.83rem", lineHeight:1.7 }}>{perfume.descripcion}</p>
          </div>
        )}

        <button onClick={() => { if(!esFav) setShowModal(true); else onToggleFav(perfume, null); }}
          style={{ width:"100%", padding:"14px", background:"transparent", border:`1.5px solid ${esFav?"#e63329":"#2a2a2a"}`, borderRadius:"12px", color:esFav?"#e63329":"#555", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px", fontSize:"0.85rem", fontWeight:600 }}>
          <Heart size={15} fill={esFav?"#e63329":"none"} />
          {esFav ? "Seguimiento activo" : "Seguir este perfume"}
        </button>
      </div>

      {showModal && <SeguimientoModal perfume={perfume} onConfirm={(s) => { onToggleFav(perfume, s); setShowModal(false); }} onClose={() => setShowModal(false)} />}
    </div>
  );
}

// ─── PRODUCT CARD ───────────────────────────────────────────────
function ProductCard({ perfume, favoritos, onToggleFav, onClick }) {
  const esFav = favoritos.has(perfume.id);
  const [showModal, setShowModal] = useState(false);
  const precioMin = perfume.precio_min || Math.min(...[perfume.rouge_precio, perfume.juleriaque_precio].filter(p => p != null && p > 0)) || 0;
  const cantVariantes = perfume.variantes?.length || 1;

  return (
    <>
      <div onClick={onClick} style={{ background:"#0f0f0f", border:"1px solid #1a1a1a", borderRadius:"14px", overflow:"hidden", cursor:"pointer", transition:"transform 0.2s, border-color 0.2s" }}
        onMouseEnter={e => { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.borderColor="#2a2a2a"; }}
        onMouseLeave={e => { e.currentTarget.style.transform=""; e.currentTarget.style.borderColor="#1a1a1a"; }}>

        <div style={{ background:"#141414", aspectRatio:"1", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
          <OfertaDots perfume={perfume} />
          <button onClick={e => { e.stopPropagation(); if(!esFav) setShowModal(true); else onToggleFav(perfume, null); }}
            style={{ position:"absolute", top:"8px", right:"8px", background:"rgba(0,0,0,0.5)", border:"none", borderRadius:"50%", width:"30px", height:"30px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", zIndex:2 }}>
            <Heart size={13} fill={esFav?"#e63329":"none"} color={esFav?"#e63329":"#fff"} />
          </button>
          {cantVariantes > 1 && (
            <div style={{ position:"absolute", bottom:"8px", right:"8px", background:"rgba(0,0,0,0.6)", borderRadius:"10px", padding:"2px 7px", fontSize:"0.65rem", color:"#888" }}>
              {cantVariantes} tamaños
            </div>
          )}
          <div style={{ position:"absolute", bottom:"6px", left:"6px", display:"flex", gap:"3px" }}>
            {perfume.en_rouge      && <div style={{ width:"6px", height:"6px", borderRadius:"50%", background:TIENDAS.rouge.color }} />}
            {perfume.en_juleriaque && <div style={{ width:"6px", height:"6px", borderRadius:"50%", background:TIENDAS.juleriaque.color }} />}
          </div>
          <img src={perfume.imagen} alt={perfume.nombre_base}
            style={{ width:"68%", height:"68%", objectFit:"contain" }}
            onError={e => e.target.style.display="none"} />
        </div>

        <div style={{ padding:"12px" }}>
          <p style={{ color:"#c9a84c", fontSize:"0.65rem", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"3px" }}>{perfume.marca}</p>
          <p style={{ color:"#ddd", fontSize:"0.82rem", lineHeight:1.3, marginBottom:"3px", fontFamily:"'Playfair Display',serif" }}>{perfume.nombre_base}</p>
          <p style={{ color:"#444", fontSize:"0.7rem", marginBottom:"10px" }}>{perfume.tipo}</p>
          {precioMin > 0 && (
            <p style={{ color:"#fff", fontWeight:700, fontSize:"0.9rem" }}>desde ${precioMin.toLocaleString("es-AR")}</p>
          )}
        </div>
      </div>

      {showModal && <SeguimientoModal perfume={perfume} onConfirm={(s) => { onToggleFav(perfume, s); setShowModal(false); }} onClose={() => setShowModal(false)} />}
    </>
  );
}

// ─── BUSCADOR ───────────────────────────────────────────────────
function Buscador({ productos, onResultados, onCerrar }) {
  const [query, setQuery]       = useState("");
  const [buscando, setBuscando] = useState(false);
  const fileRef = useRef();
  const [historial, setHistorial] = useState(() => {
    try { return JSON.parse(localStorage.getItem("busquedas_recientes") || "[]"); } catch { return []; }
  });

  const buscar = async () => {
    if (!query.trim()) return;
    setBuscando(true);
    const res = await buscarConIA(query, productos);
    onResultados(res, query);
    setBuscando(false);
  };

  const handleFoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setBuscando(true);
      const base64 = ev.target.result.split(",")[1];
      const { productos: res, titulo } = await buscarPorImagen(base64, productos);
      onResultados(res, titulo);
      setBuscando(false);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:200, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", paddingTop:"90px", backdropFilter:"blur(10px)" }}>
      <div style={{ width:"100%", maxWidth:"480px", padding:"0 16px" }}>
        <div style={{ display:"flex", gap:"8px", marginBottom:"12px" }}>
          <div style={{ flex:1, position:"relative" }}>
            <Search size={15} style={{ position:"absolute", left:"12px", top:"50%", transform:"translateY(-50%)", color:"#444" }} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key==="Enter" && buscar()}
              placeholder="Versace, cítricos, regalo mujer..."
              style={{ width:"100%", padding:"13px 12px 13px 38px", background:"#111", border:"1px solid #222", borderRadius:"12px", color:"#fff", fontSize:"0.92rem", outline:"none", fontFamily:"inherit" }} />
          </div>
          <button onClick={onCerrar} style={{ background:"#111", border:"1px solid #222", borderRadius:"12px", padding:"0 14px", color:"#555", cursor:"pointer" }}><X size={18} /></button>
        </div>
        <div style={{ display:"flex", gap:"8px", marginBottom:"20px" }}>
          <button onClick={buscar} disabled={buscando || !query.trim()}
            style={{ flex:1, padding:"11px", background:"#c9a84c", color:"#000", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer", opacity:(!query.trim()||buscando)?0.5:1 }}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>
          <button onClick={() => fileRef.current.click()}
            style={{ padding:"11px 14px", background:"#111", border:"1px solid #222", borderRadius:"10px", color:"#777", cursor:"pointer", display:"flex", alignItems:"center", gap:"5px", fontSize:"0.8rem" }}>
            <Camera size={15} /> Foto
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleFoto} />
        </div>
        {!query && historial.length > 0 && (
          <div style={{ marginTop:"8px" }}>
            <p style={{ color:"#2a2a2a", fontSize:"0.65rem", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"8px" }}>Búsquedas recientes</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
              {historial.map(h => (
                <button key={h} onClick={() => setQuery(h)}
                  style={{ padding:"5px 12px", background:"#111", border:"1px solid #1e1e1e", borderRadius:"20px", color:"#555", cursor:"pointer", fontSize:"0.78rem" }}>
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}
        {!query && historial.length === 0 && (
          <p style={{ color:"#2a2a2a", fontSize:"0.75rem", textAlign:"center" }}>Buscá por marca, notas olfativas, ocasión o subí una foto</p>
        )}
      </div>
    </div>
  );
}

// ─── NAVBAR ─────────────────────────────────────────────────────
function Navbar({ menuAbierto, setMenuAbierto, setBuscadorOpen, setVista, setGenero, setQuery, user, loginGoogle, logout, favCount }) {
  return (
    <>
      <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, background:"rgba(8,8,8,0.94)", backdropFilter:"blur(12px)", borderBottom:"1px solid #141414", height:"60px", padding:"0 16px", display:"flex", alignItems:"center" }}>
        {/* Izquierda — mismo ancho que la derecha para centrar el título */}
        <div style={{ flex:"0 0 auto" }}>
          <button onClick={() => setMenuAbierto(m => !m)} style={{ background:"none", border:"none", cursor:"pointer", padding:"8px", color:"#666" }}>
            {menuAbierto ? <X size={21} color="#c9a84c" /> : <Menu size={21} />}
          </button>
        </div>
        {/* Centro */}
        <div style={{ flex:1, textAlign:"center", pointerEvents:"none" }}>
          <span style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.05rem", color:"#fff", letterSpacing:"0.06em" }}>
            perfume<span style={{ color:"#c9a84c" }}>compare</span>
          </span>
        </div>
        {/* Derecha */}
        <div style={{ flex:"0 0 auto", display:"flex", alignItems:"center", gap:"4px" }}>
          <button onClick={() => { setVista("favoritos"); setGenero(null); setQuery(null); }} title="Mis favoritos"
            style={{ background:"none", border:"none", cursor:"pointer", padding:"8px", color: favCount > 0 ? "#e63329" : "#666" }}>
            <Heart size={20} fill={favCount > 0 ? "#e63329" : "none"} />
          </button>
          <button onClick={() => setBuscadorOpen(true)} style={{ background:"none", border:"none", cursor:"pointer", padding:"8px", color:"#666" }}>
            <Search size={20} />
          </button>
          <button onClick={user ? logout : loginGoogle} title={user ? "Cerrar sesión" : "Iniciar sesión con Google"}
            style={{ background:"none", border:"none", cursor:"pointer", padding:"8px", color: user ? "#c9a84c" : "#444" }}>
            {user ? <LogOut size={18} /> : <LogIn size={18} />}
          </button>
        </div>
      </nav>

      <div style={{ position:"fixed", top:"60px", left:0, bottom:0, width:"220px", background:"#080808", borderRight:"1px solid #141414", zIndex:99, transform:menuAbierto?"translateX(0)":"translateX(-100%)", transition:"transform 0.22s ease", overflowY:"auto" }}>
        <div style={{ padding:"24px 0" }}>
          {user && (
            <div style={{ padding:"0 20px 16px", borderBottom:"1px solid #141414", marginBottom:"12px" }}>
              <p style={{ color:"#555", fontSize:"0.72rem", marginBottom:"2px" }}>Sesión iniciada</p>
              <p style={{ color:"#c9a84c", fontSize:"0.78rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email}</p>
            </div>
          )}
          <p style={{ color:"#2a2a2a", fontSize:"0.65rem", letterSpacing:"0.12em", textTransform:"uppercase", padding:"0 20px 12px" }}>Secciones</p>
          <button onClick={() => { setVista("ofertas"); setGenero(null); setQuery(null); setMenuAbierto(false); }}
            style={{ width:"100%", padding:"13px 20px", background:"none", border:"none", color:"#ccc", textAlign:"left", cursor:"pointer", fontSize:"0.88rem", fontFamily:"'Playfair Display',serif", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            Ofertas <ChevronRight size={13} color="#2a2a2a" />
          </button>
          <button onClick={() => { setVista("favoritos"); setGenero(null); setQuery(null); setMenuAbierto(false); }}
            style={{ width:"100%", padding:"13px 20px", background:"none", border:"none", color:"#ccc", textAlign:"left", cursor:"pointer", fontSize:"0.88rem", fontFamily:"'Playfair Display',serif", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            Mis favoritos <Heart size={13} color="#c9393e" />
          </button>
          <div style={{ height:"1px", background:"#141414", margin:"12px 0" }} />
          <p style={{ color:"#2a2a2a", fontSize:"0.65rem", letterSpacing:"0.12em", textTransform:"uppercase", padding:"0 20px 12px" }}>Catálogo</p>
          {[null,"Femenino","Masculino","Unisex"].map(g => (
            <button key={g||"todos"} onClick={() => { setVista("catalogo"); setGenero(g); setQuery(null); setMenuAbierto(false); }}
              style={{ width:"100%", padding:"11px 28px", background:"none", border:"none", color:"#777", textAlign:"left", cursor:"pointer", fontSize:"0.84rem" }}>
              {g||"Todos"}
            </button>
          ))}
          <div style={{ height:"1px", background:"#141414", margin:"12px 0" }} />
          <p style={{ color:"#2a2a2a", fontSize:"0.65rem", letterSpacing:"0.12em", textTransform:"uppercase", padding:"0 20px 12px" }}>Por tienda</p>
          {Object.entries(TIENDAS).map(([k,t]) => (
            <button key={k} onClick={() => { setVista("tienda_"+k); setGenero(null); setQuery(null); setMenuAbierto(false); }}
              style={{ width:"100%", padding:"11px 28px", background:"none", border:"none", color:"#777", textAlign:"left", cursor:"pointer", fontSize:"0.84rem", display:"flex", alignItems:"center", gap:"8px" }}>
              <div style={{ width:"7px", height:"7px", borderRadius:"50%", background:t.color }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const LS_HISTORIAL = "busquedas_recientes";
function guardarBusqueda(q) {
  if (!q || q.startsWith('"')) return; // no guardar fallbacks de imagen
  try {
    const prev = JSON.parse(localStorage.getItem(LS_HISTORIAL) || "[]");
    const next = [q, ...prev.filter(x => x !== q)].slice(0, 8);
    localStorage.setItem(LS_HISTORIAL, JSON.stringify(next));
  } catch {}
}

// ─── APP ────────────────────────────────────────────────────────
export default function App() {
  const [todosProductos, setTodosProductos] = useState([]);
  const [productos, setProductos]           = useState(MOCK);
  const [filtrados, setFiltrados]           = useState(MOCK);
  const [vista, setVista]                   = useState("ofertas");
  const [genero, setGenero]                 = useState(null);
  const [queryActual, setQueryActual]       = useState(null);
  const [menuAbierto, setMenuAbierto]       = useState(false);
  const [buscadorOpen, setBuscadorOpen]     = useState(false);
  const [detalle, setDetalle]               = useState(null);
  const [orden, setOrden]                   = useState("az");

  const { user, cargando, loginGoogle, logout } = useAuth();
  const { favIds, toggle: _toggleFav }      = useFavoritos(user);
  const toggleFav = (perfume) => _toggleFav(perfume.id, perfume.precio_min ?? null);

  useEffect(() => {
    if (!SUPABASE_URL) return;
    sbFetch("perfumes_con_precios?select=*&order=nombre_base.asc&limit=5000")
      .then(data => {
        if (Array.isArray(data) && data.length) {
          setTodosProductos(data);
          const agrupados = agruparVariantes(data);
          setProductos(agrupados);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (queryActual) return;
    let base = productos;
    if (vista === "ofertas")           base = base.filter(p => p.tiene_oferta === true);
    if (vista === "tienda_rouge")      base = base.filter(p => p.en_rouge);
    if (vista === "tienda_juleriaque") base = base.filter(p => p.en_juleriaque);
    if (vista === "favoritos")         base = base.filter(p => (p.variantes||[p]).some(v => favIds.has(v.id)));
    if (genero)                        base = base.filter(p => p.genero === genero);
    setFiltrados(base);
  }, [vista, genero, productos, queryActual, favIds]);

  const onResultados = (res, query) => {
    const agrupados = agruparVariantes(res);
    setFiltrados(agrupados);
    setQueryActual(query);
    setBuscadorOpen(false);
    setDetalle(null);
    guardarBusqueda(query);
  };

  const aplicarOrden = (lista) => {
    const copia = [...lista];
    if (orden === "az")          return copia.sort((a,b) => (a.marca||"").localeCompare(b.marca||"") || (a.nombre_base||"").localeCompare(b.nombre_base||""));
    if (orden === "za")          return copia.sort((a,b) => (b.marca||"").localeCompare(a.marca||"") || (b.nombre_base||"").localeCompare(a.nombre_base||""));
    if (orden === "precio_asc")  return copia.sort((a,b) => (a.precio_min||Infinity) - (b.precio_min||Infinity));
    if (orden === "precio_desc") return copia.sort((a,b) => (b.precio_min||0) - (a.precio_min||0));
    return copia;
  };

  const tituloVista = () => {
    if (queryActual) return `"${queryActual}"`;
    if (vista === "ofertas")    return "Ofertas";
    if (vista === "favoritos")  return "Mis favoritos";
    if (vista.startsWith("tienda_")) return TIENDAS[vista.replace("tienda_","")]?.label;
    return genero || "Catálogo completo";
  };

  // // Pantalla de inicio — si no hay sesión y ya terminó de cargar
  // if (!user && !cargando) return (
  //   <>
  //     <GlobalStyles />
  //     <div style={{ minHeight:"100vh", background:"#080808", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px" }}>
  //       {/* Logo */}
  //       <div style={{ marginBottom:"48px", textAlign:"center" }}>
  //         <p style={{ color:"#c9a84c", fontSize:"0.7rem", letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:"8px" }}>Comparador de precios</p>
  //         <h1 style={{ fontFamily:"'Playfair Display',serif", fontSize:"2.2rem", color:"#fff", letterSpacing:"0.04em", margin:0 }}>
  //           perfume<span style={{ color:"#c9a84c" }}>compare</span>
  //         </h1>
  //         <p style={{ color:"#333", fontSize:"0.82rem", marginTop:"12px" }}>Encontrá el mejor precio en Rouge y Juleriaque</p>
  //       </div>

  //       {/* Card de login */}
  //       <div style={{ background:"#0f0f0f", border:"1px solid #1a1a1a", borderRadius:"16px", padding:"36px 32px", width:"100%", maxWidth:"340px", display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
  //         <p style={{ color:"#666", fontSize:"0.82rem", textAlign:"center", margin:0 }}>Iniciá sesión para guardar favoritos y acceder al catálogo completo</p>

  //         <button onClick={loginGoogle}
  //           style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:"12px", padding:"12px 16px", background:"#fff", border:"none", borderRadius:"8px", cursor:"pointer", fontSize:"0.88rem", fontWeight:600, color:"#1f1f1f", transition:"opacity 0.15s" }}
  //           onMouseOver={e => e.currentTarget.style.opacity="0.9"}
  //           onMouseOut={e => e.currentTarget.style.opacity="1"}>
  //           {/* Google icon SVG */}
  //           <svg width="18" height="18" viewBox="0 0 18 18">
  //             <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
  //             <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
  //             <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.039l3.007-2.332z"/>
  //             <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
  //           </svg>
  //           Continuar con Google
  //         </button>
  //       </div>
  //     </div>
  //   </>
  // );

  if (detalle) return (
    <>
      <GlobalStyles />
      <Navbar menuAbierto={menuAbierto} setMenuAbierto={setMenuAbierto} setBuscadorOpen={setBuscadorOpen} setVista={setVista} setGenero={setGenero} setQuery={setQueryActual} user={user} loginGoogle={loginGoogle} logout={logout} favCount={favIds.size} />
      <ProductDetail perfume={detalle} favoritos={favIds} onToggleFav={toggleFav} onBack={() => setDetalle(null)} />
      {buscadorOpen && <Buscador productos={todosProductos} onResultados={onResultados} onCerrar={() => setBuscadorOpen(false)} />}
      {menuAbierto && <div onClick={() => setMenuAbierto(false)} style={{ position:"fixed", inset:0, zIndex:98 }} />}
    </>
  );

  return (
    <>
      <GlobalStyles />
      <Navbar menuAbierto={menuAbierto} setMenuAbierto={setMenuAbierto} setBuscadorOpen={setBuscadorOpen} setVista={setVista} setGenero={setGenero} setQuery={setQueryActual} user={user} loginGoogle={loginGoogle} logout={logout} favCount={favIds.size} />

      <main style={{ maxWidth:"960px", margin:"0 auto", padding:"72px 16px 48px" }}>
        <div style={{ marginBottom:"20px", paddingTop:"16px", display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
          <div>
            <p style={{ color:"#c9a84c", fontSize:"0.68rem", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"4px" }}>
              {queryActual ? "Resultado" : vista === "ofertas" ? "Selección" : "Colección"}
            </p>
            <h2 style={{ color:"#fff", fontFamily:"'Playfair Display',serif", fontSize:"1.3rem" }}>{tituloVista()}</h2>
          </div>
          {queryActual && (
            <button onClick={() => setQueryActual(null)} style={{ background:"#141414", border:"1px solid #1e1e1e", borderRadius:"8px", padding:"7px 14px", color:"#555", cursor:"pointer", fontSize:"0.75rem" }}>
              Limpiar
            </button>
          )}
        </div>

        {vista === "catalogo" && !queryActual && (
          <div style={{ display:"flex", gap:"6px", marginBottom:"20px", flexWrap:"wrap" }}>
            {[null,"Femenino","Masculino","Unisex"].map(g => (
              <button key={g||"todos"} onClick={() => setGenero(g)}
                style={{ padding:"6px 14px", borderRadius:"20px", border:`1px solid ${genero===g?"#c9a84c":"#1e1e1e"}`, background:genero===g?"rgba(201,168,76,0.08)":"transparent", color:genero===g?"#c9a84c":"#444", cursor:"pointer", fontSize:"0.75rem", fontWeight:genero===g?700:400, transition:"all 0.15s" }}>
                {g||"Todos"}
              </button>
            ))}
          </div>
        )}

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"20px", flexWrap:"wrap", gap:"10px" }}>
          <div style={{ display:"flex", gap:"12px", alignItems:"center" }}>
            {Object.entries(TIENDAS).map(([k,t]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:"5px" }}>
                <div style={{ width:"7px", height:"7px", borderRadius:"50%", background:t.color }} />
                <span style={{ color:"#333", fontSize:"0.7rem" }}>{t.label}</span>
              </div>
            ))}
            <span style={{ color:"#2a2a2a", fontSize:"0.7rem" }}>· {filtrados.length} perfumes</span>
          </div>
          <div style={{ display:"flex", gap:"4px" }}>
            {[
              { id:"az",          label:"A-Z" },
              { id:"za",          label:"Z-A" },
              { id:"precio_asc",  label:"$ ↑" },
              { id:"precio_desc", label:"$ ↓" },
            ].map(o => (
              <button key={o.id} onClick={() => setOrden(o.id)}
                style={{ padding:"4px 10px", borderRadius:"16px", border:`1px solid ${orden===o.id?"#c9a84c":"#1e1e1e"}`, background:orden===o.id?"rgba(201,168,76,0.08)":"transparent", color:orden===o.id?"#c9a84c":"#444", cursor:"pointer", fontSize:"0.72rem", fontWeight:orden===o.id?700:400, transition:"all 0.15s" }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {filtrados.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px", color:"#2a2a2a" }}>
            <Sparkles size={28} style={{ marginBottom:"10px", opacity:0.3 }} />
            <p>No se encontraron perfumes.</p>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(175px, 1fr))", gap:"14px" }}>
            {aplicarOrden(filtrados).map((p, i) => (
              <ProductCard key={p.id || p.clave_unica || i} perfume={p} favoritos={favIds} onToggleFav={toggleFav} onClick={() => setDetalle(p)} />
            ))}
          </div>
        )}
      </main>

      {buscadorOpen && <Buscador productos={todosProductos} onResultados={onResultados} onCerrar={() => setBuscadorOpen(false)} />}
      {menuAbierto && <div onClick={() => setMenuAbierto(false)} style={{ position:"fixed", inset:0, zIndex:98 }} />}
    </>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@300;400;500;600;700&display=swap');
      * { box-sizing:border-box; margin:0; padding:0; }
      body { background:#080808; font-family:'DM Sans',sans-serif; color:#fff; }
      ::-webkit-scrollbar { width:3px; }
      ::-webkit-scrollbar-thumb { background:#1e1e1e; border-radius:2px; }
    `}</style>
  );
}
