import { criarBanco, migrar } from "./banco.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}
const banco = criarBanco(url);
try {
  await migrar(banco, console.log);
  console.log("Banco em dia.");
} finally {
  await banco.end();
}
