const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const db = require('./db');
const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ========== ROTAS HTTP ==========

// Cadastro
app.post('/api/cadastro', async (req, res) => {
  const { nome, email, senha } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Preencha todos os campos' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'Senha precisa ter 6+ caracteres' });
  }

  const existente = db.buscarUsuarioPorEmail(email);
  if (existente) {
    return res.status(400).json({ erro: 'Email já cadastrado' });
  }

  try {
    const senhaHash = await auth.hashearSenha(senha);
    const usuario = db.criarUsuario({ nome, email, senhaHash });
    const token = auth.gerarToken(usuario);

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true, usuario });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro ao cadastrar' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Preencha todos os campos' });
  }

  const usuario = db.buscarUsuarioPorEmail(email);
  if (!usuario) {
    return res.status(400).json({ erro: 'Email ou senha inválidos' });
  }

  const ok = await auth.verificarSenha(senha, usuario.senha_hash);
  if (!ok) {
    return res.status(400).json({ erro: 'Email ou senha inválidos' });
  }

  const token = auth.gerarToken(usuario);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({
    ok: true,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// Quem sou eu?
app.get('/api/eu', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ erro: 'Não logado' });

  const payload = auth.verificarToken(token);
  if (!payload) return res.status(401).json({ erro: 'Token inválido' });

  const usuario = db.buscarUsuarioPorId(payload.id);
  if (!usuario) return res.status(401).json({ erro: 'Usuário não existe' });

  res.json({ usuario });
});

// Lista de todos os usuários (pra depois fazer "amigos")
app.get('/api/usuarios', (req, res) => {
  const token = req.cookies.token;
  const payload = token ? auth.verificarToken(token) : null;
  if (!payload) return res.status(401).json({ erro: 'Não logado' });

  const todos = db.listarUsuarios().filter((u) => u.id !== payload.id);
  res.json({ usuarios: todos });
});

// ========== SOCKET.IO ==========

// Middleware pra autenticar via cookie
io.use((socket, next) => {
  const cookies = socket.request.headers.cookie || '';
  const match = cookies.match(/token=([^;]+)/);
  const token = match ? match[1] : null;

  if (!token) return next(new Error('Não autenticado'));

  const payload = auth.verificarToken(token);
  if (!payload) return next(new Error('Token inválido'));

  socket.usuario = payload;
  next();
});

const online = new Map(); // socketId -> { id, nome, email, socketId }

io.on('connection', (socket) => {
  console.log('conectado:', socket.usuario.nome, socket.id);

  // Registra como online
  online.set(socket.id, {
    id: socket.usuario.id,
    nome: socket.usuario.nome,
    email: socket.usuario.email,
    socketId: socket.id,
  });

  io.emit('lista-online', [...online.values()]);

  socket.on('pedir-conexao', ({ paraSocketId }) => {
    const de = online.get(socket.id);
    if (!de || !paraSocketId) return;
    io.to(paraSocketId).emit('pedido-recebido', { de });
  });

  socket.on('aceitar-conexao', ({ deSocketId }) => {
    if (!deSocketId) return;
    const sala = [socket.id, deSocketId].sort().join('|');
    socket.join(sala);
    const outro = io.sockets.sockets.get(deSocketId);
    if (outro) outro.join(sala);

    const historico = db.buscarHistorico(sala, 50);
    io.to(sala).emit('conexao-aceita', { sala, historico });
  });

  socket.on('encerrar-conexao', ({ sala }) => {
    if (!sala) return;
    socket.leave(sala);
    socket.to(sala).emit('conexao-encerrada');
  });

  socket.on('mensagem', ({ sala, texto }) => {
    const usuario = online.get(socket.id);
    if (!usuario || !sala) return;

    const hora = Date.now();
    db.salvarMensagem({ sala, de: usuario.nome, texto, hora });

    io.to(sala).emit('mensagem', {
      de: usuario.nome,
      texto,
      hora,
    });
  });

  socket.on('limpar-historico', ({ sala }) => {
    if (!sala) return;
    db.limparHistorico(sala);
    io.to(sala).emit('historico-limpo');
  });

  socket.on('digitando', ({ sala, nome }) => {
    if (!sala) return;
    socket.to(sala).emit('digitando', { nome });
  });

  // WebRTC (deixei aqui, funciona se você quiser voltar depois)
  socket.on('webrtc-offer', ({ sala, offer }) => {
    socket.to(sala).emit('webrtc-offer', { offer, de: socket.id });
  });
  socket.on('webrtc-answer', ({ sala, answer }) => {
    socket.to(sala).emit('webrtc-answer', { answer });
  });
  socket.on('webrtc-ice', ({ sala, candidate }) => {
    socket.to(sala).emit('webrtc-ice', { candidate });
  });
  socket.on('webrtc-encerrar', ({ sala }) => {
    socket.to(sala).emit('webrtc-encerrada');
  });

  socket.on('disconnect', () => {
    online.delete(socket.id);
    io.emit('lista-online', [...online.values()]);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});