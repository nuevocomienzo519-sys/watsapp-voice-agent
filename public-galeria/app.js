(function () {
  "use strict";

  const BASE_URL = window.location.origin + window.location.pathname.replace(/index\.html$/, "");

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
    visorPrev: document.getElementById("visorPrev"),
    visorNext: document.getElementById("visorNext"),
    visorContador: document.getElementById("visorContador"),
    visorTiras: document.getElementById("visorTiras"),
    visorCompartirModelo: document.getElementById("visorCompartirModelo"),
    visorCompartirFoto: document.getElementById("visorCompartirFoto"),

    visorBtnSeleccion: document.getElementById("visorBtnSeleccion"),
    visorBarraSeleccion: document.getElementById("visorBarraSeleccion"),
    visorSeleccionContador: document.getElementById("visorSeleccionContador"),
    visorCancelarSeleccion: document.getElementById("visorCancelarSeleccion"),
    visorCompartirSeleccion: document.getElementById("visorCompartirSeleccion"),

    btnModoSeleccion: document.getElementById("btnModoSeleccion"),
    barraSeleccion: document.getElementById("barraSeleccion"),
    seleccionContador: document.getElementById("seleccionContador"),
    btnCancelarSeleccion: document.getElementById("btnCancelarSeleccion"),
    btnCompartirSeleccion: document.getElementById("btnCompartirSeleccion"),
  };

  let manifest = null;
  let proyectoActivo = null;
  let modeloActivo = null;
  let tabActiva = "fotos"; // "fotos" | "fotosAdicionales"
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
      titulo: "Nuevo Comienzo",
      textoWhatsapp,
      soloDescargarYCompartir: true,
    });
    if (compartidoComoArchivos) return;

    const lineas = modelos.map((m) => {
      const url = urlAbsoluta(`modelo/${proyectoActivo}/${m.id}`);
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
          title: titulo || "Nuevo Comienzo",
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
    const hayFotos = modeloActivo.fotos.length > 0;
    const hayAdicionales = modeloActivo.fotosAdicionales.length > 0;
    if (!(hayFotos && hayAdicionales)) return; // no mostrar tabs si solo hay una categoría

    [
      { key: "fotos", label: `Fotos (${modeloActivo.fotos.length})` },
      { key: "fotosAdicionales", label: `Adicionales (${modeloActivo.fotosAdicionales.length})` },
    ].forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.setAttribute("aria-selected", String(key === tabActiva));
      btn.addEventListener("click", () => {
        tabActiva = key;
        indiceActivo = 0;
        pintarTabsVisor();
        pintarTiras();
        mostrarFoto(0);
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
    resaltarTira();
  }

  function pintarTiras() {
    const fotos = fotosDeTab();
    els.visorTiras.innerHTML = "";
    els.visorTiras.classList.toggle("modo-seleccion", modoSeleccionFotos);

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

  els.visorCompartirSeleccion.addEventListener("click", () => {
    const fotos = fotosDeTab();
    const items = Array.from(fotosSeleccionadas)
      .sort((a, b) => a - b)
      .map((i) => ({
        url: fotos[i],
        urlPreview: `foto/${proyectoActivo}/${modeloActivo.id}/${tabActiva}/${i}`,
        nombre: `${modeloActivo.nombre}-foto${i + 1}`,
      }));
    compartirArchivos(items, {
      textoWhatsapp: `${modeloActivo.nombre}${modeloActivo.precioFormato ? " — " + modeloActivo.precioFormato : ""} · Nuevo Comienzo`,
    });
  });

  els.visorCerrar.addEventListener("click", cerrarVisor);
  els.visorPrev.addEventListener("click", () => mostrarFoto(indiceActivo - 1));
  els.visorNext.addEventListener("click", () => mostrarFoto(indiceActivo + 1));

  document.addEventListener("keydown", (e) => {
    if (els.visor.hidden) return;
    if (e.key === "Escape") cerrarVisor();
    if (e.key === "ArrowLeft") mostrarFoto(indiceActivo - 1);
    if (e.key === "ArrowRight") mostrarFoto(indiceActivo + 1);
  });

  // Swipe táctil sobre el escenario de la foto
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
          if (dx < 0) mostrarFoto(indiceActivo + 1);
          else mostrarFoto(indiceActivo - 1);
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
    const url = urlAbsoluta(`modelo/${proyectoActivo}/${modeloActivo.id}`);
    compartir({
      titulo: modeloActivo.nombre,
      texto: `${modeloActivo.nombre}${modeloActivo.precioFormato ? " — " + modeloActivo.precioFormato : ""} · Nuevo Comienzo`,
      url,
    });
  });

  els.visorCompartirFoto.addEventListener("click", () => {
    const fotos = fotosDeTab();
    if (!fotos.length) return;
    const urlPreview = urlAbsoluta(
      `foto/${proyectoActivo}/${modeloActivo.id}/${tabActiva}/${indiceActivo}`
    );
    compartir({
      titulo: modeloActivo.nombre,
      texto: `${modeloActivo.nombre} — foto ${indiceActivo + 1}`,
      url: urlPreview,
    });
  });

  // ---------- Arranque ----------

  cargar();
})();
