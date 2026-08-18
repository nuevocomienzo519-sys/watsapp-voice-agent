// scripts/generarManifest.js
//
// Escanea public-galeria/fotos/{Diamante,Santuario}/01 Para Redes (Asesores)/
// y genera public-galeria/manifest.json con la lista real de modelos y fotos.
//
// Uso: node scripts/generarManifest.js
// Vuelve a correrlo cada vez que agregues/quites fotos o carpetas de modelo.

const fs = require("fs");
const path = require("path");

const RAIZ_FOTOS = path.join(__dirname, "..", "public-galeria", "fotos");
const SALIDA = path.join(__dirname, "..", "public-galeria", "manifest.json");

const EXT_IMAGEN = /\.(jpe?g|png|webp)$/i;

// Modelos que se manejan como preventa (aun no terminados de construir).
// Clave = nombre exacto de la carpeta del modelo tal como aparece en disco.
const MODELOS_PREVENTA = new Set([
  "Diamante - Casa Modelo Esmeralda Con Alberca - $5,200,000",
]);

// Correcciones puntuales de nombres que llegaron mal desde el ZIP original
// (encoding roto, mayúsculas inconsistentes, sufijos numéricos de carpetas
// que en realidad son el mismo modelo). Clave = nombre de carpeta tal cual
// aparece en disco, valor = nombre real a mostrar.
const CORRECCIONES_NOMBRE = {
  "Rub+¡": "Rubí",
};

function limpiarNombreModelo(nombreCarpeta) {
  // Quita el prefijo del proyecto ("Diamante - " / "Santuario - ")
  let nombre = nombreCarpeta.replace(/^(Diamante|Santuario)\s*-\s*/i, "");
  // Quita el precio al final ("... - $1,780,000")
  nombre = nombre.replace(/\s*-\s*\$[\d,]+\s*$/, "");
  // Quita el prefijo "Casa Modelo "
  nombre = nombre.replace(/^Casa Modelo\s*/i, "");
  // Quita un sufijo numérico suelto al final ("... Ampliada 1" -> "... Ampliada")
  nombre = nombre.replace(/\s+\d+$/, "");
  // Aplica correcciones de encoding/typos conocidas (por palabra completa)
  for (const [malo, bueno] of Object.entries(CORRECCIONES_NOMBRE)) {
    nombre = nombre.split(malo).join(bueno);
  }
  // Normaliza mayúscula inicial de cada palabra (excepto conectores cortos
  // en español, que van en minúscula salvo que sean la primera palabra)
  const CONECTORES = new Set(["y", "a", "de", "del", "en", "con", "la", "el", "los", "las", "sin", "por", "para"]);
  nombre = nombre
    .split(" ")
    .map((palabra, i) => {
      const limpia = palabra.toLowerCase();
      if (i > 0 && CONECTORES.has(limpia)) return limpia;
      return limpia.charAt(0).toUpperCase() + limpia.slice(1);
    })
    .join(" ");
  return nombre.trim();
}

function extraerPrecio(nombreCarpeta) {
  const match = nombreCarpeta.match(/\$([\d,]+)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}

function formatoPrecio(precio) {
  if (precio == null) return null;
  return "$" + precio.toLocaleString("es-MX");
}

function listarImagenes(dirAbsoluto) {
  if (!fs.existsSync(dirAbsoluto)) return [];
  return fs
    .readdirSync(dirAbsoluto)
    .filter((f) => EXT_IMAGEN.test(f))
    .sort((a, b) => {
      // 00_FOLLETO primero, luego el resto en orden alfabético/numérico
      if (/^00_FOLLETO/i.test(a)) return -1;
      if (/^00_FOLLETO/i.test(b)) return 1;
      return a.localeCompare(b, "es", { numeric: true });
    });
}

function rutaPublica(...partes) {
  // Construye la ruta con la que el navegador va a pedir el archivo,
  // relativa a /galeria/ (ver server.js), con cada segmento URL-encoded
  // por separado para preservar acentos, espacios, $ y paréntesis.
  return partes.map((p) => encodeURIComponent(p)).join("/");
}

function procesarProyecto(nombreProyecto) {
  const dirAsesores = path.join(
    RAIZ_FOTOS,
    nombreProyecto,
    "01 Para Redes (Asesores)"
  );
  if (!fs.existsSync(dirAsesores)) return [];

  const carpetasModelo = fs
    .readdirSync(dirAsesores)
    .filter((f) => fs.statSync(path.join(dirAsesores, f)).isDirectory())
    .sort((a, b) => a.localeCompare(b, "es"));

  return carpetasModelo.map((carpeta) => {
    const dirModelo = path.join(dirAsesores, carpeta);
    const precio = extraerPrecio(carpeta);

    const esComun = /jardines y entrada|zona comercial/i.test(carpeta);
    const esTerreno = /terreno/i.test(carpeta);

    // Subcarpeta de fotos adicionales: puede llamarse "Imagenes de
    // Complemento" o (en carpetas viejas) "Planos" — ambas son solo
    // fotos extra, no planos técnicos reales.
    let dirComplemento = path.join(dirModelo, "Imagenes de Complemento");
    if (!fs.existsSync(dirComplemento)) {
      dirComplemento = path.join(dirModelo, "Planos");
    }

    const fotosPrincipales = listarImagenes(dirModelo).map((f) =>
      rutaPublica(
        "fotos",
        nombreProyecto,
        "01 Para Redes (Asesores)",
        carpeta,
        f
      )
    );
    const fotosAdicionales = listarImagenes(dirComplemento).map((f) =>
      rutaPublica(
        "fotos",
        nombreProyecto,
        "01 Para Redes (Asesores)",
        carpeta,
        path.basename(dirComplemento),
        f
      )
    );

    return {
      id: carpeta
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // quita acentos
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
      nombre: esComun
        ? limpiarNombreModelo(carpeta).replace(/\s*\(.*\)$/, "")
        : limpiarNombreModelo(carpeta),
      tipo: esComun ? "comun" : esTerreno ? "terreno" : "casa",
      preventa: MODELOS_PREVENTA.has(carpeta),
      precio,
      precioFormato: formatoPrecio(precio),
      portada: fotosPrincipales[0] || fotosAdicionales[0] || null,
      fotos: fotosPrincipales,
      fotosAdicionales,
      totalFotos: fotosPrincipales.length + fotosAdicionales.length,
    };
  });
}

const manifest = {
  generadoEn: new Date().toISOString(),
  proyectos: [
    { id: "diamante", nombre: "Diamante", modelos: procesarProyecto("Diamante") },
    { id: "santuario", nombre: "Santuario", modelos: procesarProyecto("Santuario") },
  ],
};

fs.writeFileSync(SALIDA, JSON.stringify(manifest, null, 2), "utf-8");

const totalModelos = manifest.proyectos.reduce((n, p) => n + p.modelos.length, 0);
const totalFotos = manifest.proyectos.reduce(
  (n, p) => n + p.modelos.reduce((m, mo) => m + mo.totalFotos, 0),
  0
);
console.log(`✅ manifest.json generado: ${totalModelos} modelos, ${totalFotos} fotos.`);
manifest.proyectos.forEach((p) => {
  console.log(`\n${p.nombre}:`);
  p.modelos.forEach((m) =>
    console.log(
      `  - ${m.nombre}${m.precioFormato ? " (" + m.precioFormato + ")" : ""} [${m.tipo}] -> ${m.totalFotos} fotos`
    )
  );
});
