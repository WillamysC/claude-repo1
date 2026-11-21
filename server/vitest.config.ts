import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/preparar-banco.ts"],
    // Os testes de banco compartilham o mesmo banco: rodam um arquivo por vez.
    fileParallelism: false,
  },
});
