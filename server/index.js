const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { Server } = require('socket.io');
const db = require('./db');
const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 🔥 Detecta se está em produção (atrás de proxy)
const IS_PROD = process.env.NODE_ENV === 'production';

// 🔥 Confia no proxy (Render/Cloudflare/ngrok) pra pegar IP e protocolo reais
app.set('trust proxy', 1);

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const nome = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, nome);
  },
});

const TIPOS_PERMITIDOS = {
  foto: { mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'], max: 10 * 1024 * 1024 },
  video: { mimes: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska'], max: 100 * 1024 * 1024 },
  arquivo: { mimes: null, max: 100 * 1024 * 1024 },
};

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ============================================================
// 🔥 CORREÇÃO CRÍTICA — Anti-cache + headers de segurança
// ============================================================
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store'); // 🔥 NOVO — específico do Render
  // 🔥 Segurança extra
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// 🔥 Log de debug pra todas as chamadas /api/*
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const temCookie = req.cookies && req.cookies.token ? 'SIM' : 'NÃO';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} — IP: ${req.ip} — Cookie: ${temCookie}`);
  }
  next();
});

// 🔥 Valida HTTPS quando atrás de proxy
app.use((req, res, next) => {
  const host = req.headers.host || '';
  const ehLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || /^192\.168\./.test(host);

  // Se não for local, exige HTTPS
  if (!ehLocalhost) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      return res.status(400).json({ erro: 'HTTPS obrigatório' });
    }
  }
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('Não encontrado');
  res.sendFile(filepath);
});

// ========== AUTH HELPERS ==========

function pegarUsuario(req) {
  const token = req.cookies && req.cookies.token;
  if (!token) return null;
  return auth.verificarToken(token);
}

function exigirAuth(req, res, next) {
  const u = pegarUsuario(req);
  if (!u) return res.status(401).json({ erro: 'Não logado' });
  const usuarioAtual = db.buscarUsuarioPorId(u.id);
  if (!usuarioAtual) {
    limparCookies(res);
    return res.status(401).json({ erro: 'Usuário não existe' });
  }
  req.usuario = u;
  req.usuarioAtual = usuarioAtual;
  next();
}

// 🔥 Cookie mais seguro — sempre Secure quando não for localhost, SameSite STRICT
function setarCookieToken(req, res, token) {
  const host = req.headers.host || '';
  const ehLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || /^192\.168\./.test(host);

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',   // 🔥 MUDOU DE 'lax' PRA 'strict'
    secure: !ehLocalhost, // 🔥 Secure sempre que não for local
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function limparCookies(res) {
  res.clearCookie('token', { path: '/' });
  res.clearCookie('connect.sid', { path: '/' });
}

// ========== UPLOAD ==========

app.post('/api/upload', exigirAuth, upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    const tipoSolicitado = (req.body.tipo || 'arquivo').toLowerCase();
    const regras = TIPOS_PERMITIDOS[tipoSolicitado] || TIPOS_PERMITIDOS.arquivo;
    if (req.file.size > regras.max) {
      fs.unlinkSync(req.file.path);
      const mb = (regras.max / 1024 / 1024).toFixed(0);
      return res.status(400).json({ erro: `Arquivo muito grande (máx ${mb}MB)` });
    }
    if (regras.mimes && !regras.mimes.includes(req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ erro: `Tipo não permitido` });
    }
    res.json({
      ok: true,
      anexo: {
        tipo: tipoSolicitado,
        url: '/uploads/' + req.file.filename,
        nome: req.file.originalname,
        tamanho: req.file.size,
        mime: req.file.mimetype,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro ao processar upload' });
  }
});

// ========== AUTH ==========

app.post('/api/cadastro', async (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos' });
  if (senha.length < 6) return res.status(400).json({ erro: 'Senha precisa ter 6+ caracteres' });
  if (db.buscarUsuarioPorEmail(email)) return res.status(400).json({ erro: 'Email já cadastrado' });
  try {
    const senhaHash = await auth.hashearSenha(senha);
    const usuario = db.criarUsuario({ nome, email, senhaHash });
    const token = auth.gerarToken(usuario);
    // 🔥 Limpa cookies antigos ANTES de setar o novo
    limparCookies(res);
    setarCookieToken(req, res, token);
    res.json({ ok: true, usuario });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro ao cadastrar' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'Preencha tudo' });
  const usuario = db.buscarUsuarioPorEmail(email);
  if (!usuario) return res.status(400).json({ erro: 'Email ou senha inválidos' });
  const ok = await auth.verificarSenha(senha, usuario.senha_hash);
  if (!ok) return res.status(400).json({ erro: 'Email ou senha inválidos' });

  // 🔥 Limpa cookies antigos ANTES de setar o novo
  limparCookies(res);

  const token = auth.gerarToken(usuario);
  setarCookieToken(req, res, token);
  res.json({
    ok: true,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      avatar: usuario.avatar || '',
      banner: usuario.banner || '',
      bio: usuario.bio || '',
    },
  });
});

app.post('/api/logout', (req, res) => {
  limparCookies(res);
  res.json({ ok: true });
});

app.get('/api/eu', (req, res) => {
  const u = pegarUsuario(req);
  if (!u) return res.status(401).json({ erro: 'Não logado' });
  const usuario = db.buscarUsuarioPorId(u.id);
  if (!usuario) {
    limparCookies(res);
    return res.status(401).json({ erro: 'Usuário não existe' });
  }
  res.json({
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      avatar: usuario.avatar || '',
      banner: usuario.banner || '',
      bio: usuario.bio || '',
    },
  });
});

app.post('/api/avatar', exigirAuth, (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ erro: 'Avatar vazio' });
  if (avatar.length > 800000) return res.status(400).json({ erro: 'Imagem muito grande' });
  db.atualizarAvatar(req.usuario.id, avatar);
  io.emit('perfil-atualizado', { usuario_id: req.usuario.id, avatar });
  res.json({ ok: true });
});

app.post('/api/banner', exigirAuth, (req, res) => {
  const { banner } = req.body;
  if (!banner) return res.status(400).json({ erro: 'Banner vazio' });
  if (banner.length > 2500000) return res.status(400).json({ erro: 'Imagem muito grande' });
  db.atualizarBanner(req.usuario.id, banner);
  io.emit('perfil-atualizado', { usuario_id: req.usuario.id, banner });
  res.json({ ok: true });
});

app.post('/api/bio', exigirAuth, (req, res) => {
  const { bio } = req.body;
  if (typeof bio !== 'string') return res.status(400).json({ erro: 'Bio inválida' });
  if (bio.length > 200) return res.status(400).json({ erro: 'Bio muito longa (máx 200)' });
  db.atualizarBio(req.usuario.id, bio);
  io.emit('perfil-atualizado', { usuario_id: req.usuario.id, bio });
  res.json({ ok: true });
});

// ========== AMIZADES ==========

app.get('/api/usuarios/buscar', exigirAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ usuarios: [] });
  const usuarios = db.buscarUsuariosPorNome(q, req.usuario.id);
  const filtrados = usuarios.filter((u) => !db.estaBloqueado(req.usuario.id, u.id));
  res.json({ usuarios: filtrados });
});

app.get('/api/amizades', exigirAuth, (req, res) => {
  const id = req.usuario.id;
  res.json({
    amigos: db.listarAmigos(id),
    pedidosRecebidos: db.listarPedidosRecebidos(id),
    pedidosEnviados: db.listarPedidosEnviados(id),
  });
});

app.post('/api/amizades/pedir', exigirAuth, (req, res) => {
  const { paraId } = req.body;
  if (!paraId) return res.status(400).json({ erro: 'Informe paraId' });
  if (paraId === req.usuario.id) return res.status(400).json({ erro: 'Você não pode se adicionar' });
  if (db.estaBloqueado(req.usuario.id, paraId)) {
    return res.status(403).json({ erro: 'Você bloqueou esse usuário. Desbloqueie antes.' });
  }
  const destinatario = db.buscarUsuarioPorId(paraId);
  if (!destinatario) return res.status(404).json({ erro: 'Usuário não existe' });

  const existente = db.buscarAmizadeEntre(req.usuario.id, paraId);
  if (existente) {
    if (existente.status === 'aceita') return res.status(400).json({ erro: 'Vocês já são amigos' });
    if (existente.status === 'pendente') return res.status(400).json({ erro: 'Pedido já existe' });
    db.deletarAmizade(existente.id);
  }

  const pedido = db.criarPedidoAmizade(req.usuario.id, paraId);
  const socketDestino = [...online.values()].find((u) => u.id === paraId);
  const meusDados = db.buscarUsuarioPorId(req.usuario.id);

  if (socketDestino) {
    io.to(socketDestino.socketId).emit('amizade-nova', {
      paraId,
      pedido: {
        amizade_id: pedido.id,
        id: req.usuario.id,
        nome: req.usuario.nome,
        email: req.usuario.email,
        avatar: meusDados?.avatar || '',
        criado_em: Date.now(),
      },
    });
  }
  res.json({ ok: true, pedido });
});

app.post('/api/amizades/aceitar', exigirAuth, (req, res) => {
  const { amizadeId } = req.body;
  if (!amizadeId) return res.status(400).json({ erro: 'Informe amizadeId' });
  const pedido = db.listarPedidosRecebidos(req.usuario.id).find((p) => p.amizade_id === amizadeId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  db.atualizarStatusAmizade(amizadeId, 'aceita');

  const meusDados = db.buscarUsuarioPorId(req.usuario.id);
  const socketSolicitante = [...online.values()].find((u) => u.id === pedido.id);
  if (socketSolicitante) {
    io.to(socketSolicitante.socketId).emit('amizade-aceita', {
      por: {
        id: req.usuario.id,
        nome: req.usuario.nome,
        email: req.usuario.email,
        avatar: meusDados?.avatar || '',
      },
    });
  }
  res.json({ ok: true });
});

app.post('/api/amizades/recusar', exigirAuth, (req, res) => {
  const { amizadeId } = req.body;
  if (!amizadeId) return res.status(400).json({ erro: 'Informe amizadeId' });
  const pedido = db.listarPedidosRecebidos(req.usuario.id).find((p) => p.amizade_id === amizadeId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  db.atualizarStatusAmizade(amizadeId, 'recusada');
  res.json({ ok: true });
});

app.delete('/api/amizades/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const amigos = db.listarAmigos(req.usuario.id);
  const amizade = amigos.find((a) => a.amizade_id === id);
  if (!amizade) return res.status(404).json({ erro: 'Amizade não encontrada' });
  db.deletarAmizade(id);
  res.json({ ok: true });
});

// ========== BLOQUEIOS ==========

app.get('/api/bloqueados', exigirAuth, (req, res) => {
  res.json({ bloqueados: db.listarBloqueados(req.usuario.id) });
});

app.post('/api/bloquear', exigirAuth, (req, res) => {
  const { alvoId } = req.body;
  if (!alvoId) return res.status(400).json({ erro: 'Informe alvoId' });
  if (alvoId === req.usuario.id) return res.status(400).json({ erro: 'Não pode se bloquear' });
  const alvo = db.buscarUsuarioPorId(alvoId);
  if (!alvo) return res.status(404).json({ erro: 'Usuário não existe' });
  db.bloquear(req.usuario.id, alvoId);
  const amz = db.buscarAmizadeEntre(req.usuario.id, alvoId);
  if (amz) db.deletarAmizade(amz.id);
  res.json({ ok: true });
});

app.post('/api/desbloquear', exigirAuth, (req, res) => {
  const { alvoId } = req.body;
  if (!alvoId) return res.status(400).json({ erro: 'Informe alvoId' });
  db.desbloquear(req.usuario.id, alvoId);
  res.json({ ok: true });
});

// ========== SILENCIADOS ==========

app.post('/api/silenciar', exigirAuth, (req, res) => {
  const { tipo, alvoId } = req.body;
  if (!tipo || !alvoId) return res.status(400).json({ erro: 'Dados incompletos' });
  if (!['usuario', 'servidor'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido' });
  db.silenciar(req.usuario.id, tipo, alvoId);
  res.json({ ok: true });
});

app.post('/api/dessilenciar', exigirAuth, (req, res) => {
  const { tipo, alvoId } = req.body;
  if (!tipo || !alvoId) return res.status(400).json({ erro: 'Dados incompletos' });
  db.dessilenciar(req.usuario.id, tipo, alvoId);
  res.json({ ok: true });
});

// ========== DMs ==========

app.post('/api/conversas/abrir', exigirAuth, (req, res) => {
  const { amigoId } = req.body;
  if (!amigoId) return res.status(400).json({ erro: 'Informe amigoId' });
  if (!db.saoAmigos(req.usuario.id, amigoId)) return res.status(403).json({ erro: 'Vocês não são amigos' });
  const conv = db.abrirConversa(req.usuario.id, amigoId);
  const amigo = db.buscarUsuarioPorId(amigoId);
  res.json({ conversa_id: conv.id, amigo });
});

app.get('/api/conversas', exigirAuth, (req, res) => {
  res.json({ conversas: db.listarConversas(req.usuario.id) });
});

app.get('/api/conversas/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = db.buscarConversaPorId(id);
  if (!conv) return res.status(404).json({ erro: 'Conversa não existe' });
  const ehParticipante = conv.usuario_a === req.usuario.id || conv.usuario_b === req.usuario.id;
  if (!ehParticipante) return res.status(403).json({ erro: 'Sem permissão' });
  db.marcarComoLidas(id, req.usuario.id);
  const mensagens = db.listarMensagens(id);
  const reacoes = db.listarReacoesDeMensagens('dm', mensagens.map((m) => m.id));
  res.json({
    mensagens: mensagens.map((m) => ({ ...m, reacoes: reacoes[m.id] || {} })),
  });
});

app.post('/api/conversas/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const { texto, replyId, replyAutor, replyTexto, anexo } = req.body;
  if ((!texto || !texto.trim()) && !anexo) return res.status(400).json({ erro: 'Mensagem vazia' });
  const conv = db.buscarConversaPorId(id);
  if (!conv) return res.status(404).json({ erro: 'Conversa não existe' });
  const ehParticipante = conv.usuario_a === req.usuario.id || conv.usuario_b === req.usuario.id;
  if (!ehParticipante) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.salvarMensagem({
    conversaId: id, deId: req.usuario.id, texto: (texto || '').trim(),
    replyId: replyId || null, replyAutor: replyAutor || null,
    replyTexto: replyTexto || null, anexo: anexo || null,
  });

  const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
  const socketOutro = [...online.values()].find((u) => u.id === outroId);
  const meusDados = db.buscarUsuarioPorId(req.usuario.id);
  const payload = { ...msg, de_nome: req.usuario.nome, de_avatar: meusDados.avatar || '', reacoes: {} };

  if (socketOutro && !db.estaBloqueado(outroId, req.usuario.id)) {
    io.to(socketOutro.socketId).emit('dm-nova', { conversa_id: id, mensagem: payload });
  }
  res.json({ ok: true, mensagem: payload });
});

app.patch('/api/conversas/:idConversa/mensagens/:idMensagem', exigirAuth, (req, res) => {
  const idConversa = Number(req.params.idConversa);
  const idMensagem = Number(req.params.idMensagem);
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Texto vazio' });

  const conv = db.buscarConversaPorId(idConversa);
  if (!conv) return res.status(404).json({ erro: 'Conversa não existe' });
  const ehParticipante = conv.usuario_a === req.usuario.id || conv.usuario_b === req.usuario.id;
  if (!ehParticipante) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.buscarMensagemPorId(idMensagem);
  if (!msg || msg.conversa_id !== idConversa) return res.status(404).json({ erro: 'Mensagem não existe' });
  if (msg.de_id !== req.usuario.id) return res.status(403).json({ erro: 'Só pode editar suas mensagens' });

  db.editarMensagem(idMensagem, texto.trim());

  const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
  const socketOutro = [...online.values()].find((u) => u.id === outroId);
  const payload = { id: idMensagem, conversa_id: idConversa, de_id: req.usuario.id, texto: texto.trim(), hora: msg.hora, editado: 1 };
  if (socketOutro) io.to(socketOutro.socketId).emit('dm-editada', { conversa_id: idConversa, mensagem: payload });
  res.json({ ok: true, mensagem: payload });
});

app.delete('/api/conversas/:idConversa/mensagens/:idMensagem', exigirAuth, (req, res) => {
  const idConversa = Number(req.params.idConversa);
  const idMensagem = Number(req.params.idMensagem);

  const conv = db.buscarConversaPorId(idConversa);
  if (!conv) return res.status(404).json({ erro: 'Conversa não existe' });
  const ehParticipante = conv.usuario_a === req.usuario.id || conv.usuario_b === req.usuario.id;
  if (!ehParticipante) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.buscarMensagemPorId(idMensagem);
  if (!msg || msg.conversa_id !== idConversa) return res.status(404).json({ erro: 'Mensagem não existe' });
  if (msg.de_id !== req.usuario.id) return res.status(403).json({ erro: 'Só pode deletar suas mensagens' });

  db.deletarMensagem(idMensagem);

  const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
  const socketOutro = [...online.values()].find((u) => u.id === outroId);
  if (socketOutro) io.to(socketOutro.socketId).emit('dm-deletada', { conversa_id: idConversa, mensagem_id: idMensagem });
  res.json({ ok: true });
});

app.delete('/api/conversas/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = db.buscarConversaPorId(id);
  if (!conv) return res.status(404).json({ erro: 'Conversa não existe' });
  const ok = conv.usuario_a === req.usuario.id || conv.usuario_b === req.usuario.id;
  if (!ok) return res.status(403).json({ erro: 'Sem permissão' });
  db.limparHistoricoConversa(id);
  io.emit('dm-historico-limpo', { conversa_id: id });
  res.json({ ok: true });
});

// ========== REAÇÕES ==========

app.post('/api/reacoes/toggle', exigirAuth, (req, res) => {
  const { tipo, alvoId, emoji } = req.body;
  if (!tipo || !alvoId || !emoji) return res.status(400).json({ erro: 'Dados incompletos' });
  if (!['canal', 'dm'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido' });
  if (emoji.length > 8) return res.status(400).json({ erro: 'Emoji inválido' });

  if (tipo === 'canal') {
    const msg = db.buscarMensagemCanalPorId(alvoId);
    if (!msg) return res.status(404).json({ erro: 'Mensagem não existe' });
    const c = db.buscarCanalPorId(msg.canal_id);
    if (!c || !db.ehMembro(c.servidor_id, req.usuario.id)) {
      return res.status(403).json({ erro: 'Sem permissão' });
    }
  } else {
    const msg = db.buscarMensagemPorId(alvoId);
    if (!msg) return res.status(404).json({ erro: 'Mensagem não existe' });
    const conv = db.buscarConversaPorId(msg.conversa_id);
    const ok = conv && (conv.usuario_a === req.usuario.id || conv.usuario_b === req.usuario.id);
    if (!ok) return res.status(403).json({ erro: 'Sem permissão' });
  }

  const removida = db.removerReacao({ tipo, alvoId, usuarioId: req.usuario.id, emoji });
  let acao;
  if (removida.changes === 0) {
    db.adicionarReacao({ tipo, alvoId, usuarioId: req.usuario.id, emoji });
    acao = 'adicionada';
  } else {
    acao = 'removida';
  }

  const reacoes = db.listarReacoesDeMensagens(tipo, [alvoId]);
  const payload = { tipo, alvoId, emoji, reacoes: reacoes[alvoId] || {} };

  if (tipo === 'canal') {
    const msg = db.buscarMensagemCanalPorId(alvoId);
    io.to('canal-' + msg.canal_id).emit('reacao-atualizada', payload);
  } else {
    const msg = db.buscarMensagemPorId(alvoId);
    const conv = db.buscarConversaPorId(msg.conversa_id);
    const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
    const socketOutro = [...online.values()].find((u) => u.id === outroId);
    if (socketOutro) io.to(socketOutro.socketId).emit('reacao-atualizada', payload);
  }
  res.json({ ok: true, acao, reacoes: reacoes[alvoId] || {} });
});

// ========== SERVIDORES ==========

app.get('/api/servidores', exigirAuth, (req, res) => {
  res.json({ servidores: db.listarServidoresDoUsuario(req.usuario.id) });
});

app.post('/api/servidores', exigirAuth, (req, res) => {
  const { nome, descricao } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Informe o nome' });
  const s = db.criarServidor({ nome: nome.trim(), descricao: (descricao || '').trim(), donoId: req.usuario.id });
  res.json({ ok: true, servidor: s });
});

app.get('/api/servidores/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.buscarServidorPorId(id);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (!db.ehMembro(id, req.usuario.id)) return res.status(403).json({ erro: 'Você não é membro' });
  res.json({
    servidor: s,
    canais: db.listarCanais(id),
    membros: db.listarMembros(id),
    ehDono: s.dono_id === req.usuario.id,
    silenciado: db.estaSilenciado(req.usuario.id, 'servidor', id),
  });
});

app.patch('/api/servidores/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.buscarServidorPorId(id);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (s.dono_id !== req.usuario.id) return res.status(403).json({ erro: 'Só o dono pode editar' });
  const { nome, descricao } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Informe o nome' });
  db.atualizarServidor(id, { nome: nome.trim(), descricao: (descricao || '').trim() });
  const atualizado = db.buscarServidorPorId(id);
  io.emit('servidor-atualizado', { servidor: atualizado });
  res.json({ ok: true, servidor: atualizado });
});

app.post('/api/servidores/entrar', exigirAuth, (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ erro: 'Informe o código' });
  const s = db.buscarServidorPorCodigo(codigo.trim());
  if (!s) return res.status(404).json({ erro: 'Código inválido' });
  const entrou = db.adicionarMembro(s.id, req.usuario.id);
  if (!entrou) return res.status(400).json({ erro: 'Você já é membro' });

  const meusDados = db.buscarUsuarioPorId(req.usuario.id);
  io.to('servidor-' + s.id).emit('membro-entrou', {
    servidor_id: s.id,
    membro: {
      id: req.usuario.id,
      nome: req.usuario.nome,
      email: req.usuario.email,
      avatar: meusDados?.avatar || '',
    },
  });

  res.json({ ok: true, servidor: s });
});

app.post('/api/servidores/:id/sair', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.buscarServidorPorId(id);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (s.dono_id === req.usuario.id) return res.status(400).json({ erro: 'Dono não pode sair' });
  db.removerMembro(id, req.usuario.id);
  io.to('servidor-' + id).emit('membro-removido', { servidor_id: id, usuario_id: req.usuario.id });
  res.json({ ok: true });
});

app.delete('/api/servidores/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const ok = db.deletarServidor(id, req.usuario.id);
  if (!ok) return res.status(403).json({ erro: 'Sem permissão' });
  io.emit('servidor-deletado', { servidor_id: id });
  res.json({ ok: true });
});

app.post('/api/servidores/:id/remover-membro', exigirAuth, (req, res) => {
  const servidorId = Number(req.params.id);
  const { usuarioId } = req.body;
  if (!usuarioId) return res.status(400).json({ erro: 'Informe usuarioId' });

  const s = db.buscarServidorPorId(servidorId);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (s.dono_id !== req.usuario.id) return res.status(403).json({ erro: 'Só o dono pode remover membros' });
  if (usuarioId === s.dono_id) return res.status(400).json({ erro: 'Dono não pode ser removido' });

  db.removerMembro(servidorId, usuarioId);

  io.to('servidor-' + servidorId).emit('membro-removido', { servidor_id: servidorId, usuario_id: usuarioId });

  const socketRemovido = [...online.values()].find((u) => u.id === usuarioId);
  if (socketRemovido) {
    io.to(socketRemovido.socketId).emit('voce-foi-removido', {
      servidor_id: servidorId,
      servidor_nome: s.nome,
    });
  }

  res.json({ ok: true });
});

// ========== CANAIS ==========

app.post('/api/servidores/:id/canais', exigirAuth, (req, res) => {
  const servidorId = Number(req.params.id);
  const s = db.buscarServidorPorId(servidorId);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (s.dono_id !== req.usuario.id) return res.status(403).json({ erro: 'Só o dono pode criar canais' });
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Informe o nome' });
  const c = db.criarCanal(servidorId, nome.trim());
  if (!c) return res.status(400).json({ erro: 'Nome inválido ou já existe' });
  io.to('servidor-' + servidorId).emit('canal-criado', { canal: c });
  res.json({ ok: true, canal: c });
});

app.delete('/api/canais/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const ok = db.deletarCanal(id, req.usuario.id);
  if (!ok) return res.status(403).json({ erro: 'Sem permissão' });
  io.emit('canal-deletado', { canal_id: id });
  res.json({ ok: true });
});

app.get('/api/canais/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const c = db.buscarCanalPorId(id);
  if (!c) return res.status(404).json({ erro: 'Canal não existe' });
  if (!db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  const mensagens = db.listarMensagensCanal(id);
  const reacoes = db.listarReacoesDeMensagens('canal', mensagens.map((m) => m.id));
  res.json({
    mensagens: mensagens.map((m) => ({ ...m, reacoes: reacoes[m.id] || {} })),
  });
});

app.post('/api/canais/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const { texto, replyId, replyAutor, replyTexto, anexo } = req.body;
  if ((!texto || !texto.trim()) && !anexo) return res.status(400).json({ erro: 'Mensagem vazia' });
  const c = db.buscarCanalPorId(id);
  if (!c) return res.status(404).json({ erro: 'Canal não existe' });
  if (!db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.salvarMensagemCanal({
    canalId: id, deId: req.usuario.id, texto: (texto || '').trim(),
    replyId: replyId || null, replyAutor: replyAutor || null,
    replyTexto: replyTexto || null, anexo: anexo || null,
  });
  const meusDados = db.buscarUsuarioPorId(req.usuario.id);

  io.to('canal-' + id).emit('canal-nova-msg', {
    canal_id: id,
    mensagem: { ...msg, de_nome: req.usuario.nome, de_avatar: meusDados.avatar || '', reacoes: {} },
  });
  res.json({ ok: true, mensagem: { ...msg, de_nome: req.usuario.nome, de_avatar: meusDados.avatar || '', reacoes: {} } });
});

app.patch('/api/canais/:idCanal/mensagens/:idMensagem', exigirAuth, (req, res) => {
  const idCanal = Number(req.params.idCanal);
  const idMensagem = Number(req.params.idMensagem);
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Texto vazio' });

  const c = db.buscarCanalPorId(idCanal);
  if (!c) return res.status(404).json({ erro: 'Canal não existe' });
  if (!db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.buscarMensagemCanalPorId(idMensagem);
  if (!msg || msg.canal_id !== idCanal) return res.status(404).json({ erro: 'Mensagem não existe' });
  if (msg.de_id !== req.usuario.id) return res.status(403).json({ erro: 'Só pode editar suas mensagens' });

  db.editarMensagemCanal(idMensagem, texto.trim());

  io.to('canal-' + idCanal).emit('canal-msg-editada', {
    canal_id: idCanal,
    mensagem: { id: idMensagem, canal_id: idCanal, de_id: req.usuario.id, texto: texto.trim(), hora: msg.hora, editado: 1 },
  });
  res.json({ ok: true });
});

app.delete('/api/canais/:idCanal/mensagens/:idMensagem', exigirAuth, (req, res) => {
  const idCanal = Number(req.params.idCanal);
  const idMensagem = Number(req.params.idMensagem);

  const c = db.buscarCanalPorId(idCanal);
  if (!c) return res.status(404).json({ erro: 'Canal não existe' });
  if (!db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.buscarMensagemCanalPorId(idMensagem);
  if (!msg || msg.canal_id !== idCanal) return res.status(404).json({ erro: 'Mensagem não existe' });

  const s = db.buscarServidorPorId(c.servidor_id);
  const ehDono = s && s.dono_id === req.usuario.id;
  if (msg.de_id !== req.usuario.id && !ehDono) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }

  if (msg.anexo && msg.anexo.url && msg.anexo.url.startsWith('/uploads/')) {
    const filename = path.basename(msg.anexo.url);
    const filepath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filepath)) {
      try { fs.unlinkSync(filepath); } catch (e) {}
    }
  }

  db.deletarMensagemCanal(idMensagem);

  io.to('canal-' + idCanal).emit('canal-msg-deletada', {
    canal_id: idCanal,
    mensagem_id: idMensagem,
  });
  res.json({ ok: true });
});

// ========== SOCKET.IO ==========

// 🔥 Middleware de auth do socket — pega o ÚLTIMO cookie token
io.use((socket, next) => {
  try {
    const cookies = socket.request.headers.cookie || '';
    console.log('[SOCKET] Tentando auth — cookies:', cookies.substring(0, 80));

    const matches = [...cookies.matchAll(/(?:^|;\s*)token=([^;]+)/g)];
    if (!matches.length) return next(new Error('Não autenticado'));
    const token = decodeURIComponent(matches[matches.length - 1][1]);
    const payload = auth.verificarToken(token);
    console.log('[SOCKET] Token decodificado — user id:', payload?.id, 'nome:', payload?.nome);
    if (!payload || !payload.id) return next(new Error('Token inválido'));

    const usuarioAtual = db.buscarUsuarioPorId(payload.id);
    if (!usuarioAtual) return next(new Error('Usuário não existe'));

    socket.usuario = {
      id: usuarioAtual.id,
      nome: usuarioAtual.nome,
      email: usuarioAtual.email,
    };
    next();
  } catch (e) {
    console.error('Erro no middleware de socket:', e);
    next(new Error('Erro de autenticação'));
  }
});

const online = new Map();

function notificarListaOnline() {
  const porUsuario = new Map();
  online.forEach((u) => {
    if (!porUsuario.has(u.id)) porUsuario.set(u.id, u);
  });
  io.emit('lista-online', [...porUsuario.values()]);
}

io.on('connection', (socket) => {
  console.log('conectado:', socket.usuario.nome, socket.id);

  const dadosCompletos = db.buscarUsuarioPorId(socket.usuario.id) || {};
  online.set(socket.id, {
    id: socket.usuario.id,
    nome: socket.usuario.nome,
    email: socket.usuario.email,
    avatar: dadosCompletos.avatar || '',
    banner: dadosCompletos.banner || '',
    bio: dadosCompletos.bio || '',
    socketId: socket.id,
  });

  notificarListaOnline();

  socket.on('entrar-servidores', () => {
    const servidores = db.listarServidoresDoUsuario(socket.usuario.id);
    servidores.forEach((s) => socket.join('servidor-' + s.id));
  });

  socket.on('entrar-canal', ({ canalId }) => {
    const c = db.buscarCanalPorId(canalId);
    if (!c) return;
    if (!db.ehMembro(c.servidor_id, socket.usuario.id)) return;
    socket.join('canal-' + canalId);
  });

  socket.on('digitando-canal', ({ canalId, nome }) => {
    socket.to('canal-' + canalId).emit('alguem-digitando-canal', {
      canalId, nome, usuarioId: socket.usuario.id,
    });
  });

  socket.on('parou-digitando-canal', ({ canalId }) => {
    socket.to('canal-' + canalId).emit('alguem-parou-digitando-canal', {
      canalId, usuarioId: socket.usuario.id,
    });
  });

  socket.on('digitando-dm', ({ conversaId, paraUsuarioId, nome }) => {
    const socketOutro = [...online.values()].find((u) => u.id === paraUsuarioId);
    if (socketOutro) {
      io.to(socketOutro.socketId).emit('alguem-digitando-dm', {
        conversaId, nome, usuarioId: socket.usuario.id,
      });
    }
  });

  socket.on('parou-digitando-dm', ({ conversaId, paraUsuarioId }) => {
    const socketOutro = [...online.values()].find((u) => u.id === paraUsuarioId);
    if (socketOutro) {
      io.to(socketOutro.socketId).emit('alguem-parou-digitando-dm', {
        conversaId, usuarioId: socket.usuario.id,
      });
    }
  });

  socket.on('disconnect', () => {
    online.delete(socket.id);
    notificarListaOnline();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});