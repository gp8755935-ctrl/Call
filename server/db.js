const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'chat.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sala TEXT NOT NULL,
    de TEXT NOT NULL,
    texto TEXT NOT NULL,
    hora INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sala ON mensagens (sala, hora);
`);

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
  salvarMensagem,
  buscarHistorico,
  limparHistorico,
};