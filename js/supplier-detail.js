// ============================================
// SUPPLIER DETAIL PAGE - COMPLETE VERSION
// ============================================

console.log('🚀 Supplier detail page loading...');

// Supabase Configuration
const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
const SupplierDetail = {
    supplierId: null,
    supplier: null,
    storefront: {},
    companyProfile: {},
    customStats: [],
    categoryDisplays: [],
    featuredProducts: {
        hot: [],
        new: []
    },
    allProducts: [],
    tips: [],
    
    // ============================================
    // INITIALIZATION
    // ============================================
    async init() {
        // Get supplier ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        this.supplierId = urlParams.get('id');
        
        if (!this.supplierId) {
            this.showError();
            return;
        }
        
        console.log(`📊 Loading supplier ${this.supplierId}...`);
        
        try {
            await Promise.all([
                this.loadSupplier(),
                this.loadStorefront(),
                this.loadCompanyProfile(),
                this.loadCustomStats(),
                this.loadCategoryDisplays(),
                this.loadAllProducts(),
                this.loadFeaturedProducts(),
                this.loadTips()
            ]);
            
            this.renderSupplierHeader();
            this.renderBanner();
            this.renderStats();
            this.renderCategories();
            this.renderTagline();
            this.renderHotProducts();
            this.renderNewArrivals();
            this.renderProfileTab();
            this.renderTips();
            
            // Pre-render all products grid for products tab
            const allProductsGrid = document.getElementById('allProductsGrid');
            if (allProductsGrid) {
                this.renderProductGrid(allProductsGrid, this.allProducts);
            }
            
            this.setupTabListeners();
            this.setupEventListeners();
            
            // Hide loading, show content
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('supplierContent').style.display = 'block';
            
            console.log('✅ Supplier detail page initialized');
        } catch (error) {
            console.error('❌ Error initializing:', error);
            this.showError();
        }
    },
    
    // ============================================
    // LOAD DATA
    // ============================================
    async loadSupplier() {
        try {
            const { data, error } = await sb
                .from('suppliers')
                .select(`
                    *,
                    profiles!suppliers_profile_id_fkey (
                        avatar_url,
                        location,
                        phone,
                        email,
                        full_name,
                        is_verified
                    )
                `)
                .eq('id', this.supplierId)
                .single();

            if (error) throw error;
            
            this.supplier = data;
            console.log('✅ Supplier loaded:', this.supplier.business_name);
            
        } catch (error) {
            console.error('❌ Error loading supplier:', error);
            throw error;
        }
    },
    
    async loadStorefront() {
        try {
            const { data, error } = await sb
                .from('supplier_storefronts')
                .select('*')
                .eq('supplier_id', this.supplierId)
                .maybeSingle();
            
            if (error) throw error;
            this.storefront = data || {};
            
        } catch (error) {
            console.error('❌ Error loading storefront:', error);
            this.storefront = {};
        }
    },
    
    async loadCompanyProfile() {
        try {
            const { data, error } = await sb
                .from('supplier_company_profiles')
                .select('*')
                .eq('supplier_id', this.supplierId)
                .maybeSingle();
            
            if (error) throw error;
            this.companyProfile = data || {};
            
        } catch (error) {
            console.error('❌ Error loading company profile:', error);
            this.companyProfile = {};
        }
    },
    
    async loadCustomStats() {
        try {
            const { data, error } = await sb
                .from('supplier_custom_stats')
                .select('*')
                .eq('supplier_id', this.supplierId)
                .eq('is_active', true)
                .order('display_order', { ascending: true });
            
            if (error) throw error;
            this.customStats = data || [];
            
        } catch (error) {
            console.error('❌ Error loading custom stats:', error);
            this.customStats = [];
        }
    },
    
    async loadCategoryDisplays() {
        try {
            const { data, error } = await sb
                .from('supplier_category_displays')
                .select('*')
                .eq('supplier_id', this.supplierId)
                .eq('is_active', true)
                .order('display_order', { ascending: true });
            
            if (error) throw error;
            this.categoryDisplays = data || [];
            
        } catch (error) {
            console.error('❌ Error loading category displays:', error);
            this.categoryDisplays = [];
        }
    },
    
    async loadAllProducts() {
        try {
            console.log('🔍 Loading products for supplier:', this.supplierId);
            
            // Check if supplier_id in ads is UUID or number
            // From your schema, supplier_id is UUID type
            const { data, error } = await sb
                .from('ads')
                .select(`
                    id,
                    title,
                    price,
                    wholesale_price,
                    currency,
                    image_urls,
                    moq,
                    created_at
                `)
                .eq('supplier_id', this.supplierId)
                .eq('status', 'active')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('❌ Error loading products:', error);
                throw error;
            }
            
            console.log(`✅ Loaded ${data?.length || 0} products:`, data);
            this.allProducts = data || [];
            
        } catch (error) {
            console.error('❌ Error loading products:', error);
            this.allProducts = [];
        }
    },
    
    async loadFeaturedProducts() {
        try {
            const { data, error } = await sb
                .from('supplier_featured_products')
                .select('*, ads(*)')
                .eq('supplier_id', this.supplierId)
                .eq('is_active', true);
            
            if (error) throw error;
            
            this.featuredProducts.hot = data?.filter(f => f.section === 'hot_selling') || [];
            this.featuredProducts.new = data?.filter(f => f.section === 'new_arrivals') || [];
            
        } catch (error) {
            console.error('❌ Error loading featured products:', error);
            this.featuredProducts = { hot: [], new: [] };
        }
    },
    
    async loadTips() {
        try {
            const { data, error } = await sb
                .from('supplier_tips')
                .select('*')
                .eq('supplier_id', this.supplierId)
                .eq('is_published', true)
                .order('published_at', { ascending: false })
                .limit(10);
            
            if (error) throw error;
            this.tips = data || [];
            console.log(`✅ Loaded ${this.tips.length} tips`);
            
        } catch (error) {
            console.error('❌ Error loading tips:', error);
            this.tips = [];
        }
    },
    
    // ============================================
    // RENDER FUNCTIONS
    // ============================================
    renderSupplierHeader() {
        const profile = this.supplier.profiles || {};
        const name = this.supplier.business_name;
        const initials = name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'BS';
        const location = profile.location || this.supplier.warehouse_district || 'Uganda';
        const years = this.supplier.year_established ? 
            `${new Date().getFullYear() - parseInt(this.supplier.year_established)} yrs` : '6 yrs';
        const orders = this.formatNumber(this.supplier.total_orders || 1000) + '+';
        
        // Avatar
        const avatarContainer = document.getElementById('supplierAvatar');
        if (avatarContainer) {
            avatarContainer.innerHTML = profile.avatar_url ? 
                `<img src="${profile.avatar_url}" alt="${name}">` : 
                initials;
        }
        
        // Name
        const nameElement = document.getElementById('supplierName');
        if (nameElement) nameElement.textContent = name;
        
        // Stats
        const statsContainer = document.getElementById('supplierStats');
        if (statsContainer) {
            statsContainer.innerHTML = `
                <span><i class="far fa-calendar-alt"></i> ${years}</span>
                <span><i class="fas fa-map-marker-alt"></i> ${location}</span>
                <span><i class="fas fa-chart-line"></i> ${orders} orders</span>
            `;
        }
        
        // Badges
        const badgesContainer = document.getElementById('supplierBadges');
        if (badgesContainer) {
            let badgesHtml = '';
            if (this.supplier.verification_status === 'verified') {
                badgesHtml += '<span class="verified-badge-compact"><i class="fas fa-check-circle"></i> Verified</span>';
            }
            if (this.supplier.is_featured) {
                badgesHtml += '<span class="featured-badge-compact"><i class="fas fa-star"></i> Featured</span>';
            }
            badgesContainer.innerHTML = badgesHtml;
        }
    },
    
    renderBanner() {
        const bannerSection = document.getElementById('bannerSection');
        const bannerImage = document.getElementById('bannerImage');
        const bannerTitle = document.getElementById('bannerTitle');
        const bannerSubtitle = document.getElementById('bannerSubtitle');
        const bannerButton = document.getElementById('bannerButton');
        
        if (!bannerSection) return;
        
        if (this.storefront.banner_image_url) {
            bannerSection.style.display = 'block';
            bannerImage.innerHTML = `<img src="${this.storefront.banner_image_url}" alt="Store Banner">`;
            bannerTitle.textContent = this.storefront.banner_title || '';
            bannerSubtitle.textContent = this.storefront.banner_subtitle || '';
            bannerButton.textContent = this.storefront.banner_button_text || 'Learn More';
            bannerButton.href = this.storefront.banner_button_link || '#';
        } else {
            bannerSection.style.display = 'none';
        }
    },
    
    renderStats() {
        const statsContainer = document.getElementById('statsCards');
        if (!statsContainer) return;
        
        if (this.customStats.length > 0) {
            // Use custom stats from storefront
            statsContainer.innerHTML = this.customStats.map(stat => `
                <div class="stat-card">
                    <span class="stat-value">${stat.value}</span>
                    <span class="stat-label">${stat.label}</span>
                </div>
            `).join('');
        } else {
            // Default stats from supplier data
            const years = this.supplier.year_established ? 
                `${new Date().getFullYear() - parseInt(this.supplier.year_established)}+` : '15+';
            
            statsContainer.innerHTML = `
                <div class="stat-card">
                    <span class="stat-value">${years}</span>
                    <span class="stat-label">YEARS<br>EXPERIENCE</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${this.formatNumber(this.supplier.total_orders * 1000 || 10000)}+</span>
                    <span class="stat-label">PRODUCTS<br>SOLD</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${this.allProducts.length}</span>
                    <span class="stat-label">ACTIVE<br>PRODUCTS</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${this.supplier.completion_rate || 98}%</span>
                    <span class="stat-label">ORDER<br>COMPLETION</span>
                </div>
            `;
        }
    },
    
    renderCategories() {
        const container = document.getElementById('productCategories');
        if (!container) return;
        
        if (this.categoryDisplays.length > 0) {
            // Use custom categories from storefront
            container.innerHTML = this.categoryDisplays.map(cat => `
                <a href="#" class="category-pill" onclick="SupplierDetail.searchCategory('${cat.category_name}')">
                    <i class="fas ${cat.icon}"></i> ${cat.category_name}
                </a>
            `).join('');
            container.style.display = 'flex';
        } else {
            // Auto-detect from products
            const categories = new Set();
            this.allProducts.forEach(product => {
                const title = product.title.toLowerCase();
                if (title.includes('scooter')) categories.add('Electric Scooter');
                else if (title.includes('motorcycle')) categories.add('Motorcycle');
                else if (title.includes('bike')) categories.add('E-Bike');
                else if (title.includes('part')) categories.add('Parts');
            });
            
            if (categories.size > 0) {
                container.innerHTML = Array.from(categories).map(cat => {
                    const icon = cat.includes('Scooter') ? 'fa-motorcycle' : 
                                cat.includes('Motorcycle') ? 'fa-gas-pump' :
                                cat.includes('Bike') ? 'fa-bicycle' : 'fa-cog';
                    
                    return `<a href="#" class="category-pill" onclick="SupplierDetail.searchCategory('${cat}')">
                        <i class="fas ${icon}"></i> ${cat}
                    </a>`;
                }).join('');
                container.style.display = 'flex';
            } else {
                container.style.display = 'none';
            }
        }
    },
    
    renderTagline() {
        const taglineElement = document.getElementById('tagline');
        if (!taglineElement) return;
        
        if (this.storefront.tagline) {
            taglineElement.style.display = 'block';
            taglineElement.textContent = this.storefront.tagline;
        } else {
            taglineElement.style.display = 'none';
        }
    },
    
    renderHotProducts() {
        const container = document.getElementById('hotProductsGrid');
        const hotLabel = document.getElementById('hotLabel');
        const welcomeLabel = document.getElementById('welcomeLabel');
        
        if (!container) return;
        
        // Set labels from storefront
        if (hotLabel) hotLabel.textContent = this.storefront.hot_selling_title || 'HOT SELLING PRODUCT';
        if (welcomeLabel) welcomeLabel.textContent = this.storefront.hot_selling_subtitle || 'WELCOME TO OUR COUNTRY';
        
        // Get hot products (from featured products or fallback to first 4 products)
        let productsToShow = [];
        
        if (this.featuredProducts.hot.length > 0) {
            productsToShow = this.featuredProducts.hot.map(fp => fp.ads).filter(p => p);
        }
        
        // If no featured products or they're empty, use first 4 from all products
        if (productsToShow.length === 0 && this.allProducts.length > 0) {
            productsToShow = this.allProducts.slice(0, 4);
        }
        
        this.renderProductGrid(container, productsToShow);
    },
    
    renderNewArrivals() {
        const container = document.getElementById('newArrivalsGrid');
        const section = document.getElementById('newArrivalsSection');
        
        if (!container || !section) return;
        
        // Get new products (from featured products or fallback to next 4 products)
        let productsToShow = [];
        
        if (this.featuredProducts.new.length > 0) {
            productsToShow = this.featuredProducts.new.map(fp => fp.ads).filter(p => p);
        }
        
        // If no featured products or they're empty, use next 4 from all products
        if (productsToShow.length === 0 && this.allProducts.length > 4) {
            productsToShow = this.allProducts.slice(4, 8);
        }
        
        if (productsToShow.length > 0) {
            section.style.display = 'block';
            this.renderProductGrid(container, productsToShow);
        } else {
            section.style.display = 'none';
        }
    },
    
    renderProductGrid(container, products) {
        if (!container) return;
        
        if (products.length === 0) {
            container.innerHTML = '<p class="text-muted">No products available</p>';
            return;
        }
        
        container.innerHTML = products.map(product => {
            const imageUrl = product.image_urls?.[0] || 'https://via.placeholder.com/200?text=Product';
            const price = product.wholesale_price || product.price || 0;
            
            return `
                <a href="product.html?id=${product.id}" class="product-card">
                    <div class="product-image">
                        <img src="${imageUrl}" alt="${this.escapeHtml(product.title)}" loading="lazy" onerror="this.src='https://via.placeholder.com/200?text=No+Image'">
                    </div>
                    <div class="product-info">
                        <div class="product-title">${this.escapeHtml(product.title) || 'Product'}</div>
                        <div class="product-price">UGX ${this.formatNumber(price)}</div>
                        <div class="product-moq">MOQ: ${product.moq || 1} pcs</div>
                    </div>
                </a>
            `;
        }).join('');
    },
    
    renderProfileTab() {
        const profile = this.companyProfile;
        
        // About
        const aboutEl = document.getElementById('aboutContent');
        if (aboutEl) aboutEl.innerHTML = profile.about || '<p class="text-muted">No information provided.</p>';
        
        // Mission
        const missionEl = document.getElementById('missionContent');
        if (missionEl) missionEl.innerHTML = profile.mission || '<p class="text-muted">No mission statement provided.</p>';
        
        // Vision
        const visionEl = document.getElementById('visionContent');
        if (visionEl) visionEl.innerHTML = profile.vision || '<p class="text-muted">No vision statement provided.</p>';
        
        // Core Values
        const coreValues = profile.core_values || [];
        const coreValuesEl = document.getElementById('coreValues');
        if (coreValuesEl) {
            if (coreValues.length > 0) {
                coreValuesEl.innerHTML = coreValues.map(value => 
                    `<span class="core-value-tag">${this.escapeHtml(value)}</span>`
                ).join('');
            } else {
                coreValuesEl.innerHTML = '<p class="text-muted">No core values listed.</p>';
            }
        }
        
        // Facilities
        const facilitiesEl = document.getElementById('facilities');
        if (facilitiesEl) {
            facilitiesEl.innerHTML = `
                <div class="facility-item">
                    <span class="facility-label">Factory Size</span>
                    <span class="facility-value">${profile.factory_size || 'Not specified'}</span>
                </div>
                <div class="facility-item">
                    <span class="facility-label">Location</span>
                    <span class="facility-value">${profile.factory_location || 'Not specified'}</span>
                </div>
                <div class="facility-item">
                    <span class="facility-label">Employees</span>
                    <span class="facility-value">${profile.employee_count || 'Not specified'}</span>
                </div>
                <div class="facility-item">
                    <span class="facility-label">Annual Revenue</span>
                    <span class="facility-value">${profile.annual_revenue || 'Not specified'}</span>
                </div>
            `;
        }
        
        // Certifications
        const certifications = profile.certifications || [];
        const certEl = document.getElementById('certifications');
        if (certEl) {
            if (certifications.length > 0) {
                certEl.innerHTML = certifications.map(cert => `
                    <div class="certification-card">
                        ${cert.image_url ? 
                            `<img src="${cert.image_url}" alt="${cert.name}" class="cert-image">` : 
                            '<div class="cert-placeholder"><i class="fas fa-certificate"></i></div>'}
                        <div class="cert-info">
                            <div class="cert-name">${this.escapeHtml(cert.name)}</div>
                            <div class="cert-meta">${this.escapeHtml(cert.issuer || '')} · ${cert.year || ''}</div>
                        </div>
                    </div>
                `).join('');
            } else {
                certEl.innerHTML = '<p class="text-muted">No certifications listed.</p>';
            }
        }
        
        // Export Markets
        const markets = profile.export_markets || [];
        const marketsEl = document.getElementById('exportMarkets');
        if (marketsEl) {
            if (markets.length > 0) {
                marketsEl.innerHTML = markets.map(market => 
                    `<span class="market-tag">${this.escapeHtml(market)}</span>`
                ).join('');
            } else {
                marketsEl.innerHTML = '<p class="text-muted">No export markets listed.</p>';
            }
        }
        
        // Timeline
        const timeline = profile.company_timeline || [];
        const timelineEl = document.getElementById('timeline');
        if (timelineEl) {
            if (timeline.length > 0) {
                timelineEl.innerHTML = timeline.map(event => `
                    <div class="timeline-item">
                        <div class="timeline-year">${this.escapeHtml(event.year)}</div>
                        <div class="timeline-content">
                            <div class="timeline-title">${this.escapeHtml(event.title)}</div>
                            <div class="timeline-description">${this.escapeHtml(event.description || '')}</div>
                        </div>
                    </div>
                `).join('');
            } else {
                timelineEl.innerHTML = '<p class="text-muted">No timeline events.</p>';
            }
        }
    },
    
    renderTips() {
        const container = document.getElementById('tipsGrid');
        if (!container) return;
        
        if (this.tips.length === 0) {
            container.innerHTML = '<p class="text-muted">No tips or articles available.</p>';
            return;
        }
        
        container.innerHTML = this.tips.map(tip => {
            const date = tip.published_at || tip.created_at;
            const formattedDate = date ? new Date(date).toLocaleDateString('en-US', { 
                year: 'numeric', month: 'short', day: 'numeric' 
            }) : '';
            
            return `
                <div class="tip-card">
                    ${tip.featured_image ? 
                        `<div class="tip-image"><img src="${tip.featured_image}" alt="${tip.title}"></div>` : 
                        ''}
                    <div class="tip-category">${tip.category || 'General'}</div>
                    <h3 class="tip-title">${this.escapeHtml(tip.title)}</h3>
                    <p class="tip-excerpt">${this.escapeHtml(tip.excerpt || tip.content.substring(0, 100))}...</p>
                    <div class="tip-footer">
                        <span class="tip-date">${formattedDate}</span>
                        <span class="tip-views"><i class="far fa-eye"></i> ${tip.view_count || 0}</span>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    formatNumber(num) {
        if (!num) return '0';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    // ============================================
    // SEARCH FUNCTIONS
    // ============================================
    searchCategory(category) {
        window.location.href = `search.html?category=${encodeURIComponent(category)}&supplier=${this.supplierId}`;
    },
    
    filterProducts() {
        const searchTerm = document.getElementById('productSearchInput')?.value.toLowerCase() || '';
        const container = document.getElementById('allProductsGrid');
        
        if (!container) return;
        
        const filtered = this.allProducts.filter(p => 
            p.title.toLowerCase().includes(searchTerm)
        );
        
        if (filtered.length === 0) {
            container.innerHTML = '<p class="text-muted">No products match your search</p>';
            return;
        }
        
        this.renderProductGrid(container, filtered);
    },
    
    // ============================================
    // ACTIONS
    // ============================================
    contactSupplier() {
        sb.auth.getUser().then(({ data: { user } }) => {
            if (user) {
                window.location.href = `chat.html?user=${this.supplierId}`;
            } else {
                window.location.href = `login.html?redirect=supplier-detail.html?id=${this.supplierId}`;
            }
        });
    },
    
    sendInquiry() {
        sb.auth.getUser().then(({ data: { user } }) => {
            if (user) {
                window.location.href = `send-inquiry.html?supplier=${this.supplierId}`;
            } else {
                window.location.href = `login.html?redirect=send-inquiry.html&supplier=${this.supplierId}`;
            }
        });
    },
    
    // ============================================
    // TAB NAVIGATION
    // ============================================
    setupTabListeners() {
        document.querySelectorAll('.tab-link').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const tabId = e.target.dataset.tab;
                
                // Update active tab
                document.querySelectorAll('.tab-link').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                
                // Show corresponding content
                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                document.getElementById(`tab-${tabId}`).classList.add('active');
                
                // If switching to products tab and grid is empty, render products
                if (tabId === 'products') {
                    const allProductsGrid = document.getElementById('allProductsGrid');
                    if (allProductsGrid && allProductsGrid.children.length === 0) {
                        this.renderProductGrid(allProductsGrid, this.allProducts);
                    }
                }
            });
        });
    },
    
    // ============================================
    // ERROR HANDLING
    // ============================================
    showError() {
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
    },
    
    // ============================================
    // UI CONTROLS
    // ============================================
    toggleSearch() {
        const searchBar = document.getElementById('searchBar');
        searchBar.classList.toggle('show');
        if (searchBar.classList.contains('show')) {
            document.getElementById('searchInput').focus();
        }
    },
    
    // ============================================
    // EVENT LISTENERS
    // ============================================
    setupEventListeners() {
        // Search toggle
        const searchToggle = document.getElementById('searchToggle');
        if (searchToggle) {
            searchToggle.addEventListener('click', () => {
                this.toggleSearch();
            });
        }
        
        const searchClose = document.getElementById('searchClose');
        if (searchClose) {
            searchClose.addEventListener('click', () => {
                document.getElementById('searchBar').classList.remove('show');
            });
        }
        
        // Search input
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const query = e.target.value;
                    window.location.href = `search.html?q=${encodeURIComponent(query)}&supplier=${this.supplierId}`;
                }
            });
        }
        
        // Product search in products tab
        const productSearch = document.getElementById('productSearchInput');
        if (productSearch) {
            productSearch.addEventListener('input', () => {
                this.filterProducts();
            });
        }
        
        // Bottom navigation
        const categoriesNav = document.getElementById('categoriesNav');
        if (categoriesNav) {
            categoriesNav.addEventListener('click', (e) => {
                e.preventDefault();
                // Switch to products tab
                document.querySelectorAll('.tab-link').forEach(t => t.classList.remove('active'));
                document.querySelector('[data-tab="products"]').classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById('tab-products').classList.add('active');
            });
        }
        
        const inquiryNav = document.getElementById('inquiryNav');
        if (inquiryNav) {
            inquiryNav.addEventListener('click', (e) => {
                e.preventDefault();
                this.sendInquiry();
            });
        }
        
        const chatNav = document.getElementById('chatNav');
        if (chatNav) {
            chatNav.addEventListener('click', (e) => {
                e.preventDefault();
                this.contactSupplier();
            });
        }
    }
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    SupplierDetail.init();
});

// Make functions globally available
window.SupplierDetail = SupplierDetail;