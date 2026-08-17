import fs from 'node:fs'; import path from 'node:path';

export class JsonRepository {
  constructor(file) { this.file = file; }
  load() {
    if (!this.file || !fs.existsSync(this.file)) return null;
    const state = JSON.parse(fs.readFileSync(this.file, 'utf8')); state.idempotency = new Map(state.idempotency || []); return state;
  }
  save(state) {
    if (!this.file) return; fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`; const serializable = { ...state, idempotency: [...state.idempotency.entries()] };
    fs.writeFileSync(tmp, JSON.stringify(serializable, null, 2)); fs.renameSync(tmp, this.file);
  }
}
