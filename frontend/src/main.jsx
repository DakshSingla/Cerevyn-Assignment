import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowRight, Boxes, Check, CheckCheck,
  ChevronDown, ChevronRight, CircleHelp, Clock3, FileClock, FileText, Headset,
  LayoutDashboard, Menu, MessageSquareText, Package, Plus, RefreshCw, Search,
  Send, ShieldCheck, ShoppingBag, ShoppingCart, SlidersHorizontal, Sparkles,
  UserRound, X
} from "lucide-react";
import { formatDate, formatMoney, request } from "./api.js";
import "./style.css";

const PRODUCT_NAME = "QuoteFlow";
const NAVIGATION = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "conversations", label: "Conversations", icon: MessageSquareText },
  { id: "catalogue", label: "Product catalogue", icon: Package },
  { id: "quotations", label: "Quotations", icon: FileText },
  { id: "handoffs", label: "Human handoff", icon: Headset },
  { id: "activity", label: "Activity log", icon: Activity }
];
const STATE_LABELS = {
  active: "In progress",
  awaiting_product: "Needs product",
  awaiting_quantity: "Needs quantity",
  awaiting_confirmation: "Awaiting confirmation",
  human_handoff: "Human assistance",
  closed: "Closed"
};

function StateBadge({ state }) {
  return <span className={`state-badge state-${state || "active"}`}>{STATE_LABELS[state] || state || "In progress"}</span>;
}

function EmptyState({ icon: Icon = CircleHelp, title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={20} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

function PageHeading({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Sidebar({ page, onNavigate, openHandoffs, online, databaseOnline, mobileOpen, onClose }) {
  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-symbol"><span>Q</span></div>
          <div><strong>{PRODUCT_NAME}</strong><small>SALES OPERATIONS</small></div>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-link ${page === id ? "nav-active" : ""}`} onClick={() => onNavigate(id)}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "handoffs" && openHandoffs > 0 && <span className="nav-count">{openHandoffs}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="environment-note"><ShieldCheck size={16} /><span>Local simulator</span></div>
          <div className="system-status">
            <div className="status-line"><span className={`status-dot ${online ? "is-online" : ""}`} />Backend <b>{online ? "Connected" : "Offline"}</b></div>
            <div className="status-line"><span className={`status-dot ${databaseOnline ? "is-online" : ""}`} />Database <b>{databaseOnline ? "Connected" : "Unavailable"}</b></div>
          </div>
          <p className="sidebar-footnote">Prototype · not connected to WhatsApp</p>
        </div>
      </aside>
    </>
  );
}

function KpiCard({ label, value, detail, icon: Icon, onClick, tone }) {
  return (
    <button className={`kpi-card kpi-${tone}`} onClick={onClick}>
      <span className="kpi-icon"><Icon size={19} /></span>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value ?? 0}</strong>
      <span className="kpi-detail">{detail}<ArrowRight size={14} /></span>
    </button>
  );
}

function ActivityRows({ events, onOpenConversation, compact = false }) {
  if (!events.length) {
    return <EmptyState icon={Activity} title="No activity recorded">Events will appear here after real messages are processed by the API.</EmptyState>;
  }
  return (
    <div className={`activity-list ${compact ? "activity-compact" : ""}`}>
      {events.map((event) => (
        <button className="activity-row" key={event.id} onClick={() => onOpenConversation(event.senderId)}>
          <span className={`activity-marker marker-${event.type || "unknown"}`}><Activity size={15} /></span>
          <span className="activity-copy">
            <strong>{event.description}</strong>
            <span>{event.senderId} · {event.message}</span>
          </span>
          <time>{formatDate(event.timestamp)}</time>
        </button>
      ))}
    </div>
  );
}

function OverviewPage({ overview, activity, search, onNavigate, onOpenConversation }) {
  const counts = overview?.counts || {};
  const recentConversations = (overview?.recentConversations || []).filter((item) =>
    `${item.sender_id} ${item.last_message || ""} ${item.state}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <>
      <PageHeading eyebrow="SALES OPERATIONS" title="Overview" subtitle="A live view of customer enquiries and quotation activity." />
      <div className="kpi-grid">
        <KpiCard label="Conversations" value={counts.totalConversations} detail="Customer records" icon={MessageSquareText} tone="blue" onClick={() => onNavigate("conversations")} />
        <KpiCard label="Confirmed quotations" value={counts.confirmedQuotations} detail="Saved to register" icon={FileText} tone="green" onClick={() => onNavigate("quotations")} />
        <KpiCard label="Pending confirmations" value={counts.pendingConfirmations} detail="Awaiting customer" icon={Clock3} tone="amber" onClick={() => onNavigate("conversations")} />
        <KpiCard label="Open handoffs" value={counts.openHandoffs} detail="Needs human review" icon={Headset} tone="violet" onClick={() => onNavigate("handoffs")} />
      </div>

      <div className="overview-grid">
        <section className="surface overview-section">
          <div className="section-title-row">
            <div><h2>Recent conversations</h2><p>Customer state and latest recorded message.</p></div>
            <button className="text-button" onClick={() => onNavigate("conversations")}>All conversations <ArrowRight size={15} /></button>
          </div>
          {recentConversations.length ? (
            <div className="conversation-rows">
              {recentConversations.map((item) => (
                <button className="conversation-row" key={item.sender_id} onClick={() => onOpenConversation(item.sender_id)}>
                  <span className="avatar"><UserRound size={17} /></span>
                  <span className="conversation-copy">
                    <strong>{item.sender_id}</strong>
                    <small>{item.last_message || "Conversation started; no messages yet"}</small>
                  </span>
                  <span className="conversation-meta"><StateBadge state={item.state} /><time>{formatDate(item.last_message_at || item.updated_at)}</time></span>
                </button>
              ))}
            </div>
          ) : <EmptyState icon={MessageSquareText} title="No conversations yet">Send a message from Conversations to create the first real customer conversation.</EmptyState>}
        </section>

        <section className="surface workflow-section">
          <div className="section-title-row"><div><h2>Sales workflow</h2><p>Each step is backed by saved customer state.</p></div><ShoppingBag size={19} className="quiet-icon" /></div>
          <ol className="workflow-list">
            {[
              ["Customer enquiry", "Message received by the API"],
              ["Product identification", "Catalogue names and aliases matched"],
              ["Quantity collection", "Clarify missing or ambiguous details"],
              ["Price calculation", "Backend validates stock and totals"],
              ["Customer confirmation", "Review preview before commitment"],
              ["Quotation creation", "Persist confirmed quote and items"]
            ].map(([title, description], index) => (
              <li key={title}><span>{index + 1}</span><div><strong>{title}</strong><small>{description}</small></div>{index < 5 && <ChevronDown size={14} />}</li>
            ))}
          </ol>
        </section>

        <section className="surface overview-section overview-quotes">
          <div className="section-title-row">
            <div><h2>Recent quotations</h2><p>Only customer-confirmed quotes are shown.</p></div>
            <button className="text-button" onClick={() => onNavigate("quotations")}>Register <ArrowRight size={15} /></button>
          </div>
          {(overview?.recentQuotations || []).length ? (
            <div className="compact-record-list">
              {overview.recentQuotations.map((quote) => (
                <div className="compact-record" key={quote.id}><span><strong>{quote.id}</strong><small>{quote.sender_id} · {quote.items.length} line items</small></span><b>{formatMoney(quote.total_paise)}</b></div>
              ))}
            </div>
          ) : <EmptyState icon={FileText} title="No confirmed quotations">A quotation appears here only after a customer confirms a preview.</EmptyState>}
        </section>

        <section className="surface overview-section overview-handoffs">
          <div className="section-title-row">
            <div><h2>Recent handoffs</h2><p>Requests that need a person to review.</p></div>
            <button className="text-button" onClick={() => onNavigate("handoffs")}>Queue <ArrowRight size={15} /></button>
          </div>
          {(overview?.recentHandoffs || []).length ? (
            <div className="compact-record-list">
              {overview.recentHandoffs.map((handoff) => (
                <div className="compact-record" key={handoff.id}><span><strong>{handoff.handoff_id}</strong><small>{handoff.sender_id} · {handoff.reason}</small></span><StateBadge state={handoff.status} /></div>
              ))}
            </div>
          ) : <EmptyState icon={Headset} title="No handoffs">Unsupported requests will be listed here for local review.</EmptyState>}
        </section>
      </div>

      <section className="surface activity-section">
        <div className="section-title-row">
          <div><h2>Recent activity</h2><p>Derived from persisted message and response records.</p></div>
          <button className="text-button" onClick={() => onNavigate("activity")}>Activity log <ArrowRight size={15} /></button>
        </div>
        <ActivityRows events={activity.slice(0, 6)} compact onOpenConversation={onOpenConversation} />
      </section>
    </>
  );
}

function ConversationInbox({ conversations, selectedSender, onSelect, onNew }) {
  const [newSender, setNewSender] = useState("");
  return (
    <aside className="surface inbox-panel">
      <div className="inbox-heading"><div><h2>Inbox</h2><span>{conversations.length} saved conversations</span></div><MessageSquareText size={18} /></div>
      <form className="new-conversation-form" onSubmit={(event) => { event.preventDefault(); if (newSender.trim()) { onNew(newSender.trim()); setNewSender(""); } }}>
        <label className="sr-only" htmlFor="new-sender">Customer sender ID</label>
        <input id="new-sender" value={newSender} onChange={(event) => setNewSender(event.target.value)} placeholder="Open or start by sender ID" maxLength={200} />
        <button className="icon-button add-button" type="submit" aria-label="Open customer conversation" disabled={!newSender.trim()}><Plus size={17} /></button>
      </form>
      <div className="inbox-list">
        {conversations.map((item) => (
          <button key={item.sender_id} className={`inbox-item ${item.sender_id === selectedSender ? "inbox-selected" : ""}`} onClick={() => onSelect(item.sender_id)}>
            <span className="avatar"><UserRound size={16} /></span>
            <span className="inbox-copy"><strong>{item.sender_id}</strong><small>{item.last_message || "No messages recorded"}</small><StateBadge state={item.state} /></span>
            <time>{formatDate(item.last_message_at || item.updated_at)}</time>
          </button>
        ))}
        {!conversations.length && <div className="inbox-empty">No saved conversations yet. Enter a sender ID above to begin.</div>}
      </div>
    </aside>
  );
}

function OrderContext({ conversation, sender, onSend, busy }) {
  const preview = conversation?.preview;
  const summary = conversation?.cartSummary;
  const cart = conversation?.cart || [];
  return (
    <aside className="surface order-panel">
      <div className="order-heading"><div><span className="panel-kicker">LIVE ORDER CONTEXT</span><h2>{sender || "Select a customer"}</h2></div><ShoppingCart size={19} /></div>
      <div className="context-state"><span>Conversation state</span><StateBadge state={conversation?.state || "active"} /></div>
      {conversation?.pendingAction === "provide_quantity" && <div className="attention-note"><AlertCircle size={16} /><span>Waiting for a missing product quantity.</span></div>}
      {conversation?.pendingAction === "provide_product" && <div className="attention-note"><AlertCircle size={16} /><span>Waiting for the customer to choose a product.</span></div>}
      {cart.length ? (
        <>
          <div className="cart-title"><strong>Current cart</strong><span>{cart.length} product{cart.length === 1 ? "" : "s"}</span></div>
          <div className="order-items">
            {cart.map((item) => {
              const previewItem = preview?.items.find((row) => row.product_id === item.product_id);
              const summaryItem = summary?.items.find((row) => row.product_id === item.product_id);
              const lineTotal = previewItem?.line_total_paise ?? summaryItem?.line_total_paise;
              return (
                <div className="order-item" key={item.product_id}>
                  <div><strong>{item.name}</strong><small>{item.product_id} · Qty {item.quantity} × {formatMoney(item.unit_price_paise)}</small>
                    {item.quantity > item.stock && <em><AlertCircle size={13} /> {item.stock} in stock</em>}
                    {item.unit_price_snapshot_paise !== item.unit_price_paise && <em><AlertCircle size={13} /> Catalogue price changed</em>}
                  </div>
                  <b>{lineTotal === undefined ? "—" : formatMoney(lineTotal)}</b>
                </div>
              );
            })}
          </div>
          {(preview || summary) && (
            <div className="totals-block">
              <div><span>Subtotal</span><b>{formatMoney((preview || summary).subtotal_paise)}</b></div>
              <div><span>Tax ({(preview || summary).tax_percent}%)</span><b>{formatMoney((preview || summary).tax_paise)}</b></div>
              <div className="total-row"><span>Total</span><b>{formatMoney((preview || summary).total_paise)}</b></div>
            </div>
          )}
          {preview?.has_stock_shortage && <div className="attention-note"><AlertCircle size={16} /><span>Stock has changed. Review the cart before confirming.</span></div>}
          {preview?.has_price_changes && <div className="attention-note"><AlertCircle size={16} /><span>Catalogue pricing changed; customer should review the updated total.</span></div>}
          <div className="order-actions">
            {preview ? (
              <>
                <button className="button-primary" disabled={busy || preview.has_stock_shortage} onClick={() => onSend("CONFIRM")}>Confirm quotation</button>
                <button className="button-secondary" disabled={busy} onClick={() => onSend("CANCEL")}>Cancel</button>
              </>
            ) : <button className="button-primary" disabled={busy} onClick={() => onSend("QUOTE")}>Prepare quote preview</button>}
          </div>
          {!preview && <p className="fine-print">The backend calculates the totals. A quotation is created only after customer confirmation.</p>}
        </>
      ) : <EmptyState icon={ShoppingCart} title="Cart is empty">Products added in the conversation will appear here with backend-calculated prices.</EmptyState>}
      <div className="context-foot"><ShieldCheck size={14} /> Prices, stock and totals come from the API.</div>
    </aside>
  );
}

function ConversationTimeline({ conversation, selectedSender, busy, draft, setDraft, onSend, onReset, lastEvent, onReplay }) {
  const messages = conversation?.messages || [];
  function submit(event) {
    event.preventDefault();
    onSend(draft);
  }
  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend(draft);
    }
  }
  return (
    <section className="surface timeline-panel">
      <div className="timeline-heading">
        <span className="avatar avatar-large"><UserRound size={19} /></span>
        <div className="timeline-contact"><strong>{selectedSender || "Customer conversation"}</strong><span>Local message simulator · backend processed</span></div>
        {conversation && <StateBadge state={conversation.state} />}
        {conversation && <button className="button-secondary reset-button" onClick={onReset}>Reset cart</button>}
      </div>
      <div className="mobile-conversation-state">{conversation && <StateBadge state={conversation.state} />}</div>
      <div className="timeline-messages" aria-live="polite">
        {messages.map((message) => (
          <React.Fragment key={message.messageId}>
            <div className="message-entry customer-entry">
              <span className="message-role"><ArrowDownLeft size={13} /> CUSTOMER</span>
              <div className="message-bubble">{message.incoming}<small><time>{formatDate(message.timestamp)}</time><span>Event {message.messageId}</span></small></div>
            </div>
            <div className="message-entry assistant-entry">
              <span className="message-role"><Sparkles size={13} /> {PRODUCT_NAME.toUpperCase()}</span>
              <div className="message-bubble">{message.reply}<small><time>{formatDate(message.timestamp)}</time><span><CheckCheck size={12} /> Processed by API</span></small></div>
            </div>
          </React.Fragment>
        ))}
        {!messages.length && (
          <EmptyState icon={MessageSquareText} title={selectedSender ? "Start this conversation" : "Choose a customer"}>
            {selectedSender ? "Send a product request. The backend will process it and save the conversation." : "Choose a saved conversation from the inbox, or enter a sender ID to start one."}
          </EmptyState>
        )}
        {busy && <div className="request-status"><span className="loading-spinner" /> Sending to backend and saving response…</div>}
      </div>
      {lastEvent?.sender_id === selectedSender && (
        <div className="retry-strip">
          <span>Last event <code>{lastEvent.message_id}</code></span>
          <button className="text-button" disabled={busy} onClick={onReplay}><RefreshCw size={14} /> Replay same event</button>
        </div>
      )}
      <form className="message-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="message-input">Message to the local sales assistant</label>
        <textarea id="message-input" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown}
          placeholder="Type a product request, e.g. “2 keyboards and 1 mouse”" disabled={busy || !selectedSender} rows={2} />
        <div className="composer-bottom"><span>Enter to send · Shift+Enter for a new line</span><button className="button-primary send-button" type="submit" disabled={busy || !draft.trim() || !selectedSender}><Send size={15} /> Send</button></div>
      </form>
    </section>
  );
}

function ConversationsPage({ conversations, conversation, sender, onSelect, onNew, busy, draft, setDraft, onSend, onReset, lastEvent, onReplay }) {
  const [mobilePanel, setMobilePanel] = useState("conversation");
  return (
    <>
      <PageHeading eyebrow="CUSTOMER WORKSPACE" title="Conversations" subtitle="Review the customer’s request, process messages and verify backend order context." />
      <div className="mobile-panel-tabs" role="tablist" aria-label="Conversation panels">
        {["inbox", "conversation", "order"].map((tab) => <button key={tab} role="tab" aria-selected={mobilePanel === tab} className={mobilePanel === tab ? "mobile-tab-selected" : ""} onClick={() => setMobilePanel(tab)}>{tab === "inbox" ? "Inbox" : tab === "order" ? "Order context" : "Conversation"}</button>)}
      </div>
      <div className={`conversation-workspace mobile-${mobilePanel}`}>
        <ConversationInbox conversations={conversations} selectedSender={sender} onSelect={(id) => { onSelect(id); setMobilePanel("conversation"); }} onNew={(id) => { onNew(id); setMobilePanel("conversation"); }} />
        <ConversationTimeline conversation={conversation} selectedSender={sender} busy={busy} draft={draft} setDraft={setDraft} onSend={onSend} onReset={onReset} lastEvent={lastEvent} onReplay={onReplay} />
        <OrderContext conversation={conversation} sender={sender} onSend={onSend} busy={busy} />
      </div>
    </>
  );
}

function CataloguePage({ products, search, setSearch }) {
  const [category, setCategory] = useState("All categories");
  const [sort, setSort] = useState("name");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const categories = useMemo(() => ["All categories", ...new Set(products.map((product) => product.category).sort())], [products]);
  const filtered = useMemo(() => products.filter((product) =>
    (category === "All categories" || product.category === category)
    && `${product.id} ${product.name} ${product.description} ${product.category}`.toLowerCase().includes(search.toLowerCase())
  ).sort((left, right) => sort === "price" ? left.price_paise - right.price_paise : left.name.localeCompare(right.name)), [products, category, search, sort]);
  return (
    <>
      <PageHeading eyebrow="PRODUCT DATA" title="Product catalogue" subtitle="Catalogue-backed product identity, current pricing and available stock." />
      <section className="surface data-surface">
        <div className="toolbar">
          <div className="toolbar-title"><Boxes size={19} /><span><strong>{products.length} active products</strong><small>Read-only catalogue from the backend</small></span></div>
          <div className="toolbar-controls">
            <label className="select-control"><SlidersHorizontal size={15} /><span className="sr-only">Filter category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="select-control"><span className="sr-only">Sort products</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Sort: name</option><option value="price">Sort: price</option></select></label>
          </div>
        </div>
        {filtered.length ? <div className="catalogue-grid">
          {filtered.map((product) => <article className="product-tile" key={product.id}>
            <div className="product-tile-top"><span className="product-glyph"><Package size={20} /></span><span className={`stock-pill ${product.stock > 0 ? "stock-available" : "stock-none"}`}>{product.stock > 0 ? `${product.stock} available` : "Out of stock"}</span></div>
            <span className="product-category">{product.category} · {product.id}</span><h2>{product.name}</h2><p>{product.description}</p>
            <div className="product-tile-bottom"><strong>{formatMoney(product.price_paise)}<small> / unit</small></strong><button className="text-button" onClick={() => setSelectedProduct(product)}>Details <ChevronRight size={14} /></button></div>
          </article>)}
        </div> : <EmptyState icon={Package} title="No matching products">Change the search or category filter.</EmptyState>}
      </section>
      {selectedProduct && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedProduct(null)}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="product-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><span className="panel-kicker">CATALOGUE PRODUCT</span><h2 id="product-detail-title">{selectedProduct.name}</h2></div><button className="icon-button" aria-label="Close product details" onClick={() => setSelectedProduct(null)}><X size={18} /></button></div>
        <p>{selectedProduct.description}</p><dl className="detail-list"><div><dt>Product ID</dt><dd>{selectedProduct.id}</dd></div><div><dt>Category</dt><dd>{selectedProduct.category}</dd></div><div><dt>Unit price</dt><dd>{formatMoney(selectedProduct.price_paise)}</dd></div><div><dt>Available stock</dt><dd>{selectedProduct.stock} units</dd></div><div><dt>Search aliases</dt><dd>{selectedProduct.aliases.join(", ")}</dd></div></dl>
        <button className="button-secondary modal-close" onClick={() => setSelectedProduct(null)}>Close</button>
      </section></div>}
    </>
  );
}

function QuotationsPage({ quotations, search }) {
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("all");
  const filtered = useMemo(() => quotations.filter((quote) =>
    (status === "all" || quote.status === status)
    && `${quote.id} ${quote.enquiry_id || ""} ${quote.sender_id}`.toLowerCase().includes(search.toLowerCase())
  ), [quotations, status, search]);
  const selected = quotations.find((quote) => quote.id === selectedId);
  return (
    <>
      <PageHeading eyebrow="CUSTOMER COMMITMENTS" title="Quotations" subtitle="A register of quotations persisted after explicit customer confirmation." />
      <section className="surface data-surface">
        <div className="toolbar"><div className="toolbar-title"><FileText size={19} /><span><strong>{filtered.length} quotations</strong><small>Confirmed quotations only</small></span></div>
          <label className="select-control"><SlidersHorizontal size={15} /><span className="sr-only">Filter quotation status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="confirmed">Confirmed</option></select></label>
        </div>
        {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Quotation ID</th><th>Customer</th><th>Created</th><th>Items</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Status</th></tr></thead><tbody>
          {filtered.map((quote) => <tr key={quote.id} className={selectedId === quote.id ? "row-selected" : ""}>
            <td><button className="table-link" onClick={() => setSelectedId(quote.id)}>{quote.id}</button></td><td>{quote.sender_id}</td><td>{formatDate(quote.created_at)}</td><td>{quote.items.length}</td><td>{formatMoney(quote.subtotal_paise)}</td><td>{formatMoney(quote.tax_paise)}</td><td><strong>{formatMoney(quote.total_paise)}</strong></td><td><StateBadge state={quote.status} /></td>
          </tr>)}
        </tbody></table></div> : <EmptyState icon={FileText} title="No confirmed quotations">Use the conversation workspace to preview a quote. It will appear here only after confirmation.</EmptyState>}
        {selected && <section className="quote-detail-panel">
          <div className="section-title-row"><div><span className="panel-kicker">QUOTATION DETAIL</span><h2>{selected.id}</h2><p>{selected.sender_id} · Confirmed {formatDate(selected.created_at)}</p></div><button className="button-secondary" onClick={() => setSelectedId(null)}>Close detail</button></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Product</th><th>Product ID</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>
            {selected.items.map((item) => <tr key={`${selected.id}-${item.product_id}`}><td>{item.name}</td><td>{item.product_id}</td><td>{item.quantity}</td><td>{formatMoney(item.unit_price_paise)}</td><td>{formatMoney(item.line_total_paise)}</td></tr>)}
          </tbody></table></div>
          <div className="quote-totals"><div><span>Subtotal</span><b>{formatMoney(selected.subtotal_paise)}</b></div><div><span>Tax ({(selected.tax_rate_basis_points || 0) / 100}%)</span><b>{formatMoney(selected.tax_paise)}</b></div><div className="total-row"><span>Final total</span><b>{formatMoney(selected.total_paise)}</b></div></div>
        </section>}
      </section>
    </>
  );
}

function HandoffsPage({ handoffs, filter, setFilter, onStatusChange, onOpenConversation, busy }) {
  const shown = handoffs.filter((item) => filter === "all" || item.status === filter);
  return (
    <>
      <PageHeading eyebrow="HUMAN REVIEW" title="Human handoff" subtitle="Local queue for requests that need a sales representative to review." action={<label className="select-control"><SlidersHorizontal size={15} /><span className="sr-only">Filter handoffs</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></label>} />
      <div className="handoff-cards">
        {shown.map((item) => <article className="surface handoff-card" key={item.id}>
          <div className="handoff-card-heading"><div><span className="panel-kicker">{item.handoff_id || `HANDOFF ${item.id}`}</span><h2>{item.sender_id}</h2><time>{formatDate(item.created_at)}</time></div><StateBadge state={item.status} /></div>
          <div className="handoff-reason"><Headset size={15} /><p>{item.reason}</p></div>
          <div className="handoff-context"><strong>Captured conversation context</strong><div className="handoff-cart">{item.context?.cart?.length ? item.context.cart.map((line) => `${line.name} × ${line.quantity}`).join(" · ") : "No cart items"}</div>
            {(item.context?.recentMessages || []).slice(-4).map((message, index) => <p key={`${item.id}-${index}`}><b>{message.direction === "incoming" ? "Customer" : "Assistant"}:</b> {message.text}</p>)}
          </div>
          {item.history?.length > 0 && <div className="handoff-history"><strong>Status history</strong>{item.history.map((event, index) => <span key={`${item.id}-${index}`}>{event.previous_status} → {event.new_status} · {event.actor} · {formatDate(event.created_at)}</span>)}</div>}
          <div className="handoff-actions">
            <button className="button-secondary" onClick={() => onOpenConversation(item.sender_id)}>Open conversation</button>
            {item.status === "open" && <button className="button-primary" disabled={busy} onClick={() => onStatusChange(item.id, "in_progress")}>Take request</button>}
            {item.status !== "resolved" && <button className="button-secondary" disabled={busy} onClick={() => onStatusChange(item.id, "resolved")}><Check size={15} /> Mark resolved</button>}
          </div>
          <p className="fine-print">Local review queue only. This prototype does not notify or contact an employee.</p>
        </article>)}
        {!shown.length && <div className="surface handoff-empty"><EmptyState icon={Headset} title="No handoffs in this view">Requests requiring human attention will appear here when recorded by the backend.</EmptyState></div>}
      </div>
    </>
  );
}

function ActivityPage({ activity, onOpenConversation }) {
  return (
    <>
      <PageHeading eyebrow="PERSISTED MESSAGE EVENTS" title="Activity log" subtitle="Chronological outcomes reconstructed from saved API messages and responses." />
      <section className="surface data-surface">
        <div className="activity-toolbar"><span><FileClock size={18} /> {activity.length} saved message events</span><span>Duplicate retries return their prior response and do not create another activity record.</span></div>
        <ActivityRows events={activity} onOpenConversation={onOpenConversation} />
      </section>
    </>
  );
}

function App() {
  const [page, setPage] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [products, setProducts] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [handoffs, setHandoffs] = useState([]);
  const [activity, setActivity] = useState([]);
  const [health, setHealth] = useState({ online: false, database: false });
  const [selectedSender, setSelectedSender] = useState(() => localStorage.getItem("quoteflow-sender") || "");
  const [conversation, setConversation] = useState(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [lastEvent, setLastEvent] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [handoffFilter, setHandoffFilter] = useState("all");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    document.title = `${PRODUCT_NAME} | Sales Operations`;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, overviewData, conversationData, productData, quotationData, handoffData, activityData] = await Promise.all([
        request("/api/health"),
        request("/api/overview"),
        request("/api/conversations"),
        request("/api/products"),
        request("/api/quotations?page=1&pageSize=100"),
        request("/api/handoffs"),
        request("/api/activity?limit=100")
      ]);
      setHealth({ online: healthData.status === "ok", database: healthData.database === "connected" });
      setOverview(overviewData.overview);
      setConversations(conversationData.conversations);
      setProducts(productData.products);
      setQuotations(quotationData.quotations);
      setHandoffs(handoffData.handoffs);
      setActivity(activityData.activity);
    } catch (error) {
      setHealth({ online: false, database: false });
      setNotice({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshVersion]);
  useEffect(() => { localStorage.setItem("quoteflow-sender", selectedSender); }, [selectedSender]);

  useEffect(() => {
    let active = true;
    if (!selectedSender || !health.online) {
      setConversation(null);
      return () => { active = false; };
    }
    request(`/api/conversations/${encodeURIComponent(selectedSender)}`)
      .then((data) => { if (active) setConversation(data.conversation); })
      .catch((error) => { if (active) setNotice({ type: "error", text: error.message }); });
    return () => { active = false; };
  }, [selectedSender, health.online, refreshVersion]);

  const filteredConversations = useMemo(() => conversations.filter((item) =>
    `${item.sender_id} ${item.last_message || ""} ${item.state}`.toLowerCase().includes(search.toLowerCase())
  ), [conversations, search]);
  const filteredProducts = useMemo(() => products.filter((item) =>
    `${item.id} ${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search.toLowerCase())
  ), [products, search]);
  const filteredQuotations = useMemo(() => quotations.filter((item) =>
    `${item.id} ${item.enquiry_id || ""} ${item.sender_id}`.toLowerCase().includes(search.toLowerCase())
  ), [quotations, search]);
  const filteredActivity = useMemo(() => activity.filter((item) =>
    `${item.senderId} ${item.message} ${item.description} ${item.messageId}`.toLowerCase().includes(search.toLowerCase())
  ), [activity, search]);

  function navigate(nextPage) {
    setPage(nextPage);
    setSearch("");
    setMobileNavOpen(false);
  }

  function openConversation(senderId) {
    setSelectedSender(senderId);
    setPage("conversations");
    setMobileNavOpen(false);
  }

  async function sendText(text, replay = false) {
    const value = text.trim();
    if (!value || busy || !selectedSender) return;
    const event = replay && lastEvent ? lastEvent : {
      sender_id: selectedSender,
      message_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      text: value
    };
    setLastEvent(event);
    setBusy(true);
    try {
      const result = await request("/api/webhook/messages", { method: "POST", body: JSON.stringify(event) });
      setDraft("");
      setNotice({ type: "success", text: result.replayed ? "Duplicate event detected; the original saved response was returned." : "Message processed and saved by the backend." });
      setRefreshVersion((current) => current + 1);
      await refresh();
      const updated = await request(`/api/conversations/${encodeURIComponent(selectedSender)}`);
      setConversation(updated.conversation);
    } catch (error) {
      setNotice({ type: "error", text: `${error.message} The event ID is retained so you can safely retry it.` });
    } finally {
      setBusy(false);
    }
  }

  async function resetConversation() {
    if (!selectedSender || !window.confirm(`Clear ${selectedSender}'s current cart and pending preview? Message history and confirmed quotations are preserved.`)) return;
    try {
      await request(`/api/conversations/${encodeURIComponent(selectedSender)}/reset`, { method: "POST", body: JSON.stringify({}) });
      setNotice({ type: "success", text: "The active cart and preview were cleared. History and confirmed quotations remain saved." });
      setRefreshVersion((current) => current + 1);
    } catch (error) { setNotice({ type: "error", text: error.message }); }
  }

  async function updateHandoff(id, status) {
    setBusy(true);
    try {
      await request(`/api/handoffs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice({ type: "success", text: `Handoff status updated to ${status.replace("_", " ")} and recorded in its status history.` });
      setRefreshVersion((current) => current + 1);
    } catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  const pageDetails = {
    overview: ["Search conversations and activity", Search],
    conversations: ["Search sender, message or state", Search],
    catalogue: ["Search products", Search],
    quotations: ["Search quotation or customer", Search],
    handoffs: ["Search handoff queue", Search],
    activity: ["Search saved events", Search]
  };
  const currentPage = NAVIGATION.find((item) => item.id === page) || NAVIGATION[0];
  const SearchIcon = pageDetails[page][1];

  return (
    <div className="application-shell">
      <Sidebar page={page} onNavigate={navigate} openHandoffs={overview?.counts.openHandoffs || 0} online={health.online} databaseOnline={health.database} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <main className="main-area">
        <header className="top-header">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
          <div className="header-context"><span className="environment-label"><span /> LOCAL SIMULATOR</span><span className="header-separator">/</span><span>{currentPage.label}</span></div>
          <div className="header-tools">
            <label className="global-search"><SearchIcon size={16} /><span className="sr-only">Search current page</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={pageDetails[page][0]} /></label>
            <button className="button-secondary refresh-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh backend data"><RefreshCw size={16} className={loading ? "spin" : ""} /><span>Refresh</span></button>
          </div>
        </header>

        <div className="page-content">
          {notice && <div className={`notice notice-${notice.type}`} role="status"><span>{notice.type === "error" ? <AlertCircle size={17} /> : <Check size={17} />}{notice.text}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={16} /></button></div>}
          {loading && <div className="loading-banner"><span className="loading-spinner" /> Checking API and loading saved workspace data…</div>}
          {!health.online && !loading && <div className="api-error"><AlertCircle size={19} /><div><strong>Backend API is unavailable</strong><span>Start the backend service and refresh. The dashboard cannot show or save sales data until the API responds.</span></div><button className="button-secondary" onClick={() => void refresh()}>Try again</button></div>}
          {page === "overview" && <OverviewPage overview={overview} activity={filteredActivity} search={search} onNavigate={navigate} onOpenConversation={openConversation} />}
          {page === "conversations" && <ConversationsPage conversations={filteredConversations} conversation={conversation} sender={selectedSender} onSelect={setSelectedSender} onNew={setSelectedSender} busy={busy} draft={draft} setDraft={setDraft} onSend={(text) => void sendText(text)} onReset={() => void resetConversation()} lastEvent={lastEvent} onReplay={() => void sendText(lastEvent?.text || "", true)} />}
          {page === "catalogue" && <CataloguePage products={filteredProducts} search="" setSearch={setSearch} />}
          {page === "quotations" && <QuotationsPage quotations={filteredQuotations} search="" />}
          {page === "handoffs" && <HandoffsPage handoffs={handoffs.filter((item) => `${item.sender_id} ${item.reason} ${item.handoff_id}`.toLowerCase().includes(search.toLowerCase()))} filter={handoffFilter} setFilter={setHandoffFilter} onStatusChange={updateHandoff} onOpenConversation={openConversation} busy={busy} />}
          {page === "activity" && <ActivityPage activity={filteredActivity} onOpenConversation={openConversation} />}
          <footer className="page-footer"><span>{PRODUCT_NAME} · WhatsApp-style local sales prototype</span><span>Commercial values are calculated by the backend API</span></footer>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
