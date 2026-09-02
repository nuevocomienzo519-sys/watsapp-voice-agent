const owner = "nuevocomienzo519-sys";
const repo = "watsapp-voice-agent";
const path = "public-galeria/fotos";

async function cargarGaleriaDinamica() {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  
  try {
    const response = await fetch(url);
    const archivos = await response.json();
    
    const contenedor = document.getElementById("contenedor-galeria");
    if (!contenedor) return;
    
    // Limpiamos el contenedor por si hay contenido estático de prueba
    contenedor.innerHTML = "";
    
    archivos.forEach(archivo => {
      // Filtramos solo archivos que sean imágenes
      if (archivo.type === "file" && /\.(jpg|jpeg|png|webp|gif)$/i.test(archivo.name)) {
        const card = document.createElement("div");
        card.className = "foto-card";
        
        const img = document.createElement("img");
        img.src = archivo.download_url;
        img.alt = archivo.name;
        
        const p = document.createElement("p");
        p.textContent = archivo.name;
        
        card.appendChild(img);
        card.appendChild(p);
        contenedor.appendChild(card);
      }
    });
  } catch (error) {
    console.error("Error al cargar las fotos desde GitHub:", error);
  }
}

document.addEventListener("DOMContentLoaded", cargarGaleriaDinamica);
