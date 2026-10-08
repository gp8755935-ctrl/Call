const socket = io();

let meuNome = '';
let salaAtual = null;
let pedidoPendente = null;
let meuSocketId = null;
let naoLidas = 0;
let tituloOriginal = document.title;
let timeoutDigitando = null;

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

socket.on('conexao-aceita', ({ sala, historico }) => {
  salaAtual = sala;
  document.getElementById('msg').disabled = false;
  document.getElementById('enviar').disabled = false;
  document.getElementById('btnDesconectar').style.display = 'inline-block';
  document.getElementById('btnLimpar').style.display = 'inline-block';

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
  socket.emit('encerrar-conexao', { sala: salaAtual });
  limparSala();
  adicionarMsg('--- você encerrou a conversa ---', 'sistema');
}

socket.on('conexao-encerrada', () => {
  limparSala();
  adicionarMsg('--- a outra pessoa encerrou a conversa ---', 'sistema');
});

function limparSala() {
  salaAtual = null;
  document.getElementById('msg').disabled = true;
  document.getElementById('enviar').disabled = true;
  document.getElementById('btnDesconectar').style.display = 'none';
  document.getElementById('btnLimpar').style.display = 'none';
  document.getElementById('digitando').textContent = '';
}

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