(function () {
  "use strict";

  const BASE_URL = window.location.origin + window.location.pathname.replace(/index\.html$/, "");

  // Mismos slugs que ya usa la propiedad "Asesor" en HubSpot, para que un
  // link ?asesor=irle sea consistente con el resto del sistema. Cada
  // asesor manda su propio link (ej. ".../galeria/?asesor=irle") y la
  // galería se muestra igual, solo cambia el nombre/marca mostrada.
  const ASESORES = {
    miguel_mondragon: { nombre: "Miguel Mondragon", iniciales: "MM" },
    irle: { nombre: "Irly Lopez", iniciales: "IL" },
    jessica: { nombre: "Jessica García", iniciales: "JG" },
    alejandro: { nombre: "Alejandro Santibañez", iniciales: "AS" },
    noemi: { nombre: "Noemí Lopez", iniciales: "NL" },
    raquel: { nombre: "Raquel Rey", iniciales: "RR" },
  };
  const ASESOR_DEFAULT = "miguel_mondragon";

  const slugAsesor = new URLSearchParams(location.search).get("asesor");
  const asesorActivo = {
    slug: ASESORES[slugAsesor] ? slugAsesor : ASESOR_DEFAULT,
    ...ASESORES[ASESORES[slugAsesor] ? slugAsesor : ASESOR_DEFAULT],
  };

  function aplicarMarcaAsesor() {
    document.title = `${asesorActivo.nombre} — Diamante & Santuario`;
    const iniciales = document.getElementById("topbarIniciales");
    const nombre = document.getElementById("topbarNombre");
    if (iniciales) iniciales.textContent = asesorActivo.iniciales;
    if (nombre) nombre.textContent = asesorActivo.nombre;
  }
  aplicarMarcaAsesor();

  // Agrega ?asesor=slug a cualquier ruta relativa de la galería (para que
  // los links compartidos —modelo o foto individual— abran ya mostrando el
  // nombre del asesor correcto, no siempre el mismo por default).
  function conAsesor(rutaRelativa) {
    const separador = rutaRelativa.includes("?") ? "&" : "?";
    return `${rutaRelativa}${separador}asesor=${asesorActivo.slug}`;
  }

  const els = {
    tabs: document.getElementById("proyectoTabs"),
    buscador: document.getElementById("buscador"),
    orden: document.getElementById("orden"),
    grid: document.getElementById("grid"),
    vacio: document.getElementById("vacio"),

    visor: document.getElementById("visor"),
    visorCerrar: document.getElementById("visorCerrar"),
    visorNombre: document.getElementById("visorNombre"),
    visorPrecio: document.getElementById("visorPrecio"),
    visorTabs: document.getElementById("visorTabs"),
    visorImgWrap: document.getElementById("visorImgWrap"),
    visorImg: document.getElementById("visorImg"),
    visorVideo: document.getElementById("visorVideo"),
    visorPrev: document.getElementById("visorPrev"),
    visorNext: document.getElementById("visorNext"),
    visorContador: document.getElementById("visorContador"),
    visorTiras: document.getElementById("visorTiras"),
    visorAccionesFotos: document.getElementById("visorAccionesFotos"),
    visorAccionesVideo: document.getElementById("visorAccionesVideo"),
    visorContadorVideo: document.getElementById("visorContadorVideo"),
    visorCompartirVideo: document.getElementById("visorCompartirVideo"),
    visorCompartirModelo: document.getElementById("visorCompartirModelo"),
    visorCompartirFoto: document.getElementById("visorCompartirFoto"),
    visorDescargarFoto: document.getElementById("visorDescargarFoto"),

    visorBtnSeleccion: document.getElementById("visorBtnSeleccion"),
    visorBarraSeleccion: document.getElementById("visorBarraSeleccion"),
    visorSeleccionContador: document.getElementById("visorSeleccionContador"),
    visorCancelarSeleccion: document.getElementById("visorCancelarSeleccion"),
    visorDescargarSeleccion: document.getElementById("visorDescargarSeleccion"),
    visorCompartirSeleccion: document.getElementById("visorCompartirSeleccion"),

    btnModoSeleccion: document.getElementById("btnModoSeleccion"),
    barraSeleccion: document.getElementById("barraSeleccion"),
    seleccionContador: document.getElementById("seleccionContador"),
    btnCancelarSeleccion: document.getElementById("btnCancelarSeleccion"),
    btnCompartirSeleccion: document.getElementById("btnCompartirSeleccion"),
  };

  let manifest = null;
  let videos = {}; // { proyectoId: { modeloId: ["idYouTube1", ...] } }
  let proyectoActivo = null;
  let modeloActivo = null;
  let tabActiva = "fotos"; // "fotos" | "fotosAdicionales" | "videos"
  let indiceActivo = 0;

  let modoSeleccion = false;
  const seleccionados = new Map(); // clave "proyectoId/modeloId" -> modelo

  // Selección múltiple DENTRO del visor: elegir varias fotos de la MISMA
  // propiedad (ej. 3 fotos de fachada) para mandarlas juntas.
  let modoSeleccionFotos = false;
  const fotosSeleccionadas = new Set(); // índices dentro de fotosDeTab()

  // ---------- Carga de datos ----------

  async function cargar() {
    pintarEsqueletos();
    try {
      const res = await fetch("manifest.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      manifest = await res.json();
    } catch (err) {
      els.grid.innerHTML = "";
      els.vacio.hidden = false;
      els.vacio.textContent =
        "No pudimos cargar el catálogo de fotos. Intenta recargar la página.";
      console.error(err);
      return;
    }

    // videos.json es opcional — si no existe todavía o falla, la galería
    // sigue funcionando normal, simplemente sin pestaña de Videos.
    try {
      const resVideos = await fetch("videos.json", { cache: "no-store" });
      if (resVideos.ok) videos = await resVideos.json();
    } catch (err) {
      console.warn("No se pudo cargar videos.json (opcional):", err);
    }

    proyectoActivo = manifest.proyectos[0]?.id || null;

    // Deep-link: si la URL trae #proyectoId/modeloId (viene del redirect de
    // /galeria/modelo/:proyectoId/:modeloId), abrimos ese modelo directo,
    // en vez de mostrar siempre el primer proyecto. Formato extendido
    // #proyectoId/modeloId/f/tab/indice (viene de /galeria/foto/...) además
    // abre esa foto exacta dentro del visor.
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    const partes = hash.split("/");
    const [hashProyecto, hashModelo, marcaFoto, hashTab, hashIndiceStr] = partes;
    const hashIndice = marcaFoto === "f" ? parseInt(hashIndiceStr, 10) : null;
    if (hashProyecto && hashModelo) {
      const proyecto = manifest.proyectos.find((p) => p.id === hashProyecto);
      const modelo = proyecto?.modelos.find((m) => m.id === hashModelo);
      if (proyecto && modelo) {
        proyectoActivo = proyecto.id;
      }
    }

    pintarTabsProyecto();
    pintarGrid();

    if (hashProyecto && hashModelo) {
      const proyecto = manifest.proyectos.find((p) => p.id === hashProyecto);
      const modelo = proyecto?.modelos.find((m) => m.id === hashModelo);
      if (modelo) {
        abrirVisor(modelo);
        if (marcaFoto === "f" && (hashTab === "fotos" || hashTab === "fotosAdicionales")) {
          tabActiva = hashTab;
          pintarTabsVisor();
          pintarTiras();
          if (Number.isInteger(hashIndice)) mostrarFoto(hashIndice);
        }
      }
    }
  }

  function pintarEsqueletos() {
    els.grid.innerHTML = "";
    for (let i = 0; i < 6; i++) {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div class="card__media card__skel"></div>
        <div class="card__body">
          <div class="card__skel" style="height:16px;width:70%;border-radius:6px;margin-bottom:8px;"></div>
          <div class="card__skel" style="height:12px;width:40%;border-radius:6px;"></div>
        </div>`;
      els.grid.appendChild(div);
    }
  }

  // ---------- Tabs de proyecto ----------

  function pintarTabsProyecto() {
    els.tabs.innerHTML = "";
    manifest.proyectos.forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.textContent = p.nombre;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(p.id === proyectoActivo));
      btn.addEventListener("click", () => {
        proyectoActivo = p.id;
        pintarTabsProyecto();
        pintarGrid();
      });
      els.tabs.appendChild(btn);
    });
  }

  // ---------- Grid de modelos ----------

  function obtenerModelosFiltrados() {
    const proyecto = manifest.proyectos.find((p) => p.id === proyectoActivo);
    if (!proyecto) return [];
    const q = els.buscador.value.trim().toLowerCase();
    let modelos = proyecto.modelos.filter((m) =>
      q ? m.nombre.toLowerCase().includes(q) : true
    );

    const orden = els.orden.value;
    if (orden === "precioAsc" || orden === "precioDesc") {
      const conPrecio = modelos.filter((m) => m.precio != null);
      const sinPrecio = modelos.filter((m) => m.precio == null);
      conPrecio.sort((a, b) =>
        orden === "precioAsc" ? a.precio - b.precio : b.precio - a.precio
      );
      modelos = [...conPrecio, ...sinPrecio];
    }
    return modelos;
  }

  function pintarGrid() {
    const modelos = obtenerModelosFiltrados();
    els.grid.innerHTML = "";

    if (modelos.length === 0) {
      els.vacio.hidden = false;
      els.vacio.textContent = "No encontramos ningún modelo con ese nombre.";
      return;
    }
    els.vacio.hidden = true;

    modelos.forEach((m) => {
      const card = document.createElement("button");
      const claveSeleccion = `${proyectoActivo}/${m.id}`;
      const estaSeleccionada = seleccionados.has(claveSeleccion);
      card.className =
        "card" +
        (modoSeleccion ? " card--modo-seleccion" : "") +
        (estaSeleccionada ? " card--seleccionada" : "");
      card.style.textAlign = "left";
      card.style.border = "1px solid var(--linea)";
      card.setAttribute("type", "button");

      const badge =
        m.tipo === "terreno" ? "Terreno" : m.tipo === "comun" ? "Áreas comunes" : "Casa";

      card.innerHTML = `
        <div class="card__media">
          ${m.portada ? `<img src="${m.portada}" alt="${m.nombre}" loading="lazy" />` : ""}
          <span class="card__check" aria-hidden="true"></span>
          <span class="card__badge">${badge}</span>
          ${m.preventa ? `<span class="card__badge card__badge--preventa">Preventa</span>` : ""}
          <span class="card__count">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="2.5" width="10" height="7.5" rx="1.2" stroke="currentColor" stroke-width="1.1"/><path d="M1 8l2.7-2.7a1 1 0 0 1 1.4 0L8 8" stroke="currentColor" stroke-width="1.1"/><circle cx="8.3" cy="4.3" r="0.9" fill="currentColor"/></svg>
            ${m.totalFotos}
          </span>
        </div>
        <div class="card__body">
          <p class="card__nombre">${m.nombre}</p>
          ${
            m.precioFormato
              ? `<p class="card__precio">${m.precioFormato}</p>`
              : `<p class="card__precio card__precio--consultar">Consultar precio</p>`
          }
        </div>`;

      card.addEventListener("click", () => {
        if (modoSeleccion) {
          toggleSeleccion(claveSeleccion, m);
        } else {
          abrirVisor(m);
        }
      });
      els.grid.appendChild(card);
    });
  }

  // ---------- Selección múltiple ----------

  function toggleSeleccion(clave, modelo) {
    if (seleccionados.has(clave)) {
      seleccionados.delete(clave);
    } else {
      seleccionados.set(clave, modelo);
    }
    pintarGrid();
    actualizarBarraSeleccion();
  }

  function actualizarBarraSeleccion() {
    const n = seleccionados.size;
    els.barraSeleccion.hidden = !modoSeleccion || n === 0;
    els.seleccionContador.textContent =
      n === 1 ? "1 seleccionada" : `${n} seleccionadas`;
  }

  els.btnModoSeleccion.addEventListener("click", () => {
    modoSeleccion = !modoSeleccion;
    els.btnModoSeleccion.setAttribute("aria-pressed", String(modoSeleccion));
    els.btnModoSeleccion.textContent = modoSeleccion ? "Cancelar selección" : "Seleccionar";
    if (!modoSeleccion) {
      seleccionados.clear();
    }
    pintarGrid();
    actualizarBarraSeleccion();
  });

  els.btnCancelarSeleccion.addEventListener("click", () => {
    seleccionados.clear();
    pintarGrid();
    actualizarBarraSeleccion();
  });

  els.btnCompartirSeleccion.addEventListener("click", () => {
    compartirVarios(Array.from(seleccionados.values()));
  });

  // Comparte varias fotos (una portada por modelo seleccionado) en una
  // sola indicación, reusando compartirArchivos().
  async function compartirVarios(modelos) {
    if (!modelos.length) return;
    const items = modelos.map((m, i) => ({
      url: m.portada,
      nombre: `${m.nombre || "foto"}-${i + 1}`,
    }));
    const textoWhatsapp = modelos
      .map((m) => `${m.nombre}${m.precioFormato ? " — " + m.precioFormato : ""}`)
      .join("\n");
    // Para el respaldo por WhatsApp usamos el link de cada MODELO (con
    // vista previa propia, gracias a /galeria/modelo/...), no el link
    // directo a la imagen — por eso este caso arma su propio mensaje en
    // vez de pasar por el respaldo genérico de compartirArchivos.
    const compartidoComoArchivos = await compartirArchivos(items, {
      titulo: asesorActivo.nombre,
      textoWhatsapp,
      soloDescargarYCompartir: true,
    });
    if (compartidoComoArchivos) return;

    const lineas = modelos.map((m) => {
      const url = urlAbsoluta(conAsesor(`modelo/${proyectoActivo}/${m.id}`));
      return `${m.nombre}${m.precioFormato ? " — " + m.precioFormato : ""}\n${url}`;
    });
    const mensaje = encodeURIComponent(lineas.join("\n\n"));
    window.open(`https://wa.me/?text=${mensaje}`, "_blank");
  }

  // Función genérica: descarga cada item.url como archivo real y lo
  // comparte de una sola vez vía Web Share API (navigator.share con
  // "files" — funciona en Chrome/Safari de celular, adjuntando las
  // imágenes de verdad, no un link). Devuelve true si logró compartir
  // como archivos. Si el navegador no lo soporta y soloDescargarYCompartir
  // NO está activo, cae de respaldo a abrir WhatsApp con un link por foto
  // (útil para el visor, donde cada foto sí tiene URL directa válida).
  async function compartirArchivos(items, { titulo, textoWhatsapp, soloDescargarYCompartir } = {}) {
    if (!items.length) return false;

    try {
      const archivos = await Promise.all(
        items.map(async ({ url, nombre }) => {
          const res = await fetch(url);
          const blob = await res.blob();
          const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
          return new File([blob], `${nombre}.${ext}`, { type: blob.type });
        })
      );

      if (navigator.canShare && navigator.canShare({ files: archivos })) {
        await navigator.share({
          files: archivos,
          title: titulo || asesorActivo.nombre,
          text: textoWhatsapp || "",
        });
        return true;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return true; // el usuario canceló, no seguir al respaldo
      console.error("No se pudo compartir como archivos, usando el respaldo de links:", err);
    }

    if (soloDescargarYCompartir) return false; // deja que el llamador arme su propio respaldo

    // Respaldo genérico: WhatsApp con un link por foto. Se usa
    // item.urlPreview (página con Open Graph, si el llamador la da) en vez
    // del link directo a la imagen — así WhatsApp muestra una tarjeta con
    // miniatura de la foto en vez de un link de texto pelón (esto es lo
    // que se ve en computadora/WhatsApp Web, donde compartir-como-archivo
    // no está disponible y siempre se cae a este respaldo).
    const lineas = items.map(({ url, urlPreview }) =>
      urlPreview ? urlAbsoluta(urlPreview) : urlAbsoluta(url)
    );
    const encabezado = textoWhatsapp ? `${textoWhatsapp}\n\n` : "";
    const mensaje = encodeURIComponent(encabezado + lineas.join("\n"));
    window.open(`https://wa.me/?text=${mensaje}`, "_blank");
    return false;
  }

  els.buscador.addEventListener("input", pintarGrid);
  els.orden.addEventListener("change", pintarGrid);

  // ---------- Visor de detalle ----------

  function fotosDeTab() {
    if (!modeloActivo) return [];
    return tabActiva === "fotos" ? modeloActivo.fotos : modeloActivo.fotosAdicionales;
  }

  function videosDeModelo(modelo) {
    if (!modelo) return [];
    return (videos[proyectoActivo] && videos[proyectoActivo][modelo.id]) || [];
  }

  function abrirVisor(modelo) {
    modeloActivo = modelo;
    tabActiva = modelo.fotos.length ? "fotos" : "fotosAdicionales";
    indiceActivo = 0;

    modoSeleccionFotos = false;
    fotosSeleccionadas.clear();
    els.visorBtnSeleccion.setAttribute("aria-pressed", "false");
    els.visorBtnSeleccion.textContent = "Seleccionar fotos";
    els.visorBarraSeleccion.hidden = true;

    els.visorNombre.textContent = modelo.nombre;
    els.visorPrecio.textContent =
      (modelo.precioFormato || "Consultar precio") + (modelo.preventa ? " · Preventa" : "");

    pintarTabsVisor();
    pintarTiras();
    mostrarFoto(0);

    els.visor.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function cerrarVisor() {
    els.visor.hidden = true;
    document.body.style.overflow = "";
    modeloActivo = null;
    modoSeleccionFotos = false;
    fotosSeleccionadas.clear();
  }

  function pintarTabsVisor() {
    els.visorTabs.innerHTML = "";
    const tabs = [];
    if (modeloActivo.fotos.length) {
      tabs.push({ key: "fotos", label: `Fotos (${modeloActivo.fotos.length})` });
    }
    if (modeloActivo.fotosAdicionales.length) {
      tabs.push({
        key: "fotosAdicionales",
        label: `Adicionales (${modeloActivo.fotosAdicionales.length})`,
      });
    }
    const listaVideos = videosDeModelo(modeloActivo);
    if (listaVideos.length) {
      tabs.push({ key: "videos", label: `Videos (${listaVideos.length})` });
    }
    if (tabs.length < 2) return; // no mostrar tabs si solo hay una categoría en total

    tabs.forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.setAttribute("aria-selected", String(key === tabActiva));
      btn.addEventListener("click", () => {
        tabActiva = key;
        indiceActivo = 0;
        pintarTabsVisor();
        pintarTiras();
        if (key === "videos") {
          mostrarVideo(0);
        } else {
          mostrarFoto(0);
        }
      });
      els.visorTabs.appendChild(btn);
    });
  }

  function mostrarFoto(indice) {
    const fotos = fotosDeTab();
    if (fotos.length === 0) return;
    indiceActivo = ((indice % fotos.length) + fotos.length) % fotos.length;
    els.visorImg.src = fotos[indiceActivo];
    els.visorImg.alt = `${modeloActivo.nombre} — foto ${indiceActivo + 1}`;
    els.visorContador.textContent = `${indiceActivo + 1} / ${fotos.length}`;
    // Por si veníamos de la pestaña Videos: mostrar la imagen, detener el
    // video (limpiando el src) y regresar a la barra de acciones de fotos.
    els.visorImg.hidden = false;
    els.visorVideo.hidden = true;
    els.visorVideo.src = "";
    els.visorAccionesFotos.hidden = false;
    els.visorAccionesVideo.hidden = true;
    resaltarTira();
  }

  // Cada entrada en videos.json puede ser: un ID de YouTube ("dQw4w9WgXcQ")
  // o un link completo de un video de Facebook ("https://www.facebook.com/...
  // /videos/123..." o "https://fb.watch/..."). Se detecta por si empieza
  // con "http" — así el mismo array puede mezclar ambos tipos sin
  // problema.
  function esVideoDeFacebook(entrada) {
    return typeof entrada === "string" && entrada.startsWith("http");
  }

  function mostrarVideo(indice) {
    const lista = videosDeModelo(modeloActivo);
    if (lista.length === 0) return;
    indiceActivo = ((indice % lista.length) + lista.length) % lista.length;
    const entrada = lista[indiceActivo];
    els.visorVideo.src = esVideoDeFacebook(entrada)
      ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
          entrada
        )}&show_text=false&width=560`
      : `https://www.youtube.com/embed/${entrada}`;
    els.visorImg.hidden = true;
    els.visorVideo.hidden = false;
    els.visorAccionesFotos.hidden = true;
    els.visorAccionesVideo.hidden = false;
    els.visorContadorVideo.textContent = `${indiceActivo + 1} / ${lista.length}`;
    resaltarTira();
  }

  function pintarTiras() {
    const fotos = fotosDeTab();
    els.visorTiras.innerHTML = "";
    els.visorTiras.classList.toggle("modo-seleccion", modoSeleccionFotos);

    if (tabActiva === "videos") {
      const lista = videosDeModelo(modeloActivo);
      lista.forEach((entrada, i) => {
        const item = document.createElement("div");
        item.className = "visor__tira-item visor__tira-item--video";
        const img = document.createElement("img");
        if (esVideoDeFacebook(entrada)) {
          // Facebook no da una forma sencilla de obtener la miniatura real
          // del video sin credenciales de su API — se usa un ícono
          // genérico en su lugar (fondo azul de Facebook + ▶, ya dibujado
          // como SVG en línea, no necesita descargar nada).
          img.src =
            "data:image/svg+xml;utf8," +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#1877F2"/><text x="50" y="58" font-size="40" text-anchor="middle" fill="white">▶</text></svg>'
            );
        } else {
          img.src = `https://img.youtube.com/vi/${entrada}/mqdefault.jpg`;
        }
        img.loading = "lazy";
        img.alt = "";
        item.appendChild(img);
        item.addEventListener("click", () => mostrarVideo(i));
        els.visorTiras.appendChild(item);
      });
      resaltarTira();
      return;
    }

    fotos.forEach((src, i) => {
      const item = document.createElement("div");
      item.className =
        "visor__tira-item" + (fotosSeleccionadas.has(i) ? " seleccionada" : "");

      const img = document.createElement("img");
      img.src = src;
      img.loading = "lazy";
      img.alt = "";

      const check = document.createElement("span");
      check.className = "visor__tira-check";
      check.setAttribute("aria-hidden", "true");

      item.appendChild(img);
      item.appendChild(check);

      item.addEventListener("click", () => {
        if (modoSeleccionFotos) {
          toggleFotoSeleccionada(i);
        } else {
          mostrarFoto(i);
        }
      });

      els.visorTiras.appendChild(item);
    });
    resaltarTira();
  }

  function resaltarTira() {
    Array.from(els.visorTiras.children).forEach((item, i) => {
      if (!modoSeleccionFotos) {
        item.classList.toggle("activa", i === indiceActivo);
        item.querySelector("img")?.classList.toggle("activa", i === indiceActivo);
      }
      if (i === indiceActivo && !modoSeleccionFotos) {
        item.scrollIntoView({ inline: "center", block: "nearest" });
      }
    });
  }

  // ---------- Selección múltiple de fotos dentro del visor ----------

  function toggleFotoSeleccionada(indice) {
    if (fotosSeleccionadas.has(indice)) {
      fotosSeleccionadas.delete(indice);
    } else {
      fotosSeleccionadas.add(indice);
    }
    pintarTiras();
    actualizarBarraSeleccionFotos();
  }

  function actualizarBarraSeleccionFotos() {
    const n = fotosSeleccionadas.size;
    els.visorBarraSeleccion.hidden = !modoSeleccionFotos || n === 0;
    els.visorSeleccionContador.textContent =
      n === 1 ? "1 seleccionada" : `${n} seleccionadas`;
  }

  els.visorBtnSeleccion.addEventListener("click", () => {
    modoSeleccionFotos = !modoSeleccionFotos;
    els.visorBtnSeleccion.setAttribute("aria-pressed", String(modoSeleccionFotos));
    els.visorBtnSeleccion.textContent = modoSeleccionFotos
      ? "Cancelar selección"
      : "Seleccionar fotos";
    if (!modoSeleccionFotos) fotosSeleccionadas.clear();
    pintarTiras();
    actualizarBarraSeleccionFotos();
  });

  els.visorCancelarSeleccion.addEventListener("click", () => {
    fotosSeleccionadas.clear();
    pintarTiras();
    actualizarBarraSeleccionFotos();
  });

  els.visorDescargarSeleccion.addEventListener("click", async () => {
    const fotos = fotosDeTab();
    const items = Array.from(fotosSeleccionadas)
      .sort((a, b) => a - b)
      .map((i) => ({ url: fotos[i], nombre: `${modeloActivo.nombre}-foto${i + 1}` }));
    await descargarArchivos(items);
  });

  els.visorCompartirSeleccion.addEventListener("click", () => {
    const fotos = fotosDeTab();
    const items = Array.from(fotosSeleccionadas)
      .sort((a, b) => a - b)
      .map((i) => ({
        url: fotos[i],
        urlPreview: conAsesor(`foto/${proyectoActivo}/${modeloActivo.id}/${tabActiva}/${i}`),
        nombre: `${modeloActivo.nombre}-foto${i + 1}`,
      }));
    compartirArchivos(items, {
      textoWhatsapp: `${modeloActivo.nombre}${modeloActivo.precioFormato ? " — " + modeloActivo.precioFormato : ""} · ${asesorActivo.nombre}`,
    });
  });

  // Descarga fotos directo al dispositivo (Downloads del celular/PC). En
  // Android, las imágenes descargadas por el navegador normalmente se
  // indexan solas en la galería de fotos del teléfono — así que la
  // siguiente vez que el asesor esté respondiendo en la app de WhatsApp y
  // toque el ícono de adjuntar > Galería, la foto ya aparece ahí, lista
  // para mandar sin salir del chat. Las descargas se disparan con un
  // pequeño intervalo entre cada una porque los navegadores bloquean
  // ráfagas de descargas simultáneas disparadas por JavaScript.
  async function descargarArchivos(items) {
    for (let i = 0; i < items.length; i++) {
      const { url, nombre } = items[i];
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `${nombre}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      } catch (err) {
        console.error("No se pudo descargar la foto:", nombre, err);
      }
      if (i < items.length - 1) await new Promise((r) => setTimeout(r, 350));
    }
  }

  els.visorCerrar.addEventListener("click", cerrarVisor);
  els.visorPrev.addEventListener("click", () => {
    if (tabActiva === "videos") mostrarVideo(indiceActivo - 1);
    else mostrarFoto(indiceActivo - 1);
  });
  els.visorNext.addEventListener("click", () => {
    if (tabActiva === "videos") mostrarVideo(indiceActivo + 1);
    else mostrarFoto(indiceActivo + 1);
  });

  document.addEventListener("keydown", (e) => {
    if (els.visor.hidden) return;
    if (e.key === "Escape") cerrarVisor();
    if (e.key === "ArrowLeft") {
      if (tabActiva === "videos") mostrarVideo(indiceActivo - 1);
      else mostrarFoto(indiceActivo - 1);
    }
    if (e.key === "ArrowRight") {
      if (tabActiva === "videos") mostrarVideo(indiceActivo + 1);
      else mostrarFoto(indiceActivo + 1);
    }
  });

  // Swipe táctil sobre el escenario de la foto (o video)
  (function habilitarSwipe() {
    const stage = document.getElementById("visorImgWrap");
    let xInicio = null;
    let yInicio = null;

    stage.addEventListener(
      "touchstart",
      (e) => {
        xInicio = e.touches[0].clientX;
        yInicio = e.touches[0].clientY;
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchend",
      (e) => {
        if (xInicio === null) return;
        const dx = e.changedTouches[0].clientX - xInicio;
        const dy = e.changedTouches[0].clientY - yInicio;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          const avanzar = tabActiva === "videos" ? mostrarVideo : mostrarFoto;
          if (dx < 0) avanzar(indiceActivo + 1);
          else avanzar(indiceActivo - 1);
        }
        xInicio = null;
        yInicio = null;
      },
      { passive: true }
    );
  })();

  // ---------- Compartir ----------

  function urlAbsoluta(rutaRelativa) {
    return BASE_URL + rutaRelativa;
  }

  async function compartir({ titulo, texto, url }) {
    if (navigator.share) {
      try {
        await navigator.share({ title: titulo, text: texto, url });
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // el usuario canceló
      }
    }
    // Fallback: abrir WhatsApp Web/App con el link
    const mensaje = encodeURIComponent(`${texto}\n${url}`);
    window.open(`https://wa.me/?text=${mensaje}`, "_blank");
  }

  els.visorCompartirModelo.addEventListener("click", () => {
    if (!modeloActivo) return;
    // Se comparte el link de /galeria/modelo/..., no el link directo a la
    // imagen: ese link trae etiquetas Open Graph (og:image, og:title), así
    // que al pegarlo en WhatsApp o Facebook se ve la foto de portada como
    // vista previa, en vez de un link pelón.
    const url = urlAbsoluta(conAsesor(`modelo/${proyectoActivo}/${modeloActivo.id}`));
    compartir({
      titulo: modeloActivo.nombre,
      texto: `${modeloActivo.nombre}${modeloActivo.precioFormato ? " — " + modeloActivo.precioFormato : ""} · ${asesorActivo.nombre}`,
      url,
    });
  });

  els.visorCompartirFoto.addEventListener("click", () => {
    const fotos = fotosDeTab();
    if (!fotos.length) return;
    const urlPreview = urlAbsoluta(
      conAsesor(`foto/${proyectoActivo}/${modeloActivo.id}/${tabActiva}/${indiceActivo}`)
    );
    compartir({
      titulo: modeloActivo.nombre,
      texto: `${modeloActivo.nombre} — foto ${indiceActivo + 1}`,
      url: urlPreview,
    });
  });

  els.visorCompartirVideo.addEventListener("click", () => {
    const lista = videosDeModelo(modeloActivo);
    if (!lista.length) return;
    const idYoutube = lista[indiceActivo];
    // Se comparte el link directo de YouTube (youtu.be/...): WhatsApp y
    // Facebook generan su propia vista previa con miniatura automáticamente
    // para links de YouTube, no hace falta una página propia con Open Graph
    // como con las fotos.
    compartir({
      titulo: modeloActivo.nombre,
      texto: `${modeloActivo.nombre} — video`,
      url: `https://youtu.be/${idYoutube}`,
    });
  });

  els.visorDescargarFoto.addEventListener("click", () => {
    const fotos = fotosDeTab();
    if (!fotos.length) return;
    descargarArchivos([
      { url: fotos[indiceActivo], nombre: `${modeloActivo.nombre}-foto${indiceActivo + 1}` },
    ]);
  });

  // ---------- Arranque ----------

  cargar();
})();
