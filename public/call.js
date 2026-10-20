// ============================================================
// SISTEMA DE CHAMADAS (VOZ, VÍDEO, PIP)
// ============================================================

let peer = null;
let chamadaAtual = null;
let streamLocal = null;
let streamTela = null;
let chamadaRecebidaPendente = null;
let participantesNaChamada = {};
let canvasAudioCtx = null;
let localMuted = false;

// Variáveis do PiP
let pipWindow = null;
let audioAnalysers = {};
let animationFrameId = null;

function inicializarPeerJS() {
  if (!window.usuarioAtual) return;
  if (peer) return;
  
  const meuId = 'void_user_' + window.usuarioAtual.id; 
  peer = new Peer(meuId, { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } });

  peer.on('open', (id) => console.log('✅ PeerJS Pronto:', id));
  peer.on('error', (err) => console.error('❌ Erro PeerJS:', err));

  peer.on('call', (call) => {
    const metadata = call.metadata || {};
    
    // Recebendo Transmissão de Tela
    if (metadata.type === 'video') {
      call.answer();
      const videoContainer = document.getElementById('video-container');
      const videoEl = document.getElementById('video-transmitido');
      if (videoContainer) videoContainer.classList.add('ativa');
      
      call.on('stream', (remoteStream) => {
        if (videoEl) {
          videoEl.srcObject = remoteStream;
          videoEl.muted = false;
          videoEl.play().catch(() => {
            // Cria o botão de desbloqueio caso o celular bloqueie o autoplay
            if (videoContainer && !document.getElementById('btn-desbloquear-video')) {
              const btn = document.createElement('button');
              btn.id = 'btn-desbloquear-video';
              btn.textContent = '▶ Clique para ver a transmissão';
              btn.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:9999; padding:12px 24px; font-size:16px; font-weight:bold; background:#0284c7; color:white; border:none; border-radius:8px; cursor:pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.5);";
              btn.onclick = () => { videoEl.play(); btn.remove(); };
              videoContainer.appendChild(btn);
            }
          });
        }
      });
      return;
    }

    // Recebendo Chamada de Voz
    if (metadata.type === 'audio') {
      chamadaRecebidaPendente = call;
      document.getElementById('chamada-recebida-nome').textContent = metadata.nome || 'Amigo';
      const avatarEl = document.getElementById('chamada-recebida-avatar');
      if (avatarEl) avatarEl.innerHTML = metadata.avatar ? `<img src="${metadata.avatar}">` : (metadata.nome || '?')[0];
      document.getElementById('modal-chamada-recebida').classList.add('ativo');
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
  document.getElementById('chamada-nome-exibicao').textContent = 'Chamando ' + nomeAmigo + '...';
  document.getElementById('chamada-status').textContent = 'Conectando...';
  document.getElementById('chamada-avatares').innerHTML = '';
  
  adicionarAvatarUI(amigoId, nomeAmigo, avatarAmigo, false);

  const peerIdDestino = 'void_user_' + amigoId;
  const call = peer.call(peerIdDestino, streamLocal, {
    metadata: { type: 'audio', id: window.usuarioAtual.id, nome: window.usuarioAtual.nome, avatar: window.usuarioAtual.avatar }
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
  } catch (err) { return alert('Erro ao acessar microfone.'); }

  chamadaRecebidaPendente.answer(streamLocal);
  chamadaAtual = chamadaRecebidaPendente;
  
  const metadata = chamadaRecebidaPendente.metadata || {};
  document.getElementById('chamada-overlay').classList.add('ativa');
  document.getElementById('chamada-nome-exibicao').textContent = metadata.nome || 'Amigo';
  document.getElementById('chamada-status').textContent = 'Conectado';
  document.getElementById('chamada-avatares').innerHTML = '';
  
  adicionarAvatarUI(metadata.id, metadata.nome, metadata.avatar, false);
  configurarChamadaAtiva(chamadaAtual, metadata.id, metadata.nome, metadata.avatar);
  chamadaRecebidaPendente = null;
}

function recusarChamada() {
  if (chamadaRecebidaPendente) chamadaRecebidaPendente.close();
  chamadaRecebidaPendente = null;
  document.getElementById('modal-chamada-recebida').classList.remove('ativo');
}

// ============================================================
// CONTROLES DA CHAMADA
// ============================================================

function configurarChamadaAtiva(call, amigoId, nome, avatar) {
  call.on('stream', (remoteStream) => {
    const audioEl = document.createElement('audio');
    audioEl.srcObject = remoteStream;
    audioEl.autoplay = true;
    audioEl.volume = 1.0;
    document.body.appendChild(audioEl);
    audioEl.play().catch(()=>{});

    participantesNaChamada[amigoId] = { nome, volume: 1.0, audioEl, avatar };
    iniciarAnaliseDeVoz(remoteStream);
  });
  call.on('close', () => desligarChamada());
}

function adicionarAvatarUI(id, nome, avatar, mutado) {
  const div = document.createElement('div');
  div.className = 'avatar-chamada' + (mutado ? ' mutado' : '');
  div.id = 'avatar_' + id;
  if (avatar) {
    div.innerHTML = `<img src="${avatar}" alt="${nome}">`;
  } else {
    div.textContent = (nome || '?')[0].toUpperCase();
  }
  const muteIcon = document.createElement('div');
  muteIcon.className = 'status-mute';
  muteIcon.innerHTML = '🔇';
  div.appendChild(muteIcon);
  document.getElementById('chamada-avatares').appendChild(div);
}

function toggleMute() {
  if (!streamLocal) return;
  localMuted = !localMuted;
  streamLocal.getAudioTracks()[0].enabled = !localMuted;
  const btn = document.getElementById('btn-mutar-chamada');
  if (btn) {
    btn.classList.toggle('ativo', localMuted);
    btn.querySelector('.icone').textContent = localMuted ? '🔇' : '🎤';
  }
  atualizarBotaoMutePip();
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
    streamTela = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const videoContainer = document.getElementById('video-container');
    const videoEl = document.getElementById('video-transmitido');
    videoEl.srcObject = streamTela;
    videoEl.muted = true;
    videoEl.play().catch(()=>{});
    videoContainer.classList.add('ativa');
    document.getElementById('btn-compartilhar-tela').classList.add('ativo');

    const amigoIds = Object.keys(participantesNaChamada);
    if (amigoIds.length > 0) {
      peer.call('void_user_' + amigoIds[0], streamTela, { metadata: { type: 'video' } });
    }
    streamTela.getVideoTracks()[0].onended = () => {
      streamTela = null;
      videoContainer.classList.remove('ativa');
      document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
    };
  } catch (err) { console.log('Transmissão cancelada'); }
}

function fecharTransmissao() {
  document.getElementById('video-container').classList.remove('ativa');
  document.getElementById('video-transmitido').srcObject = null;
  document.getElementById('btn-compartilhar-tela').classList.remove('ativo');
  const btn = document.getElementById('btn-desbloquear-video');
  if (btn) btn.remove();
}

function desligarChamada() {
  if (chamadaAtual) chamadaAtual.close();
  if (streamLocal) streamLocal.getTracks().forEach(t => t.stop());
  if (streamTela) streamTela.getTracks().forEach(t => t.stop());
  Object.values(participantesNaChamada).forEach(p => { if (p.audioEl) p.audioEl.remove(); });
  
  chamadaAtual = null; streamLocal = null; streamTela = null; participantesNaChamada = {}; localMuted = false;
  document.getElementById('chamada-overlay').classList.remove('ativa');
  document.getElementById('chamada-avatares').innerHTML = '';
  fecharTransmissao();
  fecharPipChamada();
  
  const btnMute = document.getElementById('btn-mutar-chamada');
  if (btnMute) { btnMute.classList.remove('ativo'); btnMute.querySelector('.icone').textContent = '🎤'; }
}

// ============================================================
// 🔥 BALÃO FLUTUANTE (PICTURE-IN-PICTURE)
// ============================================================

async function ativarPipChamada() {
  if (!('documentPictureInPicture' in window)) return;
  if (pipWindow) return;

  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 260, height: 80 });

    const style = document.createElement('style');
    style.textContent = `
      body { margin: 0; font-family: 'Nunito', system-ui, sans-serif; overflow: hidden; background: transparent; user-select: none; -webkit-user-select: none; }
      .pip-container { display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, rgba(56,189,248,0.95), rgba(2,132,199,0.95)); border-radius: 40px; padding: 8px 16px; height: 100vh; box-sizing: border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 2px solid rgba(255,255,255,0.9); color: white; cursor: grab; }
      .pip-container:active { cursor: grabbing; }
      .pip-info { display: flex; align-items: center; gap: 10px; font-weight: 900; font-size: 14px; text-shadow: 0 1px 2px rgba(0,0,0,0.3); pointer-events: none; }
      .pip-avatar { width: 44px; height: 44px; border-radius: 50%; border: 2px solid white; background: #bae6fd; overflow: hidden; display: flex; align-items: center; justify-content: center; font-size: 20px; color: #0284c7; }
      .pip-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .pip-pulso { width: 12px; height: 12px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 10px #4ade80; transition: transform 0.1s, background 0.1s; }
      .pip-acoes { display: flex; gap: 8px; }
      .pip-btn { width: 38px; height: 38px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.9); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; color: white; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: transform 0.15s; }
      .pip-btn:hover { transform: scale(1.1); }
      .pip-btn.mute { background: rgba(0,0,0,0.3); }
      .pip-btn.mute.ativo { background: #fbbf24; color: #000; }
      .pip-btn.desligar { background: #dc2626; }
    `;

    const html = `
      <div class="pip-container" id="pip-container">
        <div class="pip-info">
          <div class="pip-avatar" id="pip-avatar"></div>
          <div>
            <div id="pip-nome" style="max-width: 80px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Chamada</div>
            <div style="display:flex; align-items:center; gap:4px; font-size:11px; opacity:0.9;">
              <span class="pip-pulso" id="pip-pulso"></span> Ativo
            </div>
          </div>
        </div>
        <div class="pip-acoes">
          <button class="pip-btn mute" id="pip-btn-mute" title="Mutar">🎤</button>
          <button class="pip-btn desligar" id="pip-btn-desligar" title="Desligar">📵</button>
        </div>
      </div>
    `;

    pipWindow.document.head.appendChild(style);
    pipWindow.document.body.innerHTML = html;

    const btnMute = pipWindow.document.getElementById('pip-btn-mute');
    const btnDesligar = pipWindow.document.getElementById('pip-btn-desligar');
    const container = pipWindow.document.getElementById('pip-container');

    container.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      voltarParaCall();
    });
    btnMute.addEventListener('click', () => { if (window.toggleMute) window.toggleMute(); });
    btnDesligar.addEventListener('click', () => { if (window.desligarChamada) window.desligarChamada(); });

    atualizarInfoPip();
    pipWindow.addEventListener('pagehide', () => { pipWindow = null; });
  } catch (err) { console.error('Erro PiP:', err); }
}

function atualizarInfoPip() {
  if (!pipWindow || !chamadaAtual) return;
  const nomeEl = pipWindow.document.getElementById('pip-nome');
  const avatarEl = pipWindow.document.getElementById('pip-avatar');
  const amigoId = Object.keys(participantesNaChamada)[0];
  const infoAmigo = participantesNaChamada[amigoId] || {};
  const nomeAmigo = infoAmigo.nome || 'Conectado';
  if (nomeEl) nomeEl.textContent = nomeAmigo;
  if (avatarEl) {
    if (infoAmigo.avatar) avatarEl.innerHTML = `<img src="${infoAmigo.avatar}">`;
    else avatarEl.textContent = nomeAmigo.charAt(0).toUpperCase();
  }
  atualizarBotaoMutePip();
}

function fecharPipChamada() {
  if (pipWindow) { pipWindow.close(); pipWindow = null; }
}

function voltarParaCall() {
  if (pipWindow) pipWindow.close();
  window.focus();
  document.getElementById('chamada-overlay').classList.add('ativa'); 
}

function atualizarBotaoMutePip() {
  if (!pipWindow) return;
  const btn = pipWindow.document.getElementById('pip-btn-mute');
  if (btn) {
    if (localMuted) { btn.classList.add('ativo'); btn.textContent = '🔇'; }
    else { btn.classList.remove('ativo'); btn.textContent = '🎤'; }
  }
}

function iniciarAnaliseDeVoz(stream) {
  if (!window.AudioContext) return;
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  const checkVolume = () => {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length;

    if (pipWindow) {
      const pulso = pipWindow.document.getElementById('pip-pulso');
      if (pulso) {
        if (avg > 10) { pulso.style.transform = 'scale(1.6)'; pulso.style.background = '#a3e635'; pulso.style.boxShadow = '0 0 15px #a3e635'; }
        else { pulso.style.transform = 'scale(1)'; pulso.style.background = '#4ade80'; pulso.style.boxShadow = '0 0 10px #4ade80'; }
      }
    }
    animationFrameId = requestAnimationFrame(checkVolume);
  };
  checkVolume();
}