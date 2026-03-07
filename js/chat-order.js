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
let order = null;
let conversation = null;
let otherParticipant = null;
let messages = [];
let messagePage = 1;
let hasMoreMessages = true;
let isLoadingMessages = false;
let selectedFiles = [];
let realtimeSubscriptions = [];
let typingTimeout = null;
let trackingEvents = [];

// Get parameters from URL
const urlParams = new URLSearchParams(window.location.search);
const orderId = urlParams.get('id');

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadUserProfile();
    
    if (!orderId) {
        showToast('No order specified');
        setTimeout(() => window.location.href = 'orders.html', 2000);
        return;
    }
    
    await loadOrder();
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
            window.location.href = 'login.html?redirect=chat-order.html?id=' + orderId;
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
// LOAD ORDER
// ============================================
async function loadOrder() {
    showPanelLoading(true);
    
    try {
        const { data, error } = await sb
            .from('orders')
            .select(`
                *,
                buyer:profiles!orders_buyer_id_fkey (
                    id,
                    full_name,
                    business_name,
                    avatar_url,
                    is_verified,
                    phone,
                    email
                ),
                supplier:suppliers!orders_supplier_id_fkey (
                    id,
                    business_name,
                    verification_status,
                    profiles!suppliers_profile_id_fkey (
                        full_name,
                        avatar_url,
                        is_verified
                    )
                ),
                order_items (*),
                delivery_tracking (*),
                inquiry_requests!orders_inquiry_id_fkey (
                    id,
                    inquiry_number
                ),
                supplier_quotes!orders_original_quote_id_fkey (
                    id,
                    quote_number
                )
            `)
            .eq('id', orderId)
            .single();
            
        if (error) throw error;
        
        order = data;
        
        // Determine other party
        if (currentUserRole === 'buyer') {
            otherParticipant = order.supplier?.profiles || order.supplier;
        } else {
            otherParticipant = order.buyer;
        }
        
        // Verify access
        if (currentUserRole === 'buyer' && order.buyer_id !== currentUser.id) {
            showToast('You do not have access to this order');
            setTimeout(() => window.location.href = 'orders.html', 2000);
            return;
        }
        
        if (currentUserRole === 'supplier' && order.supplier_id !== currentUser.id) {
            showToast('You do not have access to this order');
            setTimeout(() => window.location.href = 'supplier-orders.html', 2000);
            return;
        }
        
        // Load tracking events
        trackingEvents = order.delivery_tracking || [];
        
        renderOrderDetails();
        
    } catch (error) {
        console.error('Error loading order:', error);
        showToast('Failed to load order');
    } finally {
        showPanelLoading(false);
    }
}

// ============================================
// CONVERSATION MANAGEMENT
// ============================================
async function loadOrCreateConversation() {
    try {
        // Determine other party ID
        const otherPartyId = currentUserRole === 'buyer' ? order.supplier_id : order.buyer_id;
        
        // Check if conversation exists
        const { data: existing, error: searchError } = await sb
            .from('conversations')
            .select('*')
            .or(`and(participant_one_id.eq.${currentUser.id},participant_two_id.eq.${otherPartyId}),and(participant_one_id.eq.${otherPartyId},participant_two_id.eq.${currentUser.id})`)
            .eq('order_id', orderId)
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
                    order_id: orderId,
                    inquiry_id: order.inquiry_id,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();
                
            if (createError) throw createError;
            conversation = newConv;
        }
        
        renderChatHeader();
        
    } catch (error) {
        console.error('Error with conversation:', error);
        showToast('Failed to load conversation');
    }
}

// ============================================
// RENDER FUNCTIONS
// ============================================
function renderOrderDetails() {
    // Update status badge
    const statusBadge = document.querySelector('.order-badge');
    statusBadge.textContent = formatStatus(order.status);
    statusBadge.className = `order-badge ${order.status}`;
    
    // Order number and date
    document.getElementById('orderNumber').textContent = order.order_number || 'N/A';
    document.getElementById('orderDate').textContent = `Placed: ${formatDate(order.created_at)}`;
    
    // Party info
    renderPartyInfo();
    
    // Amount
    document.getElementById('orderAmount').textContent = `UGX ${formatNumber(order.total_amount)}`;
    document.getElementById('paymentStatus').textContent = `Payment: ${formatPaymentStatus(order.payment_status)}`;
    
    // Tracking section
    renderTrackingSection();
    
    // Items
    renderItems();
    
    // Shipping details
    renderShippingDetails();
    
    // Payment details
    renderPaymentDetails();
    
    // Timeline
    renderTimeline();
    
    // Order actions
    renderOrderActions();
    
    // Context banner and tracking bar
    renderContextBanner();
    renderTrackingBar();
    
    // Show content
    document.getElementById('orderContent').style.display = 'block';
}

function renderPartyInfo() {
    const container = document.getElementById('partyInfo');
    const party = currentUserRole === 'buyer' ? order.supplier : order.buyer;
    const role = currentUserRole === 'buyer' ? 'Supplier' : 'Buyer';
    const name = party?.business_name || party?.full_name || 'User';
    const initials = getInitials(name);
    const avatarUrl = party?.avatar_url || party?.profiles?.avatar_url;
    
    container.innerHTML = `
        <div class="party-avatar">
            ${avatarUrl ? 
                `<img src="${avatarUrl}" alt="${name}">` : 
                `<span>${initials}</span>`
            }
        </div>
        <div class="party-details">
            <div class="party-name">
                ${escapeHtml(name)}
                ${party?.is_verified ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
            </div>
            <div class="party-role">${role}</div>
        </div>
    `;
}

function renderTrackingSection() {
    const container = document.getElementById('trackingInfo');
    
    if (order.tracking_number) {
        container.innerHTML = `
            <div class="tracking-row">
                <span class="tracking-label">Tracking #:</span>
                <span class="tracking-value">
                    ${order.tracking_number}
                    ${order.tracking_url ? `<a href="${order.tracking_url}" target="_blank">Track</a>` : ''}
                </span>
            </div>
            <div class="tracking-row">
                <span class="tracking-label">Carrier:</span>
                <span class="tracking-value">${order.carrier || 'Not specified'}</span>
            </div>
            ${order.estimated_delivery ? `
            <div class="tracking-row">
                <span class="tracking-label">Est. Delivery:</span>
                <span class="tracking-value">${formatDate(order.estimated_delivery)}</span>
            </div>
            ` : ''}
        `;
    } else {
        container.innerHTML = '<p class="text-muted">No tracking information available yet</p>';
    }
    
    // Render tracking timeline
    renderTrackingTimeline();
}

function renderTrackingTimeline() {
    const container = document.getElementById('trackingTimeline');
    
    if (trackingEvents.length === 0) {
        container.innerHTML = '<p class="text-muted">No tracking events yet</p>';
        return;
    }
    
    container.innerHTML = trackingEvents.map(event => `
        <div class="timeline-event">
            <div class="event-icon">
                <i class="fas ${getTrackingIcon(event.status)}"></i>
            </div>
            <div class="event-details">
                <div class="event-status">${event.status}</div>
                <div class="event-location">${event.location || ''}</div>
                <div class="event-time">${formatDateTime(event.created_at)}</div>
                ${event.description ? `<div class="event-description">${escapeHtml(event.description)}</div>` : ''}
            </div>
        </div>
    `).join('');
}

function renderItems() {
    const container = document.getElementById('itemsList');
    const items = order.order_items || [];
    
    container.innerHTML = items.map(item => `
        <div class="item-row">
            <div class="item-info">
                <div class="item-name">${escapeHtml(item.product_title)}</div>
                ${item.product_sku ? `<div class="item-sku">SKU: ${item.product_sku}</div>` : ''}
            </div>
            <div class="item-quantity">x${item.quantity}</div>
            <div class="item-price">
                UGX ${formatNumber(item.unit_price)}
                <small>UGX ${formatNumber(item.total_price)}</small>
            </div>
        </div>
    `).join('');
}

function renderShippingDetails() {
    const container = document.getElementById('shippingDetails');
    
    container.innerHTML = `
        <div class="shipping-row">
            <span class="shipping-label">Address:</span>
            <span class="shipping-value">${escapeHtml(order.delivery_address || 'Not specified')}</span>
        </div>
        <div class="shipping-row">
            <span class="shipping-label">District:</span>
            <span class="shipping-value">${escapeHtml(order.delivery_district || 'Not specified')}</span>
        </div>
        <div class="shipping-row">
            <span class="shipping-label">Contact:</span>
            <span class="shipping-value">${escapeHtml(order.delivery_contact_name || '')} ${order.delivery_contact_phone ? `(${order.delivery_contact_phone})` : ''}</span>
        </div>
        <div class="shipping-row">
            <span class="shipping-label">Method:</span>
            <span class="shipping-value">${order.delivery_method || 'Standard'}</span>
        </div>
    `;
}

function renderPaymentDetails() {
    const container = document.getElementById('paymentDetails');
    
    container.innerHTML = `
        <div class="payment-row">
            <span class="payment-label">Method:</span>
            <span class="payment-value">${formatPaymentMethod(order.payment_method)}</span>
        </div>
        <div class="payment-row">
            <span class="payment-label">Status:</span>
            <span class="payment-value">${formatPaymentStatus(order.payment_status)}</span>
        </div>
        ${order.transaction_id ? `
        <div class="payment-row">
            <span class="payment-label">Transaction:</span>
            <span class="payment-value">${order.transaction_id}</span>
        </div>
        ` : ''}
        ${order.paid_at ? `
        <div class="payment-row">
            <span class="payment-label">Paid on:</span>
            <span class="payment-value">${formatDateTime(order.paid_at)}</span>
        </div>
        ` : ''}
    `;
}

function renderTimeline() {
    const container = document.getElementById('orderTimeline');
    
    const timelineEvents = [
        {
            status: 'Order Placed',
            date: order.created_at,
            completed: true
        },
        {
            status: 'Confirmed',
            date: order.confirmed_at,
            completed: order.status !== 'pending'
        },
        {
            status: 'Processing',
            date: order.processing_at,
            completed: ['processing', 'shipped', 'delivered'].includes(order.status)
        },
        {
            status: 'Shipped',
            date: order.shipped_at,
            completed: ['shipped', 'delivered'].includes(order.status)
        },
        {
            status: 'Delivered',
            date: order.delivered_at,
            completed: order.status === 'delivered'
        }
    ];
    
    container.innerHTML = timelineEvents.map((event, index) => {
        const isActive = index === timelineEvents.findIndex(e => !e.completed);
        
        return `
            <div class="timeline-item ${event.completed ? 'completed' : ''} ${isActive ? 'active' : ''}">
                <div class="timeline-marker">
                    ${event.completed ? '<i class="fas fa-check"></i>' : ''}
                </div>
                <div class="timeline-content">
                    <div class="timeline-title">${event.status}</div>
                    <div class="timeline-date">${event.date ? formatDate(event.date) : 'Pending'}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderOrderActions() {
    const container = document.getElementById('orderActions');
    
    if (currentUserRole === 'buyer') {
        if (order.status === 'pending' || order.status === 'pending_payment') {
            container.innerHTML = `
                <button class="action-btn primary" onclick="showPaymentProofModal()">
                    <i class="fas fa-credit-card"></i> Upload Payment Proof
                </button>
                <button class="action-btn" onclick="requestCancellation()">
                    <i class="fas fa-times-circle"></i> Request Cancellation
                </button>
            `;
        } else if (order.status === 'shipped') {
            container.innerHTML = `
                <button class="action-btn success" onclick="showConfirmDeliveryModal()">
                    <i class="fas fa-check-circle"></i> Confirm Delivery
                </button>
                <button class="action-btn" onclick="trackPackage()">
                    <i class="fas fa-truck"></i> Track Package
                </button>
            `;
        } else if (order.status === 'delivered') {
            container.innerHTML = `
                <button class="action-btn" onclick="leaveReview()">
                    <i class="fas fa-star"></i> Leave Review
                </button>
                <button class="action-btn" onclick="requestReturn()">
                    <i class="fas fa-undo"></i> Request Return
                </button>
            `;
        }
    } else {
        // Supplier view
        if (order.status === 'pending' || order.status === 'pending_payment') {
            container.innerHTML = `
                <button class="action-btn primary" onclick="confirmOrder()">
                    <i class="fas fa-check"></i> Confirm Order
                </button>
                <button class="action-btn" onclick="showTrackingModal()">
                    <i class="fas fa-truck"></i> Add Tracking
                </button>
            `;
        } else if (order.status === 'confirmed') {
            container.innerHTML = `
                <button class="action-btn primary" onclick="processOrder()">
                    <i class="fas fa-cog"></i> Start Processing
                </button>
                <button class="action-btn" onclick="showTrackingModal()">
                    <i class="fas fa-truck"></i> Add Tracking
                </button>
            `;
        } else if (order.status === 'processing') {
            container.innerHTML = `
                <button class="action-btn primary" onclick="markShipped()">
                    <i class="fas fa-truck"></i> Mark as Shipped
                </button>
                <button class="action-btn" onclick="showTrackingModal()">
                    <i class="fas fa-edit"></i> Update Tracking
                </button>
            `;
        } else if (order.status === 'shipped') {
            container.innerHTML = `
                <button class="action-btn" onclick="showTrackingModal()">
                    <i class="fas fa-edit"></i> Update Tracking
                </button>
                <button class="action-btn" onclick="contactBuyer()">
                    <i class="fas fa-comment"></i> Contact Buyer
                </button>
            `;
        }
    }
    
    // Add common actions
    container.innerHTML += `
        <button class="action-btn" onclick="downloadInvoice()">
            <i class="fas fa-file-invoice"></i> Download Invoice
        </button>
    `;
}

function renderContextBanner() {
    const banner = document.getElementById('orderContext');
    
    banner.innerHTML = `
        <div class="context-item">
            <i class="fas fa-hashtag"></i>
            <span><strong>Order:</strong> ${order.order_number}</span>
        </div>
        <div class="context-item">
            <i class="fas fa-calendar"></i>
            <span><strong>Placed:</strong> ${formatDate(order.created_at)}</span>
        </div>
        <div class="context-item">
            <i class="fas fa-boxes"></i>
            <span><strong>Items:</strong> ${order.order_items?.length || 0}</span>
        </div>
        <div class="context-item">
            <i class="fas fa-credit-card"></i>
            <span><strong>Payment:</strong> ${formatPaymentStatus(order.payment_status)}</span>
        </div>
    `;
}

function renderTrackingBar() {
    const bar = document.getElementById('orderTrackingBar');
    
    const steps = [
        { label: 'Ordered', completed: true },
        { label: 'Confirmed', completed: order.status !== 'pending' },
        { label: 'Processing', completed: ['processing', 'shipped', 'delivered'].includes(order.status) },
        { label: 'Shipped', completed: ['shipped', 'delivered'].includes(order.status) },
        { label: 'Delivered', completed: order.status === 'delivered' }
    ];
    
    bar.innerHTML = `
        <div class="tracking-steps">
            ${steps.map((step, index) => `
                <div class="tracking-step ${step.completed ? 'completed' : ''} ${index === steps.findIndex(s => !s.completed) ? 'active' : ''}">
                    <span class="tracking-dot"></span>
                    <span>${step.label}</span>
                </div>
                ${index < steps.length - 1 ? '<i class="fas fa-chevron-right tracking-arrow"></i>' : ''}
            `).join('')}
        </div>
        <div class="tracking-info">
            ${order.tracking_number ? `
                <span class="tracking-number">
                    <i class="fas fa-box"></i> ${order.tracking_number}
                </span>
            ` : ''}
        </div>
    `;
}

function renderChatHeader() {
    const header = document.getElementById('chatHeader');
    const isOnline = checkOnlineStatus(otherParticipant?.last_active);
    const name = otherParticipant?.business_name || otherParticipant?.full_name || 'User';
    const initials = getInitials(name);
    
    header.innerHTML = `
        <div class="participant-avatar">
            ${otherParticipant?.avatar_url ? 
                `<img src="${otherParticipant.avatar_url}" alt="${name}">` : 
                `<span>${initials}</span>`
            }
            <span class="status-indicator ${isOnline ? 'online' : ''}"></span>
        </div>
        <div class="participant-details">
            <div class="participant-name">
                ${escapeHtml(name)}
                ${otherParticipant?.is_verified ? '<i class="fas fa-check-circle verified-badge"></i>' : ''}
            </div>
            <div class="participant-role">
                ${currentUserRole === 'buyer' ? 'Supplier' : 'Buyer'} • 
                ${isOnline ? 'Online' : 'Offline'}
            </div>
        </div>
    `;
}

// ============================================
// MESSAGE FUNCTIONS
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
                    ${message.order_id ? renderOrderReference(message) : ''}
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

function renderOrderReference(message) {
    return `
        <div class="message-order-ref">
            <i class="fas fa-clipboard-list"></i> Order referenced
        </div>
    `;
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
                order_id: orderId,
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
// TRACKING FUNCTIONS
// ============================================
function showTrackingModal() {
    // Pre-fill with existing data if available
    if (order.tracking_number) {
        document.getElementById('trackingNumber').value = order.tracking_number || '';
        document.getElementById('carrier').value = order.carrier || '';
        document.getElementById('trackingUrl').value = order.tracking_url || '';
        document.getElementById('estimatedDelivery').value = order.estimated_delivery || '';
    }
    
    document.getElementById('trackingModal').classList.add('show');
}

async function updateTracking() {
    const trackingNumber = document.getElementById('trackingNumber').value;
    const carrier = document.getElementById('carrier').value;
    const trackingUrl = document.getElementById('trackingUrl').value;
    const estimatedDelivery = document.getElementById('estimatedDelivery').value;
    const notes = document.getElementById('trackingNotes').value;
    
    if (!trackingNumber) {
        showToast('Please enter tracking number');
        return;
    }
    
    try {
        // Update order with tracking info
        const { error: updateError } = await sb
            .from('orders')
            .update({
                tracking_number: trackingNumber,
                carrier: carrier,
                tracking_url: trackingUrl,
                estimated_delivery: estimatedDelivery || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
            
        if (updateError) throw updateError;
        
        // Add tracking event
        const { error: eventError } = await sb
            .from('delivery_tracking')
            .insert({
                order_id: orderId,
                status: 'Shipped',
                location: '',
                description: notes || `Tracking number: ${trackingNumber}`,
                created_at: new Date().toISOString()
            });
            
        if (eventError) throw eventError;
        
        // Send notification message
        const message = `📦 Tracking information added: ${trackingNumber}${carrier ? ` via ${carrier}` : ''}. You can track at: ${trackingUrl || 'Check carrier website'}`;
        
        document.getElementById('messageInput').value = message;
        closeTrackingModal();
        await sendMessage();
        
        // Refresh order data
        await loadOrder();
        
        showToast('Tracking information updated');
        
    } catch (error) {
        console.error('Error updating tracking:', error);
        showToast('Failed to update tracking');
    }
}

// ============================================
// DELIVERY CONFIRMATION
// ============================================
function showConfirmDeliveryModal() {
    document.getElementById('confirmDeliveryModal').classList.add('show');
}

async function confirmDelivery() {
    const itemsDamaged = document.getElementById('itemsDamaged')?.checked || false;
    const itemsMissing = document.getElementById('itemsMissing')?.checked || false;
    const itemsWrong = document.getElementById('itemsWrong')?.checked || false;
    const notes = document.getElementById('deliveryNotes')?.value;
    
    const hasIssues = itemsDamaged || itemsMissing || itemsWrong;
    
    try {
        // Update order status
        const { error: updateError } = await sb
            .from('orders')
            .update({
                status: hasIssues ? 'disputed' : 'delivered',
                delivered_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
            
        if (updateError) throw updateError;
        
        // Add delivery event
        await sb
            .from('delivery_tracking')
            .insert({
                order_id: orderId,
                status: hasIssues ? 'Delivery Issue Reported' : 'Delivered',
                location: '',
                description: notes || (hasIssues ? 'Issues reported with delivery' : 'Order delivered successfully'),
                created_at: new Date().toISOString()
            });
        
        // Send message
        let message = hasIssues ? 
            `⚠️ Delivery completed with issues: ${itemsDamaged ? 'Damaged items, ' : ''}${itemsMissing ? 'Missing items, ' : ''}${itemsWrong ? 'Wrong items' : ''}` :
            '✅ Order delivered successfully!';
            
        if (notes) message += `\n\nNotes: ${notes}`;
        
        document.getElementById('messageInput').value = message;
        closeConfirmDeliveryModal();
        await sendMessage();
        
        // Refresh order data
        await loadOrder();
        
        showToast(hasIssues ? 'Issues reported' : 'Delivery confirmed');
        
    } catch (error) {
        console.error('Error confirming delivery:', error);
        showToast('Failed to confirm delivery');
    }
}

// ============================================
// ISSUE REPORTING
// ============================================
function showReportIssueModal() {
    document.getElementById('reportIssueModal').classList.add('show');
}

async function reportIssue() {
    const issueType = document.querySelector('input[name="issueType"]:checked')?.value;
    const details = document.getElementById('issueDetails').value;
    const files = document.getElementById('issueFiles').files;
    
    if (!issueType || !details) {
        showToast('Please select issue type and provide details');
        return;
    }
    
    try {
        // Update order status to disputed
        await sb
            .from('orders')
            .update({
                status: 'disputed',
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        
        // Upload files if any
        let fileUrls = [];
        if (files.length > 0) {
            for (const file of files) {
                const filePath = `issues/${orderId}/${Date.now()}_${file.name}`;
                const { error: uploadError } = await sb
                    .storage
                    .from('issue-attachments')
                    .upload(filePath, file);
                    
                if (!uploadError) {
                    const { data: urlData } = sb
                        .storage
                        .from('issue-attachments')
                        .getPublicUrl(filePath);
                    fileUrls.push(urlData.publicUrl);
                }
            }
        }
        
        // Send message
        let message = `⚠️ Issue reported: ${issueType}\n\nDetails: ${details}`;
        if (fileUrls.length > 0) {
            message += `\n\n[${fileUrls.length} photo(s) attached]`;
        }
        
        document.getElementById('messageInput').value = message;
        closeReportIssueModal();
        await sendMessage();
        
        // Refresh order data
        await loadOrder();
        
        showToast('Issue reported successfully');
        
    } catch (error) {
        console.error('Error reporting issue:', error);
        showToast('Failed to report issue');
    }
}

// ============================================
// PAYMENT PROOF
// ============================================
function showPaymentProofModal() {
    document.getElementById('paymentProofModal').classList.add('show');
}

async function uploadPaymentProof() {
    const paymentMethod = document.getElementById('paymentMethod').value;
    const transactionId = document.getElementById('transactionId').value;
    const file = document.getElementById('paymentFile').files[0];
    
    if (!paymentMethod || !transactionId || !file) {
        showToast('Please fill all fields and upload proof');
        return;
    }
    
    try {
        // Upload file
        const filePath = `payments/${orderId}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await sb
            .storage
            .from('payment-proofs')
            .upload(filePath, file);
            
        if (uploadError) throw uploadError;
        
        const { data: urlData } = sb
            .storage
            .from('payment-proofs')
            .getPublicUrl(filePath);
        
        // Update order
        await sb
            .from('orders')
            .update({
                payment_method: paymentMethod,
                transaction_id: transactionId,
                payment_proof_url: urlData.publicUrl,
                payment_status: 'payment_verifying',
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        
        // Send message
        const message = `💰 Payment proof uploaded for ${paymentMethod}. Transaction ID: ${transactionId}`;
        
        document.getElementById('messageInput').value = message;
        closePaymentProofModal();
        await sendMessage();
        
        // Refresh order data
        await loadOrder();
        
        showToast('Payment proof uploaded');
        
    } catch (error) {
        console.error('Error uploading payment proof:', error);
        showToast('Failed to upload payment proof');
    }
}

// ============================================
// ORDER STATUS UPDATES (Supplier)
// ============================================
async function confirmOrder() {
    try {
        await sb
            .from('orders')
            .update({
                status: 'confirmed',
                confirmed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        
        document.getElementById('messageInput').value = '✅ Order confirmed. We will begin processing shortly.';
        await sendMessage();
        
        await loadOrder();
        showToast('Order confirmed');
        
    } catch (error) {
        console.error('Error confirming order:', error);
        showToast('Failed to confirm order');
    }
}

async function processOrder() {
    try {
        await sb
            .from('orders')
            .update({
                status: 'processing',
                processing_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        
        document.getElementById('messageInput').value = '🔧 Order is now being processed.';
        await sendMessage();
        
        await loadOrder();
        showToast('Order processing started');
        
    } catch (error) {
        console.error('Error processing order:', error);
        showToast('Failed to update order');
    }
}

async function markShipped() {
    try {
        await sb
            .from('orders')
            .update({
                status: 'shipped',
                shipped_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        
        document.getElementById('messageInput').value = '📦 Order has been shipped! Tracking details will be added soon.';
        await sendMessage();
        
        await loadOrder();
        showToast('Order marked as shipped');
        
    } catch (error) {
        console.error('Error marking shipped:', error);
        showToast('Failed to update order');
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function showPanelLoading(show) {
    document.getElementById('panelLoading').style.display = show ? 'flex' : 'none';
    document.getElementById('orderContent').style.display = show ? 'none' : 'block';
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
        'pending': 'Pending',
        'pending_payment': 'Awaiting Payment',
        'payment_verifying': 'Verifying Payment',
        'confirmed': 'Confirmed',
        'processing': 'Processing',
        'shipped': 'Shipped',
        'delivered': 'Delivered',
        'cancelled': 'Cancelled',
        'disputed': 'Disputed'
    };
    return statusMap[status] || status;
}

function formatPaymentStatus(status) {
    const statusMap = {
        'pending': 'Pending',
        'paid': 'Paid',
        'failed': 'Failed',
        'refunded': 'Refunded'
    };
    return statusMap[status] || status;
}

function formatPaymentMethod(method) {
    const methodMap = {
        'bank_transfer': 'Bank Transfer',
        'mobile_money': 'Mobile Money',
        'credit_card': 'Credit Card',
        'cash_on_delivery': 'Cash on Delivery'
    };
    return methodMap[method] || method || 'Not specified';
}

function getTrackingIcon(status) {
    const icons = {
        'Pending': 'fa-clock',
        'Picked Up': 'fa-box-open',
        'In Transit': 'fa-truck',
        'Out for Delivery': 'fa-truck',
        'Delivered': 'fa-check-circle',
        'Exception': 'fa-exclamation-triangle'
    };
    return icons[status] || 'fa-circle';
}

function formatDate(dateString) {
    return moment(dateString).format('MMM D, YYYY');
}

function formatDateTime(dateString) {
    return moment(dateString).format('MMM D, YYYY h:mm A');
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
    document.querySelector('.order-panel').classList.toggle('collapsed');
    const btn = document.getElementById('collapsePanel');
    btn.innerHTML = document.querySelector('.order-panel').classList.contains('collapsed') ? 
        '<i class="fas fa-chevron-right"></i>' : '<i class="fas fa-chevron-left"></i>';
};

window.showTrackingModal = showTrackingModal;
window.showConfirmDeliveryModal = showConfirmDeliveryModal;
window.showReportIssueModal = showReportIssueModal;
window.showPaymentProofModal = showPaymentProofModal;

window.closeTrackingModal = () => document.getElementById('trackingModal').classList.remove('show');
window.closeConfirmDeliveryModal = () => document.getElementById('confirmDeliveryModal').classList.remove('show');
window.closeReportIssueModal = () => document.getElementById('reportIssueModal').classList.remove('show');
window.closePaymentProofModal = () => document.getElementById('paymentProofModal').classList.remove('show');
window.closeMenuModal = () => document.getElementById('menuModal').classList.remove('show');
window.closeTemplatesModal = () => document.getElementById('templatesModal').classList.remove('show');
window.closeSuccessModal = () => document.getElementById('successModal').classList.remove('show');

window.updateTracking = updateTracking;
window.confirmDelivery = confirmDelivery;
window.reportIssue = reportIssue;
window.uploadPaymentProof = uploadPaymentProof;
window.confirmOrder = confirmOrder;
window.processOrder = processOrder;
window.markShipped = markShipped;

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
    
    document.getElementById('updateTrackingBtn')?.addEventListener('click', showTrackingModal);
    document.getElementById('confirmDeliveryBtn')?.addEventListener('click', showConfirmDeliveryModal);
    document.getElementById('reportIssueBtn')?.addEventListener('click', showReportIssueModal);
    
    document.getElementById('saveTrackingBtn')?.addEventListener('click', updateTracking);
    document.getElementById('confirmDeliveryBtn')?.addEventListener('click', confirmDelivery);
    document.getElementById('submitIssueBtn')?.addEventListener('click', reportIssue);
    document.getElementById('submitPaymentProofBtn')?.addEventListener('click', uploadPaymentProof);
    
    document.getElementById('collapsePanel')?.addEventListener('click', togglePanel);
    
    // File upload handlers
    document.getElementById('issueFileUploadArea')?.addEventListener('click', () => {
        document.getElementById('issueFiles').click();
    });
    
    document.getElementById('paymentFileUploadArea')?.addEventListener('click', () => {
        document.getElementById('paymentFile').click();
    });
    
    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeTrackingModal();
                closeConfirmDeliveryModal();
                closeReportIssueModal();
                closePaymentProofModal();
                closeMenuModal();
                closeTemplatesModal();
                closeSuccessModal();
            }
        });
    });
}

function setupEmojiPicker() {
    // Emoji picker implementation (similar to previous files)
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
        .channel('order-messages-' + conversation.id)
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
    
    // Listen for order updates
    const orderChannel = sb
        .channel('order-updates-' + orderId)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'orders',
                filter: `id=eq.${orderId}`
            },
            async () => {
                await loadOrder();
            }
        )
        .subscribe();
    
    // Listen for tracking updates
    const trackingChannel = sb
        .channel('tracking-updates-' + orderId)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'delivery_tracking',
                filter: `order_id=eq.${orderId}`
            },
            async (payload) => {
                trackingEvents.push(payload.new);
                renderTrackingTimeline();
            }
        )
        .subscribe();
    
    realtimeSubscriptions.push(messagesChannel, orderChannel, trackingChannel);
}

async function markMessagesAsRead() {
    // Implementation similar to previous chat files
}

// Cleanup
window.addEventListener('beforeunload', () => {
    realtimeSubscriptions.forEach(sub => sub.unsubscribe());
});

// Make functions globally available
window.sendMessage = sendMessage;
window.updateTracking = updateTracking;
window.confirmDelivery = confirmDelivery;
window.reportIssue = reportIssue;
window.uploadPaymentProof = uploadPaymentProof;
window.confirmOrder = confirmOrder;
window.processOrder = processOrder;
window.markShipped = markShipped;
window.viewImage = viewImage;