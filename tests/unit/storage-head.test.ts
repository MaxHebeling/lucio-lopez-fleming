import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setStorageForTests, storage } from "@/server/storage";

describe("driver local: head", () => {
  const key = `tests/head/${randomUUID()}.bin`;
  afterAll(async () => {
    await storage().remove("private", key);
    setStorageForTests(undefined);
  });

  it("devuelve el tamaño sin leer el contenido y null si no existe", async () => {
    setStorageForTests(undefined);
    const driver = storage();
    expect(driver.name).toBe("local");
    expect(await driver.head("private", key)).toBeNull();
    await driver.put("private", key, new Uint8Array(1234), "application/octet-stream");
    expect(await driver.head("private", key)).toEqual({ size: 1234, contentType: null });
  });
});
