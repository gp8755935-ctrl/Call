const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// 🔥 C3 - SEGURANÇA CRÍTICA
// Removemos o valor padrão. Se não houver JWT_SECRET, o servidor morre.
const SECRET = process.env.JWT_SECRET;
const EXPIRA_EM = '30d';

if (!SECRET || SECRET.length < 32) {
  console.error('🚨 ERRO FATAL: JWT_SECRET não configurado ou muito curto!');
  console.error('Configure uma string aleatória de 32+ caracteres no Render.');
  process.exit(1);
}

// 🔥 Aumentado para 4 para invalidar TODOS os tokens antigos e forçar novo login geral
const TOKEN_VERSION = 4;

async function hashearSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function verificarSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

function gerarToken(usuario) {
  if (!usuario || !usuario.id) throw new Error('gerarToken sem usuário');
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
    if (payload.v !== TOKEN_VERSION) return null; // Rejeita tokens antigos
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = { hashearSenha, verificarSenha, gerarToken, verificarToken, TOKEN_VERSION };