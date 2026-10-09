const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'troque-esse-segredo-em-producao-123';
const EXPIRA_EM = '30d';

async function hashearSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function verificarSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nome: usuario.nome, email: usuario.email },
    SECRET,
    { expiresIn: EXPIRA_EM }
  );
}

function verificarToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = {
  hashearSenha,
  verificarSenha,
  gerarToken,
  verificarToken,
};