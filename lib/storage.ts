import type { Book, Progress, Settings } from "./types";
const DB = "littleleaf-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      for (const name of ["books", "progress", "settings"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开本地存储，请检查浏览器是否允许保存数据。"));
  });
}
async function access<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), request = action(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result as T); };
    tx.onerror = () => { db.close(); reject(new Error("保存失败，可能是设备空间不足。请导出学习记录后重试。")); };
    tx.onabort = () => { db.close(); reject(new Error("本地保存已取消，请重新尝试。")); };
  });
}
export const storage = {
  books: () => access<Book[]>("books", "readonly", s => s.getAll()),
  saveBook: (book: Book) => access("books", "readwrite", s => s.put(book, book.id)),
  deleteBook: (id: string) => access("books", "readwrite", s => s.delete(id)),
  progress: () => access<Progress[]>("progress", "readonly", s => s.getAll()),
  saveProgress: (progress: Progress) => access("progress", "readwrite", s => s.put(progress, `${progress.bookId}:${progress.lessonId}`)),
  deleteProgress: (key: string) => access("progress", "readwrite", s => s.delete(key)),
  settings: () => access<Settings | undefined>("settings", "readonly", s => s.get("main")),
  saveSettings: (settings: Settings) => access("settings", "readwrite", s => s.put(settings, "main")),
};
