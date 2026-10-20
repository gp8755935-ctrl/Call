let peer = null;
let chamadaAtual = null;
let streamLocal = null;
let streamTela = null;
let chamadaRecebidaPendente = null;
let canvasAudioCtx = null;
let localMuted = false;

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

    // Recebendo Chamada de Voz
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
// LIGAR E ATENDER
// ============================================================

async function ligarParaAmigo(amigoId, nomeAmigo, avatarAmigo) {
  if (chamadaAtual) return alert('Você já está em uma chamada.');
  try {
    streamLocal = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) { return alert('Erro ao acessar microfone.'); }

  document.getElementById('chamada-overlay').classList.add('ativa');
  document.getElementById('chamada-nome-exibicao').textContent = nomeAmigo;
  document.getElementById('chamada-status').textContent = 'Chamando...';
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

function configurarChamadaAtiva(call, nome, avatar) {
  call.on('stream', (remoteStream) => {
    document.getElementById('chamada-status').textContent = 'Conectado';
    const audioEl = document.createElement('audio');
    audioEl.srcObject = remoteStream;
    audioEl.autoplay = true;
    audioEl.volume = 1.0;
    document.body.appendChild(audioEl);
    audioEl.play().catch(()=>{});
  });
  call.on('close', () => desligarChamada());
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
    
    // Requisição simplificada (sem áudio e sem restrições complexas)
    streamTela = await navigator.mediaDevices.getDisplayMedia({
      video: true
    });
    
    console.log('✅ Tela capturada. Tracks:', streamTela.getTracks().length);

    const videoTrack = streamTela.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('Nenhuma track de vídeo encontrada.');
    }

    // Mostra o vídeo local
    const videoEl = document.getElementById('video-transmitido');
    videoEl.srcObject = streamTela;
    videoEl.muted = true;
    videoEl.play().catch(e => console.warn('Autoplay do vídeo local:', e));
    document.getElementById('video-container').classList.add('ativa');
    document.getElementById('btn-compartilhar-tela').classList.add('ativo');

    if (!chamadaAtual) {
      console.error('❌ Não há chamada ativa para transmitir.');
      alert('Você precisa estar em uma chamada para transmitir a tela.');
      streamTela.getTracks().forEach(t => t.stop());
      streamTela = null;
      document.getElementById('video-container').classList.remove('ativa');
      document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
      return;
    }

    const idDestino = chamadaAtual.peer;
    console.log('📤 Enviando transmissão para:', idDestino);
    
    const videoCall = peer.call(idDestino, streamTela, { 
      metadata: { type: 'video' } 
    });
    
    if (videoCall) {
      console.log('✅ Chamada de vídeo criada com sucesso.');
    } else {
      console.error('❌ peer.call retornou null para a transmissão.');
    }

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
  document.getElementById('video-container').classList.remove('ativa');
  document.getElementById('video-transmitido').srcObject = null;
  document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
  const btn = document.getElementById('btn-desbloquear-video');
  if (btn) btn.remove();
}

function minimizarChamada() {
  document.getElementById('chamada-overlay').classList.remove('ativa');
  // Poderia mostrar um ícone flutuante aqui
}

function desligarChamada() {
  if (chamadaAtual) chamadaAtual.close();
  if (streamLocal) streamLocal.getTracks().forEach(t => t.stop());
  if (streamTela) streamTela.getTracks().forEach(t => t.stop());
  
  chamadaAtual = null; streamLocal = null; streamTela = null; localMuted = false;
  document.getElementById('chamada-overlay').classList.remove('ativa');
  document.getElementById('chamada-avatares').innerHTML = '';
  fecharTransmissao();
  
  const btnMute = document.getElementById('btn-mutar-chamada');
  if (btnMute) { btnMute.classList.remove('ativo'); btnMute.querySelector('.icone').textContent = '🎤'; }
}