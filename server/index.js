const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const db = require('./db');
const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const IS_PROD = process.env.NODE_ENV === 'production';

const ORIGEM_PERMITIDA = process.env.ORIGEM_PERMITIDA || false;
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  cors: { origin: ORIGEM_PERMITIDA || true, credentials: true },
});

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

const EXTENSOES_ARQUIVO_PERMITIDAS = [
  '.pdf', '.zip', '.rar', '.7z', '.tar', '.gz',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.weba',
  '.mp4', '.webm', '.mov', '.avi',
  '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.csv',
  '.ppt', '.pptx', '.odp', '.txt', '.md', '.json',
];

const TIPOS_PERMITIDOS = {
  foto: { mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'], max: 10 * 1024 * 1024 },
  video: { mimes: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska'], max: 100 * 1024 * 1024 },
  arquivo: { mimes: null, max: 100 * 1024 * 1024, ext: EXTENSOES_ARQUIVO_PERMITIDAS },
};

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ============================================================
// SEGURANÇA E ANTI-CACHE
// ============================================================
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  
    res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: blob:; " +
    "media-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "connect-src 'self' ws: wss: https://0.peerjs.com wss://0.peerjs.com https://unpkg.com; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
}); 

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  next();
});

app.use('/uploads', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const ext = path.extname(req.path).toLowerCase();
  const seguras = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.m4a'];
  if (!seguras.includes(ext)) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none';");
  next();
});

app.use((req, res, next) => {
  const host = req.headers.host || '';
  const ehLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || /^192\.168\./.test(host);
  if (!ehLocalhost) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') return res.status(400).json({ erro: 'HTTPS obrigatório' });
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
  const usuarioAtual = db.buscarUsuarioLevePorId(u.id);
  if (!usuarioAtual) {
    limparCookies(req, res);
    return res.status(401).json({ erro: 'Usuário não existe' });
  }
  req.usuario = { id: usuarioAtual.id, nome: usuarioAtual.nome, email: usuarioAtual.email };
  req.usuarioAtual = usuarioAtual;
  next();
}

function setarCookieToken(req, res, token) {
  const host = req.headers.host || '';
  const ehLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || /^192\.168\./.test(host);
  res.cookie('token', token, {
    httpOnly: true, sameSite: 'lax', secure: !ehLocalhost, maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
  });
}

function limparCookies(req, res) {
  const host = req.headers.host || '';
  const hostSemPorta = host.split(':')[0];
  const ehLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || /^192\.168\./.test(host);
  const opcoes = { path: '/', secure: !ehLocalhost, sameSite: 'lax', ...(ehLocalhost ? {} : { domain: hostSemPorta }) };
  res.clearCookie('token', opcoes);
  res.clearCookie('token', { path: '/', secure: !ehLocalhost, sameSite: 'lax' });
  res.clearCookie('token', { path: '/' });
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
}

// ========== RATE LIMIT ==========
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em 15 minutos.' },
});

const limiterEntrarServidor = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em 15 minutos.' },
});

// ========== UPLOAD ==========
app.post('/api/upload', exigirAuth, upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    const tipoSolicitado = (req.body.tipo || 'arquivo').toLowerCase();
    const regras = TIPOS_PERMITIDOS[tipoSolicitado] || TIPOS_PERMITIDOS.arquivo;
    if (req.file.size > regras.max) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ erro: `Arquivo muito grande` });
    }
    if (regras.mimes && !regras.mimes.includes(req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ erro: `Tipo não permitido` });
    }
    if (regras.ext) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!regras.ext.includes(ext)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ erro: `Extensão não permitida` });
      }
    }
    res.json({
      ok: true,
      anexo: { tipo: tipoSolicitado, url: '/uploads/' + req.file.filename, nome: req.file.originalname, tamanho: req.file.size, mime: req.file.mimetype },
    });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao processar upload' });
  }
});

// ========== AUTH ==========
app.post('/api/cadastro', limiterAuth, async (req, res) => {
  let { nome, email, senha } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos' });
  nome = nome.replace(/[<>]/g, '').trim().substring(0, 50);
  email = email.toLowerCase().trim();

  if (senha.length < 6) return res.status(400).json({ erro: 'Senha precisa ter 6+ caracteres' });
  if (db.buscarUsuarioPorEmail(email)) return res.status(400).json({ erro: 'Email já cadastrado' });
  try {
    const senhaHash = await auth.hashearSenha(senha);
    const usuario = db.criarUsuario({ nome, email, senhaHash });
    const token = auth.gerarToken(usuario);
    limparCookies(req, res);
    setarCookieToken(req, res, token);
    res.json({ ok: true, usuario });
  } catch (e) { res.status(500).json({ erro: 'Erro ao cadastrar' }); }
});

app.post('/api/login', limiterAuth, async (req, res) => {
  let { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'Preencha tudo' });
  email = email.toLowerCase().trim();
  const usuario = db.buscarUsuarioPorEmail(email);
  if (!usuario) return res.status(400).json({ erro: 'Email ou senha inválidos' });
  const ok = await auth.verificarSenha(senha, usuario.senha_hash);
  if (!ok) return res.status(400).json({ erro: 'Email ou senha inválidos' });
  limparCookies(req, res);
  const token = auth.gerarToken(usuario);
  setarCookieToken(req, res, token);
  res.json({ ok: true, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, avatar: usuario.avatar || '', banner: usuario.banner || '', bio: usuario.bio || '' } });
});

app.post('/api/logout', (req, res) => { limparCookies(req, res); res.json({ ok: true }); });

app.get('/api/eu', (req, res) => {
  const u = pegarUsuario(req);
  if (!u) return res.status(401).json({ erro: 'Não logado' });
  const usuario = db.buscarUsuarioPorId(u.id);
  if (!usuario) { limparCookies(req, res); return res.status(401).json({ erro: 'Usuário não existe' }); }
  res.json({ usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, avatar: usuario.avatar || '', banner: usuario.banner || '', bio: usuario.bio || '' } });
});

// ========== PERFIL ==========
app.post('/api/avatar', exigirAuth, (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ erro: 'Avatar vazio' });
  if (!avatar.startsWith('data:image/')) return res.status(400).json({ erro: 'Formato inválido' });
  if (avatar.length > 800000) return res.status(400).json({ erro: 'Imagem muito grande' });
  db.atualizarAvatar(req.usuario.id, avatar);
  io.emit('perfil-atualizado', { usuario_id: Number(req.usuario.id), avatar });
  res.json({ ok: true, usuario_id: req.usuario.id });
});

app.post('/api/banner', exigirAuth, (req, res) => {
  const { banner } = req.body;
  if (!banner) return res.status(400).json({ erro: 'Banner vazio' });
  if (!banner.startsWith('data:image/')) return res.status(400).json({ erro: 'Formato inválido' });
  if (banner.length > 2500000) return res.status(400).json({ erro: 'Imagem muito grande' });
  db.atualizarBanner(req.usuario.id, banner);
  io.emit('perfil-atualizado', { usuario_id: Number(req.usuario.id), banner });
  res.json({ ok: true, usuario_id: req.usuario.id });
});

app.post('/api/bio', exigirAuth, (req, res) => {
  let { bio } = req.body;
  if (typeof bio !== 'string') return res.status(400).json({ erro: 'Bio inválida' });
  if (bio.length > 200) return res.status(400).json({ erro: 'Bio muito longa (máx 200)' });
  const bioLimpa = bio.replace(/[<>]/g, '').trim();
  db.atualizarBio(req.usuario.id, bioLimpa);
  io.emit('perfil-atualizado', { usuario_id: Number(req.usuario.id), bio: bioLimpa });
  res.json({ ok: true, usuario_id: req.usuario.id });
});

// ========== AMIZADES ==========
app.get('/api/usuarios/buscar', exigirAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ usuarios: [] });
  const usuarios = db.buscarUsuariosPorNome(q, req.usuario.id);
  const filtrados = usuarios.filter((u) => !db.estaBloqueado(req.usuario.id, u.id));
  res.json({ usuarios: filtrados });
});

app.get('/api/usuarios/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ erro: 'ID inválido' });
  const u = db.buscarUsuarioPorId(id);
  if (!u) return res.status(404).json({ erro: 'Usuário não existe' });
  const souEu = Number(req.usuario.id) === id;
  res.json({ usuario: {
    id: u.id, nome: u.nome,
    email: souEu ? u.email : undefined,
    avatar: u.avatar || '', banner: u.banner || '', bio: u.bio || '',
  }});
});

app.get('/api/amizades', exigirAuth, (req, res) => {
  const id = req.usuario.id;
  res.json({ amigos: db.listarAmigos(id), pedidosRecebidos: db.listarPedidosRecebidos(id), pedidosEnviados: db.listarPedidosEnviados(id) });
});

app.post('/api/amizades/pedir', exigirAuth, (req, res) => {
  const { paraId } = req.body;
  if (!paraId) return res.status(400).json({ erro: 'Informe paraId' });
  if (Number(paraId) === req.usuario.id) return res.status(400).json({ erro: 'Você não pode se adicionar' });
  if (db.estaBloqueado(req.usuario.id, paraId)) return res.status(403).json({ erro: 'Você bloqueou esse usuário.' });
  const destinatario = db.buscarUsuarioPorId(paraId);
  if (!destinatario) return res.status(404).json({ erro: 'Usuário não existe' });

  const existente = db.buscarAmizadeEntre(req.usuario.id, paraId);
  if (existente) {
    if (existente.status === 'aceita') return res.status(400).json({ erro: 'Vocês já são amigos' });
    if (existente.status === 'pendente') return res.status(400).json({ erro: 'Pedido já existe' });
    db.deletarAmizade(existente.id);
  }
  const pedido = db.criarPedidoAmizade(req.usuario.id, paraId);
  const socketDestino = [...online.values()].find((u) => u.id === Number(paraId));
  const meusDados = db.buscarUsuarioPorId(req.usuario.id);

  if (socketDestino) {
    io.to(socketDestino.socketId).emit('amizade-nova', {
      paraId, pedido: { amizade_id: pedido.id, id: req.usuario.id, nome: req.usuario.nome, avatar: meusDados?.avatar || '', criado_em: Date.now() },
    });
  }
  res.json({ ok: true, pedido });
});

app.post('/api/amizades/aceitar', exigirAuth, (req, res) => {
  const { amizadeId } = req.body;
  const pedido = db.listarPedidosRecebidos(req.usuario.id).find((p) => p.amizade_id === amizadeId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  db.atualizarStatusAmizade(amizadeId, 'aceita');

  const meusDados = db.buscarUsuarioPorId(req.usuario.id);
  const socketSolicitante = [...online.values()].find((u) => u.id === pedido.id);
  if (socketSolicitante) {
    io.to(socketSolicitante.socketId).emit('amizade-aceita', { por: { id: req.usuario.id, nome: req.usuario.nome, avatar: meusDados?.avatar || '' } });
  }
  res.json({ ok: true });
});

app.post('/api/amizades/recusar', exigirAuth, (req, res) => {
  const { amizadeId } = req.body;
  const pedido = db.listarPedidosRecebidos(req.usuario.id).find((p) => p.amizade_id === amizadeId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  db.atualizarStatusAmizade(amizadeId, 'recusada');
  res.json({ ok: true });
});

app.delete('/api/amizades/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const amigos = db.listarAmigos(req.usuario.id);
  if (!amigos.find((a) => a.amizade_id === id)) return res.status(404).json({ erro: 'Amizade não encontrada' });
  db.deletarAmizade(id);
  res.json({ ok: true });
});

// ========== BLOQUEIOS ==========
app.get('/api/bloqueados', exigirAuth, (req, res) => { res.json({ bloqueados: db.listarBloqueados(req.usuario.id) }); });
app.post('/api/bloquear', exigirAuth, (req, res) => {
  const { alvoId } = req.body;
  if (Number(alvoId) === req.usuario.id) return res.status(400).json({ erro: 'Não pode se bloquear' });
  db.bloquear(req.usuario.id, alvoId);
  const amz = db.buscarAmizadeEntre(req.usuario.id, alvoId);
  if (amz) db.deletarAmizade(amz.id);
  res.json({ ok: true });
});
app.post('/api/desbloquear', exigirAuth, (req, res) => { db.desbloquear(req.usuario.id, req.body.alvoId); res.json({ ok: true }); });

// ========== SILENCIADOS ==========
app.post('/api/silenciar', exigirAuth, (req, res) => {
  const { tipo, alvoId } = req.body;
  if (!['usuario', 'servidor'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido' });
  db.silenciar(req.usuario.id, tipo, alvoId);
  res.json({ ok: true });
});
app.post('/api/dessilenciar', exigirAuth, (req, res) => { db.dessilenciar(req.usuario.id, req.body.tipo, req.body.alvoId); res.json({ ok: true }); });

// ========== DMs ==========
app.post('/api/conversas/abrir', exigirAuth, (req, res) => {
  const { amigoId } = req.body;
  if (!db.saoAmigos(req.usuario.id, amigoId)) return res.status(403).json({ erro: 'Vocês não são amigos' });
  const conv = db.abrirConversa(req.usuario.id, amigoId);
  const amigo = db.buscarUsuarioPorId(amigoId);
  res.json({ conversa_id: conv.id, amigo });
});

app.get('/api/conversas', exigirAuth, (req, res) => { res.json({ conversas: db.listarConversas(req.usuario.id) }); });

app.get('/api/conversas/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = db.buscarConversaPorId(id);
  if (!conv || (conv.usuario_a !== req.usuario.id && conv.usuario_b !== req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  db.marcarComoLidas(id, req.usuario.id);
  const mensagens = db.listarMensagens(id);
  const reacoes = db.listarReacoesDeMensagens('dm', mensagens.map((m) => m.id));
  res.json({ mensagens: mensagens.map((m) => ({ ...m, reacoes: reacoes[m.id] || {} })) });
});

app.post('/api/conversas/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const { texto, replyId, replyAutor, replyTexto, anexo } = req.body;
  if ((!texto || !texto.trim()) && !anexo) return res.status(400).json({ erro: 'Mensagem vazia' });
  const conv = db.buscarConversaPorId(id);
  if (!conv || (conv.usuario_a !== req.usuario.id && conv.usuario_b !== req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });

  const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
  if (db.estaBloqueado(outroId, req.usuario.id)) return res.status(403).json({ erro: 'Você foi bloqueado' });

  let anexoLimpo = null;
  if (anexo) {
    if (!anexo.url || !/^\/uploads\/[a-f0-9]{32}\.[a-z0-9]{1,10}$/.test(anexo.url)) {
      return res.status(400).json({ erro: 'Anexo inválido' });
    }
    anexoLimpo = { ...anexo, nome: String(anexo.nome || 'arquivo').slice(0, 200) };
  }

  const msg = db.salvarMensagem({ conversaId: id, deId: req.usuario.id, texto: (texto || '').trim(), replyId, replyAutor, replyTexto, anexo: anexoLimpo });
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
  const conv = db.buscarConversaPorId(idConversa);
  if (!conv || (conv.usuario_a !== req.usuario.id && conv.usuario_b !== req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  const msg = db.buscarMensagemPorId(idMensagem);
  if (!msg || msg.conversa_id !== idConversa || msg.de_id !== req.usuario.id) return res.status(403).json({ erro: 'Sem permissão' });
  db.editarMensagem(idMensagem, texto.trim());
  const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
  const socketOutro = [...online.values()].find((u) => u.id === outroId);
  if (socketOutro) io.to(socketOutro.socketId).emit('dm-editada', { conversa_id: idConversa, mensagem: { id: idMensagem, texto: texto.trim(), editado: 1 } });
  res.json({ ok: true });
});

app.delete('/api/conversas/:idConversa/mensagens/:idMensagem', exigirAuth, (req, res) => {
  const idConversa = Number(req.params.idConversa);
  const idMensagem = Number(req.params.idMensagem);
  const conv = db.buscarConversaPorId(idConversa);
  if (!conv || (conv.usuario_a !== req.usuario.id && conv.usuario_b !== req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  const msg = db.buscarMensagemPorId(idMensagem);
  if (!msg || msg.de_id !== req.usuario.id) return res.status(403).json({ erro: 'Sem permissão' });

  if (msg.anexo && msg.anexo.url && msg.anexo.url.startsWith('/uploads/')) {
    const filepath = path.join(UPLOADS_DIR, path.basename(msg.anexo.url));
    if (fs.existsSync(filepath)) { try { fs.unlinkSync(filepath); } catch (e) {} }
  }

  db.deletarMensagem(idMensagem);
  const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
  const socketOutro = [...online.values()].find((u) => u.id === outroId);
  if (socketOutro) io.to(socketOutro.socketId).emit('dm-deletada', { conversa_id: idConversa, mensagem_id: idMensagem });
  res.json({ ok: true });
});

app.delete('/api/conversas/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = db.buscarConversaPorId(id);
  if (!conv || (conv.usuario_a !== req.usuario.id && conv.usuario_b !== req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  db.limparHistoricoConversa(id);
  io.emit('dm-historico-limpo', { conversa_id: id });
  res.json({ ok: true });
});

// ========== REAÇÕES ==========
app.post('/api/reacoes/toggle', exigirAuth, (req, res) => {
  const { tipo, alvoId, emoji } = req.body;
  if (!['canal', 'dm'].includes(tipo) || emoji.length > 8) return res.status(400).json({ erro: 'Dados inválidos' });
  if (tipo === 'canal') {
    const msg = db.buscarMensagemCanalPorId(alvoId);
    if (!msg) return res.status(404).json({ erro: 'Msg não existe' });
  } else {
    const msg = db.buscarMensagemPorId(alvoId);
    if (!msg) return res.status(404).json({ erro: 'Msg não existe' });
  }
  const removida = db.removerReacao({ tipo, alvoId, usuarioId: req.usuario.id, emoji });
  if (removida.changes === 0) db.adicionarReacao({ tipo, alvoId, usuarioId: req.usuario.id, emoji });

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
  res.json({ ok: true, reacoes: reacoes[alvoId] || {} });
});

// ========== SERVIDORES ==========
app.get('/api/servidores', exigirAuth, (req, res) => { res.json({ servidores: db.listarServidoresDoUsuario(req.usuario.id) }); });

app.post('/api/servidores', exigirAuth, (req, res) => {
  if (!req.body.nome || !req.body.nome.trim()) return res.status(400).json({ erro: 'Informe o nome' });
  const s = db.criarServidor({ nome: req.body.nome.trim(), descricao: req.body.descricao || '', donoId: req.usuario.id });
  res.json({ ok: true, servidor: s });
});

app.get('/api/servidores/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.buscarServidorPorId(id);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (!db.ehMembro(id, req.usuario.id)) return res.status(403).json({ erro: 'Você não é membro' });
  res.json({ servidor: s, canais: db.listarCanais(id), membros: db.listarMembros(id), ehDono: Number(s.dono_id) === Number(req.usuario.id), silenciado: db.estaSilenciado(req.usuario.id, 'servidor', id) });
});

app.patch('/api/servidores/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.buscarServidorPorId(id);
  if (!s || Number(s.dono_id) !== Number(req.usuario.id)) return res.status(403).json({ erro: 'Só o dono pode editar' });
  if (!req.body.nome || !req.body.nome.trim()) return res.status(400).json({ erro: 'Informe o nome' });
  db.atualizarServidor(id, { nome: req.body.nome.trim(), descricao: req.body.descricao || '' });
  const atualizado = db.buscarServidorPorId(id);
  io.emit('servidor-atualizado', { servidor: atualizado });
  res.json({ ok: true, servidor: atualizado });
});

app.post('/api/servidores/entrar', limiterEntrarServidor, exigirAuth, (req, res) => {
  const s = db.buscarServidorPorCodigo((req.body.codigo || '').trim());
  if (!s) return res.status(404).json({ erro: 'Código inválido' });
  if (!db.adicionarMembro(s.id, req.usuario.id)) return res.status(400).json({ erro: 'Você já é membro' });
  const meusDados = db.buscarUsuarioPorId(req.usuario.id);
  io.to('servidor-' + s.id).emit('membro-entrou', { servidor_id: s.id, membro: { id: req.usuario.id, nome: req.usuario.nome, avatar: meusDados?.avatar || '' } });
  res.json({ ok: true, servidor: s });
});

app.post('/api/servidores/:id/sair', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.buscarServidorPorId(id);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (Number(s.dono_id) === Number(req.usuario.id)) return res.status(400).json({ erro: 'Dono não pode sair' });
  db.removerMembro(id, req.usuario.id);

  const socketUser = [...online.values()].find(u => u.id === req.usuario.id);
  if (socketUser) {
    io.sockets.sockets.get(socketUser.socketId)?.leave('servidor-' + id);
    io.to(socketUser.socketId).emit('voce-foi-removido', { servidor_id: id, servidor_nome: s.nome });
  }
  io.to('servidor-' + id).emit('membro-removido', { servidor_id: id, usuario_id: req.usuario.id });
  res.json({ ok: true });
});

app.delete('/api/servidores/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.deletarServidor(id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  io.emit('servidor-deletado', { servidor_id: id });
  res.json({ ok: true });
});

app.post('/api/servidores/:id/remover-membro', exigirAuth, (req, res) => {
  const servidorId = Number(req.params.id);
  const usuarioId = Number(req.body.usuarioId);
  if (!Number.isInteger(usuarioId)) return res.status(400).json({ erro: 'ID inválido' });

  const s = db.buscarServidorPorId(servidorId);
  if (!s || Number(s.dono_id) !== Number(req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  if (usuarioId === Number(s.dono_id)) return res.status(400).json({ erro: 'Dono não pode ser removido' });

  db.removerMembro(servidorId, usuarioId);

  const socketRemovido = [...online.values()].find((u) => u.id === usuarioId);
  if (socketRemovido) {
    io.sockets.sockets.get(socketRemovido.socketId)?.leave('servidor-' + servidorId);
    io.to(socketRemovido.socketId).emit('voce-foi-removido', { servidor_id: servidorId, servidor_nome: s.nome });
  }
  io.to('servidor-' + servidorId).emit('membro-removido', { servidor_id: servidorId, usuario_id: usuarioId });
  res.json({ ok: true });
});

// ========== CANAIS ==========
app.post('/api/servidores/:id/canais', exigirAuth, (req, res) => {
  const servidorId = Number(req.params.id);
  const s = db.buscarServidorPorId(servidorId);
  if (!s || Number(s.dono_id) !== Number(req.usuario.id)) return res.status(403).json({ erro: 'Só o dono pode criar canais' });
  if (!req.body.nome || !req.body.nome.trim()) return res.status(400).json({ erro: 'Informe o nome' });
  const c = db.criarCanal(servidorId, req.body.nome.trim());
  if (!c) return res.status(400).json({ erro: 'Nome inválido ou já existe' });
  io.to('servidor-' + servidorId).emit('canal-criado', { canal: c });
  res.json({ ok: true, canal: c });
});

app.delete('/api/canais/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.deletarCanal(id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
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
  res.json({ mensagens: mensagens.map((m) => ({ ...m, reacoes: reacoes[m.id] || {} })) });
});

app.post('/api/canais/:id/mensagens', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const { texto, replyId, replyAutor, replyTexto, anexo } = req.body;
  if ((!texto || !texto.trim()) && !anexo) return res.status(400).json({ erro: 'Mensagem vazia' });
  const c = db.buscarCanalPorId(id);
  if (!c || !db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });

  let anexoLimpo = null;
  if (anexo) {
    if (!anexo.url || !/^\/uploads\/[a-f0-9]{32}\.[a-z0-9]{1,10}$/.test(anexo.url)) {
      return res.status(400).json({ erro: 'Anexo inválido' });
    }
    anexoLimpo = { ...anexo, nome: String(anexo.nome || 'arquivo').slice(0, 200) };
  }

  const msg = db.salvarMensagemCanal({ canalId: id, deId: req.usuario.id, texto: (texto || '').trim(), replyId, replyAutor, replyTexto, anexo: anexoLimpo });
  const meusDados = db.buscarUsuarioPorId(req.usuario.id);
  io.to('canal-' + id).emit('canal-nova-msg', { canal_id: id, mensagem: { ...msg, de_nome: req.usuario.nome, de_avatar: meusDados.avatar || '', reacoes: {} } });
  res.json({ ok: true, mensagem: { ...msg, de_nome: req.usuario.nome, de_avatar: meusDados.avatar || '', reacoes: {} } });
});

app.patch('/api/canais/:idCanal/mensagens/:idMensagem', exigirAuth, (req, res) => {
  const idCanal = Number(req.params.idCanal);
  const idMensagem = Number(req.params.idMensagem);
  const { texto } = req.body;
  const c = db.buscarCanalPorId(idCanal);
  if (!c || !db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  const msg = db.buscarMensagemCanalPorId(idMensagem);
  if (!msg || msg.canal_id !== idCanal || msg.de_id !== req.usuario.id) return res.status(403).json({ erro: 'Sem permissão' });
  db.editarMensagemCanal(idMensagem, texto.trim());
  io.to('canal-' + idCanal).emit('canal-msg-editada', { canal_id: idCanal, mensagem: { id: idMensagem, canal_id: idCanal, de_id: req.usuario.id, texto: texto.trim(), hora: msg.hora, editado: 1 } });
  res.json({ ok: true });
});

app.delete('/api/canais/:idCanal/mensagens/:idMensagem', exigirAuth, (req, res) => {
  const idCanal = Number(req.params.idCanal);
  const idMensagem = Number(req.params.idMensagem);
  const c = db.buscarCanalPorId(idCanal);
  if (!c || !db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });
  const msg = db.buscarMensagemCanalPorId(idMensagem);
  if (!msg || msg.canal_id !== idCanal) return res.status(404).json({ erro: 'Msg não existe' });
  const s = db.buscarServidorPorId(c.servidor_id);
  const ehDono = s && Number(s.dono_id) === Number(req.usuario.id);
  if (msg.de_id !== req.usuario.id && !ehDono) return res.status(403).json({ erro: 'Sem permissão' });

  if (msg.anexo && msg.anexo.url && msg.anexo.url.startsWith('/uploads/')) {
    const filepath = path.join(UPLOADS_DIR, path.basename(msg.anexo.url));
    if (fs.existsSync(filepath)) { try { fs.unlinkSync(filepath); } catch (e) {} }
  }
  db.deletarMensagemCanal(idMensagem);
  io.to('canal-' + idCanal).emit('canal-msg-deletada', { canal_id: idCanal, mensagem_id: idMensagem });
  res.json({ ok: true });
});

// ========== SOCKET.IO ==========
io.use((socket, next) => {
  try {
    const cookies = socket.request.headers.cookie || '';
    const matches = [...cookies.matchAll(/(?:^|;\s*)token=([^;]+)/g)];
    if (!matches.length) return next(new Error('Não autenticado'));
    const token = decodeURIComponent(matches[matches.length - 1][1]);
    const payload = auth.verificarToken(token);
    if (!payload || !payload.id) return next(new Error('Token inválido'));
    const usuarioAtual = db.buscarUsuarioLevePorId(payload.id);
    if (!usuarioAtual) return next(new Error('Usuário não existe'));
    socket.usuario = { id: usuarioAtual.id, nome: usuarioAtual.nome, email: usuarioAtual.email };
    next();
  } catch (e) { next(new Error('Erro de autenticação')); }
});

const online = new Map();

function notificarListaOnline() {
  const porUsuario = new Map();
  online.forEach((u) => { if (!porUsuario.has(u.id)) porUsuario.set(u.id, u); });
  io.emit('lista-online', [...porUsuario.values()].map(u => ({ id: u.id, nome: u.nome, avatar: u.avatar })));
}

io.on('connection', (socket) => {
  const dadosCompletos = db.buscarUsuarioPorId(socket.usuario.id) || {};
  online.set(socket.id, {
    id: socket.usuario.id, nome: socket.usuario.nome, email: socket.usuario.email,
    avatar: dadosCompletos.avatar || '', banner: dadosCompletos.banner || '', bio: dadosCompletos.bio || '', socketId: socket.id,
  });

  notificarListaOnline();

  // ============================================================
  // 🔥 EVENTOS ADICIONADOS PARA CHAMADAS DE VOZ E VÍDEO
  // ============================================================
  
  socket.on('iniciar-chamada', ({ paraId }) => {
    const socketDestino = [...online.values()].find(u => u.id === Number(paraId));
    if (socketDestino) {
      io.to(socketDestino.socketId).emit('receber-chamada', {
        deId: socket.usuario.id,
        nome: socket.usuario.nome,
        avatar: dadosCompletos.avatar || ''
      });
    }
  });

  socket.on('entrar-canal-voz', ({ canalId }) => {
    socket.join('voz-' + canalId);
    socket.to('voz-' + canalId).emit('usuario-entrou-voz', {
      usuarioId: socket.usuario.id,
      nome: socket.usuario.nome
    });
  });

  // ============================================================

  socket.on('entrar-servidores', () => {
    const servidores = db.listarServidoresDoUsuario(socket.usuario.id);
    servidores.forEach((s) => socket.join('servidor-' + s.id));
  });

  socket.on('entrar-canal', ({ canalId }) => {
    const c = db.buscarCanalPorId(canalId);
    if (!c || !db.ehMembro(c.servidor_id, socket.usuario.id)) return;
    [...socket.rooms].forEach(r => { if (r.startsWith('canal-')) socket.leave(r); });
    socket.join('canal-' + canalId);
  });

  socket.on('digitando-canal', ({ canalId }) => {
    socket.to('canal-' + canalId).emit('alguem-digitando-canal', { canalId, nome: socket.usuario.nome, usuarioId: socket.usuario.id });
  });

  socket.on('parou-digitando-canal', ({ canalId }) => {
    socket.to('canal-' + canalId).emit('alguem-parou-digitando-canal', { canalId, usuarioId: socket.usuario.id });
  });

  socket.on('digitando-dm', ({ conversaId, paraUsuarioId }) => {
    const socketOutro = [...online.values()].find((u) => u.id === Number(paraUsuarioId));
    if (socketOutro) io.to(socketOutro.socketId).emit('alguem-digitando-dm', { conversaId, nome: socket.usuario.nome, usuarioId: socket.usuario.id });
  });

  socket.on('parou-digitando-dm', ({ conversaId, paraUsuarioId }) => {
    const socketOutro = [...online.values()].find((u) => u.id === Number(paraUsuarioId));
    if (socketOutro) io.to(socketOutro.socketId).emit('alguem-parou-digitando-dm', { conversaId, usuarioId: socket.usuario.id });
  });

  socket.on('perfil-atualizado-local', ({ usuario_id, avatar, banner, bio }) => {
    if (Number(usuario_id) !== Number(socket.usuario.id)) return;

    const payload = { usuario_id: Number(usuario_id) };
    if (avatar !== undefined) {
      if (typeof avatar !== 'string' || !avatar.startsWith('data:image/') || avatar.length > 800000) return;
      payload.avatar = avatar;
    }
    if (banner !== undefined) {
      if (typeof banner !== 'string' || !banner.startsWith('data:image/') || banner.length > 2500000) return;
      payload.banner = banner;
    }
    if (bio !== undefined) {
      if (typeof bio !== 'string' || bio.length > 200) return;
      payload.bio = bio.replace(/[<>]/g, '').trim();
    }
    io.emit('perfil-atualizado', payload);
  });

  socket.on('disconnect', () => {
    online.delete(socket.id);
    notificarListaOnline();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); }); 