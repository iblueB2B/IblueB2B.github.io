// ============================================
// SUPPLIER QUOTATIONS MANAGEMENT - COMPLETE
// ============================================

console.log('🚀 Supplier Quotations loading...');

// Supabase Configuration
const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
let SupplierQuotations = {
    currentUser: null,
    supplier: null,
    quotations: [],
    filteredQuotations: [],
    inquiries: [],
    currentQuote: null,
    quoteItems: [],
    currentPage: 1,
    itemsPerPage: 20,
    hasMore: true,
    isLoading: false,
    currentTab: 'all',
    filters: {
        status: [],
        dateRange: 'all',
        search: ''
    },
    
    // ============================================
    // INITIALIZATION
    // ============================================
    async init() {
        console.log('📊 Supplier Quotations initializing...');
        
        try {
            await this.checkAuth();
            await this.loadSupplier();
            await this.loadInquiries();
            await this.loadQuotations();
            this.setupEventListeners();
            
            console.log('✅ Supplier Quotations initialized');
        } catch (error) {
            console.error('❌ Error initializing:', error);
            this.showToast('Error loading quotations', 'error');
        }
    },
    
    async checkAuth() {
        try {
            const { data: { user }, error } = await sb.auth.getUser();
            
            if (error || !user) {
                window.location.href = 'login.html?redirect=supplier-quotations.html';
                return;
            }
            
            this.currentUser = user;
            console.log('✅ User authenticated:', user.email);
            
        } catch (error) {
            console.error('Auth error:', error);
            window.location.href = 'login.html';
        }
    },
    
    async loadSupplier() {
        try {
            const { data, error } = await sb
                .from('suppliers')
                .select('*')
                .eq('profile_id', this.currentUser.id)
                .single();
            
            if (error) throw error;
            
            this.supplier = data;
            console.log('✅ Supplier loaded:', this.supplier.business_name);
            
        } catch (error) {
            console.error('Error loading supplier:', error);
            this.showToast('Error loading supplier data', 'error');
        }
    },
    
    async loadInquiries() {
        try {
            const { data, error } = await sb
                .from('inquiry_requests')
                .select(`
                    *,
                    profiles!inquiry_requests_buyer_id_fkey (
                        id,
                        full_name,
                        business_name,
                        avatar_url,
                        location
                    ),
                    inquiry_items (*)
                `)
                .eq('status', 'sent')
                .order('created_at', { ascending: false })
                .limit(20);
            
            if (error) throw error;
            
            this.inquiries = data || [];
            console.log(`✅ Loaded ${this.inquiries.length} inquiries`);
            
        } catch (error) {
            console.error('Error loading inquiries:', error);
            this.inquiries = [];
        }
    },
    
    async loadQuotations(reset = true) {
        if (!this.supplier || this.isLoading) return;
        
        this.isLoading = true;
        
        if (reset) {
            this.currentPage = 1;
            this.hasMore = true;
            document.getElementById('loadingState').style.display = 'block';
            document.getElementById('quotationsList').innerHTML = '';
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('loadMore').style.display = 'none';
        }
        
        try {
            const from = (this.currentPage - 1) * this.itemsPerPage;
            const to = from + this.itemsPerPage - 1;
            
            let query = sb
                .from('supplier_quotes')
                .select(`
                    *,
                    inquiry_requests!inner (
                        id,
                        inquiry_number,
                        title,
                        profiles!inquiry_requests_buyer_id_fkey (
                            id,
                            full_name,
                            business_name,
                            avatar_url,
                            location
                        )
                    ),
                    supplier_quote_items (*)
                `)
                .eq('supplier_id', this.supplier.id)
                .order('created_at', { ascending: false });
            
            // Apply tab filter
            if (this.currentTab !== 'all') {
                query = query.eq('status', this.currentTab);
            }
            
            // Apply status filters
            if (this.filters.status.length > 0) {
                query = query.in('status', this.filters.status);
            }
            
            // Apply search
            if (this.filters.search) {
                query = query.or(`quote_number.ilike.%${this.filters.search}%,inquiry_requests.title.ilike.%${this.filters.search}%`);
            }
            
            // Apply date range
            if (this.filters.dateRange !== 'all') {
                const now = new Date();
                let startDate = new Date();
                
                switch(this.filters.dateRange) {
                    case 'today':
                        startDate.setHours(0, 0, 0, 0);
                        break;
                    case 'week':
                        startDate.setDate(now.getDate() - 7);
                        break;
                    case 'month':
                        startDate.setMonth(now.getMonth() - 1);
                        break;
                }
                
                query = query.gte('created_at', startDate.toISOString());
            }
            
            const { data, error } = await query.range(from, to);
            
            if (error) throw error;
            
            if (reset) {
                this.quotations = data || [];
            } else {
                this.quotations = [...this.quotations, ...(data || [])];
            }
            
            this.filteredQuotations = [...this.quotations];
            this.hasMore = (data || []).length === this.itemsPerPage;
            
            this.updateStats();
            this.renderQuotations();
            
            document.getElementById('loadingState').style.display = 'none';
            
            if (this.filteredQuotations.length === 0) {
                document.getElementById('emptyState').style.display = 'block';
            } else {
                document.getElementById('loadMore').style.display = this.hasMore ? 'block' : 'none';
            }
            
        } catch (error) {
            console.error('Error loading quotations:', error);
            this.showToast('Error loading quotations', 'error');
        } finally {
            this.isLoading = false;
        }
    },
    
    // ============================================
    // UPDATE STATS
    // ============================================
    updateStats() {
        const total = this.quotations.length;
        const draft = this.quotations.filter(q => q.status === 'draft').length;
        const sent = this.quotations.filter(q => q.status === 'sent').length;
        const accepted = this.quotations.filter(q => q.status === 'accepted').length;
        const rejected = this.quotations.filter(q => q.status === 'rejected').length;
        
        document.getElementById('totalQuotes').textContent = total;
        document.getElementById('draftQuotes').textContent = draft;
        document.getElementById('sentQuotes').textContent = sent;
        document.getElementById('acceptedQuotes').textContent = accepted;
        document.getElementById('rejectedQuotes').textContent = rejected;
    },
    
    // ============================================
    // RENDER QUOTATIONS
    // ============================================
    renderQuotations() {
        const container = document.getElementById('quotationsList');
        
        if (this.filteredQuotations.length === 0) return;
        
        container.innerHTML = this.filteredQuotations.map(quote => this.renderQuoteCard(quote)).join('');
    },
    
    renderQuoteCard(quote) {
        const inquiry = quote.inquiry_requests || {};
        const buyer = inquiry.profiles || {};
        const buyerName = buyer.business_name || buyer.full_name || 'Buyer';
        const buyerInitials = buyerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const items = quote.supplier_quote_items || [];
        const previewItems = items.slice(0, 2);
        const hasMore = items.length > 2;
        
        // Format date
        const createdDate = new Date(quote.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
        
        // Check if expiring
        const validUntil = new Date(quote.valid_until);
        const now = new Date();
        const daysLeft = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
        const isExpiring = daysLeft <= 3 && quote.status === 'sent';
        
        return `
            <div class="quote-card ${quote.status}" data-quote-id="${quote.id}" onclick="SupplierQuotations.viewQuote(${quote.id})">
                <div class="quote-header">
                    <div class="quote-info">
                        <h3>Quote #${quote.quote_number || 'Draft'}</h3>
                        <div class="quote-number">${inquiry.inquiry_number || ''} • ${createdDate}</div>
                    </div>
                    <span class="quote-badge ${quote.status}">${this.formatStatus(quote.status)}</span>
                </div>
                
                <div class="buyer-info">
                    <div class="buyer-avatar">
                        ${buyer.avatar_url ? 
                            `<img src="${buyer.avatar_url}" alt="${buyerName}">` : 
                            buyerInitials
                        }
                    </div>
                    <div class="buyer-details">
                        <div class="buyer-name">${this.escapeHtml(buyerName)}</div>
                        <div class="buyer-company">${inquiry.title || 'Inquiry'}</div>
                    </div>
                </div>
                
                <div class="items-preview">
                    <div class="preview-header">
                        <span>Items (${items.length})</span>
                        <span>Total: UGX ${this.formatNumber(quote.total_amount)}</span>
                    </div>
                    ${previewItems.map(item => `
                        <div class="preview-item">
                            <span class="item-name">${this.escapeHtml(item.product_name)}</span>
                            <span class="item-qty">x${item.quantity}</span>
                            <span class="item-price">UGX ${this.formatNumber(item.unit_price)}</span>
                        </div>
                    `).join('')}
                    ${hasMore ? `
                        <div class="preview-item" style="justify-content: center; color: var(--gray-500);">
                            +${items.length - 2} more items
                        </div>
                    ` : ''}
                </div>
                
                <div class="quote-footer">
                    <div class="quote-total">UGX ${this.formatNumber(quote.total_amount)}</div>
                    <div class="quote-validity ${isExpiring ? 'expiring' : ''}">
                        <i class="fas fa-clock"></i>
                        ${isExpiring ? `${daysLeft} days left` : `Valid until ${this.formatDate(quote.valid_until)}`}
                    </div>
                    <div class="quote-actions" onclick="event.stopPropagation()">
                        ${quote.status === 'draft' ? `
                            <button class="action-btn" onclick="SupplierQuotations.editQuote(${quote.id})" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="action-btn" onclick="SupplierQuotations.sendQuote(${quote.id})" title="Send">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                            <button class="action-btn delete" onclick="SupplierQuotations.deleteQuote(${quote.id})" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                        ${quote.status === 'sent' ? `
                            <button class="action-btn" onclick="SupplierQuotations.duplicateQuote(${quote.id})" title="Duplicate">
                                <i class="fas fa-copy"></i>
                            </button>
                        ` : ''}
                        ${quote.status === 'accepted' ? `
                            <button class="action-btn" onclick="SupplierQuotations.viewOrder(${quote.id})" title="View Order">
                                <i class="fas fa-clipboard-list"></i>
                            </button>
                        ` : ''}
                        <button class="action-btn" onclick="SupplierQuotations.viewQuote(${quote.id})" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    },
    
    // ============================================
    // VIEW QUOTE DETAILS
    // ============================================
    async viewQuote(quoteId) {
        const quote = this.quotations.find(q => q.id === quoteId);
        if (!quote) return;
        
        this.currentQuote = quote;
        
        const inquiry = quote.inquiry_requests || {};
        const buyer = inquiry.profiles || {};
        const items = quote.supplier_quote_items || [];
        
        const modalBody = document.getElementById('quoteModalBody');
        const modalFooter = document.getElementById('quoteModalFooter');
        
        modalBody.innerHTML = `
            <div class="quote-detail-section">
                <h4>Quote Information</h4>
                <div class="detail-row">
                    <span class="detail-label">Quote #:</span>
                    <span class="detail-value">${quote.quote_number || 'Draft'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Status:</span>
                    <span class="detail-value"><span class="quote-badge ${quote.status}">${this.formatStatus(quote.status)}</span></span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Created:</span>
                    <span class="detail-value">${this.formatDate(quote.created_at)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Valid Until:</span>
                    <span class="detail-value">${this.formatDate(quote.valid_until)}</span>
                </div>
            </div>
            
            <div class="quote-detail-section">
                <h4>Buyer Information</h4>
                <div class="detail-row">
                    <span class="detail-label">Name:</span>
                    <span class="detail-value">${this.escapeHtml(buyer.business_name || buyer.full_name || 'Buyer')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Location:</span>
                    <span class="detail-value">${this.escapeHtml(buyer.location || 'Not specified')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Inquiry:</span>
                    <span class="detail-value">${inquiry.title || ''} (${inquiry.inquiry_number || ''})</span>
                </div>
            </div>
            
            <div class="quote-detail-section">
                <h4>Items</h4>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Qty</th>
                            <th>Unit Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(item => `
                            <tr>
                                <td>${this.escapeHtml(item.product_name)}</td>
                                <td>${item.quantity}</td>
                                <td>UGX ${this.formatNumber(item.unit_price)}</td>
                                <td>UGX ${this.formatNumber(item.total_price)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="text-align: right; margin-top: 12px;">
                    <strong>Total: UGX ${this.formatNumber(quote.total_amount)}</strong>
                </div>
            </div>
            
            <div class="quote-detail-section">
                <h4>Terms</h4>
                <div class="detail-row">
                    <span class="detail-label">Payment:</span>
                    <span class="detail-value">${this.formatPaymentTerms(quote.payment_terms?.[0])}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Delivery:</span>
                    <span class="detail-value">${this.formatDeliveryTerms(quote.delivery_terms?.[0])}</span>
                </div>
                ${quote.lead_time_days ? `
                <div class="detail-row">
                    <span class="detail-label">Lead Time:</span>
                    <span class="detail-value">${quote.lead_time_days} days</span>
                </div>
                ` : ''}
            </div>
            
            ${quote.notes ? `
            <div class="quote-detail-section">
                <h4>Notes</h4>
                <p>${this.escapeHtml(quote.notes)}</p>
            </div>
            ` : ''}
        `;
        
        modalFooter.innerHTML = `
            ${quote.status === 'draft' ? `
                <button class="btn-primary" onclick="SupplierQuotations.editQuote(${quote.id})">Edit</button>
                <button class="btn-success" onclick="SupplierQuotations.sendQuote(${quote.id})">Send</button>
            ` : ''}
            ${quote.status === 'sent' ? `
                <button class="btn-primary" onclick="SupplierQuotations.duplicateQuote(${quote.id})">Duplicate</button>
            ` : ''}
            <button class="btn-secondary" onclick="SupplierQuotations.closeQuoteModal()">Close</button>
        `;
        
        document.getElementById('quoteModal').classList.add('show');
    },
    
    // ============================================
    // CREATE/EDIT QUOTE
    // ============================================
    createNewQuote(inquiryId = null) {
        this.currentQuote = null;
        this.quoteItems = [];
        
        document.getElementById('createQuoteTitle').textContent = 'Create New Quotation';
        document.getElementById('quoteId').value = '';
        document.getElementById('inquiryId').value = inquiryId || '';
        
        // Set default valid until (7 days from now)
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 7);
        document.getElementById('validUntil').value = validUntil.toISOString().split('T')[0];
        
        document.getElementById('paymentTerms').value = 'advance_full';
        document.getElementById('deliveryTerms').value = 'ex_warehouse';
        document.getElementById('leadTime').value = '7';
        document.getElementById('quoteNotes').value = '';
        
        // Load buyer info if inquiry selected
        if (inquiryId) {
            this.loadBuyerInfo(inquiryId);
        } else {
            document.getElementById('buyerInfoCard').style.display = 'none';
        }
        
        // Add one empty item
        this.addQuoteItem();
        
        document.getElementById('createQuoteModal').classList.add('show');
    },
    
    async loadBuyerInfo(inquiryId) {
        const inquiry = this.inquiries.find(i => i.id === inquiryId);
        if (!inquiry) return;
        
        const buyer = inquiry.profiles || {};
        
        document.getElementById('buyerInfoCard').style.display = 'block';
        document.getElementById('buyerInfo').innerHTML = `
            <div class="buyer-detail-row">
                <span class="buyer-detail-label">Name:</span>
                <span class="buyer-detail-value">${this.escapeHtml(buyer.business_name || buyer.full_name)}</span>
            </div>
            <div class="buyer-detail-row">
                <span class="buyer-detail-label">Location:</span>
                <span class="buyer-detail-value">${this.escapeHtml(buyer.location || 'Uganda')}</span>
            </div>
            <div class="buyer-detail-row">
                <span class="buyer-detail-label">Inquiry:</span>
                <span class="buyer-detail-value">${inquiry.title}</span>
            </div>
        `;
        
        // Pre-fill items from inquiry
        if (inquiry.inquiry_items && inquiry.inquiry_items.length > 0) {
            this.quoteItems = inquiry.inquiry_items.map(item => ({
                product_name: item.product_name,
                quantity: item.quantity,
                unit_price: item.preferred_unit_price || 0,
                notes: item.notes || ''
            }));
            this.renderQuoteItems();
        }
    },
    
    addQuoteItem() {
        this.quoteItems.push({
            product_name: '',
            quantity: 1,
            unit_price: 0,
            notes: ''
        });
        this.renderQuoteItems();
    },
    
    removeQuoteItem(index) {
        this.quoteItems.splice(index, 1);
        this.renderQuoteItems();
    },
    
    updateQuoteItem(index, field, value) {
        this.quoteItems[index][field] = field === 'quantity' || field === 'unit_price' ? parseFloat(value) || 0 : value;
        this.updateQuoteSummary();
        this.renderQuoteItems();
    },
    
    renderQuoteItems() {
        const container = document.getElementById('quoteItemsContainer');
        
        container.innerHTML = this.quoteItems.map((item, index) => `
            <div class="quote-item">
                <div class="quote-item-header">
                    <span>Item ${index + 1}</span>
                    <button type="button" class="remove-item-btn" onclick="SupplierQuotations.removeQuoteItem(${index})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="quote-item-fields">
                    <input type="text" 
                           placeholder="Product name" 
                           value="${this.escapeHtml(item.product_name)}"
                           onchange="SupplierQuotations.updateQuoteItem(${index}, 'product_name', this.value)">
                    <input type="number" 
                           placeholder="Qty" 
                           value="${item.quantity}"
                           min="1"
                           onchange="SupplierQuotations.updateQuoteItem(${index}, 'quantity', this.value)">
                    <input type="number" 
                           placeholder="Price" 
                           value="${item.unit_price}"
                           min="0"
                           step="100"
                           onchange="SupplierQuotations.updateQuoteItem(${index}, 'unit_price', this.value)">
                </div>
                <input type="text" 
                       placeholder="Notes (optional)"
                       value="${this.escapeHtml(item.notes)}"
                       style="width: 100%; margin-top: 8px; padding: 8px; border: 1px solid var(--gray-300); border-radius: var(--radius-sm);"
                       onchange="SupplierQuotations.updateQuoteItem(${index}, 'notes', this.value)">
            </div>
        `).join('');
        
        this.updateQuoteSummary();
    },
    
    updateQuoteSummary() {
        const subtotal = this.quoteItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
        document.getElementById('summarySubtotal').textContent = `UGX ${this.formatNumber(subtotal)}`;
        document.getElementById('summaryTotal').textContent = `UGX ${this.formatNumber(subtotal)}`;
    },
    
    // ============================================
    // SAVE QUOTE
    // ============================================
    async saveQuoteAsDraft() {
        await this.saveQuote('draft');
    },
    
    async sendQuote() {
        if (!this.validateQuote()) {
            this.showToast('Please fill in all required fields', 'error');
            return;
        }
        await this.saveQuote('sent');
    },
    
    validateQuote() {
        if (this.quoteItems.length === 0) return false;
        
        for (const item of this.quoteItems) {
            if (!item.product_name || item.quantity < 1 || item.unit_price <= 0) {
                return false;
            }
        }
        
        if (!document.getElementById('validUntil').value) return false;
        
        return true;
    },
    
    async saveQuote(status) {
        try {
            const quoteId = document.getElementById('quoteId').value;
            const inquiryId = document.getElementById('inquiryId').value || null;
            const validUntil = document.getElementById('validUntil').value;
            const paymentTerms = document.getElementById('paymentTerms').value;
            const deliveryTerms = document.getElementById('deliveryTerms').value;
            const leadTime = document.getElementById('leadTime').value;
            const notes = document.getElementById('quoteNotes').value;
            
            if (!validUntil) {
                this.showToast('Please select valid until date', 'error');
                return;
            }
            
            const total = this.quoteItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
            const quoteNumber = status === 'draft' ? null : ('QTE-' + Date.now() + '-' + Math.floor(Math.random() * 1000));
            
            let quoteData = {
                supplier_id: this.supplier.id,
                inquiry_id: inquiryId,
                valid_until: new Date(validUntil).toISOString(),
                status: status,
                total_amount: total,
                currency: 'UGX',
                payment_terms: [paymentTerms],
                delivery_terms: [deliveryTerms],
                lead_time_days: leadTime ? parseInt(leadTime) : null,
                notes: notes || null
            };
            
            if (quoteNumber) {
                quoteData.quote_number = quoteNumber;
            }
            
            let savedQuote;
            
            if (quoteId) {
                // Update existing
                quoteData.updated_at = new Date().toISOString();
                const { data, error } = await sb
                    .from('supplier_quotes')
                    .update(quoteData)
                    .eq('id', quoteId)
                    .select()
                    .single();
                    
                if (error) throw error;
                savedQuote = data;
                
                // Delete old items
                await sb.from('supplier_quote_items').delete().eq('supplier_quote_id', quoteId);
                
            } else {
                // Create new
                quoteData.created_at = new Date().toISOString();
                const { data, error } = await sb
                    .from('supplier_quotes')
                    .insert(quoteData)
                    .select()
                    .single();
                    
                if (error) throw error;
                savedQuote = data;
            }
            
            // Insert items
            if (this.quoteItems.length > 0) {
                const items = this.quoteItems.map(item => ({
                    supplier_quote_id: savedQuote.id,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    total_price: item.unit_price * item.quantity,
                    notes: item.notes || null
                }));
                
                const { error: itemsError } = await sb
                    .from('supplier_quote_items')
                    .insert(items);
                    
                if (itemsError) throw itemsError;
            }
            
            // If sent, create notification for buyer
            if (status === 'sent' && inquiryId) {
                const inquiry = this.inquiries.find(i => i.id === inquiryId);
                if (inquiry) {
                    await sb.from('notifications').insert({
                        user_id: inquiry.buyer_id,
                        type: 'quote_received',
                        title: 'New Quotation Received',
                        message: `You've received a quotation for your inquiry: ${inquiry.title}`,
                        link: `/buyer-quote.html?id=${savedQuote.id}`
                    });
                }
            }
            
            this.closeCreateQuoteModal();
            await this.loadQuotations(true);
            
            this.showToast(status === 'draft' ? 'Quote saved as draft' : 'Quote sent successfully!', 'success');
            
        } catch (error) {
            console.error('Error saving quote:', error);
            this.showToast('Error saving quote: ' + error.message, 'error');
        }
    },
    
    async editQuote(quoteId) {
        const quote = this.quotations.find(q => q.id === quoteId);
        if (!quote || quote.status !== 'draft') return;
        
        this.currentQuote = quote;
        this.quoteItems = (quote.supplier_quote_items || []).map(item => ({
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            notes: item.notes || ''
        }));
        
        document.getElementById('createQuoteTitle').textContent = 'Edit Quotation';
        document.getElementById('quoteId').value = quote.id;
        document.getElementById('inquiryId').value = quote.inquiry_id || '';
        
        if (quote.valid_until) {
            document.getElementById('validUntil').value = quote.valid_until.split('T')[0];
        }
        
        document.getElementById('paymentTerms').value = quote.payment_terms?.[0] || 'advance_full';
        document.getElementById('deliveryTerms').value = quote.delivery_terms?.[0] || 'ex_warehouse';
        document.getElementById('leadTime').value = quote.lead_time_days || '7';
        document.getElementById('quoteNotes').value = quote.notes || '';
        
        // Load buyer info
        if (quote.inquiry_id) {
            await this.loadBuyerInfo(quote.inquiry_id);
        }
        
        this.renderQuoteItems();
        document.getElementById('createQuoteModal').classList.add('show');
    },
    
    async duplicateQuote(quoteId) {
        const quote = this.quotations.find(q => q.id === quoteId);
        if (!quote) return;
        
        this.quoteItems = (quote.supplier_quote_items || []).map(item => ({
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            notes: item.notes || ''
        }));
        
        document.getElementById('createQuoteTitle').textContent = 'Duplicate Quotation';
        document.getElementById('quoteId').value = '';
        document.getElementById('inquiryId').value = quote.inquiry_id || '';
        
        if (quote.valid_until) {
            document.getElementById('validUntil').value = quote.valid_until.split('T')[0];
        } else {
            const validUntil = new Date();
            validUntil.setDate(validUntil.getDate() + 7);
            document.getElementById('validUntil').value = validUntil.toISOString().split('T')[0];
        }
        
        document.getElementById('paymentTerms').value = quote.payment_terms?.[0] || 'advance_full';
        document.getElementById('deliveryTerms').value = quote.delivery_terms?.[0] || 'ex_warehouse';
        document.getElementById('leadTime').value = quote.lead_time_days || '7';
        document.getElementById('quoteNotes').value = quote.notes || '';
        
        if (quote.inquiry_id) {
            await this.loadBuyerInfo(quote.inquiry_id);
        }
        
        this.renderQuoteItems();
        document.getElementById('createQuoteModal').classList.add('show');
    },
    
    async sendQuote(quoteId) {
        if (!confirm('Send this quotation to the buyer?')) return;
        
        try {
            const { error } = await sb
                .from('supplier_quotes')
                .update({ 
                    status: 'sent',
                    updated_at: new Date().toISOString()
                })
                .eq('id', quoteId);
            
            if (error) throw error;
            
            this.showToast('Quote sent successfully', 'success');
            await this.loadQuotations(true);
            
        } catch (error) {
            console.error('Error sending quote:', error);
            this.showToast('Error sending quote', 'error');
        }
    },
    
    deleteQuote(quoteId) {
        this.currentQuote = this.quotations.find(q => q.id === quoteId);
        document.getElementById('deleteModal').classList.add('show');
    },
    
    async confirmDelete() {
        if (!this.currentQuote) return;
        
        try {
            const { error } = await sb
                .from('supplier_quotes')
                .delete()
                .eq('id', this.currentQuote.id);
            
            if (error) throw error;
            
            this.showToast('Quote deleted', 'success');
            this.closeDeleteModal();
            await this.loadQuotations(true);
            
        } catch (error) {
            console.error('Error deleting quote:', error);
            this.showToast('Error deleting quote', 'error');
        }
    },
    
    viewOrder(quoteId) {
        // Navigate to order if it exists
        this.showToast('View order feature coming soon', 'info');
    },
    
    // ============================================
    // FILTER FUNCTIONS
    // ============================================
    filterQuotations(status) {
        this.currentTab = status;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === status);
        });
        
        this.loadQuotations(true);
    },
    
    applyFilters() {
        const statusFilters = [];
        document.querySelectorAll('.status-filter:checked').forEach(cb => {
            statusFilters.push(cb.value);
        });
        
        this.filters.status = statusFilters;
        this.filters.dateRange = document.getElementById('dateRange').value;
        
        this.loadQuotations(true);
        this.closeFilterPanel();
    },
    
    resetFilters() {
        document.querySelectorAll('.status-filter').forEach(cb => cb.checked = false);
        document.getElementById('dateRange').value = 'all';
        
        this.filters = {
            status: [],
            dateRange: 'all',
            search: this.filters.search
        };
        
        this.loadQuotations(true);
        this.closeFilterPanel();
    },
    
    handleSearch() {
        const searchTerm = document.getElementById('searchInput').value;
        this.filters.search = searchTerm;
        this.loadQuotations(true);
    },
    
    toggleFilterPanel() {
        const panel = document.getElementById('filterPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    },
    
    closeFilterPanel() {
        document.getElementById('filterPanel').style.display = 'none';
    },
    
    loadMoreQuotes() {
        if (!this.hasMore || this.isLoading) return;
        this.currentPage++;
        this.loadQuotations(false);
    },
    
    // ============================================
    // MODAL FUNCTIONS
    // ============================================
    closeQuoteModal() {
        document.getElementById('quoteModal').classList.remove('show');
    },
    
    closeCreateQuoteModal() {
        document.getElementById('createQuoteModal').classList.remove('show');
    },
    
    closeDeleteModal() {
        document.getElementById('deleteModal').classList.remove('show');
        this.currentQuote = null;
    },
    
    closeSuccessModal() {
        document.getElementById('successModal').classList.remove('show');
    },
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    formatStatus(status) {
        const statusMap = {
            'draft': 'Draft',
            'sent': 'Sent',
            'accepted': 'Accepted',
            'rejected': 'Rejected',
            'expired': 'Expired'
        };
        return statusMap[status] || status;
    },
    
    formatPaymentTerms(term) {
        const terms = {
            'advance_full': '100% Advance',
            'advance_partial': '50% Advance',
            'credit_7': '7 Days Credit',
            'credit_15': '15 Days Credit',
            'credit_30': '30 Days Credit',
            'negotiable': 'Negotiable'
        };
        return terms[term] || term || 'Not specified';
    },
    
    formatDeliveryTerms(term) {
        const terms = {
            'ex_warehouse': 'Ex-Warehouse',
            'fob': 'FOB',
            'cif': 'CIF',
            'door_delivery': 'Door Delivery',
            'pickup': 'Buyer Pickup'
        };
        return terms[term] || term || 'Not specified';
    },
    
    formatNumber(num) {
        if (!num) return '0';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },
    
    // ============================================
    // EVENT LISTENERS
    // ============================================
    setupEventListeners() {
        // Search with debounce
        let searchTimeout;
        document.getElementById('searchInput').addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.handleSearch(), 500);
        });
        
        // Filter button
        document.getElementById('filterBtn').addEventListener('click', () => {
            this.toggleFilterPanel();
        });
        
        // Apply filters
        document.getElementById('applyFilters').addEventListener('click', () => {
            this.applyFilters();
        });
        
        // Reset filters
        document.getElementById('resetFilters').addEventListener('click', () => {
            this.resetFilters();
        });
        
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.filterQuotations(tab);
            });
        });
        
        // Menu toggle
        document.getElementById('menuToggle').addEventListener('click', () => {
            // Could open a sidebar menu
            console.log('Menu clicked');
        });
        
        // Close modals on outside click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeQuoteModal();
                    this.closeCreateQuoteModal();
                    this.closeDeleteModal();
                    this.closeSuccessModal();
                }
            });
        });
    }
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    SupplierQuotations.init();
});

// Global functions
window.SupplierQuotations = SupplierQuotations;
window.filterQuotations = (status) => SupplierQuotations.filterQuotations(status);
window.createNewQuote = () => SupplierQuotations.createNewQuote();
window.loadMoreQuotes = () => SupplierQuotations.loadMoreQuotes();
window.closeQuoteModal = () => SupplierQuotations.closeQuoteModal();
window.closeCreateQuoteModal = () => SupplierQuotations.closeCreateQuoteModal();
window.closeDeleteModal = () => SupplierQuotations.closeDeleteModal();
window.closeSuccessModal = () => SupplierQuotations.closeSuccessModal();
window.addQuoteItem = () => SupplierQuotations.addQuoteItem();
window.saveQuoteAsDraft = () => SupplierQuotations.saveQuoteAsDraft();
window.sendQuote = () => SupplierQuotations.sendQuote();
window.confirmDelete = () => SupplierQuotations.confirmDelete();