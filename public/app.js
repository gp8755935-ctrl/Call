const socket = io();

let meuNome = '';
let salaAtual = null;
let pedidoPendente = null;
let meuSocketId = null;
let naoLidas = 0;
let tituloOriginal = document.title;
let timeoutDigitando = null;

// ========== CONEXÃO ==========

socket.on('connect', () => {
  meuSocketId = socket.id;
  console.log('Meu socket id:', meuSocketId);
});

window.addEventListener('load', () => {
  const salvo = localStorage.getItem('meuNome');
  if (salvo) {
    document.getElementById('nome').value = salvo;
    entrar();
  }
});

// ========== LOGIN ==========

function entrar() {
  meuNome = document.getElementById('nome').value.trim();
  if (!meuNome) {
    alert('Digite um nome');
    return;
  }

  localStorage.setItem('meuNome', meuNome);
  socket.emit('login', meuNome);

  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('msg').focus();
}

function esquecer() {
  localStorage.removeItem('meuNome');
  document.getElementById('nome').value = '';
  document.getElementById('nome').focus();
}

function sair() {
  if (!confirm('Sair? O nome salvo será apagado.')) return;
  localStorage.removeItem('meuNome');
  socket.disconnect();
  location.reload();
}

// ========== LISTA DE ONLINE ==========

socket.on('lista-online', (users) => {
  const ul = document.getElementById('online');
  ul.innerHTML = '';
  users
    .filter((u) => u.socketId !== meuSocketId)
    .forEach((u) => {
      const li = document.createElement('li');
      li.textContent = u.nome;
      li.onclick = () => tentarConectar(u);
      ul.appendChild(li);
    });
});

function tentarConectar(u) {
  if (salaAtual) {
    alert('Você já está em uma conversa. Encerre antes.');
    return;
  }
  socket.emit('pedir-conexao', { paraSocketId: u.socketId });
}

// ========== PEDIDO RECEBIDO ==========

socket.on('pedido-recebido', ({ de }) => {
  pedidoPendente = de.socketId;
  document.getElementById('pedido-texto').textContent =
    `${de.nome} quer falar com você`;
  document.getElementById('pedido').style.display = 'block';
});

function aceitar() {
  socket.emit('aceitar-conexao', { deSocketId: pedidoPendente });
  document.getElementById('pedido').style.display = 'none';
}

function recusar() {
  pedidoPendente = null;
  document.getElementById('pedido').style.display = 'none';
}

// ========== CONEXÃO ==========

socket.on('conexao-aceita', ({ sala, historico }) => {
  salaAtual = sala;
  document.getElementById('msg').disabled = false;
  document.getElementById('enviar').disabled = false;
  document.getElementById('btnDesconectar').style.display = 'inline-block';
  document.getElementById('btnLimpar').style.display = 'inline-block';
  document.getElementById('btnLigar').style.display = 'inline-block';

  const chat = document.getElementById('chat');
  chat.innerHTML = '';

  if (historico && historico.length > 0) {
    adicionarMsg('--- histórico ---', 'sistema');
    historico.forEach((m) => {
      const cls = m.de === meuNome ? 'eu' : 'ele';
      adicionarMsg(`${m.de}: ${m.texto}`, cls, m.hora);
    });
    adicionarMsg('--- conectado ---', 'sistema');
  } else {
    adicionarMsg('--- conectado ---', 'sistema');
  }

  document.getElementById('msg').focus();
});

function encerrar() {
  if (!salaAtual) return;
  if (chamadaAtiva) desligar();
  socket.emit('encerrar-conexao', { sala: salaAtual });
  limparSala();
  adicionarMsg('--- você encerrou a conversa ---', 'sistema');
}

socket.on('conexao-encerrada', () => {
  if (chamadaAtiva) desligar(true);
  limparSala();
  adicionarMsg('--- a outra pessoa encerrou a conversa ---', 'sistema');
});

function limparSala() {
  salaAtual = null;
  document.getElementById('msg').disabled = true;
  document.getElementById('enviar').disabled = true;
  document.getElementById('btnDesconectar').style.display = 'none';
  document.getElementById('btnLimpar').style.display = 'none';
  document.getElementById('btnLigar').style.display = 'none';
  document.getElementById('digitando').textContent = '';
}

// ========== LIMPAR HISTÓRICO ==========

function limparHistorico() {
  if (!salaAtual) return;
  if (!confirm('Apagar todo o histórico desta conversa?')) return;
  socket.emit('limpar-historico', { sala: salaAtual });
}

socket.on('historico-limpo', () => {
  const chat = document.getElementById('chat');
  chat.innerHTML = '';
  adicionarMsg('--- histórico apagado ---', 'sistema');
});

// ========== MENSAGENS ==========

const msgInput = document.getElementById('msg');

msgInput.addEventListener('input', () => {
  if (!salaAtual) return;
  socket.emit('digitando', { sala: salaAtual, nome: meuNome });
});

document.getElementById('enviar').onclick = enviar;
msgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') enviar();
});

function enviar() {
  if (!msgInput.value.trim() || !salaAtual) return;

  socket.emit('mensagem', { sala: salaAtual, texto: msgInput.value });
  adicionarMsg(`${meuNome}: ${msgInput.value}`, 'eu');
  msgInput.value = '';
  msgInput.focus();
}

socket.on('mensagem', ({ de, texto, hora }) => {
  adicionarMsg(`${de}: ${texto}`, 'ele', hora);
  notificar(de, texto);
  document.getElementById('digitando').textContent = '';
});

socket.on('digitando', ({ nome }) => {
  const el = document.getElementById('digitando');
  el.textContent = `${nome} está digitando...`;
  clearTimeout(timeoutDigitando);
  timeoutDigitando = setTimeout(() => (el.textContent = ''), 2000);
});

// ========== RENDER DA MENSAGEM ==========

function adicionarMsg(txt, cls, horaMs) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;

  const hora = horaMs ? formatarHora(horaMs) : formatarHora(Date.now());

  const span = document.createElement('span');
  span.textContent = txt;
  div.appendChild(span);

  const h = document.createElement('span');
  h.className = 'hora';
  h.textContent = hora;
  div.appendChild(h);

  const chat = document.getElementById('chat');
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function formatarHora(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ========== NOTIFICAÇÃO ==========

const audioCtx = window.AudioContext ? new AudioContext() : null;

function notificar(de, texto) {
  if (audioCtx) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  }

  if (document.hidden) {
    naoLidas++;
    document.title = `(${naoLidas}) Nova mensagem - ${tituloOriginal}`;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    naoLidas = 0;
    document.title = tituloOriginal;
  }
});

// ============================================================
// WEBRTC — CHAMADA DE VOZ
// ============================================================

let peerConnection = null;
let localStream = null;
let chamadaAtiva = false;
let timerChamada = null;
let segundosChamada = 0;
let offerPendente = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:SEU-URL-AQUI.metered.live:443',
      username: 'SEU-USERNAME',
      credential: 'SUA-CREDENTIAL',
    },
    {
      urls: 'turn:SEU-URL-AQUI.metered.live:80',
      username: 'SEU-USERNAME',
      credential: 'SUA-CREDENTIAL',
    },
  ],
};

// ---------- INICIAR CHAMADA ----------

async function ligar() {
  if (!salaAtual) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    alert('Não foi possível acessar o microfone: ' + err.message);
    return;
  }

  criarPeerConnection();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit('webrtc-offer', { sala: salaAtual, offer });

  mostrarChamada('📞 Chamando...');
}

// ---------- RECEBER OFERTA ----------

socket.on('webrtc-offer', ({ offer }) => {
  if (!salaAtual || chamadaAtiva) return;

  offerPendente = offer;
  document.getElementById('chamada-recebida').style.display = 'block';
});

async function aceitarChamada() {
  document.getElementById('chamada-recebida').style.display = 'none';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    alert('Não foi possível acessar o microfone: ' + err.message);
    return;
  }

  criarPeerConnection();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offerPendente));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit('webrtc-answer', { sala: salaAtual, answer });

  iniciarTimer();
  mostrarChamada('🎙️ Em chamada');
}

function recusarChamada() {
  document.getElementById('chamada-recebida').style.display = 'none';
  socket.emit('webrtc-encerrar', { sala: salaAtual });
  offerPendente = null;
}

// ---------- RECEBER RESPOSTA ----------

socket.on('webrtc-answer', async ({ answer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  iniciarTimer();
  mostrarChamada('🎙️ Em chamada');
});

// ---------- ICE CANDIDATES ----------

socket.on('webrtc-ice', async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('Erro ao adicionar ICE:', err);
  }
});

// ---------- CRIAR PEER CONNECTION ----------

function criarPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice', { sala: salaAtual, candidate: event.candidate });
    }
  };

  peerConnection.ontrack = (event) => {
  const audioRemoto = document.getElementById('audio-remoto');
  audioRemoto.srcObject = event.streams[0];
  audioRemoto.muted = false;         // 👈 garante que não tá mudo
  audioRemoto.volume = 1.0;          // 👈 volume máximo
  audioRemoto.play().catch((e) => {
    console.warn('Autoplay bloqueado:', e);
    alert('Clique em qualquer lugar da página para liberar o áudio');
  });
};

  peerConnection.onconnectionstatechange = () => {
    if (
      peerConnection.connectionState === 'disconnected' ||
      peerConnection.connectionState === 'failed'
    ) {
      desligar(true);
    }
  };

  chamadaAtiva = true;
}

// ---------- DESLIGAR ----------

function desligar(remoto = false) {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (!remoto && salaAtual) {
    socket.emit('webrtc-encerrar', { sala: salaAtual });
  }

  chamadaAtiva = false;
  offerPendente = null;
  pararTimer();
  esconderChamada();
  document.getElementById('chamada-recebida').style.display = 'none';
}

socket.on('webrtc-encerrada', () => {
  if (!chamadaAtiva) return;
  desligar(true);
  adicionarMsg('--- chamada encerrada pelo outro lado ---', 'sistema');
});

// ---------- UI DA CHAMADA ----------

function mostrarChamada(texto) {
  document.getElementById('chamada-status').textContent = texto;
  document.getElementById('chamada').style.display = 'block';
  document.getElementById('btnLigar').style.display = 'none';
  document.getElementById('btnDesligar').style.display = 'inline-block';
}

function esconderChamada() {
  document.getElementById('chamada').style.display = 'none';
  document.getElementById('btnLigar').style.display = 'inline-block';
  document.getElementById('btnDesligar').style.display = 'none';
  document.getElementById('chamada-tempo').textContent = '00:00';
}

function iniciarTimer() {
  segundosChamada = 0;
  pararTimer();
  timerChamada = setInterval(() => {
    segundosChamada++;
    const min = String(Math.floor(segundosChamada / 60)).padStart(2, '0');
    const seg = String(segundosChamada % 60).padStart(2, '0');
    document.getElementById('chamada-tempo').textContent = `${min}:${seg}`;
  }, 1000);
}

function pararTimer() {
  if (timerChamada) {
    clearInterval(timerChamada);
    timerChamada = null;
  }
}