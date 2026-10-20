const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'chat.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// MIGRAÇÃO (B3 - não destrutiva quando possível)
// ============================================================
function migrarBanco() {
  try {
    const tabelaExiste = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='amizades'"
    ).get();

    if (!tabelaExiste) return;

    const colunas = db.prepare('PRAGMA table_info(amizades)').all();
    const nomesColunas = colunas.map((c) => c.name);

    // Schema antigo sem usuario_a/usuario_b: tenta reconstruir preservando o que der
    if (!nomesColunas.includes('usuario_a') || !nomesColunas.includes('usuario_b')) {
      console.log('🔧 Migrando tabela amizades (schema antigo detectado)...');

      try {
        db.exec('ALTER TABLE amizades RENAME TO amizades_backup');
        console.log('   Backup criado: amizades_backup');
      } catch (e) {
        console.warn('   Não foi possível renomear para backup:', e.message);
        db.exec('DROP TABLE IF EXISTS amizades');
      }
    }
  } catch (e) {
    console.warn('Aviso na migração:', e.message);
  }
}
migrarBanco();

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

  -- 🔥 ADICIONADA A COLUNA TIPO AQUI
  CREATE TABLE IF NOT EXISTS canais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    servidor_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT DEFAULT 'texto',
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

// 🔥 SCRIPT DE MIGRAÇÃO PARA O BANCO DE DADOS ATUAL
// Se a tabela canais já existia (sem a coluna tipo), isso adiciona a coluna sem apagar nada
try {
  db.exec("ALTER TABLE canais ADD COLUMN tipo TEXT DEFAULT 'texto'");
  console.log('✅ Coluna "tipo" adicionada à tabela canais.');
} catch (e) {
  // Se cair aqui, é porque a coluna já existe. Pode ignorar.
}

// ============================================================
// USUÁRIOS (M2 - opção de colunas leves)
// ============================================================
function buscarUsuarioPorId(id) {
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) return null;
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(idNum);
}

function buscarUsuarioLevePorId(id) {
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) return null;
  return db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?').get(idNum);
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
    id: usuario.id, nome: usuario.nome, email: usuario.email,
    avatar: usuario.avatar || '', banner: usuario.banner || '', bio: usuario.bio || '',
  };
}

function atualizarAvatar(id, avatar) {
  db.prepare('UPDATE usuarios SET avatar = ? WHERE id = ?').run(avatar, Number(id));
}

function atualizarBanner(id, banner) {
  db.prepare('UPDATE usuarios SET banner = ? WHERE id = ?').run(banner, Number(id));
}

function atualizarBio(id, bio) {
  db.prepare('UPDATE usuarios SET bio = ? WHERE id = ?').run(bio, Number(id));
}

function buscarUsuariosPorNome(q, excetoId) {
  return db.prepare(
    `SELECT id, nome, avatar, banner, bio
     FROM usuarios WHERE nome LIKE ? AND id != ? LIMIT 20`
  ).all('%' + q + '%', Number(excetoId));
}

// ============================================================
// AMIZADES
// ============================================================
function buscarAmizadeEntre(a, b) {
  return db.prepare(
    `SELECT * FROM amizades WHERE (usuario_a = ? AND usuario_b = ?) OR (usuario_a = ? AND usuario_b = ?)`
  ).get(Number(a), Number(b), Number(b), Number(a));
}

function criarPedidoAmizade(deId, paraId) {
  const info = db.prepare(
    'INSERT INTO amizades (usuario_a, usuario_b, status) VALUES (?, ?, ?)'
  ).run(Number(deId), Number(paraId), 'pendente');
  return { id: info.lastInsertRowid, de_id: Number(deId), para_id: Number(paraId), status: 'pendente' };
}

function atualizarStatusAmizade(id, status) {
  db.prepare('UPDATE amizades SET status = ? WHERE id = ?').run(status, Number(id));
}

function deletarAmizade(id) {
  db.prepare('DELETE FROM amizades WHERE id = ?').run(Number(id));
}

function listarAmigos(usuarioId) {
  const id = Number(usuarioId);
  return db.prepare(
    `SELECT u.id, u.nome, u.avatar, u.banner, u.bio, a.id as amizade_id
     FROM amizades a JOIN usuarios u ON (u.id = a.usuario_a OR u.id = a.usuario_b)
     WHERE a.status = 'aceita' AND (a.usuario_a = ? OR a.usuario_b = ?) AND u.id != ?`
  ).all(id, id, id);
}

function listarPedidosRecebidos(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.avatar, a.id as amizade_id, a.criado_em
     FROM amizades a JOIN usuarios u ON u.id = a.usuario_a
     WHERE a.usuario_b = ? AND a.status = 'pendente'`
  ).all(Number(usuarioId));
}

function listarPedidosEnviados(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.avatar, a.id as amizade_id, a.criado_em
     FROM amizades a JOIN usuarios u ON u.id = a.usuario_b
     WHERE a.usuario_a = ? AND a.status = 'pendente'`
  ).all(Number(usuarioId));
}

function saoAmigos(a, b) {
  const amz = db.prepare(
    `SELECT * FROM amizades WHERE status = 'aceita' AND ((usuario_a = ? AND usuario_b = ?) OR (usuario_a = ? AND usuario_b = ?))`
  ).get(Number(a), Number(b), Number(b), Number(a));
  return !!amz;
}

// ============================================================
// BLOQUEIOS E SILENCIADOS
// ============================================================
function bloquear(bloqueadorId, bloqueadoId) {
  try {
    db.prepare('INSERT OR IGNORE INTO bloqueios (bloqueador_id, bloqueado_id) VALUES (?, ?)').run(Number(bloqueadorId), Number(bloqueadoId));
  } catch (e) {}
}

function desbloquear(bloqueadorId, bloqueadoId) {
  db.prepare('DELETE FROM bloqueios WHERE bloqueador_id = ? AND bloqueado_id = ?').run(Number(bloqueadorId), Number(bloqueadoId));
}

function estaBloqueado(bloqueadorId, bloqueadoId) {
  const r = db.prepare('SELECT 1 FROM bloqueios WHERE bloqueador_id = ? AND bloqueado_id = ?').get(Number(bloqueadorId), Number(bloqueadoId));
  return !!r;
}

function listarBloqueados(usuarioId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.avatar FROM bloqueios b
     JOIN usuarios u ON u.id = b.bloqueado_id WHERE b.bloqueador_id = ?`
  ).all(Number(usuarioId));
}

function silenciar(usuarioId, tipo, alvoId) {
  try {
    db.prepare('INSERT OR IGNORE INTO silenciados (usuario_id, tipo, alvo_id) VALUES (?, ?, ?)').run(Number(usuarioId), tipo, Number(alvoId));
  } catch (e) {}
}

function dessilenciar(usuarioId, tipo, alvoId) {
  db.prepare('DELETE FROM silenciados WHERE usuario_id = ? AND tipo = ? AND alvo_id = ?').run(Number(usuarioId), tipo, Number(alvoId));
}

function estaSilenciado(usuarioId, tipo, alvoId) {
  const r = db.prepare('SELECT 1 FROM silenciados WHERE usuario_id = ? AND tipo = ? AND alvo_id = ?').get(Number(usuarioId), tipo, Number(alvoId));
  return !!r;
}

// ============================================================
// CONVERSAS E MENSAGENS
// ============================================================
function abrirConversa(a, b) {
  const [menor, maior] = [Number(a), Number(b)].sort((x, y) => x - y);
  let conv = db.prepare('SELECT * FROM conversas WHERE usuario_a = ? AND usuario_b = ?').get(menor, maior);
  if (!conv) {
    const info = db.prepare('INSERT INTO conversas (usuario_a, usuario_b) VALUES (?, ?)').run(menor, maior);
    conv = { id: info.lastInsertRowid, usuario_a: menor, usuario_b: maior };
  }
  return conv;
}

function buscarConversaPorId(id) {
  return db.prepare('SELECT * FROM conversas WHERE id = ?').get(Number(id));
}

function listarConversas(usuarioId) {
  const id = Number(usuarioId);
  const conversas = db.prepare(
    `SELECT c.*, CASE WHEN c.usuario_a = ? THEN c.usuario_b ELSE c.usuario_a END as amigo_id
     FROM conversas c WHERE c.usuario_a = ? OR c.usuario_b = ? ORDER BY c.id DESC`
  ).all(id, id, id);

  return conversas.map((c) => {
    const amigo = buscarUsuarioPorId(c.amigo_id);
    const ultima = db.prepare(
      `SELECT m.*, u.nome as de_nome, u.avatar as de_avatar FROM mensagens m
       LEFT JOIN usuarios u ON u.id = m.de_id WHERE m.conversa_id = ? ORDER BY m.id DESC LIMIT 1`
    ).get(c.id);
    if (ultima && ultima.anexo) { try { ultima.anexo = JSON.parse(ultima.anexo); } catch (e) { ultima.anexo = null; } }
    const naoLidas = db.prepare(
      'SELECT COUNT(*) as n FROM mensagens WHERE conversa_id = ? AND de_id != ? AND lida = 0'
    ).get(c.id, id).n;
    return {
      conversa_id: c.id,
      amigo: amigo ? { id: amigo.id, nome: amigo.nome, avatar: amigo.avatar || '', banner: amigo.banner || '', bio: amigo.bio || '' } : null,
      ultima: ultima || null, nao_lidas: naoLidas, silenciado: estaSilenciado(id, 'usuario', c.amigo_id),
    };
  });
}

function salvarMensagem({ conversaId, deId, texto, replyId, replyAutor, replyTexto, anexo }) {
  const info = db.prepare(
    `INSERT INTO mensagens (conversa_id, de_id, texto, reply_id, reply_autor, reply_texto, anexo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(conversaId), Number(deId), texto || '', replyId ? Number(replyId) : null, replyAutor || null, replyTexto || null, anexo ? JSON.stringify(anexo) : null);
  return buscarMensagemPorId(info.lastInsertRowid);
}

function buscarMensagemPorId(id) {
  const m = db.prepare(
    `SELECT m.*, u.nome as de_nome, u.avatar as de_avatar FROM mensagens m
     LEFT JOIN usuarios u ON u.id = m.de_id WHERE m.id = ?`
  ).get(Number(id));
  if (m && m.anexo) { try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; } }
  return m;
}

function listarMensagens(conversaId) {
  const msgs = db.prepare(
    `SELECT m.*, u.nome as de_nome, u.avatar as de_avatar FROM mensagens m
     LEFT JOIN usuarios u ON u.id = m.de_id WHERE m.conversa_id = ? ORDER BY m.id DESC LIMIT 200`
  ).all(Number(conversaId));

  return msgs.reverse().map((m) => {
    if (m.anexo) { try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; } }
    return m;
  });
}

function editarMensagem(id, texto) {
  db.prepare('UPDATE mensagens SET texto = ?, editado = 1 WHERE id = ?').run(texto, Number(id));
}

function deletarMensagem(id) {
  db.prepare('DELETE FROM mensagens WHERE id = ?').run(Number(id));
}

function limparHistoricoConversa(conversaId) {
  db.prepare('DELETE FROM mensagens WHERE conversa_id = ?').run(Number(conversaId));
}

function marcarComoLidas(conversaId, usuarioId) {
  db.prepare('UPDATE mensagens SET lida = 1 WHERE conversa_id = ? AND de_id != ?').run(Number(conversaId), Number(usuarioId));
}

// ============================================================
// SERVIDORES E CANAIS
// ============================================================
function gerarCodigoConvite() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += chars[crypto.randomInt(chars.length)];
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

  const info = db.prepare('INSERT INTO servidores (nome, descricao, dono_id, codigo_convite) VALUES (?, ?, ?, ?)').run(nome, descricao || '', Number(donoId), codigo);
  const servidorId = info.lastInsertRowid;
  db.prepare('INSERT INTO membros_servidor (servidor_id, usuario_id) VALUES (?, ?)').run(servidorId, Number(donoId));
  
  // 🔥 Cria o canal "geral" já com o tipo texto explícito
  db.prepare('INSERT INTO canais (servidor_id, nome, tipo) VALUES (?, ?, ?)').run(servidorId, 'geral', 'texto');
  
  return buscarServidorPorId(servidorId);
}

function buscarServidorPorId(id) {
  return db.prepare('SELECT * FROM servidores WHERE id = ?').get(Number(id));
}

function buscarServidorPorCodigo(codigo) {
  return db.prepare('SELECT * FROM servidores WHERE codigo_convite = ?').get(codigo);
}

function listarServidoresDoUsuario(usuarioId) {
  return db.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM membros_servidor WHERE servidor_id = s.id) as total_membros
     FROM servidores s JOIN membros_servidor m ON m.servidor_id = s.id
     WHERE m.usuario_id = ? ORDER BY s.id ASC`
  ).all(Number(usuarioId));
}

function atualizarServidor(id, { nome, descricao }) {
  db.prepare('UPDATE servidores SET nome = ?, descricao = ? WHERE id = ?').run(nome, descricao, Number(id));
}

function deletarServidor(id, donoId) {
  const s = buscarServidorPorId(id);
  if (!s || Number(s.dono_id) !== Number(donoId)) return false;
  db.prepare('DELETE FROM servidores WHERE id = ?').run(Number(id));
  return true;
}

function ehMembro(servidorId, usuarioId) {
  const r = db.prepare('SELECT 1 FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?').get(Number(servidorId), Number(usuarioId));
  return !!r;
}

function adicionarMembro(servidorId, usuarioId) {
  try {
    db.prepare('INSERT INTO membros_servidor (servidor_id, usuario_id) VALUES (?, ?)').run(Number(servidorId), Number(usuarioId));
    return true;
  } catch (e) { return false; }
}

function removerMembro(servidorId, usuarioId) {
  db.prepare('DELETE FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?').run(Number(servidorId), Number(usuarioId));
}

function listarMembros(servidorId) {
  return db.prepare(
    `SELECT u.id, u.nome, u.avatar FROM membros_servidor m
     JOIN usuarios u ON u.id = m.usuario_id WHERE m.servidor_id = ? ORDER BY u.nome ASC`
  ).all(Number(servidorId));
}

// ============================================================
// 🔥 AQUI ESTÁ A CORREÇÃO DA CRIAÇÃO DO CANAL
// ============================================================
function criarCanal(servidorId, nome, tipo = 'texto') {
  const nomeLimpo = nome.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!nomeLimpo) return null;
  try {
    const info = db.prepare('INSERT INTO canais (servidor_id, nome, tipo) VALUES (?, ?, ?)')
      .run(Number(servidorId), nomeLimpo, tipo);
    return { id: info.lastInsertRowid, servidor_id: Number(servidorId), nome: nomeLimpo, tipo };
  } catch (e) { return null; }
}

function buscarCanalPorId(id) {
  return db.prepare('SELECT * FROM canais WHERE id = ?').get(Number(id));
}

function listarCanais(servidorId) {
  return db.prepare('SELECT * FROM canais WHERE servidor_id = ? ORDER BY id ASC').all(Number(servidorId));
}

function deletarCanal(id, donoId) {
  const c = buscarCanalPorId(id);
  if (!c) return false;
  const s = buscarServidorPorId(c.servidor_id);
  if (!s || Number(s.dono_id) !== Number(donoId)) return false;
  db.prepare('DELETE FROM canais WHERE id = ?').run(Number(id));
  return true;
}

function salvarMensagemCanal({ canalId, deId, texto, replyId, replyAutor, replyTexto, anexo }) {
  const info = db.prepare(
    `INSERT INTO mensagens_canal (canal_id, de_id, texto, reply_id, reply_autor, reply_texto, anexo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(canalId), Number(deId), texto || '', replyId ? Number(replyId) : null, replyAutor || null, replyTexto || null, anexo ? JSON.stringify(anexo) : null);
  return buscarMensagemCanalPorId(info.lastInsertRowid);
}

function buscarMensagemCanalPorId(id) {
  const m = db.prepare(
    `SELECT m.*, u.nome as de_nome, u.avatar as de_avatar FROM mensagens_canal m
     LEFT JOIN usuarios u ON u.id = m.de_id WHERE m.id = ?`
  ).get(Number(id));
  if (m && m.anexo) { try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; } }
  return m;
}

function listarMensagensCanal(canalId) {
  const msgs = db.prepare(
    `SELECT m.*, u.nome as de_nome, u.avatar as de_avatar FROM mensagens_canal m
     LEFT JOIN usuarios u ON u.id = m.de_id WHERE m.canal_id = ? ORDER BY m.id DESC LIMIT 200`
  ).all(Number(canalId));

  return msgs.reverse().map((m) => {
    if (m.anexo) { try { m.anexo = JSON.parse(m.anexo); } catch (e) { m.anexo = null; } }
    return m;
  });
}

function editarMensagemCanal(id, texto) {
  db.prepare('UPDATE mensagens_canal SET texto = ?, editado = 1 WHERE id = ?').run(texto, Number(id));
}

function deletarMensagemCanal(id) {
  db.prepare('DELETE FROM mensagens_canal WHERE id = ?').run(Number(id));
}

// ============================================================
// REAÇÕES
// ============================================================
function adicionarReacao({ tipo, alvoId, usuarioId, emoji }) {
  try {
    db.prepare('INSERT OR IGNORE INTO reacoes (tipo, alvo_id, usuario_id, emoji) VALUES (?, ?, ?, ?)').run(tipo, Number(alvoId), Number(usuarioId), emoji);
  } catch (e) {}
}

function removerReacao({ tipo, alvoId, usuarioId, emoji }) {
  const info = db.prepare('DELETE FROM reacoes WHERE tipo = ? AND alvo_id = ? AND usuario_id = ? AND emoji = ?').run(tipo, Number(alvoId), Number(usuarioId), emoji);
  return { changes: info.changes };
}

function listarReacoesDeMensagens(tipo, ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT alvo_id, emoji, usuario_id FROM reacoes WHERE tipo = ? AND alvo_id IN (${placeholders})`
  ).all(tipo, ...ids.map(Number));
  const mapa = {};
  rows.forEach((r) => {
    if (!mapa[r.alvo_id]) mapa[r.alvo_id] = {};
    if (!mapa[r.alvo_id][r.emoji]) mapa[r.alvo_id][r.emoji] = [];
    mapa[r.alvo_id][r.emoji].push(r.usuario_id);
  });
  return mapa;
}

module.exports = {
  buscarUsuarioPorId, buscarUsuarioLevePorId, buscarUsuarioPorEmail, criarUsuario, atualizarAvatar, atualizarBanner, atualizarBio,
  buscarUsuariosPorNome, buscarAmizadeEntre, criarPedidoAmizade, atualizarStatusAmizade, deletarAmizade,
  listarAmigos, listarPedidosRecebidos, listarPedidosEnviados, saoAmigos, bloquear, desbloquear,
  estaBloqueado, listarBloqueados, silenciar, dessilenciar, estaSilenciado, abrirConversa,
  buscarConversaPorId, listarConversas, salvarMensagem, buscarMensagemPorId, listarMensagens,
  editarMensagem, deletarMensagem, limparHistoricoConversa, marcarComoLidas, criarServidor,
  buscarServidorPorId, buscarServidorPorCodigo, listarServidoresDoUsuario, atualizarServidor,
  deletarServidor, ehMembro, adicionarMembro, removerMembro, listarMembros, criarCanal,
  buscarCanalPorId, listarCanais, deletarCanal, salvarMensagemCanal, buscarMensagemCanalPorId,
  listarMensagensCanal, editarMensagemCanal, deletarMensagemCanal, adicionarReacao, removerReacao,
  listarReacoesDeMensagens,
};