// Conexões com os dois bancos do projeto:
//  - MySQL   -> usuários, sessões, desafio, calendário, rotina (dados relacionais)
//  - MongoDB -> postagens das comunidades e checklist diário (dados em documentos)
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");

const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "recarregavest_db",
  waitForConnections: true,
  connectionLimit: 20,
  dateStrings: true // devolve DATE/DATETIME como texto ("2026-11-09"), sem fuso horário
});

const mongoClient = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017");
let mongoDB = null;

async function conectar() {
  await mysqlPool.query("SELECT 1");
  console.log("MySQL conectado!");

  await mongoClient.connect();
  mongoDB = mongoClient.db(process.env.MONGO_DATABASE || "recarregavest_nosql");
  await mongoDB.command({ ping: 1 });
  console.log("MongoDB conectado!");
}

function mongo() {
  return mongoDB;
}

module.exports = { mysqlPool, mongoClient, conectar, mongo };
