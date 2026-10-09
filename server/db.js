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
    UNIQUE(usuario_a, usuario_b)
  );

  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER NOT NULL,
    de_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    hora INTEGER NOT NULL,
    lida INTEGER NOT NULL DEFAULT 0
  );

  -- NOVAS: SERVIDORES
  CREATE TABLE IF NOT EXISTS servidores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    descricao TEXT DEFAULT '',
    dono_id INTEGER NOT NULL,
    codigo_convite TEXT NOT NULL UNIQUE,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY (dono_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS membros_servidor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    servidor_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    entrou_em INTEGER NOT NULL,
    FOREIGN KEY (servidor_id) REFERENCES servidores(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    UNIQUE(servidor_id, usuario_id)
  );

  CREATE TABLE IF NOT EXISTS canais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    servidor_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY (servidor_id) REFERENCES servidores(id)
  );

  CREATE TABLE IF NOT EXISTS mensagens_canal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canal_id INTEGER NOT NULL,
    de_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    hora INTEGER NOT NULL,
    FOREIGN KEY (canal_id) REFERENCES canais(id),
    FOREIGN KEY (de_id) REFERENCES usuarios(id)
  );

  CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);
  CREATE INDEX IF NOT EXISTS idx_amizades_de ON amizades (de_id);
  CREATE INDEX IF NOT EXISTS idx_amizades_para ON amizades (para_id);
  CREATE INDEX IF NOT EXISTS idx_conversas_a ON conversas (usuario_a);
  CREATE INDEX IF NOT EXISTS idx_conversas_b ON conversas (usuario_b);
  CREATE INDEX IF NOT EXISTS idx_mensagens_conv ON mensagens (conversa_id, hora);
  CREATE INDEX IF NOT EXISTS idx_membros_usuario ON membros_servidor (usuario_id);
  CREATE INDEX IF NOT EXISTS idx_membros_servidor ON membros_servidor (servidor_id);
  CREATE INDEX IF NOT EXISTS idx_canais_servidor ON canais (servidor_id);
  CREATE INDEX IF NOT EXISTS idx_msg_canal ON mensagens_canal (canal_id, hora);
`);

// ========== USUÁRIOS (mantidos iguais) ==========

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
     ORDER BY nome LIMIT 20`
  );
  const like = `%${termo}%`;
  return stmt.all(like, like, excluirId);
}

// ========== AMIZADES (mantidas) ==========

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

// ========== CONVERSAS / DMs (mantidas) ==========

function abrirConversa(idA, idB) {
  const a = Math.min(idA, idB);
  const b = Math.max(idA, idB);
  let conv = db.prepare('SELECT * FROM conversas WHERE usuario_a = ? AND usuario_b = ?').get(a, b);
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
    resultado.push({ conversa_id: c.id, amigo: outro, ultima: ultima || null, nao_lidas: naoLidas });
  }
  resultado.sort((x, y) => ((y.ultima?.hora || 0) - (x.ultima?.hora || 0)));
  return resultado;
}

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
     FROM mensagens m JOIN usuarios u ON u.id = m.de_id
     WHERE m.conversa_id = ? ORDER BY m.hora DESC LIMIT ?`
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

// ========== SERVIDORES ==========

function gerarCodigoConvite() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
  return codigo;
}

function criarServidor({ nome, descricao, donoId }) {
  let codigo;
  // Garante código único
  do { codigo = gerarCodigoConvite(); }
  while (db.prepare('SELECT 1 FROM servidores WHERE codigo_convite = ?').get(codigo));

  const info = db.prepare(
    'INSERT INTO servidores (nome, descricao, dono_id, codigo_convite, criado_em) VALUES (?, ?, ?, ?, ?)'
  ).run(nome, descricao || '', donoId, codigo, Date.now());

  const servidorId = info.lastInsertRowid;

  // Adiciona dono como membro
  db.prepare(
    'INSERT INTO membros_servidor (servidor_id, usuario_id, entrou_em) VALUES (?, ?, ?)'
  ).run(servidorId, donoId, Date.now());

  // Cria canal #geral padrão
  db.prepare(
    'INSERT INTO canais (servidor_id, nome, criado_em) VALUES (?, ?, ?)'
  ).run(servidorId, 'geral', Date.now());

  return {
    id: servidorId,
    nome,
    descricao: descricao || '',
    dono_id: donoId,
    codigo_convite: codigo,
    criado_em: Date.now(),
  };
}

function buscarServidorPorId(id) {
  return db.prepare('SELECT * FROM servidores WHERE id = ?').get(id);
}

function buscarServidorPorCodigo(codigo) {
  return db.prepare('SELECT * FROM servidores WHERE codigo_convite = ?').get(codigo.toUpperCase());
}

function listarServidoresDoUsuario(usuarioId) {
  return db.prepare(
    `SELECT s.* FROM servidores s
     JOIN membros_servidor m ON m.servidor_id = s.id
     WHERE m.usuario_id = ?
     ORDER BY s.criado_em`
  ).all(usuarioId);
}

function ehMembro(servidorId, usuarioId) {
  const x = db.prepare(
    'SELECT 1 FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?'
  ).get(servidorId, usuarioId);
  return !!x;
}

function adicionarMembro(servidorId, usuarioId) {
  const existente = db.prepare(
    'SELECT id FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?'
  ).get(servidorId, usuarioId);

  if (existente) return false;

  db.prepare(
    'INSERT INTO membros_servidor (servidor_id, usuario_id, entrou_em) VALUES (?, ?, ?)'
  ).run(servidorId, usuarioId, Date.now());
  return true;
}

function removerMembro(servidorId, usuarioId) {
  return db.prepare(
    'DELETE FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?'
  ).run(servidorId, usuarioId);
}

function listarMembros(servidorId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.email, m.entrou_em
     FROM membros_servidor m
     JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.servidor_id = ?
     ORDER BY u.nome`
  ).all(servidorId);
}

function deletarServidor(id, donoId) {
  const s = db.prepare('SELECT dono_id FROM servidores WHERE id = ?').get(id);
  if (!s || s.dono_id !== donoId) return false;

  db.prepare('DELETE FROM mensagens_canal WHERE canal_id IN (SELECT id FROM canais WHERE servidor_id = ?)').run(id);
  db.prepare('DELETE FROM canais WHERE servidor_id = ?').run(id);
  db.prepare('DELETE FROM membros_servidor WHERE servidor_id = ?').run(id);
  db.prepare('DELETE FROM servidores WHERE id = ?').run(id);
  return true;
}

// ========== CANAIS ==========

function criarCanal(servidorId, nome) {
  const nomeLimpo = nome.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!nomeLimpo) return null;

  const existente = db.prepare(
    'SELECT 1 FROM canais WHERE servidor_id = ? AND nome = ?'
  ).get(servidorId, nomeLimpo);
  if (existente) return null;

  const info = db.prepare(
    'INSERT INTO canais (servidor_id, nome, criado_em) VALUES (?, ?, ?)'
  ).run(servidorId, nomeLimpo, Date.now());

  return { id: info.lastInsertRowid, servidor_id: servidorId, nome: nomeLimpo, criado_em: Date.now() };
}

function listarCanais(servidorId) {
  return db.prepare(
    'SELECT id, servidor_id, nome, criado_em FROM canais WHERE servidor_id = ? ORDER BY id'
  ).all(servidorId);
}

function buscarCanalPorId(id) {
  return db.prepare('SELECT * FROM canais WHERE id = ?').get(id);
}

function deletarCanal(id, usuarioId) {
  const c = db.prepare(
    `SELECT c.*, s.dono_id
     FROM canais c JOIN servidores s ON s.id = c.servidor_id
     WHERE c.id = ?`
  ).get(id);
  if (!c || c.dono_id !== usuarioId) return false;

  db.prepare('DELETE FROM mensagens_canal WHERE canal_id = ?').run(id);
  db.prepare('DELETE FROM canais WHERE id = ?').run(id);
  return true;
}

// ========== MENSAGENS DE CANAL ==========

function salvarMensagemCanal({ canalId, deId, texto }) {
  const stmt = db.prepare(
    'INSERT INTO mensagens_canal (canal_id, de_id, texto, hora) VALUES (?, ?, ?, ?)'
  );
  const hora = Date.now();
  const info = stmt.run(canalId, deId, texto, hora);
  return { id: info.lastInsertRowid, canal_id: canalId, de_id: deId, texto, hora };
}

function listarMensagensCanal(canalId, limite = 100) {
  return db.prepare(
    `SELECT m.id, m.de_id, u.nome AS de_nome, m.texto, m.hora
     FROM mensagens_canal m JOIN usuarios u ON u.id = m.de_id
     WHERE m.canal_id = ? ORDER BY m.hora DESC LIMIT ?`
  ).all(canalId, limite).reverse();
}

function limparMensagensCanal(canalId) {
  return db.prepare('DELETE FROM mensagens_canal WHERE canal_id = ?').run(canalId);
}

module.exports = {
  // usuários
  criarUsuario, buscarUsuarioPorEmail, buscarUsuarioPorId, listarUsuarios, buscarUsuariosPorNome,
  // amizades
  buscarAmizadeEntre, criarPedidoAmizade, atualizarStatusAmizade, deletarAmizade,
  listarAmigos, saoAmigos, listarPedidosRecebidos, listarPedidosEnviados,
  // DMs
  abrirConversa, buscarConversaPorId, listarConversas, salvarMensagem,
  listarMensagens, marcarComoLidas, limparHistoricoConversa,
  // servidores
  criarServidor, buscarServidorPorId, buscarServidorPorCodigo,
  listarServidoresDoUsuario, ehMembro, adicionarMembro, removerMembro,
  listarMembros, deletarServidor,
  // canais
  criarCanal, listarCanais, buscarCanalPorId, deletarCanal,
  // mensagens de canal
  salvarMensagemCanal, listarMensagensCanal, limparMensagensCanal,
};