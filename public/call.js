// ============================================================
// SISTEMA DE CHAMADAS E CANAIS DE VOZ (PEERJS + SOCKET.IO)
// ============================================================

let peer = null;
let chamadaAtual = null;
let streamLocal = null;
let streamTela = null;
let chamadaRecebidaPendente = null;
let participantesNaChamada = {};
let canvasAudioCtx = null;
let localMuted = false;

// Inicializa o PeerJS com o ID do usuário logado
function inicializarPeerJS() {
  // Se o usuário não estiver definido ainda, avisa no console
  if (!window.usuarioAtual) {
    console.warn('⚠️ inicializarPeerJS: window.usuarioAtual não está definido.');
    return;
  }
  if (peer) {
    console.log('ℹ️ PeerJS já estava inicializado.');
    return;
  }
  
  const meuId = 'void_user_' + window.usuarioAtual.id; 
  console.log('🔄 Tentando inicializar PeerJS com ID:', meuId);

  peer = new Peer(meuId, {
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
  });

  peer.on('open', (id) => {
    console.log('✅ PeerJS Pronto. Seu ID de chamada é:', id);
  });

  peer.on('error', (err) => {
    console.error('❌ Erro no PeerJS:', err.type, err.message);
    // Se o erro for de "ID já em uso", pode ser que você recarregou a página rápido demais.
    if (err.type === 'unavailable-id') {
      alert('Erro: Seu ID de chamada já está em uso (talvez em outra aba). Feche a outra aba e recarregue.');
    }
  });

  // Escuta chamadas de voz e vídeo vindas de outros usuários
  peer.on('call', (call) => {
    console.log('📞 Chamada P2P recebida de:', call.peer);
    const metadata = call.metadata || {};
    
    // Recebendo transmissão de tela
    if (metadata.type === 'video') {
      console.log('🖥️ Recebendo transmissão de tela...');
      call.answer();
      const player = document.getElementById('player-video-transmissao');
      if (player) player.classList.add('ativa');
      
      call.on('stream', (remoteStream) => {
        const videoEl = document.getElementById('video-transmitido');
        if (videoEl) videoEl.srcObject = remoteStream;
      });
      return;
    }

    // Recebendo chamada de voz
    if (metadata.type === 'audio') {
      console.log('🎙️ Recebendo chamada de voz de:', metadata.nome);
      chamadaRecebidaPendente = call;
      
      // Atualiza a interface
      const nomeEl = document.getElementById('chamada-recebida-nome');
      const avatarEl = document.getElementById('chamada-recebida-avatar');
      const modalEl = document.getElementById('modal-chamada-recebida');
      
      if (nomeEl) nomeEl.textContent = metadata.nome || 'Amigo';
      if (avatarEl) avatarEl.innerHTML = metadata.avatar ? `<img src="${metadata.avatar}">` : (metadata.nome || '?')[0];
      if (modalEl) modalEl.classList.add('ativo');
      
      tocarSomChamada();
    }
  });
}

// Som sintetizado Frutiger Aero (não precisa de arquivo .mp3)
function tocarSomChamada() {
  try {
    if (!canvasAudioCtx) canvasAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Retoma o contexto de áudio se o navegador tiver suspendido
    if (canvasAudioCtx.state === 'suspended') canvasAudioCtx.resume();

    const osc = canvasAudioCtx.createOscillator();
    const gain = canvasAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(canvasAudioCtx.destination);
    osc.type = 'sine';
    
    // Bipe duplo (Dó agudo e Mi agudo)
    osc.frequency.setValueAtTime(800, canvasAudioCtx.currentTime);
    osc.frequency.setValueAtTime(1200, canvasAudioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.5, canvasAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, canvasAudioCtx.currentTime + 0.4);
    
    osc.start();
    osc.stop(canvasAudioCtx.currentTime + 0.4);
  } catch (e) { console.log('Erro ao tocar som da chamada', e); }
}

// ============================================================
// LIGAR E ATENDER
// ============================================================

async function ligarParaAmigo(amigoId, nomeAmigo, avatarAmigo) {
  if (chamadaAtual) return alert('Você já está em uma chamada.');
  
  try {
    streamLocal = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    return alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
  }

  document.getElementById('janela-chamada').classList.add('ativa');
  document.getElementById('chamada-nome-exibicao').textContent = 'Chamando ' + nomeAmigo + '...';
  document.getElementById('chamada-status').textContent = 'Conectando...';
  document.getElementById('chamada-participantes').innerHTML = '';

  const peerIdDestino = 'void_user_' + amigoId;
  const call = peer.call(peerIdDestino, streamLocal, {
    metadata: { 
      type: 'audio', 
      id: window.usuarioAtual.id, 
      nome: window.usuarioAtual.nome, 
      avatar: window.usuarioAtual.avatar 
    }
  });

  if (call) {
    chamadaAtual = call;
    configurarChamadaAtiva(call, amigoId, nomeAmigo, avatarAmigo);
  }
}

async function atenderChamada() {
  if (!chamadaRecebidaPendente) return;
  document.getElementById('modal-chamada-recebida').classList.remove('ativo');
  
  try {
    streamLocal = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    return alert('Não foi possível acessar o microfone.');
  }

  chamadaRecebidaPendente.answer(streamLocal);
  chamadaAtual = chamadaRecebidaPendente;
  
  const metadata = chamadaRecebidaPendente.metadata || {};
  document.getElementById('janela-chamada').classList.add('ativa');
  configurarChamadaAtiva(chamadaAtual, metadata.id, metadata.nome, metadata.avatar);
  chamadaRecebidaPendente = null;
}

function recusarChamada() {
  if (chamadaRecebidaPendente) {
    chamadaRecebidaPendente.close();
    chamadaRecebidaPendente = null;
  }
  document.getElementById('modal-chamada-recebida').classList.remove('ativo');
}

// ============================================================
// CONTROLES DA CHAMADA ATIVA
// ============================================================

function configurarChamadaAtiva(call, amigoId, nome, avatar) {
  document.getElementById('chamada-nome-exibicao').textContent = 'Chamada com ' + (nome || 'Amigo');
  document.getElementById('chamada-status').textContent = 'Conectado';
  document.getElementById('chamada-participantes').innerHTML = '';

  adicionarParticipanteUI(amigoId, nome, avatar);

  call.on('stream', (remoteStream) => {
    const audioEl = document.createElement('audio');
    audioEl.srcObject = remoteStream;
    audioEl.autoplay = true;
    audioEl.volume = 1.0;
    
    participantesNaChamada[amigoId] = { nome, volume: 1.0, audioEl };
  });

  call.on('close', () => {
    desligarChamada();
  });
}

function adicionarParticipanteUI(id, nome, avatar) {
  const div = document.createElement('div');
  div.className = 'participante-item';
  div.id = 'part_' + id;
  
  div.innerHTML = `
    <div class="participante-info">
      <div class="avatar mini" style="width:24px;height:24px;font-size:10px;">${avatar ? `<img src="${avatar}">` : (nome || '?')[0]}</div>
      <span>${nome || 'Amigo'}</span>
    </div>
    <input type="range" class="participante-volume" min="0" max="1" step="0.1" value="1" 
           oninput="ajustarVolume('${id}', this.value)" title="Volume do amigo">
  `;
  
  document.getElementById('chamada-participantes').appendChild(div);
}

function ajustarVolume(id, volume) {
  if (participantesNaChamada[id]) {
    participantesNaChamada[id].audioEl.volume = volume;
  }
}

function toggleMute() {
  if (!streamLocal) return;
  localMuted = !localMuted;
  streamLocal.getAudioTracks()[0].enabled = !localMuted;
  
  const btn = document.getElementById('btn-mutar-chamada');
  btn.style.background = localMuted ? 'linear-gradient(180deg, #94a3b8, #475569)' : 'linear-gradient(180deg, #fbbf24, #d97706)';
  btn.textContent = localMuted ? '🔇' : '🎤';
}

async function toggleTransmissao() {
  if (streamTela) {
    streamTela.getTracks().forEach(t => t.stop());
    streamTela = null;
    document.getElementById('btn-compartilhar-tela').style.background = 'linear-gradient(180deg, #38bdf8, #0284c7)';
    return;
  }

  try {
    streamTela = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: true 
    });

    const amigoIds = Object.keys(participantesNaChamada);
    if (amigoIds.length === 0) return;

    const idDestino = 'void_user_' + amigoIds[0];
    peer.call(idDestino, streamTela, { metadata: { type: 'video' } });
    
    document.getElementById('btn-compartilhar-tela').style.background = 'linear-gradient(180deg, #fb7185, #dc2626)';

    streamTela.getVideoTracks()[0].onended = () => {
      streamTela = null;
      document.getElementById('btn-compartilhar-tela').style.background = 'linear-gradient(180deg, #38bdf8, #0284c7)';
    };

  } catch (err) {
    console.log('Transmissão cancelada', err);
  }
}

function fecharTransmissao() {
  document.getElementById('player-video-transmissao').classList.remove('ativa');
  document.getElementById('video-transmitido').srcObject = null;
}

function desligarChamada() {
  if (chamadaAtual) chamadaAtual.close();
  if (streamLocal) streamLocal.getTracks().forEach(t => t.stop());
  if (streamTela) streamTela.getTracks().forEach(t => t.stop());
  
  chamadaAtual = null;
  streamLocal = null;
  streamTela = null;
  participantesNaChamada = {};
  
  document.getElementById('janela-chamada').classList.remove('ativa');
  document.getElementById('player-video-transmissao').classList.remove('ativa');
  document.getElementById('btn-mutar-chamada').textContent = '🎤';
  localMuted = false;
}

function minimizarChamada() {
  document.getElementById('janela-chamada').classList.remove('ativa');
}