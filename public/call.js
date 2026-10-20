let peer = null;
let chamadaAtual = null;
let streamLocal = null;
let streamTela = null;
let chamadaRecebidaPendente = null;
let canvasAudioCtx = null;
let localMuted = false;
let deafened = false;
let chamadasTela = [];
let timerChamada = null;
let chamadaComecouEm = 0;
let timeoutChamada = null;

function iniciarRelogioChamada() {
  if (timerChamada) return;
  chamadaComecouEm = Date.now();
  const atualizar = () => {
    const el = document.getElementById('chamada-duracao');
    if (!el || !chamadaComecouEm) return;
    const segundos = Math.floor((Date.now() - chamadaComecouEm) / 1000);
    el.textContent = `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`;
  };
  atualizar();
  timerChamada = setInterval(atualizar, 1000);
}

function pararRelogioChamada() {
  if (timerChamada) clearInterval(timerChamada);
  timerChamada = null;
  chamadaComecouEm = 0;
  if (timeoutChamada) clearTimeout(timeoutChamada);
  timeoutChamada = null;
  const el = document.getElementById('chamada-duracao');
  if (el) el.textContent = '00:00';
}

function inicializarPeerJS() {
  if (!window.usuarioAtual) return;
  if (peer) return;
  
  const meuId = 'void_user_' + window.usuarioAtual.id; 
  peer = new Peer(meuId, { 
    config: { 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
      ] 
    } 
  });

  peer.on('open', (id) => console.log('✅ PeerJS Pronto:', id));
  peer.on('error', (err) => console.error('❌ Erro PeerJS:', err));

  peer.on('call', (call) => {
    const metadata = call.metadata || {};
    
    // Recebendo Transmissão de Tela
    if (metadata.type === 'video') {
      call.answer();
      document.getElementById('video-container').classList.add('ativa');
      call.on('stream', (remoteStream) => {
        const videoEl = document.getElementById('video-transmitido');
        videoEl.srcObject = remoteStream;
        videoEl.play().catch(() => {
          // Botão de desbloqueio para celulares
          if (!document.getElementById('btn-desbloquear-video')) {
            const btn = document.createElement('button');
            btn.id = 'btn-desbloquear-video';
            btn.textContent = '▶ Clique para ver';
            btn.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:9999; padding:12px 24px; background:#0284c7; color:white; border:none; border-radius:8px; cursor:pointer;";
            btn.onclick = () => { videoEl.play(); btn.remove(); };
            document.getElementById('video-container').appendChild(btn);
          }
        });
      });
      return;
    }

    // Chamadas de voz em canal são atendidas automaticamente. Este bloco precisa
    // vir antes do fallback de chamada 1:1, senão o popup de ligação interrompe o mesh.
    if (metadata.type === 'audio' && metadata.canal) {
      if (!streamLocal || !canalVozAtivo) {
        call.close();
        return;
      }
      call.answer(streamLocal);
      if (typeof conexoesVoz !== 'undefined') conexoesVoz[call.peer] = call;
      if (metadata.socketId) participantesVoz.set(metadata.socketId, call.peer);
      adicionarAvatarNaChamada(metadata.nome, metadata.avatar, metadata.socketId || call.peer);
      call.on('stream', (remoteStream) => anexarAudioRemoto(call.peer, remoteStream));
      call.on('close', () => {
        if (conexoesVoz[call.peer] === call) delete conexoesVoz[call.peer];
        removerAudioRemoto(call.peer);
      });
      return;
    }

    // Recebendo chamada de voz 1:1: aguarda a decisão do usuário.
    if (metadata.type === 'audio') {
      chamadaRecebidaPendente = call;
      document.getElementById('chamada-recebida-nome').textContent = metadata.nome || 'Amigo';
      document.getElementById('chamada-recebida-popup').classList.add('ativo');
      tocarSomChamada();
    }
  });
}

function tocarSomChamada() {
  try {
    if (!canvasAudioCtx) canvasAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (canvasAudioCtx.state === 'suspended') canvasAudioCtx.resume();
    const osc = canvasAudioCtx.createOscillator();
    const gain = canvasAudioCtx.createGain();
    osc.connect(gain); gain.connect(canvasAudioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, canvasAudioCtx.currentTime);
    osc.frequency.setValueAtTime(1200, canvasAudioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.5, canvasAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, canvasAudioCtx.currentTime + 0.4);
    osc.start(); osc.stop(canvasAudioCtx.currentTime + 0.4);
  } catch (e) {}
}

// ============================================================
// LIGAR E ATENDER (1 a 1)
// ============================================================

async function ligarParaAmigo(amigoId, nomeAmigo, avatarAmigo) {
  if (chamadaAtual || canalVozAtivo) return alert('Você já está em uma chamada.');
  try {
    streamLocal = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) { return alert('Erro ao acessar microfone.'); }

  document.getElementById('chamada-overlay').classList.add('ativa');
  document.getElementById('chamada-nome-exibicao').textContent = nomeAmigo;
  document.getElementById('chamada-status').textContent = 'Chamando...';
  document.getElementById('chamada-duracao').textContent = 'Aguardando resposta';
  document.getElementById('chamada-overlay').classList.remove('minimizada');
  document.getElementById('chamada-avatares').innerHTML = '';
  
  if (avatarAmigo) {
    document.getElementById('chamada-avatares').innerHTML = `<div class="avatar-chamada"><img src="${avatarAmigo}"></div>`;
  } else {
    document.getElementById('chamada-avatares').innerHTML = `<div class="avatar-chamada">${(nomeAmigo || '?')[0].toUpperCase()}</div>`;
  }

  const peerIdDestino = 'void_user_' + amigoId;
  const call = peer.call(peerIdDestino, streamLocal, {
    metadata: { type: 'audio', id: window.usuarioAtual.id, nome: window.usuarioAtual.nome, avatar: window.usuarioAtual.avatar }
  });

  if (call) {
    chamadaAtual = call;
    configurarChamadaAtiva(call, nomeAmigo, avatarAmigo);
    timeoutChamada = setTimeout(() => {
      if (chamadaAtual === call && document.getElementById('chamada-status').textContent === 'Chamando...') {
        document.getElementById('chamada-status').textContent = 'Sem resposta';
        setTimeout(desligarChamada, 900);
      }
    }, 30000);
  }
}

async function atenderChamada() {
  if (!chamadaRecebidaPendente) return;
  document.getElementById('chamada-recebida-popup').classList.remove('ativo');
  try {
    streamLocal = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) { return alert('Erro ao acessar microfone.'); }

  chamadaRecebidaPendente.answer(streamLocal);
  chamadaAtual = chamadaRecebidaPendente;
  
  const metadata = chamadaRecebidaPendente.metadata || {};
  document.getElementById('chamada-overlay').classList.add('ativa');
  document.getElementById('chamada-nome-exibicao').textContent = metadata.nome || 'Amigo';
  document.getElementById('chamada-status').textContent = 'Conectando...';
  document.getElementById('chamada-duracao').textContent = '00:00';
  document.getElementById('chamada-overlay').classList.remove('minimizada');
  document.getElementById('chamada-avatares').innerHTML = '';

  if (metadata.avatar) {
    document.getElementById('chamada-avatares').innerHTML = `<div class="avatar-chamada"><img src="${metadata.avatar}"></div>`;
  } else {
    document.getElementById('chamada-avatares').innerHTML = `<div class="avatar-chamada">${(metadata.nome || '?')[0].toUpperCase()}</div>`;
  }

  configurarChamadaAtiva(chamadaAtual, metadata.nome, metadata.avatar);
  chamadaRecebidaPendente = null;
}

function recusarChamada() {
  if (chamadaRecebidaPendente) chamadaRecebidaPendente.close();
  chamadaRecebidaPendente = null;
  document.getElementById('chamada-recebida-popup').classList.remove('ativo');
}

// ============================================================
// CONTROLES DA CHAMADA
// ============================================================

function anexarAudioRemoto(id, remoteStream) {
  removerAudioRemoto(id);
  const audioEl = document.createElement('audio');
  audioEl.srcObject = remoteStream;
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.volume = deafened ? 0 : 1.0;
  audioEl.id = 'audio-' + id;
  document.body.appendChild(audioEl);
  audioEl.play().catch(() => {});
  return audioEl;
}

function removerAudioRemoto(id) {
  const audioEl = document.getElementById('audio-' + id);
  if (audioEl) {
    audioEl.srcObject = null;
    audioEl.remove();
  }
}

function configurarChamadaAtiva(call, nome, avatar) {
  call.on('stream', (remoteStream) => {
    document.getElementById('chamada-status').textContent = 'Conectado';
    iniciarRelogioChamada();
    anexarAudioRemoto('direta-' + call.peer, remoteStream);
  });
  call.on('close', () => {
    removerAudioRemoto('direta-' + call.peer);
    desligarChamada();
  });
}

function toggleMute() {
  if (!streamLocal) return;
  localMuted = !localMuted;
  streamLocal.getAudioTracks()[0].enabled = !localMuted;
  const btn = document.getElementById('btn-mutar-chamada');
  btn.classList.toggle('ativo', localMuted);
  btn.querySelector('.icone').textContent = localMuted ? '🔇' : '🎤';
}

async function toggleTransmissao() {
  if (streamTela) {
    streamTela.getTracks().forEach(t => t.stop());
    streamTela = null;
    document.getElementById('video-container').classList.remove('ativa');
    document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
    return;
  }

  try {
    console.log('🖥️ Solicitando captura de tela...');
    streamTela = await navigator.mediaDevices.getDisplayMedia({ video: true });
    console.log('✅ Tela capturada. Tracks:', streamTela.getTracks().length);

    const videoTrack = streamTela.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Nenhuma track de vídeo encontrada.');

    const videoEl = document.getElementById('video-transmitido');
    videoEl.srcObject = streamTela;
    videoEl.muted = true;
    videoEl.play().catch(e => console.warn('Autoplay do vídeo local:', e));
    document.getElementById('video-container').classList.add('ativa');
    document.getElementById('btn-compartilhar-tela').classList.add('ativo');

    if (!chamadaAtual && !canalVozAtivo) {
      console.error('❌ Não há chamada ativa para transmitir.');
      alert('Você precisa estar em uma chamada para transmitir a tela.');
      streamTela.getTracks().forEach(t => t.stop());
      streamTela = null;
      document.getElementById('video-container').classList.remove('ativa');
      document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
      return;
    }

    const destinos = chamadaAtual
      ? [chamadaAtual.peer]
      : Object.keys(conexoesVoz);
    chamadasTela = destinos.map((peerId) => peer.call(peerId, streamTela, {
      metadata: { type: 'video', canal: Boolean(canalVozAtivo) },
    })).filter(Boolean);
    console.log('📤 Compartilhando tela com', chamadasTela.length, 'participante(s).');

    videoTrack.onended = () => {
      console.log('🛑 Usuário parou a transmissão.');
      streamTela = null;
      document.getElementById('video-container').classList.remove('ativa');
      document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
    };

  } catch (err) {
    console.error('❌ Erro detalhado na transmissão:', err.name, err.message);
    alert('Erro ao transmitir: ' + err.message);
    streamTela = null;
  }
}

function fecharTransmissao() {
  chamadasTela.forEach((call) => { try { call.close(); } catch (e) {} });
  chamadasTela = [];
  document.getElementById('video-container').classList.remove('ativa');
  document.getElementById('video-transmitido').srcObject = null;
  document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
  const btn = document.getElementById('btn-desbloquear-video');
  if (btn) btn.remove();
}

function minimizarChamada() {
  const overlay = document.getElementById('chamada-overlay');
  if (!overlay) return;
  overlay.classList.toggle('minimizada');
  const btn = overlay.querySelector('.btn-minimizar-chamada');
  if (btn) btn.textContent = overlay.classList.contains('minimizada') ? '▢' : '🗕';
}

function desligarChamada() {
  if (canalVozAtivo) {
    sairDoCanalDeVoz();
    return;
  }
  if (chamadaAtual) chamadaAtual.close();
  if (streamLocal) streamLocal.getTracks().forEach(t => t.stop());
  if (streamTela) streamTela.getTracks().forEach(t => t.stop());
  pararRelogioChamada();
  
  chamadaAtual = null; streamLocal = null; streamTela = null; localMuted = false;
  document.getElementById('chamada-overlay').classList.remove('ativa');
  document.getElementById('chamada-overlay').classList.remove('minimizada');
  document.getElementById('chamada-avatares').innerHTML = '';
  fecharTransmissao();
  
  const btnMute = document.getElementById('btn-mutar-chamada');
  if (btnMute) { btnMute.classList.remove('ativo'); btnMute.querySelector('.icone').textContent = '🎤'; }
}

function toggleDeafen() {
  deafened = !deafened;
  document.querySelectorAll('audio[id^="audio-"]').forEach((audio) => {
    audio.volume = deafened ? 0 : 1;
  });
  const btn = document.getElementById('btn-ensurdecer-chamada');
  if (btn) {
    btn.classList.toggle('ativo', deafened);
    btn.querySelector('.icone').textContent = deafened ? '🔇' : '🔈';
  }
}

// ============================================================
// 🔥 CANAIS DE VOZ (MÚLTIPLAS PESSOAS - MESH)
// ============================================================

let conexoesVoz = {}; 
let canalVozAtivo = null;
// socketId -> peerId. Mantém a associação para remover o áudio correto
// quando alguém sai da sala.
let participantesVoz = new Map();

async function entrarNoCanalDeVoz(canalId, nomeCanal) {
  if (canalVozAtivo) sairDoCanalDeVoz();

  try {
    streamLocal = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    return alert('Erro ao acessar microfone.');
  }

  canalVozAtivo = Number(canalId);
  document.getElementById('app').classList.add('canal-ativo');
  if (typeof atualizarVisibilidadeBarraUsuario === 'function') atualizarVisibilidadeBarraUsuario();
  
  document.getElementById('chamada-nome-exibicao').textContent = '#' + nomeCanal;
  document.getElementById('chamada-status').textContent = 'Conectado ao canal de voz';
  document.getElementById('chamada-duracao').textContent = 'Na sala de voz';
  document.getElementById('chamada-overlay').classList.remove('minimizada');
  document.getElementById('chamada-overlay').classList.add('ativa');
  document.getElementById('chamada-avatares').innerHTML = ''; 
  iniciarRelogioChamada();

  socket.emit('entrar-canal-voz', { canalId });
}

function sairDoCanalDeVoz() {
  if (canalVozAtivo && socket) {
    socket.emit('sair-canal-voz', { canalId: canalVozAtivo });
  }
  
  Object.values(conexoesVoz).forEach(call => {
    if (call) call.close();
  });
  conexoesVoz = {};
  participantesVoz.clear();
  canalVozAtivo = null;
  if (typeof atualizarVisibilidadeBarraUsuario === 'function') atualizarVisibilidadeBarraUsuario();

  if (streamLocal) {
    streamLocal.getTracks().forEach(t => t.stop());
    streamLocal = null;
  }

  document.getElementById('chamada-overlay').classList.remove('ativa');
  document.getElementById('chamada-overlay').classList.remove('minimizada');
  document.getElementById('chamada-avatares').innerHTML = '';
  pararRelogioChamada();
  deafened = false;
  const btnDeaf = document.getElementById('btn-ensurdecer-chamada');
  if (btnDeaf) { btnDeaf.classList.remove('ativo'); btnDeaf.querySelector('.icone').textContent = '🔈'; }
}

// Somente quem acabou de entrar inicia as conexões. Os usuários que já
// estavam na sala apenas respondem no handler `peer.on('call')`, como no
// fluxo de uma sala de voz do Discord.
function conectarComUsuarioVoz(u) {
  const peerIdDestino = 'void_user_' + u.usuarioId;
  if (conexoesVoz[peerIdDestino]) return;

  adicionarAvatarNaChamada(u.nome, u.avatar, u.socketId);

  participantesVoz.set(u.socketId, peerIdDestino);
  console.log('🔊 Conectando automaticamente a', peerIdDestino);
  
  // Prevenção de erro se o microfone não estiver pronto
  if (!streamLocal) {
    console.warn('Sem stream local para conectar.');
    return;
  }

  const call = peer.call(peerIdDestino, streamLocal, {
    metadata: { 
      type: 'audio', 
      id: window.usuarioAtual.id, 
      nome: window.usuarioAtual.nome, 
      avatar: window.usuarioAtual.avatar,
      socketId: socket?.id || '',
      canal: true // 🔥 Identificador para atender automaticamente
    }
  });

  if (call) {
    conexoesVoz[peerIdDestino] = call;
    
    call.on('stream', (remoteStream) => {
      anexarAudioRemoto(u.socketId, remoteStream);
    });

    call.on('close', () => {
      if (conexoesVoz[peerIdDestino] === call) delete conexoesVoz[peerIdDestino];
      removerAudioRemoto(peerIdDestino);
    });
  }
}

function adicionarAvatarNaChamada(nome, avatar, socketId) {
  const container = document.getElementById('chamada-avatares');
  if (!container) return;
  
  if (socketId && document.getElementById('voz-avatar-' + socketId)) return;

  const div = document.createElement('div'); 
  div.className = 'avatar-chamada';
  div.title = nome || 'Participante';
  if (socketId) div.id = 'voz-avatar-' + socketId;
  
  if (avatar) div.innerHTML = `<img src="${avatar}">`;
  else div.textContent = (nome || '?')[0].toUpperCase();
  
  container.appendChild(div);
}

window.addEventListener('beforeunload', () => {
  if (typeof sairDoCanalDeVoz === 'function') sairDoCanalDeVoz();
}); 
