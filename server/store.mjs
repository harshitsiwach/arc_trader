/** P1 custodial ledger. Demo store: JSON file. Prod (P4): replace with Postgres. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export class Store {
  constructor(path, { persist = true, startingBankroll = 10000 } = {}) {
    this.path = path
    this.persist = persist
    this.state = {
      bankroll: startingBankroll,
      startingBankroll,
      day: today(),
      dayPnl: 0,
      seq: 1,
      users: {}, // id -> { balance }
      rounds: [], // capped in memory; full history is a P4 DB concern
      bets: [],
    }
    if (persist && existsSync(path)) {
      try {
        this.state = { ...this.state, ...JSON.parse(readFileSync(path, 'utf8')) }
      } catch {
        // corrupt demo db -> start fresh
      }
    }
  }

  save() {
    if (this.persist) writeFileSync(this.path, JSON.stringify(this.state, null, 2))
  }

  nextId(prefix) {
    return `${prefix}_${this.state.seq++}`
  }

  getUser(id) {
    if (!this.state.users[id]) {
      this.state.users[id] = { balance: 0 }
      this.save()
    }
    return this.state.users[id]
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}
