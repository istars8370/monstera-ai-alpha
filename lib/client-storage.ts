import {
  decryptRecord, deriveDeviceKey, encryptRecord, eraseDeviceKey,
  generateDeviceSalt, isEncryptedRecord, type EncryptedRecord,
  DEVICE_SALT_BYTES,
} from "@/lib/client-crypto";

// IDB v2에서 chat는 암호문만, meta에는 공개 salt만 저장한다.
export type LocalChatMessage = { role: "user" | "assistant"; content: string };
export interface MigrationSummary { migrated: number; failed: number; }
const DB_NAME = "monstera-alpha-local";
let activeKey: Uint8Array | null = null;
let pendingStorageMutation: Promise<void> = Promise.resolve();

function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = pendingStorageMutation.then(action);
  pendingStorageMutation = result.then(() => undefined, () => undefined);
  return result;
}
function isMessageList(value: unknown): value is LocalChatMessage[] {
  return Array.isArray(value) && value.length <= 5000 && value.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const m = item as Record<string, unknown>;
    return (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" && m.content.length <= 131072;
  });
}
function currentKey(): Uint8Array {
  if (!activeKey) throw new Error("LOCAL_STORAGE_LOCKED");
  return activeKey;
}
function requireCurrent(key: Uint8Array): void {
  if (activeKey !== key) throw new Error("LOCAL_STORAGE_LOCKED");
}
export function deviceUnlocked(): boolean { return activeKey !== null; }
export function lockDeviceStorage(): void {
  eraseDeviceKey(activeKey);
  activeKey = null;
}
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("chat")) db.createObjectStore("chat");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("LOCAL_STORAGE_BLOCKED"));
  });
}
async function getRecord(storeName: "chat" | "meta", name: string): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(name);
    req.onsuccess = () => { db.close(); resolve(req.result as unknown); };
    req.onerror = () => { db.close(); reject(req.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
async function storeRecord(storeName: "chat" | "meta", name: string, data: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(data, name);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
export async function getOrCreateDeviceSalt(): Promise<Uint8Array> {
  // salt 자체는 비밀이 아니다. 기존 값은 수정하지 않아야 복호화할 수 있다.
  const newSalt = await generateDeviceSalt();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");
    let chosen: Uint8Array | null = null;
    const get = store.get("device-salt-v2");
    get.onsuccess = () => {
      const existing: unknown = get.result;
      if (existing === undefined) {
        chosen = newSalt;
        store.put(newSalt, "device-salt-v2");
      } else if (existing instanceof Uint8Array && existing.length === DEVICE_SALT_BYTES) {
        chosen = existing;
      } else {
        tx.abort();
      }
    };
    tx.oncomplete = () => { db.close(); resolve(chosen!); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("INVALID_DEVICE_SALT")); };
    tx.onabort = () => { db.close(); reject(new Error("INVALID_DEVICE_SALT")); };
  });
}
export async function unlockAndMigrate(
  userId: string, passphrase: string,
): Promise<MigrationSummary> {
  const salt = await getOrCreateDeviceSalt();
  const key = await deriveDeviceKey(passphrase, salt);
  try {
    const summary = await serialized(async () => {
      const name = "messages:" + userId;
      const old: unknown = await getRecord("chat", name);
      if (old === undefined) return { migrated: 0, failed: 0 };
      if (isEncryptedRecord(old)) {
        const parsed = await decryptRecord(userId, "messages", old, key);
        if (!isMessageList(parsed)) throw new Error("INVALID_DECRYPTED_DATA");
        return { migrated: 0, failed: 0 };
      }
      // 옛 평문 레코드는 현재 사용자가 잠금을 해제한 시점에만 암호화한다.
      // 변환 실패 시 데이터는 절대 덮어쓰지 않고 실패 횟수만 반환한다.
      if (!isMessageList(old)) return { migrated: 0, failed: 1 };
      try {
        const encrypted = await encryptRecord(userId, "messages", old, key);
        await storeRecord("chat", name, encrypted);
        return { migrated: 1, failed: 0 };
      } catch { return { migrated: 0, failed: 1 }; }
    });
    lockDeviceStorage();
    activeKey = key;
    return summary;
  } catch (error) {
    eraseDeviceKey(key);
    throw error;
  }
}
export async function loadChat(userId: string): Promise<LocalChatMessage[]> {
  const key = currentKey();
  const raw = await getRecord("chat", "messages:" + userId);
  requireCurrent(key);
  if (raw === undefined) return [];
  const result = await decryptRecord(userId, "messages", raw, key);
  requireCurrent(key);
  if (!isMessageList(result)) throw new Error("INVALID_DECRYPTED_DATA");
  return result;
}
export async function saveChat(messages: LocalChatMessage[], userId: string): Promise<void> {
  // 암호화 키 없이 IndexedDB에 평문을 저장하지 않는다.
  const key = currentKey();
  if (!isMessageList(messages)) return Promise.reject(new Error("INVALID_MESSAGES"));
  return serialized(async () => {
    requireCurrent(key);
    const record: EncryptedRecord = await encryptRecord(userId, "messages", messages, key);
    requireCurrent(key);
    await storeRecord("chat", "messages:" + userId, record);
  });
}
export function deleteLocalChatForUser(userId: string): Promise<void> {
  return serialized(async () => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("chat", "readwrite");
      tx.objectStore("chat").delete("messages:" + userId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  });
}
export function deleteAllLocalChat(): Promise<void> {
  return serialized(async () => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["chat", "meta"], "readwrite");
      tx.objectStore("chat").clear();
      tx.objectStore("meta").clear();
      tx.oncomplete = () => { db.close(); lockDeviceStorage(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  });
}
