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

  CREATE TABLE IF NOT EXISTS amizades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    de_id INTEGER NOT NULL,
    para_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY (de_id) REFERENCES usuarios(id),
    FOREIGN KEY (para_id) REFERENCES usuarios(id),
    UNIQUE(de_id, para_id)
  );

  CREATE TABLE IF NOT EXISTS conversas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_a INTEGER NOT NULL,
    usuario_b INTEGER NOT NULL,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY (usuario_a) REFERENCES usuarios(id),
    FOREIGN KEY (usuario_b) REFERENCES usuarios(id),
    UNIQUE(usuario_a, usuario_b)
  );

  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER NOT NULL,
    de_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    hora INTEGER NOT NULL,
    lida INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (conversa_id) REFERENCES conversas(id),
    FOREIGN KEY (de_id) REFERENCES usuarios(id)
  );

  CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);
  CREATE INDEX IF NOT EXISTS idx_amizades_de ON amizades (de_id);
  CREATE INDEX IF NOT EXISTS idx_amizades_para ON amizades (para_id);
  CREATE INDEX IF NOT EXISTS idx_conversas_a ON conversas (usuario_a);
  CREATE INDEX IF NOT EXISTS idx_conversas_b ON conversas (usuario_b);
  CREATE INDEX IF NOT EXISTS idx_mensagens_conv ON mensagens (conversa_id, hora);
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
  return db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase());
}

function buscarUsuarioPorId(id) {
  return db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?').get(id);
}

function listarUsuarios() {
  return db.prepare('SELECT id, nome, email FROM usuarios ORDER BY nome').all();
}

function buscarUsuariosPorNome(termo, excluirId) {
  const stmt = db.prepare(
    `SELECT id, nome, email FROM usuarios
     WHERE (nome LIKE ? OR email LIKE ?) AND id != ?
     ORDER BY nome
     LIMIT 20`
  );
  const like = `%${termo}%`;
  return stmt.all(like, like, excluirId);
}

// ========== AMIZADES ==========

function buscarAmizadeEntre(a, b) {
  return db.prepare(
    `SELECT * FROM amizades
     WHERE (de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?)`
  ).get(a, b, b, a);
}

function criarPedidoAmizade(deId, paraId) {
  const stmt = db.prepare(
    'INSERT INTO amizades (de_id, para_id, status, criado_em) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(deId, paraId, 'pendente', Date.now());
  return { id: info.lastInsertRowid };
}

function atualizarStatusAmizade(id, status) {
  return db.prepare('UPDATE amizades SET status = ? WHERE id = ?').run(status, id);
}

function deletarAmizade(id) {
  return db.prepare('DELETE FROM amizades WHERE id = ?').run(id);
}

function listarAmigos(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.email, a.id as amizade_id
     FROM amizades a
     JOIN usuarios u ON (
       (a.de_id = u.id AND a.para_id = ?) OR
       (a.para_id = u.id AND a.de_id = ?)
     )
     WHERE a.status = 'aceita'
     ORDER BY u.nome`
  ).all(usuarioId, usuarioId);
}

function saoAmigos(a, b) {
  const x = db.prepare(
    `SELECT 1 FROM amizades
     WHERE status = 'aceita'
       AND ((de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?))`
  ).get(a, b, b, a);
  return !!x;
}

function listarPedidosRecebidos(usuarioId) {
  return db.prepare(
    `SELECT a.id as amizade_id, u.id, u.nome, u.email, a.criado_em
     FROM amizades a
     JOIN usuarios u ON u.id = a.de_id
     WHERE a.para_id = ? AND a.status = 'pendente'
     ORDER BY a.criado_em DESC`
  ).all(usuarioId);
}

function listarPedidosEnviados(usuarioId) {
  return db.prepare(
    `SELECT a.id as amizade_id, u.id, u.nome, u.email, a.criado_em
     FROM amizades a
     JOIN usuarios u ON u.id = a.para_id
     WHERE a.de_id = ? AND a.status = 'pendente'
     ORDER BY a.criado_em DESC`
  ).all(usuarioId);
}

// ========== CONVERSAS ==========

function abrirConversa(idA, idB) {
  // Sempre ordena pra que o par seja único
  const a = Math.min(idA, idB);
  const b = Math.max(idA, idB);

  let conv = db.prepare(
    'SELECT * FROM conversas WHERE usuario_a = ? AND usuario_b = ?'
  ).get(a, b);

  if (!conv) {
    const info = db.prepare(
      'INSERT INTO conversas (usuario_a, usuario_b, criado_em) VALUES (?, ?, ?)'
    ).run(a, b, Date.now());
    conv = { id: info.lastInsertRowid, usuario_a: a, usuario_b: b, criado_em: Date.now() };
  }

  return conv;
}

function buscarConversaPorId(id) {
  return db.prepare('SELECT * FROM conversas WHERE id = ?').get(id);
}

function listarConversas(usuarioId) {
  // Lista todas as conversas do usuário com a última mensagem e count de não lidas
  const conversas = db.prepare(
    `SELECT c.id, c.usuario_a, c.usuario_b,
            CASE WHEN c.usuario_a = ? THEN c.usuario_b ELSE c.usuario_a END AS outro_id
     FROM conversas c
     WHERE c.usuario_a = ? OR c.usuario_b = ?
     ORDER BY c.id DESC`
  ).all(usuarioId, usuarioId, usuarioId);

  const resultado = [];
  for (const c of conversas) {
    const outro = db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?').get(c.outro_id);
    if (!outro) continue;

    const ultima = db.prepare(
      'SELECT de_id, texto, hora FROM mensagens WHERE conversa_id = ? ORDER BY hora DESC LIMIT 1'
    ).get(c.id);

    const naoLidas = db.prepare(
      'SELECT COUNT(*) as n FROM mensagens WHERE conversa_id = ? AND de_id != ? AND lida = 0'
    ).get(c.id, usuarioId).n;

    resultado.push({
      conversa_id: c.id,
      amigo: outro,
      ultima: ultima || null,
      nao_lidas: naoLidas,
    });
  }

  // Ordena por última mensagem (mais recente em cima)
  resultado.sort((x, y) => {
    const tx = x.ultima ? x.ultima.hora : 0;
    const ty = y.ultima ? y.ultima.hora : 0;
    return ty - tx;
  });

  return resultado;
}

// ========== MENSAGENS ==========

function salvarMensagem({ conversaId, deId, texto }) {
  const stmt = db.prepare(
    'INSERT INTO mensagens (conversa_id, de_id, texto, hora, lida) VALUES (?, ?, ?, ?, 0)'
  );
  const hora = Date.now();
  const info = stmt.run(conversaId, deId, texto, hora);
  return { id: info.lastInsertRowid, conversa_id: conversaId, de_id: deId, texto, hora, lida: 0 };
}

function listarMensagens(conversaId, limite = 100) {
  return db.prepare(
    `SELECT m.id, m.de_id, u.nome AS de_nome, m.texto, m.hora, m.lida
     FROM mensagens m
     JOIN usuarios u ON u.id = m.de_id
     WHERE m.conversa_id = ?
     ORDER BY m.hora DESC
     LIMIT ?`
  ).all(conversaId, limite).reverse();
}

function marcarComoLidas(conversaId, usuarioId) {
  return db.prepare(
    'UPDATE mensagens SET lida = 1 WHERE conversa_id = ? AND de_id != ? AND lida = 0'
  ).run(conversaId, usuarioId);
}

function limparHistoricoConversa(conversaId) {
  return db.prepare('DELETE FROM mensagens WHERE conversa_id = ?').run(conversaId);
}

module.exports = {
  criarUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  listarUsuarios,
  buscarUsuariosPorNome,
  buscarAmizadeEntre,
  criarPedidoAmizade,
  atualizarStatusAmizade,
  deletarAmizade,
  listarAmigos,
  saoAmigos,
  listarPedidosRecebidos,
  listarPedidosEnviados,
  abrirConversa,
  buscarConversaPorId,
  listarConversas,
  salvarMensagem,
  listarMensagens,
  marcarComoLidas,
  limparHistoricoConversa,
};