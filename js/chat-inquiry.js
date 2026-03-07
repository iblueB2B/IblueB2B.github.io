// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
let currentUser = null;
let currentUserProfile = null;
let currentUserRole = null; // 'buyer' or 'supplier'
let inquiry = null;
let conversation = null;
let otherParticipant = null;
let messages = [];
let messagePage = 1;
let hasMoreMessages = true;
let isLoadingMessages = false;
let selectedFiles = [];
let quoteItems = [];
let realtimeSubscriptions = [];
let typingTimeout = null;

// Get parameters from URL
const urlParams = new URLSearchParams(window.location.search);
const inquiryId = urlParams.get('id');
const supplierId = urlParams.get('supplier'); // If starting chat with specific supplier

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadUserProfile();
    
    if (!inquiryId) {
        showToast('No inquiry specified');
        setTimeout(() => window.location.href = 'my-inquiries.html', 2000);
        return;
    }
    
    await loadInquiry();
    await loadOrCreateConversation();
    await loadMessages();
    setupEventListeners();
    setupRealtimeSubscriptions();
    setupEmojiPicker();
    setupInfiniteScroll();
    markMessagesAsRead();
});

// ============================================
// AUTHENTICATION
// ============================================
async function checkAuth() {
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) {
            window.location.href = 'login.html?redirect=chat-inquiry.html?id=' + inquiryId;
            return;
        }
        currentUser = user;
    } catch (error) {
        console.error('Auth error:', error);
        window.location.href = 'login.html';
    }
}

async function loadUserProfile() {
    try {
        const { data, error } = await sb
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();
            
        if (error) throw error;
        
        currentUserProfile = data;
        currentUserRole = data.is_supplier ? 'supplier' : 'buyer';
        
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

// ============================================
// LOAD INQUIRY
// ============================================
async function loadInquiry() {
    showPanelLoading(true);
    
    try {
        const { data, error } = await sb
            .from('inquiry_requests')
            .select(`
                *,
                inquiry_items (*),
                inquiry_attachments (*),
                profiles!inquiry_requests_buyer_id_fkey (
                    id,
                    full_name,
                    business_name,
                    avatar_url,
                    is_verified
                ),
                supplier_quotes (
                    id,
                    quote_number,
                    total_amount,
                    status,
                    suppliers!inner (
                        id,
                        business_name
                    )
                )
            `)
            .eq('id', inquiryId)
            .single();
            
        if (error) throw error;
        
        inquiry = data;
        
        // Verify access
        if (currentUserRole === 'buyer' && inquiry.buyer_id !== currentUser.id) {
            showToast('You do not have access to this inquiry');
            setTimeout(() => window.location.href = 'my-inquiries.html', 2000);
            return;
        }
        
        renderInquiryDetails();
        
    } catch (error) {
        console.error('Error loading inquiry:', error);
        showToast('Failed to load inquiry');
    } finally {
        showPanelLoading(false);
    }
}

// ============================================
// CONVERSATION MANAGEMENT
// ============================================
async function loadOrCreateConversation() {
    try {
        // Determine other party
        let otherPartyId;
        if (currentUserRole === 'buyer') {
            // Buyer is viewing - need supplier context
            if (!supplierId) {
                // No specific supplier - show general inquiry chat or list
                showToast('Please select a supplier to chat with');
                return;
            }
            otherPartyId = supplierId;
        } else {
            // Supplier is viewing
            otherPartyId = inquiry.buyer_id;
        }
        
        // Check if conversation exists
        const { data: existing, error: searchError } = await sb
            .from('conversations')
            .select('*')
            .or(`and(participant_one_id.eq.${currentUser.id},participant_two_id.eq.${otherPartyId}),and(participant_one_id.eq.${otherPartyId},participant_two_id.eq.${currentUser.id})`)
            .eq('inquiry_id', inquiryId)
            .maybeSingle();
            
        if (searchError) throw searchError;
        
        if (existing) {
            conversation = existing;
        } else {
            // Create new conversation
            const { data: newConv, error: createError } = await sb
                .from('conversations')
                .insert({
                    participant_one_id: currentUser.id,
                    participant_two_id: otherPartyId,
                    inquiry_id: inquiryId,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();
                
            if (createError) throw createError;
            conversation = newConv;
        }
        
        // Load other participant details
        await loadOtherParticipant(otherPartyId);
        renderChatHeader();
        
    } catch (error) {
        console.error('Error with conversation:', error);
        showToast('Failed to load conversation');
    }
}

async function loadOtherParticipant(userId) {
    try {
        const { data, error } = await sb
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
            
        if (error) throw error;
        otherParticipant = data;
        
    } catch (error) {
        console.error('Error loading participant:', error);
    }
}

// ============================================
// LOAD MESSAGES
// ============================================
async function loadMessages(reset = true) {
    if (!conversation || isLoadingMessages) return;
    
    isLoadingMessages = true;
    
    if (reset) {
        messagePage = 1;
        hasMoreMessages = true;
        document.getElementById('messagesContainer').innerHTML = '';
    }
    
    try {
        const from = (messagePage - 1) * 30;
        const to = from + 30 - 1;
        
        const { data, error } = await sb
            .from('messages')
            .select(`
                *,
                attachments:message_attachments (*)
            `)
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .range(from, to);
            
        if (error) throw error;
        
        if (data.length < 30) {
            hasMoreMessages = false;
        }
        
        const newMessages = data.reverse();
        
        if (reset) {
            messages = newMessages;
            renderMessages(true);
        } else {
            messages = [...newMessages, ...messages];
            renderMessages(false);
        }
        
    } catch (error) {
        console.error('Error loading messages:', error);
    } finally {
        isLoadingMessages = false;
    }
}

// ============================================
// RENDER FUNCTIONS
// ============================================
function renderInquiryDetails() {
    // Update status badge
    const statusBadge = document.querySelector('.inquiry-badge');
    statusBadge.textContent = formatStatus(inquiry.status);
    statusBadge.className = `inquiry-badge ${inquiry.status}`;
    
    // Inquiry header
    document.getElementById('inquiryTitle').textContent = inquiry.title || 'Untitled Inquiry';
    document.getElementById('inquiryNumber').textContent = inquiry.inquiry_number;
    
    // Timeline dates
    document.getElementById('sentDate').textContent = formatDate(inquiry.created_at);
    
    // Update timeline based on status
    updateTimeline();
    
    // Render products
    renderProducts();
    
    // Render requirements
    renderRequirements();
    
    // Render terms
    renderTerms();
    
    // Render attachments
    renderAttachments();
    
    // Render quotes summary (if any)
    renderQuotesSummary();
    
    // Render quick actions based on user role
    renderQuickActions();
    
    // Render context banner
    renderContextBanner();
    
    // Render quick stats
    renderQuickStats();
    
    // Show content
    document.getElementById('inquiryContent').style.display = 'block';
}

function updateTimeline() {
    const quoteTimeline = document.getElementById('quoteTimeline');
    const orderTimeline = document.getElementById('orderTimeline');
    
    if (inquiry.status === 'ordered') {
        quoteTimeline.classList.add('completed');
        quoteTimeline.classList.remove('active');
        orderTimeline.classList.add('active');
        document.getElementById('orderStatus').textContent = 'Order Placed';
    } else if (inquiry.status === 'fully_quoted' || inquiry.status === 'partially_quoted') {
        quoteTimeline.classList.add('completed');
        document.getElementById('quoteStatus').textContent = 'Quotes Received';
    } else if (inquiry.status === 'expired') {
        quoteTimeline.classList.add('expired');
        document.getElementById('quoteStatus').textContent = 'Expired';
    }
}

function renderProducts() {
    const container = document.getElementById('productsList');
    const items = inquiry.inquiry_items || [];
    
    container.innerHTML = items.map(item => `
        <div class="product-item">
            <span class="product-name">${escapeHtml(item.product_name)}</span>
            <span class="product-quantity">Qty: ${item.quantity}</span>
        </div>
    `).join('');
}

function renderRequirements() {
    const container = document.getElementById('requirementsContent');
    
    if (inquiry.description) {
        container.innerHTML = escapeHtml(inquiry.description);
    } else {
        container.innerHTML = '<p class="text-muted">No additional requirements specified</p>';
    }
}

function renderTerms() {
    const container = document.getElementById('termsGrid');
    
    container.innerHTML = `
        <div class="term-row">
            <span class="term-label">Payment:</span>
            <span class="term-value">${formatPaymentTerms(inquiry.payment_terms?.[0])}</span>
        </div>
        <div class="term-row">
            <span class="term-label">Delivery:</span>
            <span class="term-value">${formatDeliveryTerms(inquiry.delivery_terms?.[0])}</span>
        </div>
        <div class="term-row">
            <span class="term-label">Location:</span>
            <span class="term-value">${escapeHtml(inquiry.shipping_district || 'Not specified')}</span>
        </div>
        <div class="term-row">
            <span class="term-label">Expires:</span>
            <span class="term-value ${isExpiring(inquiry.expires_at) ? 'text-danger' : ''}">${formatDate(inquiry.expires_at)}</span>
        </div>
    `;
}

function renderAttachments() {
    const container = document.getElementById('attachmentsList');
    const attachments = inquiry.inquiry_attachments || [];
    
    if (attachments.length === 0) {
        document.getElementById('attachmentsSection').style.display = 'none';
        return;
    }
    
    document.getElementById('attachmentsSection').style.display = 'block';
    
    container.innerHTML = attachments.map(att => `
        <a href="${att.file_url}" target="_blank" class="attachment-item">
            <i class="fas ${getFileIcon(att.file_name)}"></i>
            <span>${att.file_name}</span>
        </a>
    `).join('');
}

function renderQuotesSummary() {
    const container = document.getElementById('quotesList');
    const quotes = inquiry.supplier_quotes || [];
    
    if (quotes.length === 0 || currentUserRole === 'supplier') {
        document.getElementById('quotesSummary').style.display = 'none';
        return;
    }
    
    document.getElementById('quotesSummary').style.display = 'block';
    
    container.innerHTML = quotes.map(quote => `
        <div class="quote-mini-card">
            <div>
                <div class="quote-supplier">${escapeHtml(quote.suppliers?.business_name || 'Supplier')}</div>
                <div class="quote-amount">UGX ${formatNumber(quote.total_amount)}</div>
            </div>
            <span class="quote-status">${quote.status}</span>
        </div>
    `).join('');
}

function renderQuickActions() {
    const container = document.getElementById('quickActions');
    
    if (currentUserRole === 'buyer') {
        container.innerHTML = `
            <button class="action-btn" onclick="viewFullInquiry()">
                <i class="fas fa-external-link-alt"></i> View Full Inquiry
            </button>
            <button class="action-btn" onclick="inviteMoreSuppliers()">
                <i class="fas fa-user-plus"></i> Invite More Suppliers
            </button>
            ${inquiry.status === 'expired' ? `
                <button class="action-btn primary" onclick="resendInquiry()">
                    <i class="fas fa-redo"></i> Resend Inquiry
                </button>
            ` : ''}
        `;
    } else {
        container.innerHTML = `
            <button class="action-btn primary" onclick="showQuickQuoteModal()">
                <i class="fas fa-file-invoice"></i> Send Quote
            </button>
            <button class="action-btn" onclick="viewSupplierProducts()">
                <i class="fas fa-box"></i> My Products
            </button>
            <button class="action-btn" onclick="requestMoreInfo()">
                <i class="fas fa-question-circle"></i> Request Info
            </button>
        `;
    }
}

function renderContextBanner() {
    const banner = document.getElementById('inquiryContext');
    
    banner.innerHTML = `
        <div class="context-item">
            <i class="fas fa-hashtag"></i>
            <span><strong>Inquiry:</strong> ${inquiry.inquiry_number}</span>
        </div>
        <div class="context-item">
            <i class="fas fa-boxes"></i>
            <span><strong>Items:</strong> ${inquiry.inquiry_items?.length || 0}</span>
        </div>
        <div class="context-item">
            <i class="fas fa-clock"></i>
            <span><strong>Posted:</strong> ${moment(inquiry.created_at).fromNow()}</span>
        </div>
    `;
}

function renderQuickStats() {
    const stats = document.getElementById('quickStats');
    const totalQty = inquiry.inquiry_items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    
    stats.innerHTML = `
        <div class="stat-item">
            <div class="stat-icon">
                <i class="fas fa-boxes"></i>
            </div>
            <div class="stat-info">
                <span class="stat-value">${inquiry.inquiry_items?.length || 0}</span>
                <span class="stat-label">Products</span>
            </div>
        </div>
        <div class="stat-item">
            <div class="stat-icon">
                <i class="fas fa-weight-hanging"></i>
            </div>
            <div class="stat-info">
                <span class="stat-value">${totalQty}</span>
                <span class="stat-label">Total Qty</span>
            </div>
        </div>
        <div class="stat-item">
            <div class="stat-icon">
                <i class="fas fa-file-invoice"></i>
            </div>
            <div class="stat-info">
                <span class="stat-value">${inquiry.supplier_quotes?.length || 0}</span>
                <span class="stat-label">Quotes</span>
            </div>
        </div>
    `;
}

function renderChatHeader() {
    const header = document.getElementById('chatHeader');
    const isOnline = checkOnlineStatus(otherParticipant.last_active);
    const displayName = otherParticipant.business_name || otherParticipant.full_name || 'User';
    const initials = getInitials(displayName);
    
    header.innerHTML = `
        <div class="participant-avatar">
            ${otherParticipant.avatar_url ? 
                `<img src="${otherParticipant.avatar_url}" alt="${displayName}">` : 
                `<span>${initials}</span>`
            }
            <span class="status-indicator ${isOnline ? 'online' : ''}"></span>
        </div>
        <div class="participant-details">
            <div class="participant-name">
                ${escapeHtml(displayName)}
                ${otherParticipant.is_verified ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
            </div>
            <div class="participant-role">
                ${currentUserRole === 'buyer' ? 'Supplier' : 'Buyer'} • 
                ${isOnline ? 'Online' : 'Offline'}
            </div>
        </div>
    `;
}

function renderMessages(scrollToBottom = true) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    let currentDate = null;
    let html = '';
    
    messages.forEach(message => {
        const messageDate = new Date(message.created_at).toDateString();
        
        if (messageDate !== currentDate) {
            currentDate = messageDate;
            html += `
                <div class="message-date-divider">
                    <span class="date-divider-text">${formatMessageDate(message.created_at)}</span>
                </div>
            `;
        }
        
        const isOwn = message.sender_id === currentUser.id;
        
        html += `
            <div class="message-wrapper ${isOwn ? 'own-message' : ''}">
                <div class="message-bubble">
                    <div class="message-text">${escapeHtml(message.content)}</div>
                    ${renderMessageAttachments(message.attachments)}
                    <div class="message-time">${formatTime(message.created_at)}</div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    if (scrollToBottom) {
        scrollToBottom();
    }
}

function renderMessageAttachments(attachments) {
    if (!attachments || attachments.length === 0) return '';
    
    return attachments.map(att => {
        if (att.file_type?.startsWith('image/')) {
            return `
                <div class="message-attachment">
                    <img src="${att.file_url}" class="attachment-image" onclick="viewImage('${att.file_url}')">
                </div>
            `;
        }
        return '';
    }).join('');
}

// ============================================
// QUOTE FUNCTIONS
// ============================================
function showQuickQuoteModal() {
    const form = document.getElementById('quoteForm');
    const items = inquiry.inquiry_items || [];
    
    quoteItems = items.map(item => ({
        id: item.id,
        name: item.product_name,
        quantity: item.quantity,
        price: null
    }));
    
    form.innerHTML = quoteItems.map((item, index) => `
        <div class="quote-form-item">
            <div class="quote-item-header">
                <span class="quote-item-name">${escapeHtml(item.name)}</span>
                <span class="quote-item-qty">Qty: ${item.quantity}</span>
            </div>
            <div class="quote-price-input">
                <input type="number" 
                       id="price_${index}" 
                       placeholder="Unit price" 
                       min="0" 
                       step="100"
                       onchange="updateQuoteItemPrice(${index}, this.value)">
                <span>UGX</span>
            </div>
        </div>
    `).join('');
    
    document.getElementById('quickQuoteModal').classList.add('show');
}

window.updateQuoteItemPrice = function(index, price) {
    if (quoteItems[index]) {
        quoteItems[index].price = parseFloat(price) || null;
    }
};

async function sendQuote() {
    // Validate all items have prices
    const missingPrices = quoteItems.filter(item => !item.price);
    if (missingPrices.length > 0) {
        showToast('Please enter prices for all items');
        return;
    }
    
    try {
        const total = quoteItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const quoteNumber = 'QTE-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 7); // Valid for 7 days
        
        // Create quote
        const { data: quote, error: quoteError } = await sb
            .from('supplier_quotes')
            .insert({
                quote_number: quoteNumber,
                inquiry_id: inquiryId,
                supplier_id: currentUser.id,
                valid_until: validUntil.toISOString(),
                status: 'sent',
                total_amount: total,
                currency: 'UGX'
            })
            .select()
            .single();
            
        if (quoteError) throw quoteError;
        
        // Create quote items
        const quoteItemsData = quoteItems.map(item => ({
            supplier_quote_id: quote.id,
            inquiry_item_id: item.id,
            product_name: item.name,
            unit_price: item.price,
            quantity: item.quantity,
            total_price: item.price * item.quantity
        }));
        
        const { error: itemsError } = await sb
            .from('supplier_quote_items')
            .insert(quoteItemsData);
            
        if (itemsError) throw itemsError;
        
        // Send confirmation message
        const message = `📄 I've sent a quotation for this inquiry. Total amount: UGX ${formatNumber(total)}. Valid until ${formatDate(validUntil)}.`;
        
        await sb
            .from('messages')
            .insert({
                conversation_id: conversation.id,
                sender_id: currentUser.id,
                receiver_id: otherParticipant.id,
                content: message,
                quote_id: quote.id,
                message_type: 'quote',
                created_at: new Date().toISOString()
            });
        
        closeQuickQuoteModal();
        showSuccess('Quote sent successfully!');
        
        // Refresh messages
        await loadMessages(true);
        
    } catch (error) {
        console.error('Error sending quote:', error);
        showToast('Failed to send quote');
    }
}

// ============================================
// INFO REQUEST FUNCTIONS
// ============================================
window.requestInfo = function(type) {
    let message = '';
    
    switch(type) {
        case 'pricing':
            message = 'Could you please provide detailed pricing for these items?';
            break;
        case 'specs':
            message = 'Could you share detailed specifications for these products?';
            break;
        case 'samples':
            message = 'Do you offer samples before placing a bulk order?';
            break;
        case 'certification':
            message = 'Do you have quality certifications for these products?';
            break;
        case 'leadtime':
            message = 'What is the typical lead time for this order?';
            break;
        case 'moq':
            message = 'Could you clarify the minimum order quantities?';
            break;
    }
    
    document.getElementById('messageInput').value = message;
    closeRequestInfoModal();
    checkSendButton();
};

function sendInfoRequest() {
    const customMessage = document.getElementById('customRequest').value;
    if (customMessage) {
        document.getElementById('messageInput').value = customMessage;
    }
    closeRequestInfoModal();
    checkSendButton();
}

// ============================================
// SUGGEST PRODUCT FUNCTIONS
// ============================================
async function searchProducts(query) {
    if (!query || query.length < 2) return;
    
    try {
        const { data, error } = await sb
            .from('ads')
            .select('id, title, price, image_urls')
            .eq('seller_id', currentUser.id)
            .ilike('title', `%${query}%`)
            .limit(5);
            
        if (error) throw error;
        
        renderProductResults(data || []);
        
    } catch (error) {
        console.error('Error searching products:', error);
    }
}

function renderProductResults(products) {
    const container = document.getElementById('productResults');
    
    if (products.length === 0) {
        container.innerHTML = '<p class="text-muted">No products found</p>';
        return;
    }
    
    container.innerHTML = products.map(product => `
        <div class="product-result-item" onclick="selectProduct(${product.id})">
            <div class="product-result-image">
                ${product.image_urls?.[0] ? 
                    `<img src="${product.image_urls[0]}" alt="${escapeHtml(product.title)}">` : 
                    '<i class="fas fa-box"></i>'
                }
            </div>
            <div class="product-result-info">
                <div class="product-result-title">${escapeHtml(product.title)}</div>
                <div class="product-result-price">UGX ${formatNumber(product.price)}</div>
            </div>
        </div>
    `).join('');
}

window.selectProduct = function(productId) {
    // Store selected product
    window.selectedProductId = productId;
};

async function sendProductSuggestion() {
    const message = document.getElementById('suggestMessage').value;
    const productId = window.selectedProductId;
    
    if (!productId) {
        showToast('Please select a product');
        return;
    }
    
    try {
        const { data: product } = await sb
            .from('ads')
            .select('title, price')
            .eq('id', productId)
            .single();
        
        const suggestionMessage = `📦 I'd like to suggest an alternative product: ${product.title} (UGX ${formatNumber(product.price)})\n\n${message}`;
        
        document.getElementById('messageInput').value = suggestionMessage;
        closeSuggestProductModal();
        checkSendButton();
        
    } catch (error) {
        console.error('Error getting product:', error);
        showToast('Failed to get product details');
    }
}

// ============================================
// MESSAGE FUNCTIONS
// ============================================
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    
    if (!content && selectedFiles.length === 0) return;
    
    try {
        input.disabled = true;
        document.getElementById('sendMessageBtn').disabled = true;
        
        const { data: message, error } = await sb
            .from('messages')
            .insert({
                conversation_id: conversation.id,
                sender_id: currentUser.id,
                receiver_id: otherParticipant.id,
                inquiry_id: inquiryId,
                content: content,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        
        if (selectedFiles.length > 0) {
            await uploadAttachments(message.id);
        }
        
        await sb
            .from('conversations')
            .update({
                last_message_id: message.id,
                last_message_at: new Date().toISOString(),
                last_message_preview: truncate(content, 50)
            })
            .eq('id', conversation.id);
        
        input.value = '';
        input.style.height = 'auto';
        clearAttachments();
        
        messages.push(message);
        renderMessages(true);
        
        input.disabled = false;
        
    } catch (error) {
        console.error('Error sending message:', error);
        showToast('Failed to send message');
        input.disabled = false;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function showPanelLoading(show) {
    document.getElementById('panelLoading').style.display = show ? 'flex' : 'none';
    document.getElementById('inquiryContent').style.display = show ? 'none' : 'block';
}

function checkSendButton() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendMessageBtn');
    sendBtn.disabled = !input.value.trim() && selectedFiles.length === 0;
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

function checkOnlineStatus(lastActive) {
    if (!lastActive) return false;
    const now = new Date();
    const last = new Date(lastActive);
    const diffMinutes = (now - last) / (1000 * 60);
    return diffMinutes < 5;
}

function formatStatus(status) {
    const statusMap = {
        'draft': 'Draft',
        'sent': 'Pending',
        'fully_quoted': 'Quotes Received',
        'partially_quoted': 'Partial Quotes',
        'ordered': 'Order Placed',
        'expired': 'Expired',
        'cancelled': 'Cancelled'
    };
    return statusMap[status] || status;
}

function formatPaymentTerms(term) {
    const terms = {
        'advance_full': '100% Advance',
        'advance_partial': '50% Advance',
        'credit_7': '7 Days Credit',
        'credit_15': '15 Days Credit',
        'credit_30': '30 Days Credit',
        'negotiable': 'Negotiable'
    };
    return terms[term] || term || 'Not specified';
}

function formatDeliveryTerms(term) {
    const terms = {
        'ex_warehouse': 'Ex-Warehouse',
        'fob': 'FOB',
        'cif': 'CIF',
        'door_delivery': 'Door Delivery',
        'pickup': 'Buyer Pickup'
    };
    return terms[term] || term || 'Not specified';
}

function isExpiring(dateString) {
    if (!dateString) return false;
    const expiry = new Date(dateString);
    const now = new Date();
    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return diffDays <= 3;
}

function formatDate(dateString) {
    return moment(dateString).format('MMM D, YYYY');
}

function formatMessageDate(timestamp) {
    const date = moment(timestamp);
    const now = moment();
    
    if (date.isSame(now, 'day')) return 'Today';
    if (date.isSame(now.subtract(1, 'day'), 'day')) return 'Yesterday';
    return date.format('MMMM D, YYYY');
}

function formatTime(timestamp) {
    return moment(timestamp).format('h:mm A');
}

function formatNumber(num) {
    return num?.toLocaleString('en-UG') || '0';
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word',
        'docx': 'fa-file-word',
        'xls': 'fa-file-excel',
        'xlsx': 'fa-file-excel',
        'jpg': 'fa-file-image',
        'jpeg': 'fa-file-image',
        'png': 'fa-file-image'
    };
    return icons[ext] || 'fa-file';
}

function truncate(str, length) {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function showSuccess(message) {
    document.getElementById('successMessage').textContent = message;
    document.getElementById('successModal').classList.add('show');
}

// ============================================
// MODAL FUNCTIONS
// ============================================
window.togglePanel = function() {
    document.querySelector('.inquiry-panel').classList.toggle('collapsed');
    const btn = document.getElementById('collapsePanel');
    btn.innerHTML = document.querySelector('.inquiry-panel').classList.contains('collapsed') ? 
        '<i class="fas fa-chevron-right"></i>' : '<i class="fas fa-chevron-left"></i>';
};

window.showQuickQuoteModal = showQuickQuoteModal;
window.closeQuickQuoteModal = () => document.getElementById('quickQuoteModal').classList.remove('show');
window.closeRequestInfoModal = () => document.getElementById('requestInfoModal').classList.remove('show');
window.closeSuggestProductModal = () => document.getElementById('suggestProductModal').classList.remove('show');
window.closeMenuModal = () => document.getElementById('menuModal').classList.remove('show');
window.closeTemplatesModal = () => document.getElementById('templatesModal').classList.remove('show');
window.closeImageViewModal = () => document.getElementById('imageViewModal').classList.remove('show');
window.closeSuccessModal = () => document.getElementById('successModal').classList.remove('show');

window.requestInfo = requestInfo;
window.sendInfoRequest = sendInfoRequest;
window.sendProductSuggestion = sendProductSuggestion;
window.viewImage = (url) => {
    document.getElementById('fullSizeImage').src = url;
    document.getElementById('imageViewModal').classList.add('show');
};

window.autoResize = function(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
    checkSendButton();
};

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    document.getElementById('menuBtn')?.addEventListener('click', () => {
        document.getElementById('menuModal').classList.add('show');
    });
    
    document.getElementById('messageInput')?.addEventListener('input', checkSendButton);
    document.getElementById('messageInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    document.getElementById('sendMessageBtn')?.addEventListener('click', sendMessage);
    
    document.getElementById('quickQuoteBtn')?.addEventListener('click', showQuickQuoteModal);
    document.getElementById('requestInfoBtn')?.addEventListener('click', () => {
        document.getElementById('requestInfoModal').classList.add('show');
    });
    document.getElementById('suggestProductBtn')?.addEventListener('click', () => {
        document.getElementById('suggestProductModal').classList.add('show');
    });
    
    document.getElementById('sendQuoteBtn')?.addEventListener('click', sendQuote);
    
    document.getElementById('productSearch')?.addEventListener('input', (e) => {
        searchProducts(e.target.value);
    });
    
    document.getElementById('sendSuggestionBtn')?.addEventListener('click', sendProductSuggestion);
    
    document.getElementById('collapsePanel')?.addEventListener('click', togglePanel);
    
    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeQuickQuoteModal();
                closeRequestInfoModal();
                closeSuggestProductModal();
                closeMenuModal();
                closeTemplatesModal();
                closeImageViewModal();
                closeSuccessModal();
            }
        });
    });
}

function setupEmojiPicker() {
    // Emoji picker implementation (similar to chat.js)
}

function setupInfiniteScroll() {
    const container = document.getElementById('messagesContainer');
    container.addEventListener('scroll', () => {
        if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMessages) {
            messagePage++;
            loadMessages(false);
        }
    });
}

function setupRealtimeSubscriptions() {
    if (!conversation) return;
    
    const messagesChannel = sb
        .channel('inquiry-messages-' + conversation.id)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `conversation_id=eq.${conversation.id}`
            },
            async (payload) => {
                const { data: message } = await sb
                    .from('messages')
                    .select('*, attachments:message_attachments(*)')
                    .eq('id', payload.new.id)
                    .single();
                    
                messages.push(message);
                renderMessages(true);
                
                if (message.sender_id !== currentUser.id) {
                    markMessagesAsRead();
                }
            }
        )
        .subscribe();
    
    realtimeSubscriptions.push(messagesChannel);
}

async function markMessagesAsRead() {
    // Implementation similar to chat.js
}

// Cleanup
window.addEventListener('beforeunload', () => {
    realtimeSubscriptions.forEach(sub => sub.unsubscribe());
});

// Make functions globally available
window.sendMessage = sendMessage;
window.requestInfo = requestInfo;
window.sendInfoRequest = sendInfoRequest;
window.sendProductSuggestion = sendProductSuggestion;
window.viewImage = viewImage;
window.updateQuoteItemPrice = updateQuoteItemPrice;
window.selectProduct = selectProduct;

