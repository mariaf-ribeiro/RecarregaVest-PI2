// Checklist diário de autocuidado - MongoDB (coleção "checklists")
// Um documento por vestibulando por dia, com os itens embutidos:
// { vestibulandoId: 6, data: "2026-11-09", itens: [ { descricao, realizado } ] }
const express = require("express");
const { mongo } = require("../db");
const { exigirLogin } = require("../auth");
const { hoje, dataValida, textoValido } = require("../util");

const router = express.Router();

// Itens padrão (os mesmos da tela "Checklist" do Figma)
const ITENS_PADRAO = [
  "Fiz pausas entre os estudos para descansar a mente.",
  "Tirei um tempo para me alongar ou fazer uma caminhada leve.",
  "Reconheci algo bom que aconteceu hoje, mesmo que pequeno.",
  "Evitei me comparar com os outros e foquei no meu próprio ritmo."
];

const colecao = () => mongo().collection("checklists");

// Operação "adicionarItemChecklist" do documento do banco não-convencional:
// cria o documento do dia (upsert) e insere o item só se ele ainda não existir.
async function adicionarItem(vestibulandoId, data, descricao) {
  const doc = await colecao().findOne({ vestibulandoId, data });
  if (!doc) {
    try {
      await colecao().insertOne({ vestibulandoId, data, itens: [{ descricao, realizado: false }] });
      return true;
    } catch (error) {
      // Outra requisição criou o documento do dia ao mesmo tempo (índice único) -> tenta de novo
      if (error.code === 11000) return adicionarItem(vestibulandoId, data, descricao);
      throw error;
    }
  }
  if (doc.itens.some((item) => item.descricao === descricao)) return false;
  // O filtro com $ne garante que o item não seja duplicado mesmo com requisições simultâneas
  const r = await colecao().updateOne(
    { _id: doc._id, "itens.descricao": { $ne: descricao } },
    { $push: { itens: { descricao, realizado: false } } }
  );
  return r.modifiedCount === 1;
}

// GET /api/checklist?data=AAAA-MM-DD  (padrão: hoje)
router.get("/checklist", exigirLogin("vestibulando"), async (req, res) => {
  try {
    const data = dataValida(req.query.data) ? req.query.data : hoje();
    let doc = await colecao().findOne({ vestibulandoId: req.usuario.id, data });
    if (!doc && data === hoje()) {
      try {
        await colecao().insertOne({
          vestibulandoId: req.usuario.id,
          data,
          itens: ITENS_PADRAO.map((descricao) => ({ descricao, realizado: false }))
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
      doc = await colecao().findOne({ vestibulandoId: req.usuario.id, data });
    }
    res.json(doc || { vestibulandoId: req.usuario.id, data, itens: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao carregar o checklist." });
  }
});

// PATCH /api/checklist/itens  { data, descricao, realizado }  -> marcar/desmarcar
router.patch("/checklist/itens", exigirLogin("vestibulando"), async (req, res) => {
  const { descricao, realizado } = req.body;
  const data = dataValida(req.body.data) ? req.body.data : hoje();
  if (!textoValido(descricao, 150) || typeof realizado !== "boolean") {
    return res.status(400).json({ erro: "Dados inválidos." });
  }
  try {
    const doc = await colecao().findOne({ vestibulandoId: req.usuario.id, data });
    const posicao = doc ? doc.itens.findIndex((item) => item.descricao === descricao) : -1;
    if (posicao === -1) return res.status(404).json({ erro: "Item não encontrado." });
    await colecao().updateOne(
      { _id: doc._id, [`itens.${posicao}.descricao`]: descricao },
      { $set: { [`itens.${posicao}.realizado`]: realizado } }
    );
    res.json({ mensagem: "Checklist atualizado." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao atualizar o checklist." });
  }
});

// POST /api/checklist/itens  { descricao }  -> adicionar item próprio no dia de hoje
router.post("/checklist/itens", exigirLogin("vestibulando"), async (req, res) => {
  const { descricao } = req.body;
  if (!textoValido(descricao, 150)) {
    return res.status(400).json({ erro: "Descreva o item (até 150 caracteres)." });
  }
  try {
    const inserido = await adicionarItem(req.usuario.id, hoje(), descricao.trim());
    if (!inserido) return res.status(409).json({ erro: "Esse item já está no seu checklist de hoje." });
    res.status(201).json({ mensagem: "Item adicionado." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao adicionar item." });
  }
});

// Rota experimental usada pelo teste de carga tests/escrita-checklist.js (k6).
// Mantida sem login para o script do k6 continuar funcionando.
router.post("/checklists/:vestibulandoId/itens", async (req, res) => {
  const vestibulandoId = Number(req.params.vestibulandoId);
  const { data, descricao } = req.body;
  if (!Number.isInteger(vestibulandoId) || vestibulandoId < 1 || !dataValida(data) || !textoValido(descricao, 150)) {
    return res.status(400).json({
      erro: "Informe um usuário válido, uma data AAAA-MM-DD e uma descrição de até 150 caracteres."
    });
  }
  try {
    const inserido = await adicionarItem(vestibulandoId, data, descricao.trim());
    res.status(200).json({ mensagem: "Operação de checklist concluída.", inserido });
  } catch (error) {
    console.error("Erro ao atualizar checklist:", error);
    res.status(500).json({ erro: "Erro ao atualizar checklist." });
  }
});

module.exports = router;
