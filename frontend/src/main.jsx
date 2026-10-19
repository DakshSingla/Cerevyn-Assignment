import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./extra.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const formatMoney = (paise) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2
}).format(paise / 100);

async function request(path, options) {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    const error = new Error(message || "Request failed");
    error.status = response.status;
    throw error;
  }
  return body;
}

function App() {
  const [tab, setTab] = useState("Chat simulator");
  const [products, setProducts] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [handoffs, setHandoffs] = useState([]);
  const [sender, setSender] = useState(() => localStorage.getItem("ps05-sender") || "CUST-001");
  const [messages, setMessages] = useState([{ from: "assistant", text: "Namaste! Tell me a product and quantity to get started." }]);
  const [conversation, setConversation] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const refresh = async () => {
    try {
      const [catalog, quotationData, handoffData] = await Promise.all([
        request("/api/products"), request("/api/quotations"), request("/api/handoffs")
      ]);
      setProducts(catalog.products);
      setQuotes(quotationData.quotations);
      setHandoffs(handoffData.handoffs);
      const conversationData = await request(`/api/conversations/${encodeURIComponent(sender)}`);
      setConversation(conversationData.conversation || null);
      setMessages((conversationData.conversation?.messages || []).flatMap((message) => [
        { from: "customer", text: message.incoming, timestamp: message.timestamp, messageId: message.messageId },
        { from: "assistant", text: message.reply, timestamp: message.timestamp }
      ]));
      if (!conversationData.conversation) {
        setMessages([{ from: "assistant", text: "Namaste! Tell me a product and quantity to get started." }]);
      }
      setApiConnected(true);
    } catch (error) {
      setApiConnected(false);
      setNotice(`API unavailable: ${error.message}. Start the backend on port 3001.`);
    }
  };

  useEffect(() => { refresh(); }, [sender]);
  useEffect(() => { localStorage.setItem("ps05-sender", sender); }, [sender]);
  const filteredProducts = useMemo(() => products.filter((product) =>
    `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(search.toLowerCase())
  ), [products, search]);

  async function deliverEvent(event, replay = false) {
    setBusy(true);
    try {
      const result = await request("/api/webhook/messages", {
        method: "POST",
        body: JSON.stringify(event)
      });
      if (replay) setNotice(`Event ${event.message_id} replayed${result.replayed ? " (stored response returned)" : ""}.`);
      await refresh();
    } catch (error) {
      setApiConnected(false);
      setNotice(`Message request failed: ${error.message}. You can retry the same event ID below.`);
    } finally {
      setBusy(false);
    }
  }

  async function sendText(text) {
    const message = text.trim();
    if (!message || busy) return;
    const event = {
      sender_id: sender,
      message_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      text: message
    };
    setLastEvent(event);
    setDraft("");
    setMessages((current) => [...current, { from: "customer", text: message, timestamp: event.timestamp, messageId: event.message_id }]);
    await deliverEvent(event);
  }

  function sendMessage(event) {
    event.preventDefault();
    void sendText(draft);
  }

  async function resetDemoCart() {
    if (!window.confirm(`Clear ${sender}'s current cart and pending quotation preview? Message history and confirmed quotations stay saved.`)) return;
    try {
      await request(`/api/conversations/${encodeURIComponent(sender)}/reset`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function changeHandoff(id, status) {
    try {
      await request(`/api/handoffs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await refresh();
    } catch (error) { setNotice(error.message); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">W</div>
        <div className="brand-copy"><strong>PS05 Assistant</strong><span>SALES CONSOLE</span></div>
        <nav aria-label="Main navigation">
          {["Chat simulator", "Catalogue", "Quotations", "Human handoff"].map((item) => (
            <button key={item} className={tab === item ? "nav-item active" : "nav-item"} onClick={() => setTab(item)}>
              <span className="nav-icon">{({ "Chat simulator": "◉", Catalogue: "▦", Quotations: "▤", "Human handoff": "↗" })[item]}</span>
              {item}
              {item === "Human handoff" && handoffs.filter((row) => row.status === "open").length > 0 &&
                <span className="badge">{handoffs.filter((row) => row.status === "open").length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><span className={apiConnected ? "online-dot" : "offline-dot"} /> Local API {apiConnected ? "connected" : "unavailable"}</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><div className="eyebrow">WHATSAPP SALES & QUOTATION ASSISTANT</div><h1>{tab}</h1></div>
          <div className="profile"><span className="avatar">PS</span><div><strong>Sales workspace</strong><small>Local demo</small></div></div>
        </header>
        {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {tab === "Chat simulator" && (
          <section className="chat-layout">
            <div className="panel chat-panel">
              <div className="panel-heading">
                <div className="contact-avatar">WA</div><div><strong>WhatsApp simulator</strong><small><span className="online-dot" /> Online · try Hinglish or English</small></div>
                <button className="quiet-button" onClick={resetDemoCart}>Reset demo cart</button>
              </div>
              <label className="sender-field">Customer / sender ID
                <select value={sender} onChange={(event) => setSender(event.target.value)} aria-label="Select demo customer">
                  <option value="CUST-001">CUST-001 · Asha</option>
                  <option value="CUST-002">CUST-002 · Rahul</option>
                </select>
              </label>
              <div className="messages">
                {messages.map((message, index) => <div key={index} className={`message-row ${message.from}`}>
                  <div className="bubble">{message.text.split("\n").map((line, lineIndex) => <React.Fragment key={lineIndex}>{line}{lineIndex < message.text.split("\n").length - 1 && <br />}</React.Fragment>)}
                    {(message.timestamp || message.messageId) && <small className="message-meta">{message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : ""}{message.messageId ? ` · ${message.messageId}` : ""}</small>}
                  </div>
                </div>)}
                {busy && <div className="typing">Assistant is thinking…</div>}
              </div>
              <div className="suggestions">
                {["2 keyboards, 3 monitors, and 1 mouse", "cart", "quote", "human"].map((suggestion) =>
                  <button key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}</button>)}
              </div>
              <form className="composer" onSubmit={sendMessage}>
                <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" aria-label="Message" />
                <button disabled={busy || !draft.trim()} aria-label="Send message">➤</button>
              </form>
              {lastEvent && <div className="event-tools">
                <span>Last event ID: <code>{lastEvent.message_id}</code></span>
                <button className="outline-button" disabled={busy} onClick={() => deliverEvent(lastEvent, true)}>Replay same event</button>
              </div>}
            </div>
            <aside className="side-panels">
              <div className="panel mini-panel">
                <h2>Current cart · {sender}</h2>
                {conversation?.cart?.length ? <ul className="cart-lines">{conversation.cart.map((item) => (
                  <li key={item.product_id}><span>{item.name} × {item.quantity}<small>{item.stock} available{item.unit_price_snapshot_paise !== item.unit_price_paise ? " · price changed" : ""}</small></span><b>{formatMoney(item.unit_price_paise * item.quantity)}</b></li>
                ))}</ul> : <p className="muted">No items in this customer's cart.</p>}
                {conversation?.preview && <>
                  <div className="cart-total"><span>Subtotal</span><b>{formatMoney(conversation.preview.subtotal_paise)}</b></div>
                  <div className="cart-total"><span>Tax ({conversation.preview.tax_percent}%)</span><b>{formatMoney(conversation.preview.tax_paise)}</b></div>
                  <div className="cart-total total"><span>Total</span><b>{formatMoney(conversation.preview.total_paise)}</b></div>
                  <div className="preview-actions">
                    <button disabled={busy} onClick={() => void sendText("CONFIRM")}>Confirm quote</button>
                    <button disabled={busy} className="secondary-button" onClick={() => void sendText("CANCEL")}>Cancel</button>
                  </div>
                </>}
              </div>
              <div className="panel mini-panel">
                <h2>How it works</h2>
                <ol><li>Ask for an item and quantity.</li><li>Review your cart with <b>QUOTE</b>.</li><li>Only <b>CONFIRM</b> creates a quote.</li></ol>
                <div className="tax-note">Prices are stored in paise; tax is configurable.</div>
              </div>
              <div className="panel mini-panel">
                <h2>Live summary</h2><p className="metric">{quotes.length}</p><span className="muted">Confirmed quotations</span>
                <button className="text-link" onClick={() => setTab("Quotations")}>View quotations →</button>
              </div>
            </aside>
          </section>
        )}

        {tab === "Catalogue" && (
          <section className="panel catalogue-panel">
            <div className="section-heading"><div><h2>Product catalogue</h2><p>Live products, available stock and current prices.</p></div>
              <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products…" aria-label="Search products" /></div>
            <div className="product-grid">{filteredProducts.map((product) => <article className="product-card" key={product.id}>
              <div className="product-art">{product.category.slice(0, 1)}</div>
              <div className="product-info"><span className="category-tag">{product.category}</span><small className="product-id">{product.id} · {product.active ? "Active" : "Inactive"}</small><h3>{product.name}</h3><p>{product.description}</p>
              <div className="product-footer"><strong>{formatMoney(product.price_paise)}</strong><span className={product.stock ? "stock-ok" : "stock-empty"}>{product.stock} in stock</span></div></div>
            </article>)}</div>
            {!filteredProducts.length && <p className="empty-state">No matching products.</p>}
          </section>
        )}

        {tab === "Quotations" && (
          <section className="panel table-panel"><div className="section-heading"><div><h2>Confirmed quotations</h2><p>Only customer-confirmed previews are recorded here.</p></div><button className="outline-button" onClick={refresh}>Refresh</button></div>
            {quotes.length ? <div className="table-wrap"><table><thead><tr><th>Quotation</th><th>Customer</th><th>Items</th><th>Subtotal</th><th>GST</th><th>Total</th><th>Created</th></tr></thead><tbody>
              {quotes.map((quote) => <tr key={quote.id}><td><button className="table-link" onClick={() => setSelectedQuote(quote)}>{quote.id}</button></td><td>{quote.sender_id}</td><td>{quote.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</td><td>{formatMoney(quote.subtotal_paise)}</td><td>{formatMoney(quote.tax_paise)}</td><td><b>{formatMoney(quote.total_paise)}</b></td><td>{new Date(`${quote.created_at}Z`).toLocaleString()}</td></tr>)}
            </tbody></table></div> : <div className="empty-state">No confirmed quotations yet. Preview and confirm one in the chat simulator.</div>}
            {selectedQuote && <div className="quote-detail">
              <div className="section-heading"><div><h2>{selectedQuote.id} details</h2><p>Historical product and price snapshots.</p></div><button className="outline-button" onClick={() => setSelectedQuote(null)}>Close details</button></div>
              <div className="table-wrap"><table><thead><tr><th>Product snapshot</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>
                {selectedQuote.items.map((item) => <tr key={item.product_id}><td>{item.name} ({item.product_id})</td><td>{item.quantity}</td><td>{formatMoney(item.unit_price_paise)}</td><td>{formatMoney(item.line_total_paise)}</td></tr>)}
              </tbody></table></div>
              <p className="quote-snapshot-total">Subtotal {formatMoney(selectedQuote.subtotal_paise)} · Tax {formatMoney(selectedQuote.tax_paise)} · Total <b>{formatMoney(selectedQuote.total_paise)}</b></p>
            </div>}
          </section>
        )}

        {tab === "Human handoff" && (
          <section className="panel table-panel"><div className="section-heading"><div><h2>Human handoff queue</h2><p>Requests include the customer's current cart and conversation state.</p></div><button className="outline-button" onClick={refresh}>Refresh</button></div>
            {handoffs.length ? <div className="handoff-list">{handoffs.map((handoff) => <article className="handoff-card" key={handoff.id}>
              <div className="handoff-top"><div><span className="queue-id">REQUEST {handoff.handoff_id || `#${handoff.id}`}</span><h3>{handoff.sender_id}</h3></div><span className={`status ${handoff.status}`}>{handoff.status.replace("_", " ")}</span></div>
              <p>{handoff.reason}</p><div className="context-box"><b>Cart:</b> {(handoff.context.cart || []).length ? handoff.context.cart.map((item) => `${item.name} × ${item.quantity}`).join(" · ") : "No cart items"}<br />Conversation state: {handoff.context.state}
                {(handoff.context.recentMessages || []).map((message, index) => <p key={index}><b>{message.direction === "incoming" ? "Customer" : "Assistant"}:</b> {message.text}</p>)}
              </div>
              <div className="handoff-actions">{handoff.status === "open" && <button onClick={() => changeHandoff(handoff.id, "in_progress")}>Take request</button>}{handoff.status !== "resolved" && <button className="secondary-button" onClick={() => changeHandoff(handoff.id, "resolved")}>Mark resolved</button>}</div>
            </article>)}</div> : <div className="empty-state">The handoff queue is clear.</div>}
          </section>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
