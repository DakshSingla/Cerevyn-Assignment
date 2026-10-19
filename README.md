# WhatsApp Sales and Quotation Assistant

I built **QuoteFlow** for PS05 as a WhatsApp-style sales and quotation assistant. It helps demonstrate how a business can handle product enquiries, collect quantities, check a local catalogue and stock, calculate a quotation, and save it after the customer confirms. The application runs as a local message simulator; it does not connect to WhatsApp or send messages to real customers.

## Preview

The screenshots below were captured from the running application using a separate local demo database and fictional sender IDs.

![QuoteFlow overview dashboard](docs/screenshots/dashboard.png)

![Multi-product quotation preview](docs/screenshots/multi-product-quotation.png)

## Contents

- [Problem and objectives](#problem-and-objectives)
- [Technology stack](#technology-stack)
- [Dependencies](#dependencies)
- [Implemented features](#implemented-features)
- [Screenshots and walkthrough](#screenshots-and-walkthrough)
- [End-to-end workflow](#end-to-end-workflow)
- [Architecture and data storage](#architecture-and-data-storage)
- [Installation and local execution](#installation-and-local-execution)
- [Sample inputs, outputs, and short demonstration](#sample-inputs-outputs-and-short-demonstration)
- [Demonstration scenarios](#demonstration-scenarios)
- [Testing evidence](#testing-evidence)
- [Limitations and future improvements](#limitations-and-future-improvements)
- [Deployment design](#deployment-design)
- [Conclusion](#conclusion)

## Problem and objectives

Product enquiries often require several small steps before a sales representative can prepare a useful quotation: identify the catalogue item, clarify the quantity, check stock, calculate the price, and confirm the customer's intent. Handling these steps manually can lead to inconsistent totals or incomplete requests.

I built this project to demonstrate how that routine flow can be handled through a WhatsApp-style message interface. The application keeps each sender's conversation and cart separate, so a quantity clarification or quote for one customer does not change another customer's order. Product names, prices, and stock come from the backend catalogue, and the backend calculates totals rather than trusting values from the browser. A quotation is saved only after a customer confirms its preview.

## Technology stack

| Area | Technologies |
|---|---|
| Frontend | React 18, Vite 6, JavaScript ES modules, CSS, Lucide React |
| Backend | Node.js, Express 4, Zod request validation, Pino logging, Helmet, CORS |
| Product matching | Deterministic local intent and quantity parsing, catalogue name/alias/ID matching, Fuse.js fuzzy matching |
| Database | SQLite using `better-sqlite3`; versioned migrations, transactions, WAL mode, and foreign keys |
| Tests | Node.js built-in test runner (`node:test`), assertions, and HTTP requests against an ephemeral server |
| CI | GitHub Actions workflow runs the backend tests and frontend production build on pushes and pull requests |

There is no external language-model service, WhatsApp API, or API key in the current application.

## Dependencies

There is no root `package.json`. The backend and frontend each have their own `package.json` and lockfile, so dependencies must be installed from each package directory with `npm ci`.

| Package | Main dependencies |
|---|---|
| Backend (`backend/package.json`) | `express` for HTTP routes; `better-sqlite3` for persistence; `zod` for request validation; `fuse.js` for fuzzy catalogue matching; `helmet`, `cors`, `pino`, `pino-http`, and `dotenv` for security headers, cross-origin configuration, logging, and environment loading |
| Frontend (`frontend/package.json`) | `react` and `react-dom` for the interface; `vite` and `@vitejs/plugin-react` for development/build; `lucide-react` for icons |
| Development/test tools | Node.js 20+ and npm; the built-in `node:test` runner is used, so no separate backend test framework is required |

The exact pinned dependency versions used by `npm ci` are recorded in `backend/package-lock.json` and `frontend/package-lock.json`.

## Implemented features

- Six connected work areas: Overview, Conversations, Product Catalogue, Quotations, Human Handoff, and Activity Log.
- A seeded 12-item product catalogue with product IDs, descriptions, aliases, prices, and stock.
- Product lookup using catalogue IDs, names, aliases, and fuzzy matching. The local parser handles common English and some Hinglish requests; it is not a general-purpose conversational model.
- A customer-specific conversation and cart, including clarification when a product is named without a quantity.
- Whole-number quantity validation and stock checks. A request above the available stock is rejected instead of being added to the cart.
- Backend calculation of item totals, subtotal, tax, and quotation total. The default tax rate is configurable and is 18%.
- A quotation preview and explicit confirmation step. The quotation and its item/price snapshots are persisted after confirmation.
- Duplicate-event protection: an identical message ID and payload returns the previously saved response without repeating its effects. Reusing an ID with a different payload returns an HTTP 409 conflict.
- A local human-review queue for supported handoff requests, with status updates and a status history. The queue does not contact an employee.
- An activity log reconstructed from saved messages and processing responses.
- A local message simulator in the browser. It sends events to the backend webhook; it is not a live WhatsApp integration.

## Screenshots and walkthrough

All images in this section were captured from the running frontend connected to the local API. The demo used fictional sender IDs and an isolated SQLite database, not personal customer information.

### Overview dashboard

![Overview dashboard](docs/screenshots/dashboard.png)

I opened the overview after starting both services. It displays values returned from the database, including saved conversations, confirmed quotations, pending confirmations, and open handoffs. The recent conversation, quotation, handoff, and activity panels show how the work areas reflect persisted records rather than static sample cards.

### Conversation workspace

![Conversation workspace](docs/screenshots/conversation-workspace.png)

I selected the demo customer in Conversations. The page shows the inbox, saved message transcript, and live order context together. The conversation was processed by the backend and the customer's current cart is kept separate from other senders.

### Multi-product quotation preview

![Multi-product quotation preview](docs/screenshots/multi-product-quotation.png)

To exercise the quote calculation, I sent `I need 2 keyboards, 3 monitors, and 1 mouse.` and then `QUOTE`. The preview contains two Mechanical Keyboards, three 24-inch Monitors, and one Wireless Mouse. At the default 18% tax rate, the backend calculated a subtotal of ₹26,900.00, tax of ₹4,842.00, and total of ₹31,742.00. This is a preview; it is not yet a saved quotation.

### Missing quantity clarification

![Assistant asking for a missing quantity](docs/screenshots/missing-quantity.png)

I sent `I need a keyboard.` without a quantity. The assistant asked how many Mechanical Keyboards I wanted, and the conversation entered a “Needs quantity” state. No product was added to the cart before the question was answered.

### Insufficient stock

![Stock validation response](docs/screenshots/stock-validation.png)

I requested `12 monitors`. The catalogue has 10 24-inch Monitors available, so the assistant reported the limit and did not add the request to the cart.

### Quotation confirmation

![Quotation confirmation response](docs/screenshots/quotation-confirmation.png)

After reviewing the multi-product preview, I selected **Confirm quotation**. The assistant returned a quotation ID and the same subtotal, tax, and total. The cart was cleared after confirmation while the saved quotation remained in the register.

### Quotation register

![Saved quotation register](docs/screenshots/quotation-register.png)

I opened Quotations after confirming the preview. The register contains the persisted quote, customer ID, number of items, financial totals, and confirmed status. A preview alone does not create a register entry.

### Human handoff conversation

![Human handoff conversation](docs/screenshots/human-handoff.png)

I sent `Can I get a custom bulk discount?`. The assistant created a local handoff record and explicitly explained that no employee was contacted. The request is then available in the staff-facing review queue.

### Human handoff queue

![Human handoff review queue](docs/screenshots/handoff-queue.png)

The Human Handoff page shows the saved request and its context for local review. Queue status can be changed in the interface; those changes are recorded in the handoff status history.

### Independent customer sessions

![Separate customer conversations and carts](docs/screenshots/independent-sessions.png)

I created one session with a Wireless Mouse and a second session with Mechanical Keyboards. Selecting one sender shows that sender's own conversation and cart, while the other sender remains a separate inbox entry.

### Duplicate event handling

![Duplicate event replay response](docs/screenshots/duplicate-event.png)

I sent a message in the conversation workspace and used **Replay same event**. The UI reported that it returned the saved response. The cart shows the effect of the original message only; replaying the same event did not add the item a second time.

### Product catalogue

![Product catalogue](docs/screenshots/product-catalogue.png)

The catalogue page displays the active products, their IDs, descriptions, prices, and available stock as read from the backend.

## End-to-end workflow

In the local demonstration, a customer message is sent to the backend by the browser's message simulator. Product identification and quantity handling happen locally in the sales workflow code. A quote is saved only after the customer reviews and confirms the preview.

```mermaid
flowchart TD
    A[Customer message in local simulator] --> B[Validate webhook fields and timestamp]
    B --> C{Previously processed message ID?}
    C -- Same payload --> D[Return saved response]
    C -- Conflicting payload --> E[Return HTTP 409 conflict]
    C -- New event --> F[Load or create sender-specific conversation]
    F --> G[Match catalogue product and parse quantity]
    G --> H{Required information missing?}
    H -- Yes --> I[Ask a clarification and save pending state]
    H -- No --> J[Validate requested stock]
    J --> K[Calculate prices, subtotal, tax, and quote preview]
    K --> L{Customer confirms?}
    L -- No --> M[Keep preview/cart or wait for the next message]
    L -- Yes --> N[Save quotation and item snapshots transactionally]
    G --> O[Unsupported request]
    O --> P[Create local human-review handoff]
```

## Architecture and data storage

The React/Vite frontend makes JSON HTTP requests to the Express API. In development, Vite proxies `/api` requests to the backend at `http://127.0.0.1:3001`. The API validates simulated webhook events, processes sales intents, and reads or writes SQLite records. The backend is authoritative for catalogue prices, stock, and monetary totals.

Incoming simulated messages are posted to `POST /api/webhook/messages` (also available at `/api/webhook`). Each event has a sender ID, message ID, timezone-qualified ISO timestamp, and text. The message ID is used as an idempotency key; the backend stores a payload hash and the response in the same transaction as the message transcript and workflow effects.

| Tables | Purpose |
|---|---|
| `products` | Catalogue data, aliases, prices in integer paise, and stock |
| `conversations`, `carts`, `cart_items` | Sender-specific state and the current order |
| `messages`, `conversation_messages` | Incoming events, saved responses, and displayed transcript |
| `quotations`, `quotation_items` | Confirmed quotation totals and item/price snapshots |
| `handoffs`, `handoff_status_events` | Local review requests and auditable status changes |
| `schema_migrations` | Applied database schema versions |

The default database path is `backend/data/assistant.sqlite`. The application applies migrations when the database module is loaded. Run the seed command to ensure the catalogue records exist; existing records are preserved by the seed operation.

The API also exposes health, overview, product, conversation, quotation, handoff, and activity endpoints. The main read/write routes are:

| Method and path | Purpose |
|---|---|
| `GET /api/health` | API and database health |
| `GET /api/overview` | Current dashboard values and recent records |
| `GET /api/products` | Active product catalogue |
| `GET /api/conversations` | Searchable conversation inbox |
| `GET /api/conversations/:senderId` | One sender's transcript and current order context |
| `POST /api/conversations/:senderId/reset` | Clear only that sender's active cart and preview |
| `POST /api/webhook/messages` | Validate and process a simulated incoming event |
| `GET /api/quotations` | Confirmed quotation register |
| `GET /api/handoffs` and `PATCH /api/handoffs/:id` | Review and update handoff status |
| `GET /api/activity` | Saved message-processing activity |

## Installation and local execution

### Prerequisites

- Node.js 20 or newer and npm. The repository's CI workflow uses Node.js 20.
- A Windows, macOS, or Linux terminal.
- No API keys, WhatsApp account, or external service credentials are required.

There is no root `package.json`; install and run the backend and frontend from their respective directories.

### Install and seed

From the repository root, open a terminal and run:

```powershell
Set-Location backend
npm ci
npm run seed
```

`npm run seed` inserts the catalogue if it is missing and preserves existing catalogue records. Database migrations run automatically when the backend starts.

### Start the backend

If the terminal is still in `backend` from the install step:

```powershell
npm start
```

Alternatively, from a new terminal opened at the repository root:

```powershell
Set-Location backend
npm start
```

The API listens at `http://127.0.0.1:3001` by default. For development with Node's watch mode, use `npm run dev` instead.

### Start the frontend

In a second terminal:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open the local URL printed by Vite. The default is `http://localhost:5173`; if that port is busy, Vite selects another and prints it. Keep the backend and frontend terminals running while using the application.

The default development setup uses Vite's `/api` proxy, so a frontend API URL override is not needed. The backend can be configured through an optional `backend/.env` file; copy `backend/.env.example` as a starting point. Common settings are:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API port |
| `HOST` | `127.0.0.1` | API bind address |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed development CORS origin |
| `DATABASE_PATH` | `./data/assistant.sqlite` | SQLite database file, relative to the backend |
| `TAX_RATE_BASIS_POINTS` | `1800` | Tax rate in basis points (18%); valid range is 0–10,000 |
| `LOG_LEVEL` | `info` | Pino log level |

For a production frontend build that calls a separately hosted API, set `VITE_API_URL` in the environment at build time. Do not put secrets in `VITE_*` variables because they become part of the browser bundle.

### Run tests and build

From the repository root:

```powershell
Set-Location backend
npm test
```

In another terminal:

```powershell
Set-Location frontend
npm run build
```

## Sample inputs, outputs, and short demonstration

The frontend's **Conversations** page is a local message simulator. Enter a sender ID to open a customer session, type a message, and select **Send**. The following is a verified example using the seeded catalogue and default 18% tax rate:

```text
Customer: I need 2 keyboards, 3 monitors, and 1 mouse.
Assistant: Added 2 × Mechanical Keyboard, 3 × 24-inch Monitor, 1 × Wireless Mouse to your cart.
```

Then select **Prepare quote preview** (or send `QUOTE`):

```text
Quotation preview
24-inch Monitor (P003) × 3 at ₹8,000.00: ₹24,000.00 — 10 available
Mechanical Keyboard (P002) × 2 at ₹1,200.00: ₹2,400.00 — 30 available
Wireless Mouse (P001) × 1 at ₹500.00: ₹500.00 — 50 available
Subtotal: ₹26,900.00
Tax (18%): ₹4,842.00
Total: ₹31,742.00
```

The preview asks the customer to reply `CONFIRM`, or to change the cart first. After confirmation the app returns a generated quotation ID and the same totals; the ID differs for each quotation. The saved record appears under **Quotations**.

Other useful sample inputs:

| Customer input | Expected assistant behaviour |
|---|---|
| `I need a keyboard.` | Asks, “How many Mechanical Keyboards would you like?” and waits for a quantity |
| `three` (after the quantity question) | Adds three Mechanical Keyboards to that sender's cart |
| `12 monitors` | Reports that only 10 24-inch Monitors are available; does not add the request |
| `Can I get a custom bulk discount?` | Creates a local human handoff and states that no employee was contacted |

### Short evaluator walkthrough

1. Follow [Installation and local execution](#installation-and-local-execution) to install the packages, seed the catalogue, and start the API and Vite server.
2. Open the Vite URL shown in the frontend terminal and select **Conversations**.
3. Enter a demo sender ID such as `EVAL-CUSTOMER-01`; send `I need 2 keyboards, 3 monitors, and 1 mouse.` and then `QUOTE`.
4. Review the three line items and ₹26,900.00 subtotal, ₹4,842.00 tax, and ₹31,742.00 total. Select **Confirm quotation**.
5. Open **Quotations** to see the persisted record. Return to **Conversations** and enter a different sender ID to verify that the second customer's session is separate.

These steps create persistent local demo records in the configured SQLite database. To remove a demo cart, use the selected conversation's **Reset cart** control; it preserves message history and confirmed quotations. Do not delete the database file unless you intend to remove all local records.

### Troubleshooting

- **Dashboard says the API is unavailable:** start the backend and check `http://127.0.0.1:3001/api/health`, then refresh the browser.
- **Port 3001 is already in use:** stop the other service or set a different backend `PORT`. If it changes, update the frontend API configuration/proxy target to match.
- **Vite reports that port 5173 is occupied:** use the alternate local URL printed by Vite. If using a non-default frontend origin with a separately configured backend, set `FRONTEND_URL` to that origin.
- **Catalogue appears empty:** from `backend`, run `npm run seed`, then refresh the page.

## Demonstration scenarios

The scenarios below were exercised during this documentation pass using the live local API and/or frontend against an isolated demo database. Automated test coverage is reported separately in [Testing evidence](#testing-evidence).

| Scenario | Input or action | Expected behaviour | Verified result |
|---|---|---|---|
| Multi-product quotation | `I need 2 keyboards, 3 monitors, and 1 mouse.` then `QUOTE` | Match all three products, check stock, and show itemized totals | Verified: subtotal ₹26,900.00; tax ₹4,842.00; total ₹31,742.00 |
| Missing quantity | `I need a keyboard.` | Ask for quantity and leave the cart unchanged until answered | Verified: asked “How many Mechanical Keyboards would you like?” |
| Insufficient stock | `12 monitors` | Report available stock and do not add the over-stock request | Verified: 10 monitors were available; request was rejected |
| Duplicate message event | Replay the same event ID and payload | Return the original response without applying side effects twice | Verified: first request was new; replay returned `replayed: true`; the UI cart remained at the result of one application |
| Two independent customer sessions | Add `1 mouse` for one sender and `2 keyboards` for another | Keep their conversations and cart lines separate | Verified: each sender's conversation and cart remained distinct |
| Confirmation and quotation creation | Confirm a displayed `QUOTE` preview | Save a quotation and item snapshots only after confirmation | Verified: confirmation returned a quotation ID; it appeared in the quotation register |
| Unsupported request and human handoff | `Can I get a custom bulk discount?` | Create a local handoff with context; do not claim a person was contacted | Verified: a handoff was added to the local queue; the reply said no employee was contacted |

## Testing evidence

I ran the repository's actual backend test and frontend build commands:

| Check | Command (run from) | Result |
|---|---|---|
| Backend tests | `Set-Location backend; npm test` | Passed: 16 tests, 0 failures |
| Production frontend build | `Set-Location frontend; npm run build` | Passed: Vite built the production bundle |

The backend tests cover catalogue data, fuzzy matching, missing and ambiguous information, multi-product totals, stock validation, confirmation and persistence, duplicate-event handling, sender isolation, handoff context and history, transactional rollback, concurrent duplicate requests, webhook validation, and overview/activity endpoints. These are Node.js `node:test` tests; the repository does not currently configure a separate coverage-report command.

## Limitations and future improvements

### Current limitations

- This is a local simulator, not a real WhatsApp integration. It does not send or receive messages through WhatsApp.
- Product and quantity handling is deterministic and limited to the implemented local parser and catalogue matching. Unrecognized or ambiguous language may need clarification.
- A handoff creates a local review record only; it does not notify or contact a sales employee.
- Stock is checked when a request is added and again when a quotation is confirmed, but stock is not reserved or decremented by a confirmed quotation.
- The staff interface has no authentication or authorization. It is not suitable for private customer data or production use.
- SQLite is intended for this single-process local demonstration, not shared storage for a horizontally scaled deployment.

### Possible future improvements

- Add a real WhatsApp Business integration with secure webhook verification and outbound-message handling.
- Add staff authentication, authorization, and notifications for handoff records.
- Add stock reservation and release rules around quotation confirmation.
- Expand language handling and add evaluation data for product/quantity extraction.
- Add a managed database, backups, monitoring, and deployment automation before any hosted production use.

## Deployment design

There is **no live Azure deployment**. The following is the proposed Azure plan documented for this assessment, not an implemented or provisioned environment:

```mermaid
flowchart LR
    U[Browser / future WhatsApp provider] -->|HTTPS| FD[Azure Front Door / optional WAF]
    FD --> APP[Azure App Service or Container Apps]
    APP --> DB[Azure Database for PostgreSQL]
    APP --> KV[Azure Key Vault via managed identity]
    APP --> MON[Azure Monitor / Application Insights]
    APP -. optional handoff notifications .-> SB[Azure Service Bus]
    APP --> HP[Health probe: GET /api/health]
```

| Component | Proposed role |
|---|---|
| Azure Front Door (optional WAF) | HTTPS entry point and optional web application firewall |
| Azure App Service or Azure Container Apps | Run the Node.js/Express API. Build the React/Vite client and serve its static files from Azure Static Web Apps or a CDN, or configure the service to serve `frontend/dist` |
| Azure Database for PostgreSQL | Durable relational storage for a multi-instance hosted deployment |
| Azure Key Vault | Store provider or database secrets if integrations are added; access them through managed identity |
| Azure Monitor and Application Insights | Collect structured logs, metrics, and traces; configure alerts for API, database, and webhook failures |
| Azure Service Bus (optional) | Future durable handoff notifications; the current local handoff queue does not publish messages |
| Health probe | Use `GET /api/health`; readiness should distinguish database connectivity before production |

**Database migration is a prerequisite:** the current backend uses a SQLite-specific `better-sqlite3` adapter. PostgreSQL cannot be enabled by changing an environment variable alone. A hosted PostgreSQL deployment needs a deliberate database adapter and migration rewrite, while preserving event-ID uniqueness, transactional quotation writes, and other data constraints. Do not use an ephemeral local SQLite file as shared state across multiple hosted instances.

**Build and configuration:** install each npm package from its own directory with `npm ci`, build the frontend with `npm run build`, and run controlled, versioned database migrations as a release step. Configure `PORT`, a production `FRONTEND_URL`, and `TAX_RATE_BASIS_POINTS` in the backend hosting environment. Use HTTPS, strict CORS, webhook signature verification, rate limits, and authenticated staff access before connecting a real messaging provider. The current local simulator does not implement those production integrations.

**Monitoring and recovery:** forward structured Pino logs to Azure Monitor/Application Insights, redact personal message content where possible, alert on HTTP 5xx responses, webhook failures, database connectivity, and handoff queue age, and configure managed-database backups with tested point-in-time restore.

**CI/CD:** the existing GitHub Actions workflow only runs tests and builds the frontend; it does not deploy. A separate deployment workflow should run only after CI succeeds and use protected GitHub environment approvals and federated credentials/OIDC rather than long-lived secrets.

Azure compute, databases, Key Vault operations, monitoring ingestion, networking, and messaging may incur charges. Verify current regional pricing, quotas, and free-tier terms before provisioning anything. No Azure resources or deployment URL have been created.


## Conclusion

I built this project to demonstrate how product enquiries can be turned into a consistent, customer-specific quotation workflow. The application now supports a local message simulator, catalogue-backed matching and pricing, quantity and stock checks, customer confirmation, saved quotations, duplicate-event protection, and a local handoff queue. Building and testing it helped me connect a React interface to a validated API and persistent database while keeping financial calculations and customer state on the backend.
