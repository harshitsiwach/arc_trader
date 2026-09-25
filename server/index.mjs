/** P1 entry: feed + round engine + API. */
import { config } from './config.mjs'
import { Store } from './store.mjs'
import { PriceFeed } from './feed.mjs'
import { RoundManager } from './rounds.mjs'
import { startApi } from './api.mjs'

const store = new Store(config.dataPath, { startingBankroll: config.startingBankroll })
const feed = new PriceFeed()
const manager = new RoundManager(store, feed, config.products, { settleSecret: config.settleSecret })

feed.connect()
manager.start()
startApi({
  port: config.port,
  store,
  manager,
  products: config.products,
  faucet: { amount: config.demoFaucetAmount, cap: config.demoFaucetCap },
})

process.on('SIGINT', () => {
  manager.stop()
  process.exit(0)
});
