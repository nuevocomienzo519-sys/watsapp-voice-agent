// lib/confirmacionesPendientes.js
const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', 'data', 'confirmaciones_pendientes.json');

function leerTodas() {
  try {
    return JSON.parse(fs.readFileSync(RUTA, 'utf8'));
  } catch {
    return {};
  }
}

function guardarTodas(obj) {
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(obj, null, 2));
}

function guardarPendiente(chatId, datos) {
  const todas = leerTodas();
  todas[chatId] = datos;
  guardarTodas(todas);
}

function leerPendiente(chatId) {
  return leerTodas()[chatId] || null;
}

function borrarPendiente(chatId) {
  const todas = leerTodas();
  delete todas[chatId];
  guardarTodas(todas);
}

module.exports = { guardarPendiente, leerPendiente, borrarPendiente };
