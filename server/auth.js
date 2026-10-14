const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'troque-esse-segredo-em-producao-123';
const EXPIRA_EM = '30d';

// 🔥 TRAVA: em produção, exige JWT_SECRET configurado
if (process.env.NODE_ENV === 'production') {
  if (SECRET === 'troque-esse-segredo-em-producao-123') {
    console.error('🚨 JWT_SECRET NÃO CONFIGURADO EM PRODUÇÃO! Configure no Render!');
    process.exit(1);
  }
  if (SECRET.length < 32) {
    console.error('🚨 JWT_SECRET muito curto! Use 32+ caracteres.');
    process.exit(1);
  }
}

// 🔥 Versão do token — mude pra invalidar TODOS os tokens existentes
const TOKEN_VERSION = 3;

async function hashearSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function verificarSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

function gerarToken(usuario) {
  if (!usuario || !usuario.id) {
    throw new Error('gerarToken chamado sem usuário válido');
  }
  return jwt.sign(
    { id: usuario.id, nome: usuario.nome, email: usuario.email, v: TOKEN_VERSION },
    SECRET,
    { expiresIn: EXPIRA_EM }
  );
}

function verificarToken(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (!payload || !payload.id) return null;
    if (payload.v !== TOKEN_VERSION) return null; // rejeita tokens antigos
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  hashearSenha,
  verificarSenha,
  gerarToken,
  verificarToken,
  TOKEN_VERSION,
};