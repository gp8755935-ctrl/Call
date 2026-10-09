let socket = null;
let meuUsuario = null;
let salaAtual = null;
let pedidoPendente = null;
let meuSocketId = null;
let timeoutDigitando = null;
let naoLidas = 0;
let tituloOriginal = document.title;

// ========== TROCA DE ABAS ==========

function mudarAba(qual) {
  document.getElementById('aba-login').classList.toggle('ativa', qual === 'login');
  document.getElementById('aba-cadastro').classList.toggle('ativa', qual === 'cadastro');
  document.getElementById('form-login').style.display = qual === 'login' ? 'block' : 'none';
  document.getElementById('form-cadastro').style.display = qual === 'cadastro' ? 'block' : 'none';
  document.getElementById('login-erro').textContent = '';
  document.getElementById('cad-erro').textContent = '';
}

// ========== LOGIN / CADASTRO ==========

async function fazerLogin() {
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  erroEl.textContent = '';

  if (!email || !senha) {
    erroEl.textContent = 'Preencha email e senha';
    return;
  }

  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await r.json();
    if (!r.ok) {
      erroEl.textContent = data.erro || 'Erro ao entrar';
      return;
    }
    entrarNoApp(data.usuario);
  } catch (e) {
    erroEl.textContent = 'Erro de conexão';
  }
}

async function fazerCadastro() {
  const nome = document.getElementById('cad-nome').value.trim();
  const email = document.getElementById('cad-email').value.trim();
  const senha = document.getElementById('cad-senha').value;
  const erroEl = document.getElementById('cad-erro');
  erroEl.textContent = '';

  if (!nome || !email || !senha) {
    erroEl.textContent = 'Preencha todos os campos';
    return;
  }

  try {
    const r = await fetch('/api/cadastro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha }),
    });
    const data = await r.json();
    if (!r.ok) {
      erroEl.textContent = data.erro || 'Erro ao cadastrar';
      return;
    }
    entrarNoApp(data.usuario);
  } catch (e) {
    erroEl.textContent = 'Erro de conexão';
  }
}

async function fazerLogout() {
  if (!confirm('Sair da conta?')) return;
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

// ========== ENTRAR NO APP ==========

function entrarNoApp(usuario) {
  meuUsuario = usuario;
  document.getElementById('nome-usuario').textContent = usuario.nome;

  document.getElementById('tela-auth').classList.remove('ativa');
  document.getElementById('tela-app').classList.add('ativa');

  conectarSocket();
}

// ========== SOCKET ==========

function conectarSocket() {
  if (socket) return;

  socket = io();

  socket.on('connect', () => {
    meuSocketId = socket.id;
    console.log('Conectado como', meuUsuario.nome, '— socket', meuSocketId);
  });

  socket.on('connect_error', (err) => {
    console.error('Erro de conexão:', err.message);
    if (err.message === 'Não autenticado' || err.message === 'Token inválido') {
      alert('Sessão expirada. Faça login de novo.');
      location.reload();
    }
  });

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

  socket.on('pedido-recebido', ({ de }) => {
    pedidoPendente = de.socketId;
    document.getElementById('pedido-texto').textContent =
      `${de.nome} quer falar com você`;
    document.getElementById('pedido').style.display = 'block';
  });

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
        const cls = m.de === meuUsuario.nome ? 'eu' : 'ele';
        adicionarMsg(`${m.de}: ${m.texto}`, cls, m.hora);
      });
      adicionarMsg('--- conectado ---', 'sistema');
    } else {
      adicionarMsg('--- conectado ---', 'sistema');
    }

    document.getElementById('msg').focus();
  });

  socket.on('conexao-encerrada', () => {
    limparSala();
    adicionarMsg('--- a outra pessoa encerrou a conversa ---', 'sistema');
  });

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
}

// ========== AÇÕES DO CHAT ==========

function tentarConectar(u) {
  if (salaAtual) {
    alert('Você já está em uma conversa. Encerre antes.');
    return;
  }
  socket.emit('pedir-conexao', { paraSocketId: u.socketId });
}

function aceitar() {
  socket.emit('aceitar-conexao', { deSocketId: pedidoPendente });
  document.getElementById('pedido').style.display = 'none';
}

function recusar() {
  pedidoPendente = null;
  document.getElementById('pedido').style.display = 'none';
}

function encerrar() {
  if (!salaAtual) return;
  socket.emit('encerrar-conexao', { sala: salaAtual });
  limparSala();
  adicionarMsg('--- você encerrou a conversa ---', 'sistema');
}

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

// ========== MENSAGENS ==========

const msgInput = document.getElementById('msg');

msgInput.addEventListener('input', () => {
  if (!salaAtual) return;
  socket.emit('digitando', { sala: salaAtual, nome: meuUsuario.nome });
});

document.getElementById('enviar').onclick = enviar;
msgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') enviar();
});

function enviar() {
  if (!msgInput.value.trim() || !salaAtual) return;

  socket.emit('mensagem', { sala: salaAtual, texto: msgInput.value });
  adicionarMsg(`${meuUsuario.nome}: ${msgInput.value}`, 'eu');
  msgInput.value = '';
  msgInput.focus();
}

// ========== RENDER ==========

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

// ========== INICIALIZAÇÃO ==========

// Ao carregar, tenta pegar quem tá logado
window.addEventListener('load', async () => {
  try {
    const r = await fetch('/api/eu');
    if (r.ok) {
      const data = await r.json();
      entrarNoApp(data.usuario);
    }
  } catch (e) {
    // não logado, mostra tela de auth
  }

  // Enter nos campos
  document.getElementById('login-senha').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fazerLogin();
  });
  document.getElementById('cad-senha').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fazerCadastro();
  });
});