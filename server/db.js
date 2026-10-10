const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'chat.db');
const db = new Database(DB_PATH);

// 🔥 WAL + foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// CRIAÇÃO DAS TABELAS
// ============================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    banner TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS amizades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_a INTEGER NOT NULL,
    usuario_b INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    FOREIGN KEY (usuario_a) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_b) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bloqueios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bloqueador_id INTEGER NOT NULL,
    bloqueado_id INTEGER NOT NULL,
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(bloqueador_id, bloqueado_id),
    FOREIGN KEY (bloqueador_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (bloqueado_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS silenciados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    alvo_id INTEGER NOT NULL,
    UNIQUE(usuario_id, tipo, alvo_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_a INTEGER NOT NULL,
    usuario_b INTEGER NOT NULL,
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(usuario_a, usuario_b),
    FOREIGN KEY (usuario_a) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_b) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER NOT NULL,
    de_id INTEGER NOT NULL,
    texto TEXT DEFAULT '',
    reply_id INTEGER,
    reply_autor TEXT,
    reply_texto TEXT,
    anexo TEXT,
    hora INTEGER DEFAULT (strftime('%s','now') * 1000),
    editado INTEGER DEFAULT 0,
    lida INTEGER DEFAULT 0,
    FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE,
    FOREIGN KEY (de_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS servidores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    descricao TEXT DEFAULT '',
    dono_id INTEGER NOT NULL,
    codigo_convite TEXT UNIQUE NOT NULL,
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    FOREIGN KEY (dono_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS membros_servidor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    servidor_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    entrou_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(servidor_id, usuario_id),
    FOREIGN KEY (servidor_id) REFERENCES servidores(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS canais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    servidor_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(servidor_id, nome),
    FOREIGN KEY (servidor_id) REFERENCES servidores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mensagens_canal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canal_id INTEGER NOT NULL,
    de_id INTEGER NOT NULL,
    texto TEXT DEFAULT '',
    reply_id INTEGER,
    reply_autor TEXT,
    reply_texto TEXT,
    anexo TEXT,
    hora INTEGER DEFAULT (strftime('%s','now') * 1000),
    editado INTEGER DEFAULT 0,
    FOREIGN KEY (canal_id) REFERENCES canais(id) ON DELETE CASCADE,
    FOREIGN KEY (de_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    alvo_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(tipo, alvo_id, usuario_id, emoji),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens(conversa_id);
  CREATE INDEX IF NOT EXISTS idx_mensagens_canal ON mensagens_canal(canal_id);
  CREATE INDEX IF NOT EXISTS idx_reacoes_alvo ON reacoes(tipo, alvo_id);
  CREATE INDEX IF NOT EXISTS idx_amizades_usuarios ON amizades(usuario_a, usuario_b);
  CREATE INDEX IF NOT EXISTS idx_membros_servidor ON membros_servidor(servidor_id);
  CREATE INDEX IF NOT EXISTS idx_membros_usuario ON membros_servidor(usuario_id);
`);

// ============================================================
// USUÁRIOS
// ============================================================

function buscarUsuarioPorId(id) {
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

function buscarUsuarioPorEmail(email) {
  return db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
}

function criarUsuario({ nome, email, senhaHash }) {
  const info = db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)'
  ).run(nome, email, senhaHash);
  const usuario = buscarUsuarioPorId(info.lastInsertRowid);
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    avatar: usuario.avatar || '',
    banner: usuario.banner || '',
    bio: usuario.bio || '',
  };
}

function atualizarAvatar(id, avatar) {
  db.prepare('UPDATE usuarios SET avatar = ? WHERE id = ?').run(avatar, id);
}

function atualizarBanner(id, banner) {
  db.prepare('UPDATE usuarios SET banner = ? WHERE id = ?').run(banner, id);
}

function atualizarBio(id, bio) {
  db.prepare('UPDATE usuarios SET bio = ? WHERE id = ?').run(bio, id);
}

function buscarUsuariosPorNome(q, excetoId) {
  return db.prepare(
    `SELECT id, nome, email, avatar, banner, bio
     FROM usuarios
     WHERE nome LIKE ? AND id != ?
     LIMIT 20`
  ).all('%' + q + '%', excetoId);
}

// ============================================================
// AMIZADES
// ============================================================

function buscarAmizadeEntre(a, b) {
  return db.prepare(
    `SELECT * FROM amizades
     WHERE (usuario_a = ? AND usuario_b = ?) OR (usuario_a = ? AND usuario_b = ?)`
  ).get(a, b, b, a);
}

function criarPedidoAmizade(deId, paraId) {
  const info = db.prepare(
    'INSERT INTO amizades (usuario_a, usuario_b, status) VALUES (?, ?, ?)'
  ).run(deId, paraId, 'pendente');
  return { id: info.lastInsertRowid, de_id: deId, para_id: paraId, status: 'pendente' };
}

function atualizarStatusAmizade(id, status) {
  db.prepare('UPDATE amizades SET status = ? WHERE id = ?').run(status, id);
}

function deletarAmizade(id) {
  db.prepare('DELETE FROM amizades WHERE id = ?').run(id);
}

function listarAmigos(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.avatar, u.banner, u.bio, a.id as amizade_id
     FROM amizades a
     JOIN usuarios u ON (u.id = a.usuario_a OR u.id = a.usuario_b)
     WHERE a.status = 'aceita'
       AND (a.usuario_a = ? OR a.usuario_b = ?)
       AND u.id != ?`
  ).all(usuarioId, usuarioId, usuarioId);
}

function listarPedidosRecebidos(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.avatar, a.id as amizade_id, a.criado_em
     FROM amizades a
     JOIN usuarios u ON u.id = a.usuario_a
     WHERE a.usuario_b = ? AND a.status = 'pendente'`
  ).all(usuarioId);
}

function listarPedidosEnviados(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.avatar, a.id as amizade_id, a.criado_em
     FROM amizades a
     JOIN usuarios u ON u.id = a.usuario_b
     WHERE a.usuario_a = ? AND a.status = 'pendente'`
  ).all(usuarioId);
}

function saoAmigos(a, b) {
  const amz = db.prepare(
    `SELECT * FROM amizades
     WHERE status = 'aceita'
       AND ((usuario_a = ? AND usuario_b = ?) OR (usuario_a = ? AND usuario_b = ?))`
  ).get(a, b, b, a);
  return !!amz;
}

// ============================================================
// BLOQUEIOS
// ============================================================

function bloquear(bloqueadorId, bloqueadoId) {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO bloqueios (bloqueador_id, bloqueado_id) VALUES (?, ?)'
    ).run(bloqueadorId, bloqueadoId);
  } catch (e) {}
}

function desbloquear(bloqueadorId, bloqueadoId) {
  db.prepare(
    'DELETE FROM bloqueios WHERE bloqueador_id = ? AND bloqueado_id = ?'
  ).run(bloqueadorId, bloqueadoId);
}

function estaBloqueado(bloqueadorId, bloqueadoId) {
  const r = db.prepare(
    'SELECT 1 FROM bloqueios WHERE bloqueador_id = ? AND bloqueado_id = ?'
  ).get(bloqueadorId, bloqueadoId);
  return !!r;
}

function listarBloqueados(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.avatar
     FROM bloqueios b
     JOIN usuarios u ON u.id = b.bloqueado_id
     WHERE b.bloqueador_id = ?`
  ).all(usuarioId);
}

// ============================================================
// SILENCIADOS
// ============================================================

function silenciar(usuarioId, tipo, alvoId) {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO silenciados (usuario_id, tipo, alvo_id) VALUES (?, ?, ?)'
    ).run(usuarioId, tipo, alvoId);
  } catch (e) {}
}

function dessilenciar(usuarioId, tipo, alvoId) {
  db.prepare(
    'DELETE FROM silenciados WHERE usuario_id = ? AND tipo = ? AND alvo_id = ?'
  ).run(usuarioId, tipo, alvoId);
}

function estaSilenciado(usuarioId, tipo, alvoId) {
  const r = db.prepare(
    'SELECT 1 FROM silenciados WHERE usuario_id = ? AND tipo = ? AND alvo_id = ?'
  ).get(usuarioId, tipo, alvoId);
  return !!r;
}

// ============================================================
// CONVERSAS E MENSAGENS
// ============================================================

function abrirConversa(a, b) {
  const [menor, maior] = [a, b].sort((x, y) => x - y);
  let conv = db.prepare(
    'SELECT * FROM conversas WHERE usuario_a = ? AND usuario_b = ?'
  ).get(menor, maior);
  if (!conv) {
    const info = db.prepare(
      'INSERT INTO conversas (usuario_a, usuario_b) VALUES (?, ?)'
    ).run(menor, maior);
    conv = { id: info.lastInsertRowid, usuario_a: menor, usuario_b: maior };
  }
  return conv;
}

function buscarConversaPorId(id) {
  return db.prepare('SELECT * FROM conversas WHERE id = ?').get(id);
}

function listarConversas(usuarioId) {
  const conversas = db.prepare(
    `SELECT c.*,
      CASE WHEN c.usuario_a = ? THEN c.usuario_b ELSE c.usuario_a END as amigo_id
     FROM conversas c
     WHERE c.usuario_a = ? OR c.usuario_b = ?
     ORDER BY c.id DESC`
  ).all(usuarioId, usuarioId, usuarioId);

  return conversas.map((c) => {
    const amigo = buscarUsuarioPorId(c.amigo_id);
    const ultima = db.prepare(
      'SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY id DESC LIMIT 1'
    ).get(c.id);
    const naoLidas = db.prepare(
      'SELECT COUNT(*) as n FROM mensagens WHERE conversa_id = ? AND de_id != ? AND lida = 0'
    ).get(c.id, usuarioId).n;
    return {
      conversa_id: c.id,
      amigo: amigo ? {
        id: amigo.id, nome: amigo.nome, email: amigo.email,
        avatar: amigo.avatar || '', banner: amigo.banner || '', bio: amigo.bio || '',
      } : null,
      ultima: ultima || null,
      nao_lidas: naoLidas,
      silenciado: estaSilenciado(usuarioId, 'usuario', c.amigo_id),
    };
  });
}

function salvarMensagem({ conversaId, deId, texto, replyId, replyAutor, replyTexto, anexo }) {
  const info = db.prepare(
    `INSERT INTO mensagens (conversa_id, de_id, texto, reply_id, reply_autor, reply_texto, anexo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    conversaId, deId, texto || '',
    replyId || null, replyAutor || null, replyTexto || null,
    anexo ? JSON.stringify(anexo) : null
  );
  return buscarMensagemPorId(info.lastInsertRowid);
}

function buscarMensagemPorId(id) {
  const m = db.prepare('SELECT * FROM mensagens WHERE id = ?').get(id);
  if (m && m.anexo) {
    try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; }
  }
  return m;
}

function listarMensagens(conversaId) {
  const msgs = db.prepare(
    'SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY id ASC LIMIT 200'
  ).all(conversaId);
  return msgs.map((m) => {
    if (m.anexo) {
      try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; }
    }
    return m;
  });
}

function editarMensagem(id, texto) {
  db.prepare('UPDATE mensagens SET texto = ?, editado = 1 WHERE id = ?').run(texto, id);
}

function deletarMensagem(id) {
  db.prepare('DELETE FROM mensagens WHERE id = ?').run(id);
}

function limparHistoricoConversa(conversaId) {
  db.prepare('DELETE FROM mensagens WHERE conversa_id = ?').run(conversaId);
}

function marcarComoLidas(conversaId, usuarioId) {
  db.prepare(
    'UPDATE mensagens SET lida = 1 WHERE conversa_id = ? AND de_id != ?'
  ).run(conversaId, usuarioId);
}

// ============================================================
// SERVIDORES
// ============================================================

function gerarCodigoConvite() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += chars[Math.floor(Math.random() * chars.length)];
  }
  return codigo;
}

function criarServidor({ nome, descricao, donoId }) {
  let codigo;
  let tentativas = 0;
  do {
    codigo = gerarCodigoConvite();
    tentativas++;
  } while (db.prepare('SELECT 1 FROM servidores WHERE codigo_convite = ?').get(codigo) && tentativas < 10);

  const info = db.prepare(
    'INSERT INTO servidores (nome, descricao, dono_id, codigo_convite) VALUES (?, ?, ?, ?)'
  ).run(nome, descricao || '', donoId, codigo);

  const servidorId = info.lastInsertRowid;
  db.prepare(
    'INSERT INTO membros_servidor (servidor_id, usuario_id) VALUES (?, ?)'
  ).run(servidorId, donoId);

  db.prepare(
    'INSERT INTO canais (servidor_id, nome) VALUES (?, ?)'
  ).run(servidorId, 'geral');

  return buscarServidorPorId(servidorId);
}

function buscarServidorPorId(id) {
  return db.prepare('SELECT * FROM servidores WHERE id = ?').get(id);
}

function buscarServidorPorCodigo(codigo) {
  return db.prepare('SELECT * FROM servidores WHERE codigo_convite = ?').get(codigo);
}

function listarServidoresDoUsuario(usuarioId) {
  return db.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM membros_servidor WHERE servidor_id = s.id) as total_membros
     FROM servidores s
     JOIN membros_servidor m ON m.servidor_id = s.id
     WHERE m.usuario_id = ?
     ORDER BY s.id ASC`
  ).all(usuarioId);
}

function atualizarServidor(id, { nome, descricao }) {
  db.prepare('UPDATE servidores SET nome = ?, descricao = ? WHERE id = ?').run(nome, descricao, id);
}

function deletarServidor(id, donoId) {
  const s = buscarServidorPorId(id);
  if (!s || s.dono_id !== donoId) return false;
  db.prepare('DELETE FROM servidores WHERE id = ?').run(id);
  return true;
}

function ehMembro(servidorId, usuarioId) {
  const r = db.prepare(
    'SELECT 1 FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?'
  ).get(servidorId, usuarioId);
  return !!r;
}

function adicionarMembro(servidorId, usuarioId) {
  try {
    db.prepare(
      'INSERT INTO membros_servidor (servidor_id, usuario_id) VALUES (?, ?)'
    ).run(servidorId, usuarioId);
    return true;
  } catch (e) {
    return false;
  }
}

function removerMembro(servidorId, usuarioId) {
  db.prepare(
    'DELETE FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?'
  ).run(servidorId, usuarioId);
}

function listarMembros(servidorId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.avatar
     FROM membros_servidor m
     JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.servidor_id = ?
     ORDER BY u.nome ASC`
  ).all(servidorId);
}

// ============================================================
// CANAIS
// ============================================================

function criarCanal(servidorId, nome) {
  const nomeLimpo = nome.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!nomeLimpo) return null;
  try {
    const info = db.prepare(
      'INSERT INTO canais (servidor_id, nome) VALUES (?, ?)'
    ).run(servidorId, nomeLimpo);
    return { id: info.lastInsertRowid, servidor_id: servidorId, nome: nomeLimpo };
  } catch (e) {
    return null;
  }
}

function buscarCanalPorId(id) {
  return db.prepare('SELECT * FROM canais WHERE id = ?').get(id);
}

function listarCanais(servidorId) {
  return db.prepare('SELECT * FROM canais WHERE servidor_id = ? ORDER BY id ASC').all(servidorId);
}

function deletarCanal(id, donoId) {
  const c = buscarCanalPorId(id);
  if (!c) return false;
  const s = buscarServidorPorId(c.servidor_id);
  if (!s || s.dono_id !== donoId) return false;
  db.prepare('DELETE FROM canais WHERE id = ?').run(id);
  return true;
}

// ============================================================
// MENSAGENS DE CANAL
// ============================================================

function salvarMensagemCanal({ canalId, deId, texto, replyId, replyAutor, replyTexto, anexo }) {
  const info = db.prepare(
    `INSERT INTO mensagens_canal (canal_id, de_id, texto, reply_id, reply_autor, reply_texto, anexo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    canalId, deId, texto || '',
    replyId || null, replyAutor || null, replyTexto || null,
    anexo ? JSON.stringify(anexo) : null
  );
  return buscarMensagemCanalPorId(info.lastInsertRowid);
}

function buscarMensagemCanalPorId(id) {
  const m = db.prepare('SELECT * FROM mensagens_canal WHERE id = ?').get(id);
  if (m && m.anexo) {
    try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; }
  }
  return m;
}

function listarMensagensCanal(canalId) {
  const msgs = db.prepare(
    'SELECT * FROM mensagens_canal WHERE canal_id = ? ORDER BY id ASC LIMIT 200'
  ).all(canalId);
  return msgs.map((m) => {
    if (m.anexo) {
      try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; }
    }
    return m;
  });
}

function editarMensagemCanal(id, texto) {
  db.prepare('UPDATE mensagens_canal SET texto = ?, editado = 1 WHERE id = ?').run(texto, id);
}

function deletarMensagemCanal(id) {
  db.prepare('DELETE FROM mensagens_canal WHERE id = ?').run(id);
}

// ============================================================
// REAÇÕES
// ============================================================

function adicionarReacao({ tipo, alvoId, usuarioId, emoji }) {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO reacoes (tipo, alvo_id, usuario_id, emoji) VALUES (?, ?, ?, ?)'
    ).run(tipo, alvoId, usuarioId, emoji);
  } catch (e) {}
}

function removerReacao({ tipo, alvoId, usuarioId, emoji }) {
  const info = db.prepare(
    'DELETE FROM reacoes WHERE tipo = ? AND alvo_id = ? AND usuario_id = ? AND emoji = ?'
  ).run(tipo, alvoId, usuarioId, emoji);
  return { changes: info.changes };
}

function listarReacoesDeMensagens(tipo, ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT alvo_id, emoji, usuario_id FROM reacoes
     WHERE tipo = ? AND alvo_id IN (${placeholders})`
  ).all(tipo, ...ids);
  const mapa = {};
  rows.forEach((r) => {
    if (!mapa[r.alvo_id]) mapa[r.alvo_id] = {};
    if (!mapa[r.alvo_id][r.emoji]) mapa[r.alvo_id][r.emoji] = [];
    mapa[r.alvo_id][r.emoji].push(r.usuario_id);
  });
  return mapa;
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  buscarUsuarioPorId,
  buscarUsuarioPorEmail,
  criarUsuario,
  atualizarAvatar,
  atualizarBanner,
  atualizarBio,
  buscarUsuariosPorNome,
  buscarAmizadeEntre,
  criarPedidoAmizade,
  atualizarStatusAmizade,
  deletarAmizade,
  listarAmigos,
  listarPedidosRecebidos,
  listarPedidosEnviados,
  saoAmigos,
  bloquear,
  desbloquear,
  estaBloqueado,
  listarBloqueados,
  silenciar,
  dessilenciar,
  estaSilenciado,
  abrirConversa,
  buscarConversaPorId,
  listarConversas,
  salvarMensagem,
  buscarMensagemPorId,
  listarMensagens,
  editarMensagem,
  deletarMensagem,
  limparHistoricoConversa,
  marcarComoLidas,
  criarServidor,
  buscarServidorPorId,
  buscarServidorPorCodigo,
  listarServidoresDoUsuario,
  atualizarServidor,
  deletarServidor,
  ehMembro,
  adicionarMembro,
  removerMembro,
  listarMembros,
  criarCanal,
  buscarCanalPorId,
  listarCanais,
  deletarCanal,
  salvarMensagemCanal,
  buscarMensagemCanalPorId,
  listarMensagensCanal,
  editarMensagemCanal,
  deletarMensagemCanal,
  adicionarReacao,
  removerReacao,
  listarReacoesDeMensagens,
}; 