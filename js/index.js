// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
let swiperInstances = {};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Restore scroll position
    const savedPosition = localStorage.getItem('homeScrollPosition');
    if (savedPosition) {
        setTimeout(() => {
            window.scrollTo(0, parseInt(savedPosition));
        }, 100);
    }
    
    // Show loading states
    showLoadingStates();
    
    // Load all sections
    await Promise.all([
        loadBanners(),
        loadQuickActions(),
        loadFeaturedDeals(),
        loadCategories(),
        loadHotSuppliers(),
        loadCategoryProducts()
    ]);
    
    // Initialize Swiper after content loads
    setTimeout(() => {
        initSwiper();
    }, 100);
    
    // Save scroll position
    window.addEventListener('scroll', () => {
        localStorage.setItem('homeScrollPosition', window.scrollY);
    });
    
    // Search button
    document.getElementById('searchBtn')?.addEventListener('click', () => {
        window.location.href = 'B2B-search.html';
    });
});

// ============================================
// LOADING STATES
// ============================================
function showLoadingStates() {
    document.getElementById('bannerWrapper').innerHTML = `
        <div class="swiper-slide"><div class="banner-slide skeleton"></div></div>
        <div class="swiper-slide"><div class="banner-slide skeleton"></div></div>
    `;
    
    document.getElementById('quickActionsWrapper').innerHTML = getSkeletonItems(5, 'quick');
    document.getElementById('featuredDealsWrapper').innerHTML = getSkeletonItems(5, 'product');
    document.getElementById('categoriesWrapper').innerHTML = getSkeletonItems(8, 'category');
    document.getElementById('hotSuppliersWrapper').innerHTML = getSkeletonItems(8, 'supplier');
}

function getSkeletonItems(count, type) {
    let html = '';
    for (let i = 0; i < count; i++) {
        if (type === 'quick') {
            html += `
                <div class="swiper-slide">
                    <div class="quick-action-item">
                        <div class="quick-action-icon skeleton"></div>
                        <div class="skeleton-text" style="width: 60px; height: 12px;"></div>
                    </div>
                </div>
            `;
        } else if (type === 'product') {
            html += `
                <div class="swiper-slide">
                    <div class="product-card">
                        <div class="product-image skeleton"></div>
                        <div class="product-info">
                            <div class="skeleton-text" style="width: 90%; height: 16px;"></div>
                            <div class="skeleton-text" style="width: 60%; height: 20px; margin-top: 8px;"></div>
                        </div>
                    </div>
                </div>
            `;
        } else if (type === 'category' || type === 'supplier') {
            html += `
                <div class="swiper-slide">
                    <div class="category-item">
                        <div class="category-image skeleton"></div>
                        <div class="skeleton-text" style="width: 60px; height: 12px; margin-top: 6px;"></div>
                    </div>
                </div>
            `;
        }
    }
    return html;
}

// ============================================
// LOAD BANNERS
// ============================================
async function loadBanners() {
    try {
        const { data: banners } = await sb
            .from('banners')
            .select('*')
            .eq('is_active', true)
            .order('display_order');

        const wrapper = document.getElementById('bannerWrapper');
        
        if (!banners || banners.length === 0) {
            wrapper.innerHTML = getFallbackBanners();
            return;
        }

        wrapper.innerHTML = banners.map(banner => `
            <div class="swiper-slide">
                <div class="banner-slide" style="background: linear-gradient(135deg, ${banner.background_color || '#0B4F6C'}, ${banner.background_color || '#1a6b8a'})">
                    <div class="banner-content">
                        <h3 class="banner-title">${escapeHtml(banner.title)}</h3>
                        ${banner.description ? `<p class="banner-subtitle">${escapeHtml(banner.description)}</p>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading banners:', error);
        document.getElementById('bannerWrapper').innerHTML = getFallbackBanners();
    }
}

function getFallbackBanners() {
    return `
        <div class="swiper-slide">
            <div class="banner-slide" style="background: linear-gradient(135deg, #0B4F6C, #1a6b8a)">
                <div class="banner-content">
                    <h3 class="banner-title">B2B Wholesale Prices</h3>
                    <p class="banner-subtitle">Minimum Orders Apply</p>
                </div>
            </div>
        </div>
        <div class="swiper-slide">
            <div class="banner-slide" style="background: linear-gradient(135deg, #10B981, #0ea271)">
                <div class="banner-content">
                    <h3 class="banner-title">Bulk Delivery Across Uganda</h3>
                    <p class="banner-subtitle">Negotiate Prices</p>
                </div>
            </div>
        </div>
        <div class="swiper-slide">
            <div class="banner-slide" style="background: linear-gradient(135deg, #F59E0B, #d97706)">
                <div class="banner-content">
                    <h3 class="banner-title">Verified Suppliers</h3>
                    <p class="banner-subtitle">Business Registration Required</p>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// LOAD QUICK ACTIONS
// ============================================
async function loadQuickActions() {
    const actions = [
        { icon: 'fa-search', label: 'Source by Category', link: 'categories.html', color: '#0B4F6C' },
        { icon: 'fa-file-invoice', label: 'Send Inquiry', link: 'send-inquiry.html', color: '#10B981' },
        { icon: 'fa-bolt', label: 'Instant Purchase', link: 'instant-purchase-order.html', color: '#F59E0B' },
        { icon: 'fa-fire', label: 'Featured Deals', link: 'featured-deals.html', color: '#EF4444' },
        { icon: 'fa-handshake', label: 'Hot Suppliers', link: 'suppliers.html', color: '#8B5CF6' }
    ];

    document.getElementById('quickActionsWrapper').innerHTML = actions.map(action => `
        <div class="swiper-slide">
            <a href="${action.link}" class="quick-action-item">
                <div class="quick-action-icon" style="color: ${action.color};">
                    <i class="fas ${action.icon}"></i>
                </div>
                <span class="quick-action-label">${action.label}</span>
            </a>
        </div>
    `).join('');
}

// ============================================
// LOAD FEATURED DEALS
// ============================================
async function loadFeaturedDeals() {
    try {
        const { data: deals } = await sb
            .from('ads')
            .select(`
                id,
                title,
                wholesale_price,
                price,
                image_urls,
                moq
            `)
            .eq('status', 'active')
            .eq('is_featured', true)
            .not('wholesale_price', 'is', null)
            .limit(10);

        const wrapper = document.getElementById('featuredDealsWrapper');
        
        if (!deals || deals.length === 0) {
            wrapper.innerHTML = getSkeletonItems(5, 'product');
            return;
        }

        wrapper.innerHTML = deals.map(deal => `
            <div class="swiper-slide">
                <a href="product.html?id=${deal.id}" class="product-card">
                    <div class="product-image">
                        <img src="${deal.image_urls?.[0] || 'https://via.placeholder.com/200'}" 
                             alt="${escapeHtml(deal.title)}"
                             loading="lazy"
                             onerror="this.src='https://via.placeholder.com/200'">
                        <span class="product-badge featured">FEATURED</span>
                    </div>
                    <div class="product-info">
                        <div class="product-title">${escapeHtml(deal.title.substring(0, 25))}${deal.title.length > 25 ? '...' : ''}</div>
                        <div class="product-price">UGX ${formatNumber(deal.wholesale_price || deal.price)}</div>
                        ${deal.moq ? `<div class="product-moq">MOQ: ${deal.moq}</div>` : ''}
                    </div>
                </a>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading deals:', error);
    }
}

// ============================================
// LOAD CATEGORIES
// ============================================
async function loadCategories() {
    try {
        const { data: categories } = await sb
            .from('categories')
            .select('id, name, image_url, icon, color_hex')
            .eq('is_active', true)
            .order('display_order')
            .limit(12);

        const wrapper = document.getElementById('categoriesWrapper');
        
        if (!categories || categories.length === 0) {
            wrapper.innerHTML = getSkeletonItems(8, 'category');
            return;
        }

        wrapper.innerHTML = categories.map(cat => `
            <div class="swiper-slide">
                <a href="category.html?id=${cat.id}" class="category-item">
                    <div class="category-image">
                        ${cat.image_url ? 
                            `<img src="${cat.image_url}" alt="${escapeHtml(cat.name)}" loading="lazy">` : 
                            `<i class="fas ${cat.icon || 'fa-tag'}" style="color: ${cat.color_hex || '#0B4F6C'}"></i>`
                        }
                    </div>
                    <span class="category-name">${escapeHtml(cat.name)}</span>
                </a>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// ============================================
// LOAD HOT SUPPLIERS (FIXED - SMALL CIRCLES)
// ============================================
async function loadHotSuppliers() {
    try {
        const { data: suppliers } = await sb
            .from('suppliers')
            .select(`
                id,
                business_name,
                warehouse_district,
                verification_status,
                profiles!suppliers_profile_id_fkey (
                    avatar_url
                )
            `)
            .eq('verification_status', 'verified')
            .limit(12);

        const wrapper = document.getElementById('hotSuppliersWrapper');
        
        if (!suppliers || suppliers.length === 0) {
            wrapper.innerHTML = getSkeletonItems(8, 'supplier');
            return;
        }

        // Get spotlight data
        const supplierIds = suppliers.map(s => s.id);
        const { data: spotlights } = await sb
            .from('supplier_spotlights')
            .select('supplier_id, badge_text')
            .in('supplier_id', supplierIds)
            .eq('is_active', true);

        const spotlightMap = {};
        if (spotlights) {
            spotlights.forEach(s => {
                spotlightMap[s.supplier_id] = s;
            });
        }

        wrapper.innerHTML = suppliers.map(supplier => {
            const spotlight = spotlightMap[supplier.id] || {};
            const avatarUrl = supplier.profiles?.avatar_url;
            const initials = supplier.business_name
                .split(' ')
                .map(n => n[0])
                .join('')
                .substring(0, 2)
                .toUpperCase();

            return `
                <div class="swiper-slide">
                    <a href="supplier-profile.html?id=${supplier.id}" class="hot-supplier-card">
                        <div class="hot-supplier-avatar">
                            ${avatarUrl ? 
                                `<img src="${avatarUrl}" alt="${escapeHtml(supplier.business_name)}">` : 
                                `<span>${initials}</span>`
                            }
                            ${spotlight.badge_text ? '<div class="hot-badge">🔥</div>' : ''}
                            ${supplier.verification_status === 'verified' ? '<div class="verified-badge-small">✓</div>' : ''}
                        </div>
                        <div class="hot-supplier-name">${escapeHtml(supplier.business_name)}</div>
                    </a>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading suppliers:', error);
    }
}

// ============================================
// LOAD CATEGORY PRODUCTS
// ============================================
async function loadCategoryProducts() {
    try {
        const { data: categories } = await sb
            .from('categories')
            .select('id, name, display_name')
            .eq('is_active', true)
            .order('display_order')
            .limit(4);

        const container = document.getElementById('categoryProductSections');
        let html = '';

        for (const category of categories || []) {
            const { data: products } = await sb
                .from('ads')
                .select(`
                    id,
                    title,
                    wholesale_price,
                    price,
                    image_urls,
                    moq
                `)
                .eq('status', 'active')
                .eq('category_id', category.id)
                .not('wholesale_price', 'is', null)
                .limit(6);

            if (products && products.length > 0) {
                html += `
                    <section class="category-product-section">
                        <div class="section-header-with-link">
                            <h2>${escapeHtml(category.display_name || category.name)}</h2>
                            <a href="category.html?id=${category.id}" class="section-link">
                                View All <i class="fas fa-chevron-right"></i>
                            </a>
                        </div>
                        <div class="products-scroll">
                            <div class="products-track">
                                ${products.map(product => `
                                    <a href="product.html?id=${product.id}" class="product-card">
                                        <div class="product-image">
                                            <img src="${product.image_urls?.[0] || 'https://via.placeholder.com/200'}" 
                                                 alt="${escapeHtml(product.title)}"
                                                 loading="lazy"
                                                 onerror="this.src='https://via.placeholder.com/200'">
                                        </div>
                                        <div class="product-info">
                                            <div class="product-title">${escapeHtml(product.title.substring(0, 20))}${product.title.length > 20 ? '...' : ''}</div>
                                            <div class="product-price">UGX ${formatNumber(product.wholesale_price || product.price)}</div>
                                            ${product.moq ? `<div class="product-moq">MOQ: ${product.moq}</div>` : ''}
                                        </div>
                                    </a>
                                `).join('')}
                            </div>
                        </div>
                    </section>
                `;
            }
        }

        container.innerHTML = html || '<p style="text-align: center; padding: 40px;">No products available</p>';
        
    } catch (error) {
        console.error('Error loading category products:', error);
    }
}

// ============================================
// INIT SWIPER
// ============================================
function initSwiper() {
    // Destroy existing instances
    Object.values(swiperInstances).forEach(s => {
        if (s && s.destroy) s.destroy(true, true);
    });

    // Banner Swiper
    if (document.querySelector('.banner-swiper')) {
        swiperInstances.banner = new Swiper('.banner-swiper', {
            autoplay: { delay: 3000 },
            pagination: { el: '.swiper-pagination', clickable: true },
            loop: true,
            speed: 500
        });
    }

    // Quick Actions Swiper
    if (document.querySelector('.quick-actions-swiper')) {
        swiperInstances.quick = new Swiper('.quick-actions-swiper', {
            slidesPerView: 3.5,
            spaceBetween: 8,
            freeMode: true
        });
    }

    // Deals Swiper
    if (document.querySelector('.deals-swiper')) {
        swiperInstances.deals = new Swiper('.deals-swiper', {
            slidesPerView: 2.2,
            spaceBetween: 12,
            freeMode: true
        });
    }

    // Categories Swiper
    if (document.querySelector('.categories-swiper')) {
        swiperInstances.categories = new Swiper('.categories-swiper', {
            slidesPerView: 3.5,
            spaceBetween: 8,
            freeMode: true
        });
    }

    // Suppliers Swiper
    if (document.querySelector('.suppliers-swiper')) {
        swiperInstances.suppliers = new Swiper('.suppliers-swiper', {
            slidesPerView: 3.5,
            spaceBetween: 8,
            freeMode: true
        });
    }
}

// ============================================
// UTILITIES
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!num) return '0';
    return parseInt(num).toLocaleString('en-UG');
}

// ============================================
// MAKE FUNCTIONS GLOBAL
// ============================================
window.escapeHtml = escapeHtml;
window.formatNumber = formatNumber;