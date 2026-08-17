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
  };

  let manifest = null;
  let proyectoActivo = null;
  let modeloActivo = null;
  let tabActiva = "fotos"; // "fotos" | "fotosAdicionales"
  let indiceActivo = 0;

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
    pintarTabsProyecto();
    pintarGrid();
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
      card.className = "card";
      card.style.textAlign = "left";
      card.style.border = "1px solid var(--linea)";
      card.setAttribute("type", "button");

      const badge =
        m.tipo === "terreno" ? "Terreno" : m.tipo === "comun" ? "Áreas comunes" : "Casa";

      card.innerHTML = `
        <div class="card__media">
          ${m.portada ? `<img src="${m.portada}" alt="${m.nombre}" loading="lazy" />` : ""}
          <span class="card__badge">${badge}</span>
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

      card.addEventListener("click", () => abrirVisor(m));
      els.grid.appendChild(card);
    });
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

    els.visorNombre.textContent = modelo.nombre;
    els.visorPrecio.textContent = modelo.precioFormato || "Consultar precio";

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
    fotos.forEach((src, i) => {
      const img = document.createElement("img");
      img.src = src;
      img.loading = "lazy";
      img.alt = "";
      img.addEventListener("click", () => mostrarFoto(i));
      els.visorTiras.appendChild(img);
    });
    resaltarTira();
  }

  function resaltarTira() {
    Array.from(els.visorTiras.children).forEach((img, i) => {
      img.classList.toggle("activa", i === indiceActivo);
      if (i === indiceActivo) img.scrollIntoView({ inline: "center", block: "nearest" });
    });
  }

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
    const portada = modeloActivo.portada ? urlAbsoluta(modeloActivo.portada) : "";
    compartir({
      titulo: modeloActivo.nombre,
      texto: `${modeloActivo.nombre}${modeloActivo.precioFormato ? " — " + modeloActivo.precioFormato : ""} · Miguel Mondragon`,
      url: portada,
    });
  });

  els.visorCompartirFoto.addEventListener("click", () => {
    const fotos = fotosDeTab();
    if (!fotos.length) return;
    compartir({
      titulo: modeloActivo.nombre,
      texto: `${modeloActivo.nombre} — foto ${indiceActivo + 1}`,
      url: urlAbsoluta(fotos[indiceActivo]),
    });
  });

  // ---------- Arranque ----------

  cargar();
})();
