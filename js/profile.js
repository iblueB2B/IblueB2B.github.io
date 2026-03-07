// ============================================
// PROFILE PAGE - COMPLETE
// ============================================

console.log('🚀 Profile page loading...');

// Supabase Configuration
const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
let ProfileManager = {
    currentUser: null,
    profile: null,
    supplier: null,
    activities: [],
    
    // ============================================
    // INITIALIZATION
    // ============================================
    async init() {
        console.log('📊 Profile page initializing...');
        
        try {
            await this.checkAuth();
            await this.loadProfile();
            await this.loadSupplierData();
            await this.loadStats();
            await this.loadActivities();
            
            this.renderProfile();
            this.setupEventListeners();
            
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('profileContent').style.display = 'block';
            
            console.log('✅ Profile page initialized');
        } catch (error) {
            console.error('❌ Error initializing:', error);
            this.showError();
        }
    },
    
    async checkAuth() {
        try {
            const { data: { user }, error } = await sb.auth.getUser();
            
            if (error || !user) {
                window.location.href = 'login.html?redirect=profile.html';
                return;
            }
            
            this.currentUser = user;
            console.log('✅ User authenticated:', user.email);
            
        } catch (error) {
            console.error('Auth error:', error);
            window.location.href = 'login.html';
        }
    },
    
    async loadProfile() {
        try {
            const { data, error } = await sb
                .from('profiles')
                .select('*')
                .eq('id', this.currentUser.id)
                .single();
            
            if (error) throw error;
            
            this.profile = data;
            console.log('✅ Profile loaded:', this.profile);
            
        } catch (error) {
            console.error('Error loading profile:', error);
            throw error;
        }
    },
    
    async loadSupplierData() {
        try {
            const { data, error } = await sb
                .from('suppliers')
                .select('*')
                .eq('profile_id', this.currentUser.id)
                .maybeSingle();
            
            if (error) throw error;
            
            this.supplier = data;
            if (this.supplier) {
                console.log('✅ Supplier data loaded:', this.supplier.business_name);
            }
            
        } catch (error) {
            console.error('Error loading supplier data:', error);
        }
    },
    
    async loadStats() {
        try {
            // Get orders count
            const { count: ordersCount } = await sb
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('buyer_id', this.currentUser.id);
            
            // Get inquiries count
            const { count: inquiriesCount } = await sb
                .from('inquiry_requests')
                .select('*', { count: 'exact', head: true })
                .eq('buyer_id', this.currentUser.id);
            
            // Get quotes count (for buyer)
            let quotesCount = 0;
            if (!this.profile.is_supplier) {
                const { count } = await sb
                    .from('supplier_quotes')
                    .select('*', { count: 'exact', head: true })
                    .eq('inquiry_requests.buyer_id', this.currentUser.id);
                quotesCount = count || 0;
            }
            
            // Get unread messages count
            const { count: messagesCount } = await sb
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('receiver_id', this.currentUser.id)
                .eq('is_read', false);
            
            // Get unread notifications count
            const { count: notificationsCount } = await sb
                .from('notifications')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', this.currentUser.id)
                .eq('is_read', false);
            
            // Update DOM
            document.getElementById('profileOrders').textContent = ordersCount || 0;
            document.getElementById('profileInquiries').textContent = inquiriesCount || 0;
            document.getElementById('profileQuotes').textContent = quotesCount || 0;
            document.getElementById('messageBadge').textContent = messagesCount || 0;
            document.getElementById('notificationBadge').textContent = notificationsCount || 0;
            
            // Show compare quotes card if multiple quotes
            if (quotesCount > 1) {
                document.getElementById('compareQuotesCard').style.display = 'flex';
            }
            
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    },
    
    async loadActivities() {
        try {
            // Get recent orders
            const { data: orders } = await sb
                .from('orders')
                .select('order_number, status, created_at')
                .eq('buyer_id', this.currentUser.id)
                .order('created_at', { ascending: false })
                .limit(3);
            
            // Get recent inquiries
            const { data: inquiries } = await sb
                .from('inquiry_requests')
                .select('title, status, created_at')
                .eq('buyer_id', this.currentUser.id)
                .order('created_at', { ascending: false })
                .limit(3);
            
            // Combine and sort activities
            const activities = [];
            
            orders?.forEach(order => {
                activities.push({
                    type: 'order',
                    title: `Order ${order.order_number}`,
                    status: order.status,
                    time: order.created_at,
                    icon: 'fa-clipboard-list'
                });
            });
            
            inquiries?.forEach(inquiry => {
                activities.push({
                    type: 'inquiry',
                    title: inquiry.title,
                    status: inquiry.status,
                    time: inquiry.created_at,
                    icon: 'fa-file-invoice'
                });
            });
            
            // Sort by date (newest first)
            activities.sort((a, b) => new Date(b.time) - new Date(a.time));
            
            this.activities = activities.slice(0, 5);
            this.renderActivities();
            
        } catch (error) {
            console.error('Error loading activities:', error);
        }
    },
    
    // ============================================
    // RENDER FUNCTIONS
    // ============================================
    renderProfile() {
        this.renderProfileHeader();
        this.renderBusinessInfo();
        this.renderRoleBasedActions();
    },
    
    renderProfileHeader() {
        const name = this.profile.full_name || 'User';
        const email = this.profile.email || this.currentUser.email;
        const avatarUrl = this.profile.avatar_url;
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        // Avatar
        const avatarContainer = document.getElementById('profileAvatar');
        avatarContainer.innerHTML = avatarUrl ? 
            `<img src="${avatarUrl}" alt="${name}">` : 
            initials;
        
        // Name and email
        document.getElementById('profileName').textContent = name;
        document.getElementById('profileEmail').textContent = email;
        
        // Member since
        const created = new Date(this.profile.created_at || Date.now());
        document.getElementById('memberSince').textContent = created.getFullYear();
        
        // Badges
        const badgesContainer = document.getElementById('profileBadges');
        let badgesHtml = '';
        
        if (this.profile.is_verified) {
            badgesHtml += '<span class="badge verified"><i class="fas fa-check-circle"></i> Verified</span>';
        }
        
        if (this.profile.is_supplier) {
            badgesHtml += '<span class="badge supplier"><i class="fas fa-store"></i> Supplier</span>';
        }
        
        if (this.profile.is_buyer) {
            badgesHtml += '<span class="badge buyer"><i class="fas fa-shopping-cart"></i> Buyer</span>';
        }
        
        if (this.profile.is_admin) {
            badgesHtml += '<span class="badge admin"><i class="fas fa-crown"></i> Admin</span>';
        }
        
        badgesContainer.innerHTML = badgesHtml;
    },
    
    renderBusinessInfo() {
        const businessSection = document.getElementById('businessSection');
        
        if (!this.supplier) {
            businessSection.style.display = 'none';
            return;
        }
        
        businessSection.style.display = 'block';
        
        const businessInfo = document.getElementById('businessInfo');
        businessInfo.innerHTML = `
            <div class="business-item">
                <span class="business-label">Business Name</span>
                <span class="business-value">${this.escapeHtml(this.supplier.business_name)}</span>
            </div>
            <div class="business-item">
                <span class="business-label">Business Type</span>
                <span class="business-value">${this.escapeHtml(this.supplier.business_type || 'Not specified')}</span>
            </div>
            <div class="business-item">
                <span class="business-label">Verification</span>
                <span class="business-value">${this.supplier.verification_status || 'Pending'}</span>
            </div>
            <div class="business-item">
                <span class="business-label">Location</span>
                <span class="business-value">${this.escapeHtml(this.supplier.warehouse_district || 'Uganda')}</span>
            </div>
        `;
    },
    
    renderRoleBasedActions() {
        // Show/hide role-specific cards
        const sellOnIblueCard = document.getElementById('sellOnIblueCard');
        const supplierPortalCard = document.getElementById('supplierPortalCard');
        const adminDashboardCard = document.getElementById('adminDashboardCard');
        
        if (this.profile.is_supplier) {
            sellOnIblueCard.style.display = 'none';
            supplierPortalCard.style.display = 'flex';
        } else {
            sellOnIblueCard.style.display = 'flex';
            supplierPortalCard.style.display = 'none';
        }
        
        if (this.profile.is_admin) {
            adminDashboardCard.style.display = 'flex';
        } else {
            adminDashboardCard.style.display = 'none';
        }
    },
    
    renderActivities() {
        const container = document.getElementById('activityList');
        
        if (this.activities.length === 0) {
            container.innerHTML = '<p class="text-muted">No recent activity</p>';
            return;
        }
        
        container.innerHTML = this.activities.map(activity => {
            const timeAgo = this.getTimeAgo(new Date(activity.time));
            
            return `
                <div class="activity-item">
                    <div class="activity-icon">
                        <i class="fas ${activity.icon}"></i>
                    </div>
                    <div class="activity-details">
                        <div class="activity-title">${this.escapeHtml(activity.title)}</div>
                        <div class="activity-time">${timeAgo}</div>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    // ============================================
    // ACCOUNT ACTIONS
    // ============================================
    async logout() {
        try {
            const { error } = await sb.auth.signOut();
            if (error) throw error;
            
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Logout error:', error);
            this.showToast('Error logging out', 'error');
        }
    },
    
    showDeleteModal() {
        document.getElementById('deleteModal').classList.add('show');
        
        // Enable delete button when typing DELETE
        const confirmInput = document.getElementById('deleteConfirm');
        const deleteBtn = document.getElementById('confirmDeleteBtn');
        
        confirmInput.addEventListener('input', (e) => {
            deleteBtn.disabled = e.target.value !== 'DELETE';
        });
    },
    
    async confirmDelete() {
        try {
            // Delete user data (this would need proper cascade)
            const { error } = await sb.auth.admin.deleteUser(this.currentUser.id);
            
            if (error) throw error;
            
            await sb.auth.signOut();
            window.location.href = 'index.html?deleted=true';
            
        } catch (error) {
            console.error('Error deleting account:', error);
            this.showToast('Error deleting account', 'error');
            this.closeDeleteModal();
        }
    },
    
    closeDeleteModal() {
        document.getElementById('deleteModal').classList.remove('show');
        document.getElementById('deleteConfirm').value = '';
        document.getElementById('confirmDeleteBtn').disabled = true;
    },
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour ago`;
        if (diffDays < 7) return `${diffDays} days ago`;
        
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    
    showError() {
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
    },
    
    // ============================================
    // EVENT LISTENERS
    // ============================================
    setupEventListeners() {
        // Edit profile button
        document.getElementById('editProfileBtn').addEventListener('click', () => {
            window.location.href = 'edit-profile.html';
        });
        
        // Logout button
        document.getElementById('logoutBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.logout();
        });
        
        // Delete account button
        document.getElementById('deleteAccountBtn').addEventListener('click', () => {
            this.showDeleteModal();
        });
        
        // Confirm delete button
        document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
            this.confirmDelete();
        });
        
        // Close modal button
        document.querySelectorAll('.modal-close, .btn-secondary').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeDeleteModal();
            });
        });
        
        // Menu toggle
        document.getElementById('menuToggle').addEventListener('click', () => {
            console.log('Menu clicked');
        });
        
        // Close modal on outside click
        document.getElementById('deleteModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('deleteModal')) {
                this.closeDeleteModal();
            }
        });
    }
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    ProfileManager.init();
});

// Global functions
window.ProfileManager = ProfileManager;
window.closeDeleteModal = () => ProfileManager.closeDeleteModal();