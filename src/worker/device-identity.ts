import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {chmod, open, readFile, unlink} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";

const DeviceIdentitySchema = z.object({deviceId: z.string().uuid()}).strict();

async function readDeviceId(path: string): Promise<string> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new Error(`Stored device identity ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) {
    throw new Error(`Stored device identity ${path} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = DeviceIdentitySchema.safeParse(value);
  if (!parsed.success) throw new Error(`Stored device identity ${path} is invalid: ${z.prettifyError(parsed.error)}`);
  try { await chmod(path, 0o600); }
  catch (error) {
    throw new Error(`Stored device identity ${path} could not be secured to mode 0600: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsed.data.deviceId;
}

export async function loadOrCreateDeviceId(stateDir: string): Promise<string> {
  const path = join(stateDir, "device-id.json");
  try { return await readDeviceId(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const deviceId = randomUUID();
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readDeviceId(path);
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({deviceId})}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(path).catch(() => {});
    throw new Error(`Could not persist device identity ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try { await handle.close(); }
  catch (error) { throw new Error(`Could not close device identity ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  return deviceId;
}
