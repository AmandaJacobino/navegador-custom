const fs = require('fs');
const { Database } = require('node-sqlite3-wasm');

// Armazenamento do histórico de navegação em SQLite. O node-sqlite3-wasm é o
// SQLite compilado em WebAssembly com VFS sobre o fs do Node: grava só as
// páginas alteradas, sem módulo nativo (o better-sqlite3 não carrega no
// runtime do Electron deste projeto).
function openHistoryStore(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      visited_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS visits_visited_at ON visits (visited_at);
  `);

  return {
    // Registra uma visita e devolve o id da entrada.
    add(url, title, visitedAt) {
      const info = db.run('INSERT INTO visits (url, title, visited_at) VALUES (?, ?, ?)', [url, title, visitedAt]);
      return Number(info.lastInsertRowid);
    },

    setTitle(id, title) {
      db.run('UPDATE visits SET title = ? WHERE id = ?', [title, id]);
    },

    touch(id, visitedAt) {
      db.run('UPDATE visits SET visited_at = ? WHERE id = ?', [visitedAt, id]);
    },

    // Entradas com visited_at em [since, until), mais recentes primeiro.
    list(since, until = Number.MAX_SAFE_INTEGER) {
      return db.all(
        `SELECT id, url, title, visited_at AS timestamp
           FROM visits
          WHERE visited_at >= ? AND visited_at < ?
          ORDER BY visited_at DESC, id DESC`,
        [since, until],
      );
    },

    remove(id) {
      db.run('DELETE FROM visits WHERE id = ?', [id]);
    },

    clear() {
      db.run('DELETE FROM visits');
    },

    // Apaga entradas visitadas antes de olderThan (timestamp em ms). Devolve quantas saíram.
    prune(olderThan) {
      return db.run('DELETE FROM visits WHERE visited_at < ?', [olderThan]).changes;
    },

    // Importa o histórico antigo em JSON ({ id, url, title, timestamp }) numa
    // única transação. Só renomeia o arquivo depois de gravar tudo, então uma
    // falha no meio não perde dados e a próxima inicialização tenta de novo.
    importLegacyJson(jsonFile) {
      if (!fs.existsSync(jsonFile)) return 0;
      const entries = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
      db.exec('BEGIN');
      try {
        for (const e of entries) {
          db.run('INSERT INTO visits (url, title, visited_at) VALUES (?, ?, ?)', [e.url, e.title || '', e.timestamp]);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      fs.renameSync(jsonFile, jsonFile + '.migrated');
      return entries.length;
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openHistoryStore };
