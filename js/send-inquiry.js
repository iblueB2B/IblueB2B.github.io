// ============================================
// SEND INQUIRY - FIXED VERSION
// ============================================

const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
let currentUser = null;
let currentStep = 1;
let selectedProducts = new Map();
let uploadedFiles = [];
let availableProducts = [];
let categories = [];
let matchingSuppliers = [];

// Form data
let inquiryData = {
    title: '',
    description: '',
    expectedDelivery: '',
    paymentTerms: '',
    deliveryTerms: '',
    shippingDistrict: '',
    shippingAddress: ''
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadCategories();
    await loadProducts();
    await loadDistricts();
    setupEventListeners();
    setMinDeliveryDate();
    updateStep(1);
});

// ============================================
// AUTHENTICATION
// ============================================
async function checkAuth() {
    try {
        const { data: { user }, error } = await sb.auth.getUser();
        if (error || !user) {
            window.location.href = 'login.html?redirect=send-inquiry.html';
            return;
        }
        currentUser = user;
        
        // Check if user is a buyer
        const { data: profile } = await sb
            .from('profiles')
            .select('is_buyer, is_supplier')
            .eq('id', user.id)
            .single();
            
        if (profile && !profile.is_buyer && profile.is_supplier) {
            showToast('This page is for buyers. Suppliers should use the quote management page.');
            setTimeout(() => window.location.href = 'supplier-dashboard.html', 3000);
        }
    } catch (error) {
        console.error('Error checking auth:', error);
        window.location.href = 'login.html';
    }
}

// ============================================
// LOAD DATA
// ============================================
async function loadCategories() {
    try {
        const { data, error } = await sb
            .from('categories')
            .select('id, name, display_name')
            .eq('is_active', true)
            .order('display_order');
            
        if (error) throw error;
        categories = data || [];
        renderCategoryFilters();
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

async function loadProducts(filters = {}) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    
    grid.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        let query = sb
            .from('ads')
            .select(`
                id,
                title,
                price,
                wholesale_price,
                currency,
                image_urls,
                moq,
                is_bulk_only,
                category_id,
                sku
            `)
            .eq('status', 'active')
            .not('wholesale_price', 'is', null);
            
        if (filters.categories && filters.categories.length > 0) {
            query = query.in('category_id', filters.categories);
        }
        
        if (filters.search) {
            query = query.ilike('title', `%${filters.search}%`);
        }
        
        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (error) throw error;
        
        availableProducts = data || [];
        renderProducts(availableProducts);
    } catch (error) {
        console.error('Error loading products:', error);
        grid.innerHTML = '<p class="error-message">Failed to load products</p>';
    }
}

async function loadDistricts() {
    try {
        const { data: districts, error } = await sb
            .from('districts')
            .select('name, region:regions(name)')
            .order('name');
            
        const select = document.getElementById('shippingDistrict');
        if (!select) return;
        
        let options = '<option value="">Select district</option>';
        
        if (districts && districts.length > 0) {
            const grouped = {};
            districts.forEach(d => {
                const region = d.region?.name || 'Other';
                if (!grouped[region]) grouped[region] = [];
                grouped[region].push(d.name);
            });
            
            Object.keys(grouped).sort().forEach(region => {
                options += `<optgroup label="${region}">`;
                grouped[region].sort().forEach(district => {
                    options += `<option value="${district}">${district}</option>`;
                });
                options += '</optgroup>';
            });
        } else {
            // Fallback
            const ugandaRegions = [
                { region: 'Central', districts: ['Kampala', 'Wakiso', 'Mukono'] },
                { region: 'Western', districts: ['Mbarara', 'Kasese', 'Kabale'] },
                { region: 'Eastern', districts: ['Jinja', 'Mbale', 'Tororo'] },
                { region: 'Northern', districts: ['Gulu', 'Lira', 'Arua'] }
            ];
            
            ugandaRegions.forEach(region => {
                options += `<optgroup label="${region.region}">`;
                region.districts.forEach(district => {
                    options += `<option value="${district}">${district}</option>`;
                });
                options += '</optgroup>';
            });
        }
        
        select.innerHTML = options;
        
    } catch (error) {
        console.error('Error loading districts:', error);
    }
}

// ============================================
// RENDERING FUNCTIONS
// ============================================
function renderCategoryFilters() {
    const container = document.getElementById('categoryFilters');
    if (!container) return;
    
    container.innerHTML = categories.map(cat => `
        <label class="category-checkbox">
            <input type="checkbox" value="${cat.id}" class="category-filter">
            <span>${cat.display_name || cat.name}</span>
        </label>
    `).join('');
}

function renderProducts(products) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    
    if (products.length === 0) {
        grid.innerHTML = '<p class="text-muted">No products found</p>';
        return;
    }
    
    grid.innerHTML = products.map(product => {
        const isSelected = selectedProducts.has(product.id);
        const imageUrl = product.image_urls?.[0] || 'https://via.placeholder.com/200';
        const price = product.wholesale_price || product.price || 0;
        
        return `
            <div class="product-card ${isSelected ? 'selected' : ''}" data-product-id="${product.id}" onclick="toggleProduct(${product.id})">
                <div class="product-image">
                    <img src="${imageUrl}" alt="${escapeHtml(product.title)}" loading="lazy">
                    ${product.is_bulk_only ? '<span class="product-badge">BULK</span>' : ''}
                    <div class="select-indicator">
                        ${isSelected ? '<i class="fas fa-check"></i>' : ''}
                    </div>
                </div>
                <div class="product-info">
                    <div class="product-title">${escapeHtml(product.title)}</div>
                    <div class="product-price">UGX ${formatNumber(price)}</div>
                    ${product.moq ? `<div class="product-moq">MOQ: ${product.moq}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function renderSelectedSummary() {
    const summary = document.getElementById('selectedSummary');
    const selectedItems = document.getElementById('selectedItems');
    const selectedCount = document.getElementById('selectedCount');
    
    if (selectedProducts.size === 0) {
        summary.style.display = 'none';
        return;
    }
    
    summary.style.display = 'block';
    selectedCount.textContent = selectedProducts.size;
    
    selectedItems.innerHTML = Array.from(selectedProducts.values()).map(product => `
        <div class="selected-item-tag">
            <span>${escapeHtml(product.title.substring(0, 20))}</span>
            <i class="fas fa-times remove-item" onclick="removeProduct(${product.id})"></i>
        </div>
    `).join('');
}

function renderInquiryProducts() {
    const container = document.getElementById('inquiryProducts');
    if (!container) return;
    
    if (selectedProducts.size === 0) {
        updateStep(1);
        return;
    }
    
    container.innerHTML = Array.from(selectedProducts.values()).map(product => `
        <div class="inquiry-product-item" data-product-id="${product.id}">
            <div class="inquiry-product-header">
                <h4>${escapeHtml(product.title)}</h4>
                <button class="remove-product" onclick="removeProduct(${product.id})">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
            <div class="inquiry-product-details">
                <div class="form-group">
                    <label>Quantity <span class="required">*</span></label>
                    <input type="number" 
                           class="product-quantity" 
                           data-product-id="${product.id}"
                           value="${product.quantity || ''}" 
                           placeholder="Enter quantity"
                           min="${product.moq || 1}"
                           onchange="updateProductQuantity(${product.id}, this.value)">
                </div>
                <div class="form-group">
                    <label>Target Price (UGX)</label>
                    <input type="number" 
                           class="product-price-input" 
                           data-product-id="${product.id}"
                           value="${product.targetPrice || ''}" 
                           placeholder="Optional"
                           onchange="updateProductTargetPrice(${product.id}, this.value)">
                </div>
                <div class="form-group">
                    <label>Requirements</label>
                    <textarea class="product-notes" 
                              data-product-id="${product.id}"
                              placeholder="Specific requirements..."
                              onchange="updateProductNotes(${product.id}, this.value)">${product.notes || ''}</textarea>
                </div>
            </div>
        </div>
    `).join('');
}

async function renderMatchingSuppliers() {
    const container = document.getElementById('matchingSuppliers');
    if (!container) return;
    
    container.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const { data: suppliers, error } = await sb
            .from('suppliers')
            .select(`
                id,
                business_name,
                warehouse_district,
                verification_status,
                profiles!suppliers_profile_id_fkey (avatar_url)
            `)
            .eq('verification_status', 'verified')
            .limit(10);
            
        if (error) throw error;
        
        matchingSuppliers = suppliers || [];
        
        if (matchingSuppliers.length === 0) {
            container.innerHTML = '<p class="text-muted">No matching suppliers found</p>';
            return;
        }
        
        container.innerHTML = matchingSuppliers.map(supplier => {
            const initials = supplier.business_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'BS';
            
            return `
                <div class="supplier-match-item">
                    <div class="supplier-avatar">
                        ${supplier.profiles?.avatar_url ? 
                            `<img src="${supplier.profiles.avatar_url}" alt="${supplier.business_name}">` : 
                            initials
                        }
                    </div>
                    <div class="supplier-info">
                        <div class="supplier-name">${escapeHtml(supplier.business_name)}</div>
                        <div class="supplier-location">
                            <i class="fas fa-map-marker-alt"></i> ${escapeHtml(supplier.warehouse_district || 'Uganda')}
                        </div>
                    </div>
                    <div class="supplier-badge">Verified</div>
                </div>
            `;
        }).join('');
        
        document.getElementById('sentSupplierCount').textContent = matchingSuppliers.length;
        
    } catch (error) {
        console.error('Error loading suppliers:', error);
        container.innerHTML = '<p class="error-message">Error loading suppliers</p>';
    }
}

function renderSummary() {
    document.getElementById('summaryProductCount').textContent = selectedProducts.size;
    
    const summaryProducts = document.getElementById('summaryProducts');
    summaryProducts.innerHTML = Array.from(selectedProducts.values()).map(product => `
        <div class="summary-product">
            <span class="summary-product-name">${escapeHtml(product.title.substring(0, 30))}</span>
            <span class="summary-product-qty">Qty: ${product.quantity || 'Not specified'}</span>
        </div>
    `).join('');
    
    document.getElementById('summaryTitle').textContent = inquiryData.title || '-';
    document.getElementById('summaryDelivery').textContent = inquiryData.expectedDelivery ? 
        new Date(inquiryData.expectedDelivery).toLocaleDateString() : '-';
    document.getElementById('summaryPayment').textContent = formatPaymentTerms(inquiryData.paymentTerms);
    document.getElementById('summaryDeliveryTerms').textContent = formatDeliveryTerms(inquiryData.deliveryTerms);
    document.getElementById('summaryShipping').textContent = inquiryData.shippingAddress ? 
        `${inquiryData.shippingAddress} (${inquiryData.shippingDistrict})` : 
        inquiryData.shippingDistrict || '-';
    
    const attachmentsSection = document.getElementById('summaryAttachmentsSection');
    const summaryAttachments = document.getElementById('summaryAttachments');
    
    if (uploadedFiles.length > 0) {
        attachmentsSection.style.display = 'block';
        summaryAttachments.innerHTML = uploadedFiles.map(file => `
            <div class="attachment-badge">
                <i class="fas ${getFileIcon(file.type)}"></i>
                <span>${file.name}</span>
            </div>
        `).join('');
    } else {
        attachmentsSection.style.display = 'none';
    }
}

// ============================================
// PRODUCT SELECTION
// ============================================
window.toggleProduct = function(productId) {
    const product = availableProducts.find(p => p.id === productId);
    if (!product) return;
    
    if (selectedProducts.has(productId)) {
        selectedProducts.delete(productId);
    } else {
        selectedProducts.set(productId, {
            id: product.id,
            title: product.title,
            moq: product.moq,
            quantity: product.moq || null,
            targetPrice: null,
            notes: ''
        });
    }
    
    renderProducts(availableProducts);
    renderSelectedSummary();
    validateStep1();
};

window.removeProduct = function(productId) {
    selectedProducts.delete(productId);
    renderProducts(availableProducts);
    renderSelectedSummary();
    
    if (currentStep === 2) renderInquiryProducts();
    if (currentStep === 3) {
        renderInquiryProducts();
        renderSummary();
    }
    
    validateStep1();
    validateStep2();
};

window.updateProductQuantity = function(productId, quantity) {
    const product = selectedProducts.get(productId);
    if (product) {
        product.quantity = quantity ? parseInt(quantity) : null;
        selectedProducts.set(productId, product);
    }
    validateStep2();
};

window.updateProductTargetPrice = function(productId, price) {
    const product = selectedProducts.get(productId);
    if (product) {
        product.targetPrice = price ? parseFloat(price) : null;
        selectedProducts.set(productId, product);
    }
};

window.updateProductNotes = function(productId, notes) {
    const product = selectedProducts.get(productId);
    if (product) {
        product.notes = notes;
        selectedProducts.set(productId, product);
    }
};

// ============================================
// STEP NAVIGATION
// ============================================
function updateStep(step) {
    currentStep = step;
    
    document.querySelectorAll('.step').forEach((el, index) => {
        const stepNum = index + 1;
        el.classList.remove('active', 'completed');
        if (stepNum === step) {
            el.classList.add('active');
        } else if (stepNum < step) {
            el.classList.add('completed');
        }
    });
    
    document.querySelectorAll('.step-content').forEach((el, index) => {
        const stepNum = index + 1;
        el.classList.toggle('active', stepNum === step);
    });
    
    if (step === 2) {
        renderInquiryProducts();
        validateStep2();
    } else if (step === 3) {
        renderSummary();
        renderMatchingSuppliers();
        validateStep3();
    }
}

// ============================================
// VALIDATION
// ============================================
function validateStep1() {
    const continueBtn = document.getElementById('continueToStep2');
    if (continueBtn) continueBtn.disabled = selectedProducts.size === 0;
}

function validateStep2() {
    const continueBtn = document.getElementById('continueToStep3');
    const title = document.getElementById('inquiryTitle');
    
    let allHaveQuantity = true;
    selectedProducts.forEach(product => {
        if (!product.quantity || product.quantity < (product.moq || 1)) {
            allHaveQuantity = false;
        }
    });
    
    const isValid = selectedProducts.size > 0 && 
                    allHaveQuantity && 
                    title && title.value.trim().length > 0;
    
    if (continueBtn) continueBtn.disabled = !isValid;
}

function validateStep3() {
    const submitBtn = document.getElementById('submitInquiry');
    const termsCheck = document.getElementById('acceptTerms');
    if (submitBtn && termsCheck) {
        submitBtn.disabled = !termsCheck.checked;
    }
}

// ============================================
// FILE UPLOAD
// ============================================
function setupFileUpload() {
    const uploadArea = document.getElementById('fileUploadArea');
    const fileInput = document.getElementById('fileInput');
    
    if (!uploadArea || !fileInput) return;
    
    uploadArea.addEventListener('click', () => fileInput.click());
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = 'var(--primary)';
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = 'var(--gray-300)';
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = 'var(--gray-300)';
        handleFiles(Array.from(e.dataTransfer.files));
    });
    
    fileInput.addEventListener('change', (e) => {
        handleFiles(Array.from(e.target.files));
    });
}

function handleFiles(files) {
    const maxSize = 10 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    
    files.forEach(file => {
        if (file.size > maxSize) {
            showToast(`File ${file.name} exceeds 10MB`);
            return;
        }
        uploadedFiles.push(file);
    });
    
    renderFileList();
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    
    if (uploadedFiles.length === 0) {
        fileList.innerHTML = '';
        return;
    }
    
    fileList.innerHTML = uploadedFiles.map((file, index) => `
        <div class="file-item">
            <i class="fas ${getFileIcon(file.type)}"></i>
            <span class="file-name">${file.name}</span>
            <span class="file-size">${formatFileSize(file.size)}</span>
            <i class="fas fa-times remove-file" onclick="removeFile(${index})"></i>
        </div>
    `).join('');
}

window.removeFile = function(index) {
    uploadedFiles.splice(index, 1);
    renderFileList();
};

// ============================================
// SUBMIT INQUIRY - FIXED VERSION
// ============================================
async function submitInquiry() {
    const submitBtn = document.getElementById('submitInquiry');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }
    
    try {
        collectFormData();
        
        if (!currentUser) throw new Error('Please login');
        if (selectedProducts.size === 0) throw new Error('Select at least one product');
        if (!inquiryData.title) throw new Error('Enter an inquiry title');
        
        const inquiryNumber = 'INQ-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        
        // 1. Create inquiry request
        const { data: inquiry, error: inquiryError } = await sb
            .from('inquiry_requests')
            .insert({
                inquiry_number: inquiryNumber,
                buyer_id: currentUser.id,
                title: inquiryData.title,
                description: inquiryData.description || null,
                expected_delivery_date: inquiryData.expectedDelivery || null,
                shipping_address: inquiryData.shippingAddress || null,
                shipping_district: inquiryData.shippingDistrict || null,
                payment_terms: inquiryData.paymentTerms ? [inquiryData.paymentTerms] : null,
                delivery_terms: inquiryData.deliveryTerms ? [inquiryData.deliveryTerms] : null,
                status: 'sent',
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            })
            .select()
            .single();
            
        if (inquiryError) throw inquiryError;
        
        // 2. Create inquiry items - FIXED: removed ad_id reference
        for (const [productId, productData] of selectedProducts) {
            const product = availableProducts.find(p => p.id === productId);
            if (!product) continue;
            
            const { error: itemError } = await sb
                .from('inquiry_items')
                .insert({
                    inquiry_id: inquiry.id,
                    product_id: productId, // This is correct - references ads(id)
                    product_name: product.title,
                    product_sku: product.sku || null,
                    quantity: productData.quantity || 1,
                    preferred_unit_price: productData.targetPrice || null,
                    specifications: productData.notes ? { notes: productData.notes } : null,
                    notes: productData.notes || null
                });
                
            if (itemError) throw itemError;
        }
        
        // 3. Find matching suppliers
        const productIds = Array.from(selectedProducts.keys());
        let supplierIds = [];
        
        try {
            const { data: supplierProducts } = await sb
                .from('supplier_product_catalog')
                .select('supplier_id')
                .in('product_id', productIds)
                .eq('is_active', true);
                
            supplierIds = [...new Set(supplierProducts?.map(sp => sp.supplier_id) || [])];
        } catch (e) {
            console.log('Supplier catalog not available');
        }
        
        if (supplierIds.length === 0) {
            const { data: suppliers } = await sb
                .from('suppliers')
                .select('id')
                .eq('verification_status', 'verified')
                .limit(20);
                
            supplierIds = suppliers?.map(s => s.id) || [];
        }
        
        // 4. Create matches
        if (supplierIds.length > 0) {
            const matches = supplierIds.map(supplierId => ({
                inquiry_id: inquiry.id,
                supplier_id: supplierId,
                match_score: 100
            }));
            
            await sb.from('inquiry_supplier_matches').insert(matches);
        }
        
        // 5. Upload files
        if (uploadedFiles.length > 0) {
            for (const file of uploadedFiles) {
                const filePath = `inquiries/${inquiry.id}/${Date.now()}_${file.name}`;
                
                const { error: uploadError } = await sb.storage
                    .from('inquiry-attachments')
                    .upload(filePath, file);
                    
                if (uploadError) throw uploadError;
                
                const { data: { publicUrl } } = sb.storage
                    .from('inquiry-attachments')
                    .getPublicUrl(filePath);
                
                await sb.from('rfq_attachments').insert({
                    negotiation_id: inquiry.id,
                    file_url: publicUrl,
                    file_name: file.name,
                    file_size: file.size,
                    uploaded_by: currentUser.id
                });
            }
        }
        
        // 6. Create notifications
        if (supplierIds.length > 0) {
            const notifications = supplierIds.map(supplierId => ({
                user_id: supplierId,
                type: 'new_inquiry',
                title: 'New Bulk Inquiry',
                message: `You've received a new inquiry: ${inquiryData.title}`,
                link: `/supplier-inquiry.html?id=${inquiry.id}`
            }));
            
            await sb.from('notifications').insert(notifications);
        }
        
        // Show success
        document.getElementById('sentInquiryNumber').textContent = inquiryNumber;
        document.getElementById('successModal').classList.add('show');
        
    } catch (error) {
        console.error('Error submitting inquiry:', error);
        showToast(error.message || 'Failed to send inquiry');
        
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Inquiry';
        }
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function collectFormData() {
    inquiryData = {
        title: document.getElementById('inquiryTitle')?.value || '',
        description: document.getElementById('inquiryDescription')?.value || '',
        expectedDelivery: document.getElementById('expectedDelivery')?.value || '',
        paymentTerms: document.getElementById('paymentTerms')?.value || '',
        deliveryTerms: document.getElementById('deliveryTerms')?.value || '',
        shippingDistrict: document.getElementById('shippingDistrict')?.value || '',
        shippingAddress: document.getElementById('shippingAddress')?.value || ''
    };
}

function setMinDeliveryDate() {
    const input = document.getElementById('expectedDelivery');
    if (input) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        input.min = tomorrow.toISOString().split('T')[0];
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!num) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mimeType) {
    if (mimeType?.includes('pdf')) return 'fa-file-pdf';
    if (mimeType?.includes('excel') || mimeType?.includes('sheet')) return 'fa-file-excel';
    if (mimeType?.includes('image')) return 'fa-file-image';
    return 'fa-file';
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
    return terms[term] || term || '-';
}

function formatDeliveryTerms(term) {
    const terms = {
        'ex_warehouse': 'Ex-Warehouse',
        'fob': 'FOB',
        'cif': 'CIF',
        'door_delivery': 'Door Delivery',
        'pickup': 'Buyer Pickup'
    };
    return terms[term] || term || '-';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    // Filter button
    document.getElementById('filterBtn')?.addEventListener('click', () => {
        const panel = document.getElementById('filterPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    
    // Apply filters
    document.getElementById('applyFilters')?.addEventListener('click', () => {
        const selectedCategories = Array.from(document.querySelectorAll('.category-filter:checked'))
            .map(cb => parseInt(cb.value));
        
        loadProducts({
            categories: selectedCategories,
            search: document.getElementById('productSearch')?.value
        });
        
        document.getElementById('filterPanel').style.display = 'none';
    });
    
    // Search debounce
    let searchTimeout;
    document.getElementById('productSearch')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const selectedCategories = Array.from(document.querySelectorAll('.category-filter:checked'))
                .map(cb => parseInt(cb.value));
            
            loadProducts({
                categories: selectedCategories,
                search: e.target.value
            });
        }, 500);
    });
    
    // Clear all
    document.getElementById('clearAllBtn')?.addEventListener('click', () => {
        selectedProducts.clear();
        renderProducts(availableProducts);
        renderSelectedSummary();
    });
    
    // Step navigation
    document.getElementById('continueToStep2')?.addEventListener('click', () => updateStep(2));
    document.getElementById('continueToStep3')?.addEventListener('click', () => {
        collectFormData();
        updateStep(3);
    });
    
    document.getElementById('backToStep1')?.addEventListener('click', () => updateStep(1));
    document.getElementById('backToStep2')?.addEventListener('click', () => {
        collectFormData();
        updateStep(2);
    });
    
    // Form validation
    document.getElementById('inquiryTitle')?.addEventListener('input', validateStep2);
    
    // Terms checkbox
    document.getElementById('acceptTerms')?.addEventListener('change', validateStep3);
    
    // Submit
    document.getElementById('submitInquiry')?.addEventListener('click', submitInquiry);
    
    // File upload
    setupFileUpload();
    
    // Close modals
    document.querySelectorAll('.modal-close, .modal').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target === el || e.target.classList.contains('modal-close')) {
                document.getElementById('successModal')?.classList.remove('show');
            }
        });
    });
}

// Make functions available globally
window.toggleProduct = toggleProduct;
window.removeProduct = removeProduct;
window.updateProductQuantity = updateProductQuantity;
window.updateProductTargetPrice = updateProductTargetPrice;
window.updateProductNotes = updateProductNotes;
window.removeFile = removeFile;