// Comunidades (postagens no MongoDB) e Sessões com psicólogos (MySQL)
const express = require("express");
const { mysqlPool, mongo } = require("../db");
const { exigirLogin, lerToken } = require("../auth");
const { textoValido, erroMySQL, COMUNIDADES } = require("../util");

const router = express.Router();
const postagens = () => mongo().collection("postagens");

// Lista de comunidades (para o menu lateral)
router.get("/comunidades", (req, res) => {
  res.json(Object.entries(COMUNIDADES).map(([tipo, nome]) => ({ tipo, nome })));
});

// GET /api/comunidades/:comunidadeId/postagens  (também usada pelo teste k6 consulta-postagens.js)
router.get("/comunidades/:comunidadeId/postagens", async (req, res) => {
  const { comunidadeId } = req.params;
  if (!COMUNIDADES[comunidadeId]) return res.status(404).json({ erro: "Comunidade não encontrada." });
  try {
    const lista = await postagens()
      .find({ comunidadeId })
      .sort({ dataCriacao: -1 })
      .limit(100)
      .toArray();

    // Busca o nome dos autores no MySQL (referência lógica autorId -> usuario.id_usuario)
    const ids = [...new Set(lista.map((p) => p.autorId))];
    const autores = {};
    if (ids.length) {
      const [linhas] = await mysqlPool.query(
        `SELECT id_usuario, nome, tipo_perfil, foto_perfil FROM usuario WHERE id_usuario IN (?)`,
        [ids]
      );
      linhas.forEach((u) => (autores[u.id_usuario] = u));
    }

    res.json({
      total: lista.length,
      postagens: lista.map((p) => ({
        ...p,
        autor: autores[p.autorId] || { nome: "Usuário removido", tipo_perfil: "" }
      }))
    });
  } catch (error) {
    console.error("Erro ao consultar postagens:", error);
    res.status(500).json({ erro: "Erro ao consultar postagens." });
  }
});

// POST /api/comunidades/:comunidadeId/postagens  { texto, urlExterna }
router.post("/comunidades/:comunidadeId/postagens", exigirLogin(), async (req, res) => {
  const { comunidadeId } = req.params;
  const { texto, urlExterna } = req.body;
  if (!COMUNIDADES[comunidadeId]) return res.status(404).json({ erro: "Comunidade não encontrada." });
  if (comunidadeId === "psicologos" && req.usuario.tipo === "vestibulando") {
    return res.status(403).json({ erro: "Essa comunidade é exclusiva dos psicólogos voluntários." });
  }
  if (!textoValido(texto, 1000)) {
    return res.status(400).json({ erro: "Escreva algo antes de postar (até 1000 caracteres)." });
  }
  let url = null;
  if (urlExterna && String(urlExterna).trim()) {
    url = String(urlExterna).trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    if (url.length > 255) return res.status(400).json({ erro: "Link muito longo." });
  }
  try {
    const doc = {
      autorId: req.usuario.id,
      comunidadeId,
      texto: texto.trim(),
      tipo: url ? "link" : "texto",
      urlExterna: url,
      dataCriacao: new Date()
    };
    const r = await postagens().insertOne(doc);
    // Registra a participação do usuário na comunidade (MySQL), se ainda não existir
    await mysqlPool.query(
      `INSERT IGNORE INTO participa_comunidade (fk_id_usuario, fk_id_comunidade)
       SELECT ?, id_comunidade FROM comunidade WHERE tipo = ?`,
      [req.usuario.id, comunidadeId]
    );
    res.status(201).json({ _id: r.insertedId, ...doc });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao publicar." });
  }
});

// Apagar a própria postagem
router.delete("/postagens/:id", exigirLogin(), async (req, res) => {
  try {
    const { ObjectId } = require("mongodb");
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ erro: "Id inválido." });
    const r = await postagens().deleteOne({ _id: new ObjectId(req.params.id), autorId: req.usuario.id });
    if (!r.deletedCount) return res.status(404).json({ erro: "Postagem não encontrada." });
    res.json({ mensagem: "Postagem apagada." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao apagar." });
  }
});

// ---------------- Sessões com psicólogos ----------------
// GET /api/sessoes -> próximas sessões primeiro, depois as que já aconteceram
router.get("/sessoes", async (req, res) => {
  const usuario = lerToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  try {
    const [linhas] = await mysqlPool.query(
      `SELECT s.id_sessao, s.titulo, DATE_FORMAT(s.data_hora, '%Y-%m-%dT%H:%i') AS data_hora,
              s.link_acesso, s.limite_vagas, s.fk_id_psicologo, u.nome AS psicologo,
              COUNT(ps.fk_id_vestibulando) AS inscritos,
              SUM(ps.fk_id_vestibulando = ?) AS inscrito,
              s.data_hora < NOW() AS encerrada
         FROM sessao s
         JOIN usuario u ON u.id_usuario = s.fk_id_psicologo
         LEFT JOIN participa_sessao ps ON ps.fk_id_sessao = s.id_sessao
        GROUP BY s.id_sessao
        ORDER BY encerrada, CASE WHEN s.data_hora >= NOW() THEN s.data_hora END,
                 s.data_hora DESC`,
      [usuario ? usuario.id : 0]
    );
    res.json(
      linhas.map((s) => {
        const inscrito = !!Number(s.inscrito);
        const minha = usuario && usuario.id === s.fk_id_psicologo;
        return {
          ...s,
          inscritos: Number(s.inscritos),
          vagas_restantes: s.limite_vagas - Number(s.inscritos),
          inscrito,
          encerrada: !!Number(s.encerrada),
          minha,
          // O link só aparece para quem está inscrito ou para o psicólogo da sessão
          link_acesso: inscrito || minha ? s.link_acesso : null
        };
      })
    );
  } catch (error) {
    erroMySQL(res, error);
  }
});

// POST /api/sessoes (psicólogo) { titulo, data_hora, link_acesso, limite_vagas }
router.post("/sessoes", exigirLogin("psicologo"), async (req, res) => {
  const { titulo, data_hora, link_acesso, limite_vagas } = req.body;
  const vagas = Number(limite_vagas);
  if (!textoValido(titulo, 150) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data_hora || "")) {
    return res.status(400).json({ erro: "Informe título e data/hora da sessão." });
  }
  if (!textoValido(link_acesso, 255) || !Number.isInteger(vagas) || vagas < 1) {
    return res.status(400).json({ erro: "Informe o link de acesso e o número de vagas (mínimo 1)." });
  }
  if (new Date(data_hora) < new Date()) {
    return res.status(400).json({ erro: "A sessão precisa ser em uma data futura." });
  }
  try {
    let link = link_acesso.trim();
    if (!/^https?:\/\//i.test(link)) link = "https://" + link;
    const [r] = await mysqlPool.query(
      `INSERT INTO sessao (titulo, data_hora, link_acesso, limite_vagas, fk_id_psicologo) VALUES (?, ?, ?, ?, ?)`,
      [titulo.trim(), data_hora.replace("T", " ") + ":00", link, vagas, req.usuario.id]
    );
    res.status(201).json({ id_sessao: r.insertId });
  } catch (error) {
    erroMySQL(res, error, {
      duplicado: "Você já tem uma sessão nesse mesmo horário.",
      gatilho: "Seu CRP ainda não foi validado pela administração, então você ainda não pode criar sessões."
    });
  }
});

// POST /api/sessoes/:id/inscricao (vestibulando)
router.post("/sessoes/:id/inscricao", exigirLogin("vestibulando"), async (req, res) => {
  try {
    const [[sessao]] = await mysqlPool.query(`SELECT data_hora < NOW() AS encerrada FROM sessao WHERE id_sessao = ?`, [
      Number(req.params.id)
    ]);
    if (!sessao) return res.status(404).json({ erro: "Sessão não encontrada." });
    if (Number(sessao.encerrada)) return res.status(409).json({ erro: "Essa sessão já aconteceu." });

    await mysqlPool.query(`INSERT INTO participa_sessao (fk_id_sessao, fk_id_vestibulando) VALUES (?, ?)`, [
      Number(req.params.id),
      req.usuario.id
    ]);
    res.status(201).json({ mensagem: "Inscrição confirmada!" });
  } catch (error) {
    erroMySQL(res, error, {
      duplicado: "Você já está inscrito(a) nessa sessão.",
      gatilho: "Que pena, as vagas dessa sessão esgotaram."
    });
  }
});

router.delete("/sessoes/:id/inscricao", exigirLogin("vestibulando"), async (req, res) => {
  try {
    await mysqlPool.query(`DELETE FROM participa_sessao WHERE fk_id_sessao = ? AND fk_id_vestibulando = ?`, [
      Number(req.params.id),
      req.usuario.id
    ]);
    res.json({ mensagem: "Inscrição cancelada." });
  } catch (error) {
    erroMySQL(res, error);
  }
});

module.exports = router;
