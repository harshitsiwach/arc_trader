# Hyperliquid WebSocket + API Skills for AI Agents

Complete reference for building your own Hyperliquid trading app with WebSocket streams, REST APIs, and optional MCP integration.

---

## Quick Start

### 1. Install the Python SDK

```bash
pip install hyperliquid-python-sdk
```

- Official SDK: https://github.com/hyperliquid-dex/hyperliquid-python-sdk
- Docs index: https://hyperliquid.gitbook.io/hyperliquid-docs/llms.txt

### 2. Configure API Wallet

1. Go to https://app.hyperliquid.xyz/API
2. Generate a new API key (recommended over using your main wallet private key)
3. Create `examples/config.json`:

```json
{
  "account_address": "0xYOUR_PUBLIC_KEY",
  "secret_key": "0xYOUR_PRIVATE_KEY_OR_API_KEY"
}
```

---

## Core Architecture

### Two Main Classes

|Class|Purpose|WebSocket|
|---|---|---|
|`Info`|Read-only market data, account state|Yes (built-in)|
|`Exchange`|Sign + place orders, manage positions|Uses `Info` internally|

---

## WebSocket Data Streams (Native API)

### Public WebSocket Endpoint

```
wss://api.hyperliquid.xyz/ws
```

No authentication required for public data.

### Subscription Types

```python
# Subscribe envelope
{
  "method": "subscribe",
  "subscription": {
    "type": "<STREAM_TYPE>",
    "coin": "BTC"  # or "@<spot_index>" for spot
  }
}
```

|Stream Type|Description|Example|
|---|---|---|
|`l2Book`|Full order book (20 levels)|`{"type":"l2Book","coin":"BTC"}`|
|`trades`|Real-time trades|`{"type":"trades","coin":"BTC"}`|
|`orders`|Order lifecycle events|`{"type":"orders","user":"0x..."}`|
|`userEvents`|Account updates|`{"type":"userEvents","user":"0x..."}`|
|`candle|1m`|1-minute candles|`{"type":"candle","coin":"BTC","interval":"1m"}`|

### Minimal WebSocket Client (Python)

```python
import asyncio, json, websockets

URL = "wss://api.hyperliquid.xyz/ws"

async def main():
    async with websockets.connect(URL) as ws:
        # Subscribe to BTC order book
        await ws.send(json.dumps({
            "method": "subscribe",
            "subscription": {"type": "l2Book", "coin": "BTC"},
        }))
        
        # Subscribe to BTC trades
        await ws.send(json.dumps({
            "method": "subscribe",
            "subscription": {"type": "trades", "coin": "BTC"},
        }))
        
        async for raw in ws:
            msg = json.loads(raw)
            channel = msg.get("channel")
            
            if channel == "l2Book":
                bids, asks = msg["data"]["levels"]
                print(f"BTC Book: Bid {bids[0]['px']} | Ask {asks[0]['px']}")
            
            elif channel == "trades":
                for trade in msg["data"]:
                    print(f"Trade: {trade['side']} {trade['sz']} @ {trade['px']}")

asyncio.run(main())
```

### Keep-Alive

The server does not ping automatically. Use standard WebSocket pings or:

```python
await ws.send(json.dumps({"method": "ping"}))
# Response: {"channel": "pong"}
```

---

## REST API Endpoints

Base URL: `https://api.hyperliquid.xyz`

### Info Class (Read-Only)

```python
from hyperliquid.info import Info
from hyperliquid.utils import constants

# Mainnet
info = Info(constants.MAINNET_API_URL, skip_ws=True)

# Testnet
# info = Info(constants.TESTNET_API_URL, skip_ws=True)

# Get all mid prices
mids = info.all_mids()
print(mids)  # {"BTC": "67234.5", "ETH": "3456.7", ...}

# Get order book (L2)
book = info.l2_book("BTC")
print(book["levels"])  # [[bids], [asks]]

# Get recent trades
trades = info.recent_trades("BTC")

# Get user account state
user = info.user_state("0xYOUR_ADDRESS")
print(user["marginSummary"]["accountValue"])

# Get open orders
orders = info.open_orders("0xYOUR_ADDRESS")

# Get candles
candles = info.candles("BTC", "1m", start_time=..., end_time=...)
```

### Exchange Class (Trading)

```python
from hyperliquid.exchange import Exchange
from hyperliquid.utils import constants
import json

# Load config
with open("examples/config.json") as f:
    config = json.load(f)

exchange = Exchange(
    config["account_address"],
    config["secret_key"],
    constants.MAINNET_API_URL
)

# Place limit order
order_result = exchange.order(
    coin="BTC",
    is_buy=True,
    sz=0.1,
    px=67000,  # limit price
    order_type={"limit": {"tif": "Gtc"}}  # Good til cancelled
)

# Place market order
order_result = exchange.order(
    coin="BTC",
    is_buy=True,
    sz=0.1,
    px=None,  # None = market
    order_type={"limit": {"tif": "Ioc"}}  # Immediate or cancel
)

# Cancel all open orders for a coin
cancel_result = exchange.cancel_all("BTC")

# Get account summary
account = exchange.account()
print(account["marginSummary"]["accountValue"])
```

---

## Full Example: Market Maker Bot

```python
import asyncio, json
from hyperliquid.info import Info
from hyperliquid.exchange import Exchange
from hyperliquid.utils import constants
import websockets

CONFIG_PATH = "examples/config.json"
SPREAD_BPS = 10  # 0.1%
ORDER_SIZE = 0.1
COIN = "BTC"

class MarketMaker:
    def __init__(self):
        with open(CONFIG_PATH) as f:
            config = json.load(f)
        
        self.info = Info(constants.MAINNET_API_URL, skip_ws=False)
        self.exchange = Exchange(
            config["account_address"],
            config["secret_key"],
            constants.MAINNET_API_URL
        )
        self.last_bid = None
        self.last_ask = None
    
    async def run(self):
        # Connect to WebSocket for real-time book
        async with websockets.connect("wss://api.hyperliquid.xyz/ws") as ws:
            await ws.send(json.dumps({
                "method": "subscribe",
                "subscription": {"type": "l2Book", "coin": COIN},
            }))
            
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("channel") != "l2Book":
                    continue
                
                levels = msg["data"]["levels"]
                bids, asks = levels[0], levels[1]
                
                best_bid = float(bids[0]["px"])
                best_ask = float(asks[0]["px"])
                mid = (best_bid + best_ask) / 2
                
                # Calculate our quotes
                my_bid = mid * (1 - SPREAD_BPS / 10000)
                my_ask = mid * (1 + SPREAD_BPS / 10000)
                
                # Only update if prices moved significantly
                if abs(my_bid - (self.last_bid or 0)) > 1:
                    # Cancel existing orders
                    await asyncio.to_thread(self.exchange.cancel_all, COIN)
                    
                    # Place new bid
                    self.exchange.order(
                        coin=COIN,
                        is_buy=True,
                        sz=ORDER_SIZE,
                        px=round(my_bid, 1),
                        order_type={"limit": {"tif": "Gtc"}}
                    )
                    
                    # Place new ask
                    self.exchange.order(
                        coin=COIN,
                        is_buy=False,
                        sz=ORDER_SIZE,
                        px=round(my_ask, 1),
                        order_type={"limit": {"tif": "Gtc"}}
                    )
                    
                    self.last_bid = my_bid
                    self.last_ask = my_ask
                    print(f"Updated quotes: Bid {my_bid:.1f} | Ask {my_ask:.1f}")

if __name__ == "__main__":
    mm = MarketMaker()
    asyncio.run(mm.run())
```

---

## Hyperliquid MCP Servers (Optional Integration)

If you want AI agents to control your app via MCP:

### 1. MCPify.trade

- Endpoint: `https://mcp.mcpify.trade/mcp?token=<your-key>`
- Tools: 12 (8 read + 4 trading)
- Setup:
  1. Generate key at https://mcpify.trade/mcp
  2. Add to Claude Settings → Connectors
  3. Arm trading with caps

### 2. Build Your Own MCP Server

```python
# mcp_server.py
from mcp.server.fastmcp import FastMCP
from hyperliquid.info import Info
from hyperliquid.exchange import Exchange
from hyperliquid.utils import constants
import json

mcp = FastMCP("Hyperliquid")

CONFIG_PATH = "examples/config.json"
with open(CONFIG_PATH) as f:
    config = json.load(f)

info = Info(constants.MAINNET_API_URL, skip_ws=True)
exchange = Exchange(
    config["account_address"],
    config["secret_key"],
    constants.MAINNET_API_URL
)

@mcp.tool()
def get_btc_price() -> dict:
    """Get current BTC mid price"""
    mids = info.all_mids()
    return {"btc_mid": mids.get("BTC")}

@mcp.tool()
def get_order_book(coin: str) -> dict:
    """Get L2 order book for a coin"""
    return info.l2_book(coin)

@mcp.tool()
def place_limit_order(coin: str, is_buy: bool, sz: float, px: float) -> dict:
    """Place a limit order"""
    result = exchange.order(
        coin=coin,
        is_buy=is_buy,
        sz=sz,
        px=px,
        order_type={"limit": {"tif": "Gtc"}}
    )
    return result

@mcp.tool()
def get_account_value() -> dict:
    """Get account margin summary"""
    account = exchange.account()
    return account["marginSummary"]

if __name__ == "__main__":
    mcp.run()
```

Run with:

```bash
python mcp_server.py
```

Then connect in Claude/Cursor via:

```json
{
  "mcpServers": {
    "hyperliquid": {
      "command": "python",
      "args": ["mcp_server.py"]
    }
  }
}
```

---

## Advanced: Supanode WebSocket (Enhanced Feed)

For deeper books (1000 levels) and block-rate updates:

- Endpoint: `wss://toy.hl.supanode.xyz:48080/ws`
- Auth: `x-token: YOUR_KEY` header on handshake
- Docs: https://supanode.xyz/docs/hyperliquid/websocket/overview

```python
import asyncio, json, websockets

URL = "wss://toy.hl.supanode.xyz:48080/ws"
HEADERS = {"x-token": "YOUR_SUPANODE_KEY"}

async def main():
    async with websockets.connect(URL, additional_headers=HEADERS) as ws:
        await ws.send(json.dumps({
            "method": "subscribe",
            "subscription": {"type": "l2Book", "coin": "BTC", "nLevels": 100},
        }))
        
        async for raw in ws:
            msg = json.loads(raw)
            if msg.get("channel") == "l2Book":
                bids, asks = msg["data"]["levels"]
                print(f"Depth: {len(bids)} bids, {len(asks)} asks")

asyncio.run(main())
```

---

## Reference Links

|Resource|URL|
|---|---|
|Official Docs|https://hyperliquid.gitbook.io/hyperliquid-docs|
|Python SDK|https://github.com/hyperliquid-dex/hyperliquid-python-sdk|
|SDK Examples|https://github.com/hyperliquid-dex/hyperliquid-python-sdk/tree/master/examples|
|Quicknode RPC|https://www.quicknode.com/docs/hyperliquid|
|Supanode WS|https://supanode.xyz/docs/hyperliquid/websocket|
|Hydromancer Data|https://docs.hydromancer.xyz|

---

## Example Files in SDK

The SDK includes these ready-to-run examples:

- `basic_ws.py` — WebSocket subscriptions
- `basic_order.py` — Place limit order
- `basic_market_order.py` — Market order
- `basic_agent.py` — Simple trading agent
- `basic_adding.py` — Market making
- `basic_tpsl.py` — Take profit / stop loss
- `evm_block_indexer.py` — HyperEVM indexer
- `basic_spot_order.py` — Spot trading
- `basic_vault.py` — Vault operations

Copy `config.json.example` to `config.json`, add your keys, then run:

```bash
python examples/basic_order.py
```

---

## Testing on Testnet

All examples work on testnet with:

```python
from hyperliquid.utils import constants

info = Info(constants.TESTNET_API_URL, skip_ws=True)
exchange = Exchange(..., constants.TESTNET_API_URL)
```

Testnet URL: `https://api.hyperliquid-testnet.xyz`

Get testnet USDC from faucet, then practice without real money.