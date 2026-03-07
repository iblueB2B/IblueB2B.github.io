// ============================================
// PROFESSIONAL B2B CHAT SYSTEM - UNIFIED CHAT
// ============================================

const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    }
});

// ============================================
// CHAT STATE MANAGEMENT
// ============================================
let ChatSystem = {
    currentUser: null,
    currentUserProfile: null,
    currentConversation: null,
    conversations: [],
    messages: [],
    onlineUsers: new Set(),
    typingUsers: new Set(),
    selectedFiles: [],
    messagePage: 1,
    hasMoreMessages: true,
    isLoadingMessages: false,
    realtimeSubscriptions: [],
    typingTimeout: null,
    
    // ============================================
    // INITIALIZATION
    // ============================================
    async init(conversationId = null) {
        await this.checkAuth();
        await this.loadUserProfile();
        await this.updateOnlineStatus(true);
        await this.loadConversations();
        
        // Check for URL parameters (from new-message.html)
        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('user');
        const inquiryId = urlParams.get('inquiry');
        const quoteId = urlParams.get('quote');
        const orderId = urlParams.get('order');
        
        if (userId) {
            await this.startDirectConversation(userId);
        } else if (inquiryId) {
            await this.startContextConversation('inquiry', inquiryId);
        } else if (quoteId) {
            await this.startContextConversation('quote', quoteId);
        } else if (orderId) {
            await this.startContextConversation('order', orderId);
        } else if (conversationId) {
            await this.openConversation(conversationId);
        }
        
        this.setupRealtimeSubscriptions();
        this.setupEventListeners();
    },
    
    // Check authentication
    async checkAuth() {
        try {
            const { data: { user } } = await sb.auth.getUser();
            if (!user) {
                window.location.href = `login.html?redirect=${window.location.pathname}${window.location.search}`;
                return;
            }
            this.currentUser = user;
        } catch (error) {
            console.error('Auth error:', error);
            window.location.href = 'login.html';
        }
    },
    
    // Load user profile
    async loadUserProfile() {
        try {
            const { data, error } = await sb
                .from('profiles')
                .select('*')
                .eq('id', this.currentUser.id)
                .single();
                
            if (error) throw error;
            this.currentUserProfile = data;
        } catch (error) {
            console.error('Error loading profile:', error);
        }
    },
    
    // ============================================
    // CONVERSATION MANAGEMENT
    // ============================================
    
    // Load all conversations for current user
    async loadConversations() {
        try {
            console.log('Loading conversations for user:', this.currentUser.id);
            
            const { data, error } = await sb
                .from('conversations')
                .select(`
                    *,
                    participant_one:profiles!conversations_participant_one_id_fkey (
                        id, full_name, business_name, avatar_url, is_verified, last_active
                    ),
                    participant_two:profiles!conversations_participant_two_id_fkey (
                        id, full_name, business_name, avatar_url, is_verified, last_active
                    ),
                    inquiry:inquiry_requests!inquiry_id (
                        id, inquiry_number, title
                    ),
                    quote:supplier_quotes!quote_id (
                        id, quote_number, total_amount
                    ),
                    order:orders!order_id (
                        id, order_number, total_amount, status
                    )
                `)
                .or(`participant_one_id.eq.${this.currentUser.id},participant_two_id.eq.${this.currentUser.id}`)
                .order('last_message_at', { ascending: false, nullsLast: true });
                
            if (error) {
                console.error('SQL Error:', error);
                throw error;
            }
            
            this.conversations = data || [];
            console.log('Loaded conversations:', this.conversations.length);
            
            // For each conversation, get the last message details
            for (let conv of this.conversations) {
                if (conv.last_message_id) {
                    const { data: lastMsg } = await sb
                        .from('messages')
                        .select('id, content, sender_id, created_at, is_read')
                        .eq('id', conv.last_message_id)
                        .single();
                        
                    conv.last_message = lastMsg;
                }
            }
            
            this.renderConversations();
            
        } catch (error) {
            console.error('Error loading conversations:', error);
            this.showToast('Failed to load conversations', 'error');
        }
    },
    
    // Load messages for a conversation
    async loadMessages(conversationId, reset = true) {
        if (!conversationId || this.isLoadingMessages) return;
        
        this.isLoadingMessages = true;
        
        if (reset) {
            this.messagePage = 1;
            this.hasMoreMessages = true;
            document.getElementById('messagesContainer').innerHTML = '';
            this.showLoading(true);
        }
        
        try {
            const from = (this.messagePage - 1) * 30;
            const to = from + 29;
            
            const { data, error } = await sb
                .from('messages')
                .select(`
                    *,
                    attachments:message_attachments(*),
                    reactions:message_reactions(*, user:profiles(id, full_name, avatar_url))
                `)
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .range(from, to);
                
            if (error) throw error;
            
            if (data.length < 30) {
                this.hasMoreMessages = false;
            }
            
            const newMessages = data.reverse();
            
            if (reset) {
                this.messages = newMessages;
            } else {
                this.messages = [...newMessages, ...this.messages];
            }
            
            this.renderMessages(reset);
            await this.markMessagesAsRead(conversationId);
            
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showToast('Failed to load messages', 'error');
        } finally {
            this.isLoadingMessages = false;
            this.showLoading(false);
        }
    },
    
    // Open a conversation
    async openConversation(conversationId) {
        const conversation = this.conversations.find(c => c.id === conversationId);
        if (!conversation) return;
        
        this.currentConversation = conversation;
        
        // Update UI
        document.getElementById('chatEmptyState').style.display = 'none';
        document.getElementById('activeConversation').style.display = 'flex';
        
        // Render header and context
        this.renderConversationHeader();
        this.renderContextBanner();
        
        // Load messages
        await this.loadMessages(conversationId);
        
        // Update active state
        document.querySelectorAll('.conversation-item').forEach(el => {
            el.classList.remove('active');
        });
        const activeEl = document.querySelector(`[data-conversation-id="${conversationId}"]`);
        if (activeEl) activeEl.classList.add('active');
        
        // Enable input
        document.getElementById('messageInput').disabled = false;
        document.getElementById('messageInput').focus();
        
        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('id', conversationId);
        window.history.pushState({}, '', url);
    },
    
    // Start a direct conversation with a user
    async startDirectConversation(userId) {
        try {
            // Check if conversation exists
            const { data: existing, error: searchError } = await sb
                .from('conversations')
                .select('*')
                .or(`and(participant_one_id.eq.${this.currentUser.id},participant_two_id.eq.${userId}),and(participant_one_id.eq.${userId},participant_two_id.eq.${this.currentUser.id})`)
                .is('inquiry_id', null)
                .is('quote_id', null)
                .is('order_id', null)
                .maybeSingle();
                
            if (searchError) throw searchError;
            
            if (existing) {
                await this.openConversation(existing.id);
                return;
            }
            
            // Create new conversation
            const { data, error } = await sb
                .from('conversations')
                .insert({
                    participant_one_id: this.currentUser.id,
                    participant_two_id: userId,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();
                
            if (error) throw error;
            
            // Add to conversations list and open
            this.conversations.unshift(data);
            await this.openConversation(data.id);
            
        } catch (error) {
            console.error('Error starting conversation:', error);
            this.showToast('Failed to start conversation', 'error');
        }
    },
    
    // Start a context-based conversation (inquiry/quote/order)
    async startContextConversation(contextType, contextId) {
        try {
            let contextData;
            let otherUserId;
            
            if (contextType === 'inquiry') {
                // Get inquiry details
                const { data } = await sb
                    .from('inquiry_requests')
                    .select(`
                        *,
                        inquiry_supplier_matches (
                            supplier_id
                        )
                    `)
                    .eq('id', contextId)
                    .single();
                contextData = data;
                
                // Determine other party (supplier for buyer, buyer for supplier)
                const isSupplier = this.currentUserProfile?.is_supplier;
                if (isSupplier) {
                    otherUserId = data.buyer_id;
                } else {
                    // For buyer, get the first supplier who's responded or any matched supplier
                    const match = data.inquiry_supplier_matches?.[0];
                    if (!match) {
                        this.showToast('No suppliers found for this inquiry', 'error');
                        return;
                    }
                    // Get supplier's profile_id
                    const { data: supplier } = await sb
                        .from('suppliers')
                        .select('profile_id')
                        .eq('id', match.supplier_id)
                        .single();
                    otherUserId = supplier?.profile_id;
                }
            } else if (contextType === 'quote') {
                // Get quote details
                const { data } = await sb
                    .from('supplier_quotes')
                    .select(`
                        *,
                        inquiry_requests (
                            buyer_id
                        )
                    `)
                    .eq('id', contextId)
                    .single();
                contextData = data;
                
                // Get supplier's profile_id
                const { data: supplier } = await sb
                    .from('suppliers')
                    .select('profile_id')
                    .eq('id', data.supplier_id)
                    .single();
                
                // Determine other party
                const isSupplier = this.currentUserProfile?.is_supplier;
                otherUserId = isSupplier ? data.inquiry_requests.buyer_id : supplier?.profile_id;
            } else if (contextType === 'order') {
                // Get order details
                const { data } = await sb
                    .from('orders')
                    .select(`
                        *,
                        suppliers!orders_supplier_id_fkey (
                            profile_id
                        )
                    `)
                    .eq('id', contextId)
                    .single();
                contextData = data;
                
                // Determine other party
                const isSupplier = this.currentUserProfile?.is_supplier;
                otherUserId = isSupplier ? data.buyer_id : data.suppliers?.profile_id;
            }
            
            if (!otherUserId) {
                this.showToast('Cannot start conversation: no participant found', 'error');
                return;
            }
            
            // Check for existing context conversation
            const { data: existing, error: searchError } = await sb
                .from('conversations')
                .select('*')
                .or(`and(participant_one_id.eq.${this.currentUser.id},participant_two_id.eq.${otherUserId}),and(participant_one_id.eq.${otherUserId},participant_two_id.eq.${this.currentUser.id})`)
                .eq(`${contextType}_id`, contextId)
                .maybeSingle();
                
            if (searchError) throw searchError;
            
            if (existing) {
                await this.openConversation(existing.id);
                return;
            }
            
            // Create new context conversation
            const insertData = {
                participant_one_id: this.currentUser.id,
                participant_two_id: otherUserId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            insertData[`${contextType}_id`] = parseInt(contextId);
            
            const { data, error } = await sb
                .from('conversations')
                .insert(insertData)
                .select()
                .single();
                
            if (error) throw error;
            
            this.conversations.unshift(data);
            await this.openConversation(data.id);
            
            // Send initial context message
            let initialMessage = '';
            if (contextType === 'inquiry') {
                initialMessage = `I'd like to discuss inquiry #${contextData.inquiry_number}: ${contextData.title}`;
            } else if (contextType === 'quote') {
                initialMessage = `I'm following up on quote #${contextData.quote_number}`;
            } else if (contextType === 'order') {
                initialMessage = `I have a question about order #${contextData.order_number}`;
            }
            
            if (initialMessage) {
                setTimeout(() => {
                    document.getElementById('messageInput').value = initialMessage;
                    this.checkSendButton();
                }, 500);
            }
            
        } catch (error) {
            console.error('Error starting context conversation:', error);
            this.showToast('Failed to start conversation', 'error');
        }
    },
    
    // ============================================
    // MESSAGE FUNCTIONS
    // ============================================
    
    // Send a new message
    async sendMessage(content = null) {
        const input = document.getElementById('messageInput');
        const messageContent = content || input.value.trim();
        
        if (!messageContent && this.selectedFiles.length === 0) return;
        if (!this.currentConversation) return;
        
        try {
            this.disableInput(true);
            
            const { data: message, error } = await sb
                .from('messages')
                .insert({
                    conversation_id: this.currentConversation.id,
                    sender_id: this.currentUser.id,
                    receiver_id: this.getOtherParticipant().id,
                    content: messageContent || '(Attachment)',
                    message_type: this.selectedFiles.length > 0 ? 'file' : 'text',
                    metadata: {
                        hasAttachments: this.selectedFiles.length > 0
                    },
                    created_at: new Date().toISOString()
                })
                .select()
                .single();
                
            if (error) throw error;
            
            if (this.selectedFiles.length > 0) {
                await this.uploadAttachments(message.id);
            }
            
            // Clear input
            if (input) {
                input.value = '';
                input.style.height = 'auto';
            }
            this.selectedFiles = [];
            this.hideAttachmentPreview();
            
            // Add to UI optimistically
            this.messages.push(message);
            this.renderMessages(true);
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.showToast('Failed to send message', 'error');
        } finally {
            this.disableInput(false);
        }
    },
    
    // Upload file attachments
    async uploadAttachments(messageId) {
        for (const file of this.selectedFiles) {
            const filePath = `${this.currentConversation.id}/${Date.now()}_${file.name}`;
            
            const { error: uploadError } = await sb.storage
                .from('chat-attachments')
                .upload(filePath, file);
                
            if (uploadError) throw uploadError;
            
            const { data: { publicUrl } } = sb.storage
                .from('chat-attachments')
                .getPublicUrl(filePath);
            
            await sb
                .from('message_attachments')
                .insert({
                    message_id: messageId,
                    file_url: publicUrl,
                    file_name: file.name,
                    file_size: file.size,
                    file_type: file.type,
                    created_at: new Date().toISOString()
                });
        }
    },
    
    // Mark messages as read
    async markMessagesAsRead(conversationId) {
        try {
            await sb.rpc('mark_conversation_messages_read', {
                p_conversation_id: conversationId,
                p_user_id: this.currentUser.id
            });
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    },
    
    // Send typing indicator
    sendTypingIndicator(isTyping) {
        if (!this.currentConversation) return;
        
        clearTimeout(this.typingTimeout);
        
        const channel = sb.channel(`typing:${this.currentConversation.id}`);
        channel.send({
            type: 'broadcast',
            event: 'typing',
            payload: { 
                user_id: this.currentUser.id,
                is_typing: isTyping,
                conversation_id: this.currentConversation.id
            }
        });
        
        if (isTyping) {
            this.typingTimeout = setTimeout(() => {
                this.sendTypingIndicator(false);
            }, 3000);
        }
    },
    
    // ============================================
    // FILE HANDLING
    // ============================================
    
    // Handle file selection
    handleFileSelect(files) {
        const maxSize = 10 * 1024 * 1024; // 10MB
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
        
        this.selectedFiles = Array.from(files).filter(file => {
            if (file.size > maxSize) {
                this.showToast(`${file.name} exceeds 10MB`, 'error');
                return false;
            }
            if (!allowedTypes.includes(file.type) && !file.type.startsWith('image/')) {
                this.showToast(`File type not allowed: ${file.name}`, 'error');
                return false;
            }
            return true;
        });
        
        this.showAttachmentPreview();
    },
    
    // ============================================
    // RENDERING FUNCTIONS
    // ============================================
    
    renderConversations() {
        const container = document.getElementById('conversationsList');
        if (!container) return;
        
        if (this.conversations.length === 0) {
            container.innerHTML = `
                <div class="welcome-message">
                    <i class="fas fa-comments"></i>
                    <h3>Welcome to Messages</h3>
                    <p>Start a conversation with suppliers or buyers</p>
                    <button class="btn-primary" onclick="window.location.href='new-message.html'">
                        <i class="fas fa-plus"></i> New Message
                    </button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.conversations.map(conv => {
            const other = this.getOtherParticipant(conv);
            if (!other) return '';
            
            const isOnline = this.onlineUsers.has(other.id);
            const unread = this.getUnreadCount(conv);
            const name = other.business_name || other.full_name || 'User';
            const contextClass = `
                ${conv.inquiry_id ? 'has-inquiry' : ''} 
                ${conv.quote_id ? 'has-quote' : ''} 
                ${conv.order_id ? 'has-order' : ''}
            `;
            
            return `
                <div class="conversation-item ${contextClass} ${this.currentConversation?.id === conv.id ? 'active' : ''}" 
                     data-conversation-id="${conv.id}"
                     onclick="ChatSystem.openConversation(${conv.id})">
                    <div class="conversation-avatar">
                        ${other.avatar_url ? 
                            `<img src="${other.avatar_url}" alt="${name}">` : 
                            `<div class="avatar-placeholder">${this.getInitials(name)}</div>`
                        }
                        <span class="status-indicator ${isOnline ? 'online' : ''}"></span>
                    </div>
                    <div class="conversation-info">
                        <div class="conversation-header">
                            <span class="participant-name">${this.escapeHtml(name)}</span>
                            <span class="conversation-time">${this.formatTime(conv.last_message_at)}</span>
                        </div>
                        <div class="conversation-preview">
                            ${this.getContextBadge(conv)}
                            <span class="last-message">${conv.last_message_preview || 'No messages yet'}</span>
                        </div>
                    </div>
                    ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
                </div>
            `;
        }).join('');
    },
    
    renderConversationHeader() {
        const header = document.getElementById('participantInfo');
        if (!header || !this.currentConversation) return;
        
        const other = this.getOtherParticipant();
        if (!other) return;
        
        const isOnline = this.onlineUsers.has(other.id);
        const name = other.business_name || other.full_name || 'User';
        
        header.innerHTML = `
            <div class="participant-avatar">
                ${other.avatar_url ? 
                    `<img src="${other.avatar_url}" alt="${name}">` : 
                    `<div class="avatar-placeholder">${this.getInitials(name)}</div>`
                }
                <span class="status-indicator ${isOnline ? 'online' : ''}"></span>
            </div>
            <div class="participant-details">
                <h4>${this.escapeHtml(name)}</h4>
                <span class="participant-status ${isOnline ? 'online' : ''}">
                    <i class="fas fa-circle"></i>
                    ${isOnline ? 'Online' : this.getLastSeen(other.last_active)}
                </span>
            </div>
        `;
    },
    
    renderContextBanner() {
        const banner = document.getElementById('contextBanner');
        if (!banner || !this.currentConversation) return;
        
        const context = this.getContextInfo();
        
        if (context) {
            banner.style.display = 'flex';
            banner.innerHTML = `
                <div class="context-icon ${context.type}">
                    <i class="fas ${context.icon}"></i>
                </div>
                <div class="context-details">
                    <div class="context-title">${this.escapeHtml(context.title)}</div>
                    <div class="context-subtitle">${this.escapeHtml(context.subtitle)}</div>
                </div>
                <a href="${context.link}" class="context-action">View</a>
            `;
        } else {
            banner.style.display = 'none';
        }
    },
    
    renderMessages(scrollToBottom = true) {
        const container = document.getElementById('messagesContainer');
        if (!container) return;
        
        let currentDate = null;
        let html = '';
        
        this.messages.forEach(message => {
            const messageDate = new Date(message.created_at).toDateString();
            
            if (messageDate !== currentDate) {
                currentDate = messageDate;
                html += `
                    <div class="message-date-divider">
                        <span class="date-divider-text">${this.formatMessageDate(message.created_at)}</span>
                    </div>
                `;
            }
            
            const isOwn = message.sender_id === this.currentUser.id;
            
            html += `
                <div class="message-wrapper ${isOwn ? 'own-message' : ''}" data-message-id="${message.id}">
                    <div class="message-bubble" onclick="ChatSystem.showMessageOptions(${message.id})">
                        <div class="message-text">${this.formatMessageText(message.content)}</div>
                        
                        ${this.renderMessageAttachments(message.attachments)}
                        
                        ${this.renderMessageReactions(message.reactions, message.id)}
                        
                        <div class="message-time">
                            ${this.formatTime(message.created_at)}
                            ${this.getMessageStatus(message, isOwn)}
                        </div>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
        if (scrollToBottom) {
            this.scrollToBottom();
        }
    },
    
    renderMessageAttachments(attachments) {
        if (!attachments || attachments.length === 0) return '';
        
        return attachments.map(att => {
            if (att.file_type?.startsWith('image/')) {
                return `
                    <div class="message-attachment">
                        <img src="${att.file_url}" class="attachment-image" 
                             onclick="ChatSystem.viewImage('${att.file_url}')"
                             loading="lazy">
                    </div>
                `;
            } else {
                return `
                    <div class="message-attachment">
                        <a href="${att.file_url}" target="_blank" class="attachment-file">
                            <i class="fas ${this.getFileIcon(att.file_type)}"></i>
                            <div class="attachment-info">
                                <div class="attachment-name">${this.escapeHtml(att.file_name)}</div>
                                <div class="attachment-size">${this.formatFileSize(att.file_size)}</div>
                            </div>
                        </a>
                    </div>
                `;
            }
        }).join('');
    },
    
    renderMessageReactions(reactions, messageId) {
        if (!reactions || reactions.length === 0) return '';
        
        const grouped = reactions.reduce((acc, r) => {
            acc[r.reaction] = (acc[r.reaction] || 0) + 1;
            return acc;
        }, {});
        
        return `
            <div class="message-reactions">
                ${Object.entries(grouped).map(([reaction, count]) => `
                    <span class="reaction-badge" onclick="ChatSystem.addReaction(${messageId}, '${reaction}')">
                        ${reaction} ${count}
                    </span>
                `).join('')}
            </div>
        `;
    },
    
    // ============================================
    // FILTER AND SEARCH
    // ============================================
    
    filterConversations(filter) {
        const container = document.getElementById('conversationsList');
        if (!container) return;
        
        const items = container.querySelectorAll('.conversation-item');
        
        items.forEach(item => {
            const hasInquiry = item.classList.contains('has-inquiry');
            const hasQuote = item.classList.contains('has-quote');
            const hasOrder = item.classList.contains('has-order');
            const unread = item.querySelector('.unread-badge');
            
            let show = true;
            
            switch(filter) {
                case 'unread':
                    show = !!unread;
                    break;
                case 'inquiry':
                    show = hasInquiry;
                    break;
                case 'quote':
                    show = hasQuote;
                    break;
                case 'order':
                    show = hasOrder;
                    break;
                default:
                    show = true;
            }
            
            item.style.display = show ? 'flex' : 'none';
        });
    },
    
    searchConversations(query) {
        const container = document.getElementById('conversationsList');
        if (!container) return;
        
        if (!query) {
            document.querySelectorAll('.conversation-item').forEach(item => {
                item.style.display = 'flex';
            });
            return;
        }
        
        const searchTerm = query.toLowerCase();
        
        document.querySelectorAll('.conversation-item').forEach(item => {
            const name = item.querySelector('.participant-name')?.textContent.toLowerCase() || '';
            const preview = item.querySelector('.last-message')?.textContent.toLowerCase() || '';
            
            if (name.includes(searchTerm) || preview.includes(searchTerm)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    },
    
    // ============================================
    // REALTIME SUBSCRIPTIONS
    // ============================================
    
    setupRealtimeSubscriptions() {
        // Online presence
        const presenceChannel = sb.channel('online-users');
        presenceChannel
            .on('presence', { event: 'sync' }, () => {
                const state = presenceChannel.presenceState();
                this.onlineUsers = new Set(
                    Object.values(state).flat().map(p => p.user_id)
                );
                this.renderConversations();
                this.renderConversationHeader();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await presenceChannel.track({
                        user_id: this.currentUser.id,
                        online_at: new Date().toISOString()
                    });
                }
            });
        
        // New messages
        const messagesChannel = sb
            .channel('new-messages')
            .on('postgres_changes', 
                { event: 'INSERT', schema: 'public', table: 'messages' },
                async (payload) => {
                    if (payload.new.conversation_id === this.currentConversation?.id) {
                        const { data: message } = await sb
                            .from('messages')
                            .select('*, attachments:message_attachments(*)')
                            .eq('id', payload.new.id)
                            .single();
                            
                        if (message) {
                            this.messages.push(message);
                            this.renderMessages(true);
                            
                            if (message.sender_id !== this.currentUser.id) {
                                await this.markMessagesAsRead(this.currentConversation.id);
                            }
                        }
                    } else {
                        await this.loadConversations();
                    }
                }
            )
            .subscribe();
        
        // Typing indicators
        const typingChannel = sb
            .channel('typing-indicators')
            .on('broadcast', { event: 'typing' }, (payload) => {
                if (payload.payload.user_id !== this.currentUser.id &&
                    payload.payload.conversation_id === this.currentConversation?.id) {
                    
                    if (payload.payload.is_typing) {
                        this.typingUsers.add(payload.payload.user_id);
                    } else {
                        this.typingUsers.delete(payload.payload.user_id);
                    }
                    
                    this.showTypingIndicator(this.typingUsers.size > 0);
                }
            })
            .subscribe();
        
        this.realtimeSubscriptions = [presenceChannel, messagesChannel, typingChannel];
    },
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    
    getOtherParticipant(conversation = this.currentConversation) {
        if (!conversation) return null;
        return conversation.participant_one_id === this.currentUser.id 
            ? conversation.participant_two 
            : conversation.participant_one;
    },
    
    getUnreadCount(conversation) {
        return this.currentUser.id === conversation.participant_one_id 
            ? conversation.unread_count_one 
            : conversation.unread_count_two;
    },
    
    getContextInfo() {
        const conv = this.currentConversation;
        
        if (conv.inquiry) {
            return {
                type: 'inquiry',
                icon: 'fa-file-invoice',
                title: `Inquiry: ${conv.inquiry.inquiry_number}`,
                subtitle: conv.inquiry.title,
                link: `inquiry-details.html?id=${conv.inquiry.id}`
            };
        } else if (conv.quote) {
            return {
                type: 'quote',
                icon: 'fa-file-invoice',
                title: `Quote: ${conv.quote.quote_number}`,
                subtitle: `UGX ${this.formatNumber(conv.quote.total_amount)}`,
                link: `buyer-quote.html?id=${conv.quote.id}`
            };
        } else if (conv.order) {
            return {
                type: 'order',
                icon: 'fa-clipboard-list',
                title: `Order: ${conv.order.order_number}`,
                subtitle: `Status: ${conv.order.status}`,
                link: `purchase-order.html?id=${conv.order.id}`
            };
        }
        
        return null;
    },
    
    getContextBadge(conversation) {
        if (conversation.inquiry_id) {
            return '<span class="context-badge inquiry">INQ</span>';
        } else if (conversation.quote_id) {
            return '<span class="context-badge quote">QTE</span>';
        } else if (conversation.order_id) {
            return '<span class="context-badge order">ORD</span>';
        }
        return '';
    },
    
    getMessageStatus(message, isOwn) {
        if (!isOwn) return '';
        
        if (message.is_read) {
            return '<i class="fas fa-check-double read"></i>';
        } else if (message.delivered_at) {
            return '<i class="fas fa-check"></i>';
        }
        return '<i class="fas fa-clock"></i>';
    },
    
    getInitials(name) {
        if (!name) return 'U';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    },
    
    getLastSeen(timestamp) {
        if (!timestamp) return 'Offline';
        
        const last = new Date(timestamp);
        const now = new Date();
        const diff = Math.floor((now - last) / 60000); // minutes
        
        if (diff < 1) return 'Just now';
        if (diff < 60) return `${diff}m ago`;
        if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
        return `${Math.floor(diff / 1440)}d ago`;
    },
    
    formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    
    formatMessageDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        
        if (date.toDateString() === now.toDateString()) return 'Today';
        
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        
        return date.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
        });
    },
    
    formatMessageText(text) {
        if (!text) return '';
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.replace(urlRegex, '<a href="$1" target="_blank">$1</a>');
    },
    
    formatNumber(num) {
        return num?.toLocaleString('en-UG') || '0';
    },
    
    formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    
    getFileIcon(mimeType) {
        if (mimeType?.includes('pdf')) return 'fa-file-pdf';
        if (mimeType?.includes('word')) return 'fa-file-word';
        if (mimeType?.includes('excel')) return 'fa-file-excel';
        if (mimeType?.includes('image')) return 'fa-file-image';
        return 'fa-file';
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    scrollToBottom() {
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
    },
    
    showLoading(show) {
        const loading = document.getElementById('messagesLoading');
        if (loading) {
            loading.style.display = show ? 'flex' : 'none';
        }
    },
    
    showTypingIndicator(show) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.style.display = show ? 'flex' : 'none';
        }
    },
    
    showAttachmentPreview() {
        const preview = document.getElementById('attachmentPreview');
        if (!preview) return;
        
        if (this.selectedFiles.length === 0) {
            preview.style.display = 'none';
            return;
        }
        
        preview.style.display = 'flex';
        
        const file = this.selectedFiles[0];
        const extraCount = this.selectedFiles.length - 1;
        
        preview.innerHTML = `
            <div class="preview-file">
                <i class="fas ${this.getFileIcon(file.type)}"></i>
                <div class="preview-info">
                    <div class="preview-name">${this.escapeHtml(file.name)}${extraCount > 0 ? ` +${extraCount} more` : ''}</div>
                    <div class="preview-size">${this.formatFileSize(file.size)}</div>
                </div>
            </div>
            <i class="fas fa-times remove-attachment" onclick="ChatSystem.clearAttachments()"></i>
        `;
    },
    
    hideAttachmentPreview() {
        const preview = document.getElementById('attachmentPreview');
        if (preview) preview.style.display = 'none';
    },
    
    clearAttachments() {
        this.selectedFiles = [];
        this.hideAttachmentPreview();
        this.checkSendButton();
    },
    
    checkSendButton() {
        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendMessageBtn');
        if (sendBtn && input) {
            sendBtn.disabled = !input.value.trim() && this.selectedFiles.length === 0;
        }
    },
    
    disableInput(disabled) {
        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendMessageBtn');
        if (input) input.disabled = disabled;
        if (sendBtn) sendBtn.disabled = disabled;
    },
    
    autoResize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    },
    
    async updateOnlineStatus(isOnline) {
        try {
            await sb
                .from('profiles')
                .update({ last_active: new Date().toISOString() })
                .eq('id', this.currentUser.id);
        } catch (error) {
            console.error('Error updating online status:', error);
        }
    },
    
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        const colors = {
            success: '#10B981',
            error: '#EF4444',
            info: '#0B4F6C',
            warning: '#F59E0B'
        };
        
        toast.style.backgroundColor = colors[type] || colors.info;
        toast.textContent = message;
        toast.classList.add('show');
        
        setTimeout(() => toast.classList.remove('show'), 3000);
    },
    
    // ============================================
    // EVENT HANDLERS
    // ============================================
    
    setupEventListeners() {
        // Message input
        const input = document.getElementById('messageInput');
        if (input) {
            input.addEventListener('input', (e) => {
                this.autoResize(e.target);
                this.checkSendButton();
                if (this.currentConversation) {
                    this.sendTypingIndicator(e.target.value.trim().length > 0);
                }
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (this.currentConversation) {
                        this.sendMessage();
                    }
                }
            });
        }
        
        // Send button
        const sendBtn = document.getElementById('sendMessageBtn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                if (this.currentConversation) {
                    this.sendMessage();
                }
            });
        }
        
        // New chat button
        const newChatBtn = document.getElementById('newChatBtn');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = 'new-message.html';
            });
        }
        
        // Empty state new chat button
        const emptyStateBtn = document.getElementById('emptyStateNewChat');
        if (emptyStateBtn) {
            emptyStateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = 'new-message.html';
            });
        }
        
        // Attach file button
        const attachBtn = document.getElementById('attachFileBtn');
        if (attachBtn) {
            attachBtn.addEventListener('click', () => {
                if (!this.currentConversation) {
                    this.showToast('Select a conversation first', 'warning');
                    return;
                }
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx';
                input.onchange = (e) => this.handleFileSelect(e.target.files);
                input.click();
            });
        }
        
        // View profile button
        const profileBtn = document.getElementById('viewParticipantProfile');
        if (profileBtn) {
            profileBtn.addEventListener('click', () => {
                const other = this.getOtherParticipant();
                if (other) {
                    window.location.href = `profile.html?id=${other.id}`;
                }
            });
        }
        
        // Filter conversations
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.filterConversations(btn.dataset.filter);
            });
        });
        
        // Search
        const searchInput = document.getElementById('chatSearch');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.searchConversations(e.target.value);
                }, 300);
            });
        }
        
        // Infinite scroll
        const container = document.getElementById('messagesContainer');
        if (container) {
            container.addEventListener('scroll', () => {
                if (!this.currentConversation) return;
                if (container.scrollTop < 100 && this.hasMoreMessages && !this.isLoadingMessages) {
                    this.messagePage++;
                    this.loadMessages(this.currentConversation.id, false);
                }
            });
        }
        
        // Window before unload
        window.addEventListener('beforeunload', () => {
            this.realtimeSubscriptions.forEach(sub => sub.unsubscribe());
            this.updateOnlineStatus(false);
        });
    },
    
    // ============================================
    // MODAL FUNCTIONS (Placeholders)
    // ============================================
    
    showMessageOptions(messageId) {
        this.showToast('Message options coming soon');
    },
    
    addReaction(messageId, reaction) {
        this.showToast('Reactions coming soon');
    },
    
    viewImage(url) {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.style.background = 'rgba(0,0,0,0.95)';
        modal.innerHTML = `
            <div class="modal-content" style="background: transparent; max-width: 90%;">
                <div style="text-align: right; margin-bottom: 10px;">
                    <button class="modal-close" style="color: white; font-size: 30px;" 
                            onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <img src="${url}" style="max-width: 100%; max-height: 80vh; display: block; margin: 0 auto;">
            </div>
        `;
        document.body.appendChild(modal);
    }
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const conversationId = urlParams.get('id');
    ChatSystem.init(conversationId);
});

// Make globally available
window.ChatSystem = ChatSystem;