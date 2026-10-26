import { promises as fs } from 'node:fs';
import path from 'node:path';

const ARRAY_COLLECTIONS = ['jobs', 'presets', 'pricelists'];

export function createStore(dataDir) {
  let queue = Promise.resolve();
  const file = (name) => path.join(dataDir, `${name}.json`);

  async function init() {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o750 });
    for (const name of ARRAY_COLLECTIONS) {
      try { await fs.access(file(name)); } catch { await fs.writeFile(file(name), '[]\n', { mode: 0o640 }); }
    }
    try { await fs.access(file('settings')); } catch { await fs.writeFile(file('settings'), '{}\n', { mode: 0o640 }); }
    try { await fs.access(file('meta')); } catch { await fs.writeFile(file('meta'), JSON.stringify({ schema: 1, nummern: { angebot: 1, rechnung: 1 } }, null, 2) + '\n', { mode: 0o640 }); }
    await fs.mkdir(path.join(dataDir, 'fotos'), { recursive: true, mode: 0o750 });
  }

  async function read(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(file(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  function write(name, value) {
    const run = async () => {
      const tmp = `${file(name)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o640 });
      await fs.rename(tmp, file(name));
    };
    queue = queue.then(run, run);
    return queue;
  }

  return { init, read, write };
}
