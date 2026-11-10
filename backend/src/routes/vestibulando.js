// Ferramentas do vestibulando: Desafio do Equilíbrio, Calendário e Rotina (MySQL)
const express = require("express");
const { mysqlPool } = require("../db");
const { exigirLogin } = require("../auth");
const { hoje, dataValida, textoValido, erroMySQL } = require("../util");

const router = express.Router();
const soVestibulando = exigirLogin("vestibulando");

// ---------------- Desafio do Equilíbrio (um por dia - UC07) ----------------
const DESAFIOS = [
  "Tire 5 minutos para fazer algo que te acalme. Pode ser respirar fundo, ouvir uma música, assistir um vídeo ou abraçar o travesseiro.",
  "Beba um copo de água agora e faça uma pausa de 5 minutos longe das telas.",
  "Escreva três coisas pelas quais você é grato(a) hoje.",
  "Faça um alongamento de 5 minutos entre dois blocos de estudo.",
  "Mande uma mensagem carinhosa para alguém de quem você gosta.",
  "Dê uma caminhada curta, nem que seja até a janela, e observe o céu.",
  "Durma pelo menos 7 horas esta noite: desligue o celular 30 minutos antes."
];

router.get("/desafio/hoje", soVestibulando, async (req, res) => {
  try {
    const data = hoje();
    let [linhas] = await mysqlPool.query(
      `SELECT id_desafio, descricao, data, concluido FROM desafio WHERE fk_id_vestibulando = ? AND data = ?`,
      [req.usuario.id, data]
    );
    if (!linhas.length) {
      const descricao = DESAFIOS[Math.floor(Math.random() * DESAFIOS.length)];
      // INSERT IGNORE: se duas abas pedirem ao mesmo tempo, o UNIQUE (vestibulando, data) evita duplicar
      await mysqlPool.query(
        `INSERT IGNORE INTO desafio (descricao, data, fk_id_vestibulando) VALUES (?, ?, ?)`,
        [descricao, data, req.usuario.id]
      );
      [linhas] = await mysqlPool.query(
        `SELECT id_desafio, descricao, data, concluido FROM desafio WHERE fk_id_vestibulando = ? AND data = ?`,
        [req.usuario.id, data]
      );
    }
    const [[{ total }]] = await mysqlPool.query(
      `SELECT COUNT(*) AS total FROM desafio WHERE fk_id_vestibulando = ? AND concluido = 1`,
      [req.usuario.id]
    );
    res.json({ ...linhas[0], concluido: !!linhas[0].concluido, totalConcluidos: total });
  } catch (error) {
    erroMySQL(res, error);
  }
});

router.post("/desafio/hoje/concluir", soVestibulando, async (req, res) => {
  try {
    await mysqlPool.query(`UPDATE desafio SET concluido = 1 WHERE fk_id_vestibulando = ? AND data = ?`, [
      req.usuario.id,
      hoje()
    ]);
    res.json({ mensagem: "Desafio concluído! Parabéns por cuidar de você." });
  } catch (error) {
    erroMySQL(res, error);
  }
});

// ---------------- Calendário de estudos ----------------
// GET /api/tarefas?mes=2026-11
router.get("/tarefas", soVestibulando, async (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || "") ? req.query.mes : hoje().slice(0, 7);
  try {
    const [linhas] = await mysqlPool.query(
      `SELECT id_tarefa, descricao, data FROM tarefa_calendario
        WHERE fk_id_vestibulando = ? AND DATE_FORMAT(data, '%Y-%m') = ?
        ORDER BY data, id_tarefa`,
      [req.usuario.id, mes]
    );
    res.json(linhas);
  } catch (error) {
    erroMySQL(res, error);
  }
});

router.post("/tarefas", soVestibulando, async (req, res) => {
  const { descricao, data } = req.body;
  if (!textoValido(descricao, 200) || !dataValida(data)) {
    return res.status(400).json({ erro: "Informe uma descrição (até 200 caracteres) e uma data válida." });
  }
  try {
    const [r] = await mysqlPool.query(
      `INSERT INTO tarefa_calendario (descricao, data, fk_id_vestibulando) VALUES (?, ?, ?)`,
      [descricao.trim(), data, req.usuario.id]
    );
    res.status(201).json({ id_tarefa: r.insertId, descricao: descricao.trim(), data });
  } catch (error) {
    erroMySQL(res, error, { duplicado: "Você já tem essa tarefa nesse dia." });
  }
});

router.delete("/tarefas/:id", soVestibulando, async (req, res) => {
  try {
    await mysqlPool.query(`DELETE FROM tarefa_calendario WHERE id_tarefa = ? AND fk_id_vestibulando = ?`, [
      Number(req.params.id),
      req.usuario.id
    ]);
    res.json({ mensagem: "Tarefa removida." });
  } catch (error) {
    erroMySQL(res, error);
  }
});

// ---------------- Rotina diária ----------------
router.get("/rotina", soVestibulando, async (req, res) => {
  try {
    const [linhas] = await mysqlPool.query(
      `SELECT id_atividade, TIME_FORMAT(hora_inicio,'%H:%i') AS hora_inicio,
              TIME_FORMAT(hora_fim,'%H:%i') AS hora_fim, descricao
         FROM atividade_rotina WHERE fk_id_vestibulando = ? ORDER BY hora_inicio`,
      [req.usuario.id]
    );
    res.json(linhas);
  } catch (error) {
    erroMySQL(res, error);
  }
});

router.post("/rotina", soVestibulando, async (req, res) => {
  const { hora_inicio, hora_fim, descricao } = req.body;
  const hora = /^\d{2}:\d{2}$/;
  if (!hora.test(hora_inicio || "") || !hora.test(hora_fim || "") || !textoValido(descricao, 255)) {
    return res.status(400).json({ erro: "Informe hora de início, hora de fim e descrição." });
  }
  if (hora_fim <= hora_inicio) {
    return res.status(400).json({ erro: "A hora de fim deve ser depois da hora de início." });
  }
  try {
    const [r] = await mysqlPool.query(
      `INSERT INTO atividade_rotina (hora_inicio, hora_fim, descricao, fk_id_vestibulando) VALUES (?, ?, ?, ?)`,
      [hora_inicio, hora_fim, descricao.trim(), req.usuario.id]
    );
    res.status(201).json({ id_atividade: r.insertId });
  } catch (error) {
    erroMySQL(res, error, { duplicado: "Já existe uma atividade começando nesse horário." });
  }
});

router.delete("/rotina/:id", soVestibulando, async (req, res) => {
  try {
    await mysqlPool.query(`DELETE FROM atividade_rotina WHERE id_atividade = ? AND fk_id_vestibulando = ?`, [
      Number(req.params.id),
      req.usuario.id
    ]);
    res.json({ mensagem: "Atividade removida." });
  } catch (error) {
    erroMySQL(res, error);
  }
});

module.exports = router;
