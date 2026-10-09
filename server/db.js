const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'chat.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sala TEXT NOT NULL,
    de TEXT NOT NULL,
    texto TEXT NOT NULL,
    hora INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sala ON mensagens (sala, hora);
  CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);
`);

// ========== USUÁRIOS ==========

function criarUsuario({ nome, email, senhaHash }) {
  const stmt = db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash, criado_em) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(nome, email.toLowerCase(), senhaHash, Date.now());
  return { id: info.lastInsertRowid, nome, email: email.toLowerCase() };
}

function buscarUsuarioPorEmail(email) {
  const stmt = db.prepare('SELECT * FROM usuarios WHERE email = ?');
  return stmt.get(email.toLowerCase());
}

function buscarUsuarioPorId(id) {
  const stmt = db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?');
  return stmt.get(id);
}

function listarUsuarios() {
  const stmt = db.prepare('SELECT id, nome, email FROM usuarios ORDER BY nome');
  return stmt.all();
}

// ========== MENSAGENS ==========

function salvarMensagem({ sala, de, texto, hora }) {
  const stmt = db.prepare(
    'INSERT INTO mensagens (sala, de, texto, hora) VALUES (?, ?, ?, ?)'
  );
  return stmt.run(sala, de, texto, hora);
}

function buscarHistorico(sala, limite = 50) {
  const stmt = db.prepare(
    `SELECT de, texto, hora FROM mensagens
     WHERE sala = ?
     ORDER BY hora DESC
     LIMIT ?`
  );
  return stmt.all(sala, limite).reverse();
}

function limparHistorico(sala) {
  const stmt = db.prepare('DELETE FROM mensagens WHERE sala = ?');
  return stmt.run(sala);
}

module.exports = {
  criarUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  listarUsuarios,
  salvarMensagem,
  buscarHistorico,
  limparHistorico,
};