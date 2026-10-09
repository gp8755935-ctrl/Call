const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

const online = new Map(); // socketId -> { nome, socketId }

io.on('connection', (socket) => {
  console.log('conectado:', socket.id);

  socket.on('login', (nome) => {
    online.set(socket.id, { nome, socketId: socket.id });
    io.emit('lista-online', [...online.values()]);
  });

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

  // ========== WEBRTC (SINALIZAÇÃO) ==========

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