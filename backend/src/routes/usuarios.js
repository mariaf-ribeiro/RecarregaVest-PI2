// Login, cadastro, perfil e validação de CRP (administrador) - MySQL
const express = require("express");
const { mysqlPool, mongo } = require("../db");
const { hashSenha, gerarToken, exigirLogin } = require("../auth");
const { textoValido, erroMySQL } = require("../util");

const router = express.Router();

// Busca o usuário com os campos da subclasse (vestibulando / psicologo / administrador)
async function buscarUsuario(id) {
  const [linhas] = await mysqlPool.query(
    `SELECT u.id_usuario, u.email, u.nome, u.foto_perfil, u.tipo_perfil,
            v.curso_pretendido, p.crp, p.status_validacao, a.credenciamento
       FROM usuario u
       LEFT JOIN vestibulando v ON v.fk_id_usuario = u.id_usuario
       LEFT JOIN psicologo p ON p.fk_id_usuario = u.id_usuario
       LEFT JOIN administrador a ON a.fk_id_usuario = u.id_usuario
      WHERE u.id_usuario = ?`,
    [id]
  );
  return linhas[0] || null;
}

// POST /api/auth/login
// Estudante (e administrador) entram com e-mail; psicólogo entra com CRP (tela do Figma).
router.post("/auth/login", async (req, res) => {
  try {
    const { perfil, email, crp, senha } = req.body;
    if (!senha) return res.status(400).json({ erro: "Informe a senha." });

    let linhas;
    if (perfil === "psicologo") {
      if (!crp) return res.status(400).json({ erro: "Informe o CRP." });
      [linhas] = await mysqlPool.query(
        `SELECT u.id_usuario, u.senha, u.tipo_perfil FROM usuario u
           JOIN psicologo p ON p.fk_id_usuario = u.id_usuario
          WHERE p.crp = ?`,
        [String(crp).trim()]
      );
    } else {
      if (!email) return res.status(400).json({ erro: "Informe o e-mail." });
      [linhas] = await mysqlPool.query(
        `SELECT id_usuario, senha, tipo_perfil FROM usuario
          WHERE email = ? AND tipo_perfil IN ('vestibulando','administrador')`,
        [String(email).trim().toLowerCase()]
      );
    }

    const usuario = linhas[0];
    if (!usuario || usuario.senha !== hashSenha(senha)) {
      return res.status(401).json({ erro: "Dados de login incorretos." });
    }

    const completo = await buscarUsuario(usuario.id_usuario);
    if (completo.tipo_perfil === "psicologo" && completo.status_validacao === "rejeitado") {
      return res.status(403).json({ erro: "Seu CRP foi rejeitado pela administração." });
    }
    res.json({ token: gerarToken(completo), usuario: completo });
  } catch (error) {
    erroMySQL(res, error);
  }
});

// POST /api/auth/cadastro  (Criar conta aluno / Criar conta psicólogo)
router.post("/auth/cadastro", async (req, res) => {
  const { perfil, nome, email, senha, foto_perfil, crp, curso_pretendido } = req.body;
  const tipo = perfil === "psicologo" ? "psicologo" : "vestibulando";

  if (!textoValido(nome, 150)) return res.status(400).json({ erro: "Informe o nome completo." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) {
    return res.status(400).json({ erro: "Informe um e-mail válido." });
  }
  if (!senha || String(senha).length < 6) {
    return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres." });
  }
  if (tipo === "psicologo" && !textoValido(crp, 20)) {
    return res.status(400).json({ erro: "Informe o número de registro profissional (CRP)." });
  }

  const conexao = await mysqlPool.getConnection();
  try {
    await conexao.beginTransaction();
    const [resultado] = await conexao.query(
      `INSERT INTO usuario (email, nome, senha, foto_perfil, tipo_perfil) VALUES (?, ?, ?, ?, ?)`,
      [email.trim().toLowerCase(), nome.trim(), hashSenha(senha), foto_perfil || null, tipo]
    );
    const id = resultado.insertId;
    if (tipo === "psicologo") {
      // Todo psicólogo começa "pendente" até o administrador validar o CRP (RN01 / UC14)
      await conexao.query(`INSERT INTO psicologo (fk_id_usuario, crp) VALUES (?, ?)`, [id, crp.trim()]);
    } else {
      await conexao.query(
        `INSERT INTO vestibulando (fk_id_usuario, curso_pretendido) VALUES (?, ?)`,
        [id, curso_pretendido || null]
      );
    }
    await conexao.commit();

    const usuario = await buscarUsuario(id);
    res.status(201).json({ token: gerarToken(usuario), usuario });
  } catch (error) {
    await conexao.rollback();
    erroMySQL(res, error, { duplicado: "Já existe uma conta com esse e-mail ou CRP." });
  } finally {
    conexao.release();
  }
});

// GET /api/me  -> dados do usuário logado (tela "Meu perfil")
router.get("/me", exigirLogin(), async (req, res) => {
  try {
    const usuario = await buscarUsuario(req.usuario.id);
    if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado." });
    res.json(usuario);
  } catch (error) {
    erroMySQL(res, error);
  }
});

// PUT /api/me  -> editar nome, avatar e curso pretendido (ícone de lápis no perfil)
router.put("/me", exigirLogin(), async (req, res) => {
  const { nome, foto_perfil, curso_pretendido } = req.body;
  if (nome !== undefined && !textoValido(nome, 150)) {
    return res.status(400).json({ erro: "Nome inválido." });
  }
  try {
    if (nome !== undefined || foto_perfil !== undefined) {
      await mysqlPool.query(
        `UPDATE usuario SET nome = COALESCE(?, nome), foto_perfil = COALESCE(?, foto_perfil)
          WHERE id_usuario = ?`,
        [nome ? nome.trim() : null, foto_perfil || null, req.usuario.id]
      );
    }
    if (curso_pretendido !== undefined && req.usuario.tipo === "vestibulando") {
      await mysqlPool.query(`UPDATE vestibulando SET curso_pretendido = ? WHERE fk_id_usuario = ?`, [
        curso_pretendido || null,
        req.usuario.id
      ]);
    }
    res.json(await buscarUsuario(req.usuario.id));
  } catch (error) {
    erroMySQL(res, error);
  }
});

// DELETE /api/me -> excluir a própria conta (MySQL em cascata + dados no MongoDB)
router.delete("/me", exigirLogin(), async (req, res) => {
  try {
    await mysqlPool.query(`DELETE FROM usuario WHERE id_usuario = ?`, [req.usuario.id]);
    await mongo().collection("postagens").deleteMany({ autorId: req.usuario.id });
    await mongo().collection("checklists").deleteMany({ vestibulandoId: req.usuario.id });
    res.json({ mensagem: "Conta excluída." });
  } catch (error) {
    erroMySQL(res, error);
  }
});

// ---------------- Administrador: validar CRP (UC14) ----------------
router.get("/admin/psicologos", exigirLogin("administrador"), async (req, res) => {
  try {
    const [linhas] = await mysqlPool.query(
      `SELECT u.id_usuario, u.nome, u.email, p.crp, p.status_validacao
         FROM psicologo p JOIN usuario u ON u.id_usuario = p.fk_id_usuario
        ORDER BY FIELD(p.status_validacao,'pendente','validado','rejeitado'), u.nome`
    );
    res.json(linhas);
  } catch (error) {
    erroMySQL(res, error);
  }
});

router.patch("/admin/psicologos/:id", exigirLogin("administrador"), async (req, res) => {
  const { status } = req.body;
  if (!["pendente", "validado", "rejeitado"].includes(status)) {
    return res.status(400).json({ erro: "Status inválido." });
  }
  try {
    const [r] = await mysqlPool.query(`UPDATE psicologo SET status_validacao = ? WHERE fk_id_usuario = ?`, [
      status,
      Number(req.params.id)
    ]);
    if (!r.affectedRows) return res.status(404).json({ erro: "Psicólogo não encontrado." });
    res.json({ mensagem: "Status atualizado." });
  } catch (error) {
    erroMySQL(res, error);
  }
});

module.exports = router;
