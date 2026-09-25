> ## Documentation Index
> Fetch the complete documentation index at: https://docs.arc.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart: Embed the Onramp widget

> Mint a session on your server and mount the Onramp widget inline in your app so users can buy stablecoins on Arc.

Embed the [Onramp](/app-kit/onramp) widget inline in an existing web app using
the App Kit SDK. A signed-in user can open your page, complete an onramp inside
an iframe, and your page receives a settled deposit event.

The Onramp widget integration is framework-agnostic. The server handler uses the
Fetch `Request` / `Response` standard, and the browser widget only needs a
mounted DOM container. The route example uses Next.js App Router wiring, but the
same handler works in Fetch-compatible backends such as Hono, Cloudflare
Workers, Bun, Deno, and modern Node. For Express or Fastify hosts, see
[Customize session minting](/app-kit/tutorials/onramp/customize-session-minting).

<Tip>
  Try the live demo at [https://onramp-demo.arc.io/](https://onramp-demo.arc.io/)
  before integrating.
</Tip>

## Prerequisites

Before you begin, ensure that you've:

* Installed [Node.js v22+](https://nodejs.org/).
* Set up an existing web app with a server route and a browser page.
* [Installed the App Kit SDK](/app-kit/tutorials/installation).
* Obtained an [API key](/app-kit/onramp#api-key) from the
  [Circle Console](https://console.circle.com/api-keys).
* Obtained a wallet address on Arc where users will receive their stablecoins.

## Step 1. Set your environment variables

Add your API key to your server environment. Never inline it in client code or
commit it to source control.

```bash .env theme={null}
CIRCLE_API_KEY=YOUR_API_KEY
```

## Step 2. Expose a session route on your server

Create a route that exchanges your API key for a short-lived session token. The
App Kit SDK ships `createSessionRouteHandler` as a drop-in `Request → Response`
handler. The following example uses the Next.js App Router:

```typescript app/api/onramp/sessions/route.ts theme={null}
import {
  createAppServerKit,
  createSessionRouteHandler,
} from "@circle-fin/app-kit/server";

const server = createAppServerKit({
  onramp: {
    apiKey: process.env.CIRCLE_API_KEY!,
    referrerDomain: "your.domain.com", // Required for debit card, Apple Pay, and Google Pay.
  },
});

export const POST = createSessionRouteHandler(server.onramp);
```

The handler accepts `POST` requests, validates the body, calls
`server.onramp.createSession()`, and returns the session as JSON. It maps thrown
errors to the appropriate HTTP status codes and sets `Cache-Control: no-store`
so session tokens are never cached.

<Note>
  This route doesn't perform authentication. Before deploying, add an `authorize`
  callback that checks the user's session. See
  [Customize session minting](/app-kit/tutorials/onramp/customize-session-minting#add-authentication).
</Note>

## Step 3. Add a container element to your page

The Onramp widget renders inside an `<iframe>` that fills its container. The
container must already be attached to the DOM and must have an explicit,
non-zero height, or the iframe collapses to 0px.

The snippet shows only the container markup. Step 4 extends this file with the
full mounting logic.

```html theme={null}
<h1>Add funds to your account</h1>
<div id="onramp-root"></div>
```

```css theme={null}
#onramp-root {
  width: 100%;
  height: 720px;
}
```

## Step 4. Mint a session and mount the widget

In your browser code, mint the session by sending a `POST` request to the route
you created in step 2, then mount the widget into the container element.

```typescript onramp.ts theme={null}
import { AppKit } from "@circle-fin/app-kit";

const kit = new AppKit();
const container = document.getElementById("onramp-root");

if (!container) {
  throw new Error("Missing #onramp-root container");
}

let widget: { close: () => void } | undefined;

async function startOnramp() {
  widget?.close();

  const session = await kit.onramp.fetchSession({
    url: "/api/onramp/sessions",
    body: {
      appUserId: "user-123",
      destinationAddress: "USER_WALLET_ADDRESS",
    },
  });

  widget = kit.onramp.mountIframe({
    session,
    container,
    onDepositSettled: ({ payload }) => {
      console.log("Deposit settled:", payload);
    },
    onDepositNotCompleted: ({ code }) => {
      console.log("Deposit not completed:", code);
    },
  });
}

function stopOnramp() {
  widget?.close();
  widget = undefined;
}

void startOnramp();
window.addEventListener("beforeunload", stopOnramp);
```

Replace `USER_WALLET_ADDRESS` with the signed-in user's Arc wallet address
before running the flow.

Keep the widget controller returned by `mountIframe`. Call `widget.close()` when
the user leaves this view, closes the modal, or starts a new widget session. In
a framework, call `stopOnramp()` from that framework's cleanup lifecycle.

## Step 5. Allow the widget origin in your Content Security Policy (CSP)

If your site sends a CSP header, the iframe fails to load silently unless you
allow the widget and API origins:

```text theme={null}
frame-src https://onramp.arc.io;
connect-src https://onramp.arc.io https://api.circle.com;
```

See [Hosting requirements](/app-kit/references/onramp-hosting-requirements) for
the complete list of host-side constraints.

## Step 6. Set up a webhook receiver

Browser events such as `DEPOSIT_SETTLED` are best-effort UX signals only. If a
user closes the tab between submitting a deposit and settlement, the browser
never receives the settlement event even though the deposit succeeds. Reconcile
final deposit state from webhook events delivered to your backend.