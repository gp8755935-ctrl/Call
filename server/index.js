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

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ========== AUTH HELPERS ==========

function pegarUsuario(req) {
  const token = req.cookies.token;
  if (!token) return null;
  return auth.verificarToken(token);
}

function exigirAuth(req, res, next) {
  const u = pegarUsuario(req);
  if (!u) return res.status(401).json({ erro: 'Não logado' });
  req.usuario = u;
  next();
}

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
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
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

  const token = auth.gerarToken(usuario);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
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
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/eu', (req, res) => {
  const u = pegarUsuario(req);
  if (!u) return res.status(401).json({ erro: 'Não logado' });
  const usuario = db.buscarUsuarioPorId(u.id);
  if (!usuario) return res.status(401).json({ erro: 'Usuário não existe' });
  res.json({ usuario });
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
  res.json({ usuarios: db.buscarUsuariosPorNome(q, req.usuario.id) });
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
  const destinatario = db.buscarUsuarioPorId(paraId);
  if (!destinatario) return res.status(404).json({ erro: 'Usuário não existe' });

  const existente = db.buscarAmizadeEntre(req.usuario.id, paraId);
  if (existente) {
    if (existente.status === 'aceita') return res.status(400).json({ erro: 'Vocês já são amigos' });
    if (existente.status === 'pendente') return res.status(400).json({ erro: 'Pedido já existe' });
    db.deletarAmizade(existente.id);
  }

  const pedido = db.criarPedidoAmizade(req.usuario.id, paraId);
  io.emit('amizade-nova', {
    paraId,
    pedido: {
      amizade_id: pedido.id,
      id: req.usuario.id,
      nome: req.usuario.nome,
      email: req.usuario.email,
      criado_em: Date.now(),
    },
  });
  res.json({ ok: true, pedido });
});

app.post('/api/amizades/aceitar', exigirAuth, (req, res) => {
  const { amizadeId } = req.body;
  if (!amizadeId) return res.status(400).json({ erro: 'Informe amizadeId' });
  const pedido = db.listarPedidosRecebidos(req.usuario.id).find((p) => p.amizade_id === amizadeId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  db.atualizarStatusAmizade(amizadeId, 'aceita');
  io.emit('amizade-aceita', {
    paraId: pedido.id,
    por: { id: req.usuario.id, nome: req.usuario.nome, email: req.usuario.email },
  });
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
  const { texto, replyId, replyAutor, replyTexto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Texto vazio' });
  const conv = db.buscarConversaPorId(id);
  if (!conv) return res.status(404).json({ erro: 'Conversa não existe' });
  const ehParticipante = conv.usuario_a === req.usuario.id || conv.usuario_b === req.usuario.id;
  if (!ehParticipante) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.salvarMensagem({
    conversaId: id,
    deId: req.usuario.id,
    texto: texto.trim(),
    replyId: replyId || null,
    replyAutor: replyAutor || null,
    replyTexto: replyTexto || null,
  });

  const outroId = conv.usuario_a === req.usuario.id ? conv.usuario_b : conv.usuario_a;
  const socketOutro = [...online.values()].find((u) => u.id === outroId);

  const meusDados = db.buscarUsuarioPorId(req.usuario.id);
  const payload = { ...msg, de_nome: req.usuario.nome, de_avatar: meusDados.avatar || '', reacoes: {} };

  if (socketOutro) {
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
  res.json({ ok: true, servidor: s });
});

app.post('/api/servidores/:id/sair', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.buscarServidorPorId(id);
  if (!s) return res.status(404).json({ erro: 'Servidor não existe' });
  if (s.dono_id === req.usuario.id) return res.status(400).json({ erro: 'Dono não pode sair' });
  db.removerMembro(id, req.usuario.id);
  res.json({ ok: true });
});

app.delete('/api/servidores/:id', exigirAuth, (req, res) => {
  const id = Number(req.params.id);
  const ok = db.deletarServidor(id, req.usuario.id);
  if (!ok) return res.status(403).json({ erro: 'Sem permissão' });
  io.emit('servidor-deletado', { servidor_id: id });
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
  const { texto, replyId, replyAutor, replyTexto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Texto vazio' });
  const c = db.buscarCanalPorId(id);
  if (!c) return res.status(404).json({ erro: 'Canal não existe' });
  if (!db.ehMembro(c.servidor_id, req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão' });

  const msg = db.salvarMensagemCanal({
    canalId: id,
    deId: req.usuario.id,
    texto: texto.trim(),
    replyId: replyId || null,
    replyAutor: replyAutor || null,
    replyTexto: replyTexto || null,
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

  db.deletarMensagemCanal(idMensagem);

  io.to('canal-' + idCanal).emit('canal-msg-deletada', {
    canal_id: idCanal,
    mensagem_id: idMensagem,
  });
  res.json({ ok: true });
});

// ========== SOCKET.IO ==========

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

  // 🔥 MODIFICADO: agora inclui avatar, banner e bio
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

  socket.on('sair-canal', ({ canalId }) => {
    socket.leave('canal-' + canalId);
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