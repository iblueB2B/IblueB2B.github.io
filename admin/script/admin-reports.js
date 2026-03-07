// ========== ADMIN REPORTS JAVASCRIPT ==========
const reportsManager = (function() {
    // ===== SUPABASE CONFIGURATION =====
    const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // ===== GLOBAL STATE =====
    let currentUser = null;
    let isAdmin = false;
    let reports = [];
    let filteredReports = [];
    let currentPage = 1;
    let itemsPerPage = 20;
    let currentReport = null;

    // Report reasons mapping
    const REPORT_REASONS = {
        'spam': 'Spam',
        'fake': 'Fake or Counterfeit',
        'scam': 'Scam or Fraud',
        'wrong_category': 'Wrong Category',
        'wrong_price': 'Wrong Price',
        'sold': 'Already Sold',
        'duplicate': 'Duplicate Ad',
        'offensive': 'Offensive Content',
        'personal_info': 'Personal Information',
        'prohibited_item': 'Prohibited Item',
        'other': 'Other'
    };

    // ===== INITIALIZATION =====
    document.addEventListener('DOMContentLoaded', async function() {
        console.log('DOM loaded, initializing reports manager...');
        await checkAuth();
        await loadReports();
        setupEventListeners();
        populateReasonFilter();
    });

    // ===== AUTHENTICATION & AUTHORIZATION =====
    async function checkAuth() {
        try {
            console.log('Checking authentication...');
            const { data: { session } } = await sb.auth.getSession();
            
            if (!session) {
                console.log('No session found, redirecting to login...');
                window.location.href = 'login.html?redirect=admin-dashboard.html';
                return;
            }

            console.log('Session found for user:', session.user.id);
            
            const { data: profile, error } = await sb
                .from('profiles')
                .select('id, is_admin, admin_role, full_name')
                .eq('id', session.user.id)
                .single();

            if (error) {
                console.error('Profile fetch error:', error);
                throw error;
            }

            if (!profile || !profile.is_admin) {
                console.log('User is not admin:', profile);
                showNotification('Unauthorized access. Admin privileges required.', 'error');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2000);
                return;
            }

            console.log('Admin authenticated:', profile.full_name);
            currentUser = profile;
            isAdmin = true;
            
        } catch (error) {
            console.error('Auth error:', error);
            showNotification('Authentication error', 'error');
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);
        }
    }

    // ===== LOAD REPORTS =====
    async function loadReports() {
        try {
            console.log('Loading reports...');
            showLoading();

            const { data, error } = await sb
                .from('reports')
                .select(`
                    *,
                    reporter:profiles!reports_reporter_id_fkey(id, full_name, email, is_verified),
                    reported_ad:ads!reports_reported_ad_id_fkey(id, title, price, currency, image_urls, seller_id),
                    reported_user:profiles!reports_reported_user_id_fkey(id, full_name, email, is_verified),
                    resolver:profiles!reports_resolved_by_fkey(id, full_name)
                `)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching reports:', error);
                throw error;
            }

            console.log(`Loaded ${data?.length || 0} reports`);
            reports = data || [];
            applyFilters();
            updateStats();
            
            hideLoading();
            
            if (reports.length === 0) {
                showEmptyState('No reports have been submitted yet.');
            }

        } catch (error) {
            console.error('Error loading reports:', error);
            showNotification('Failed to load reports: ' + error.message, 'error');
            hideLoading();
            showEmptyState('Failed to load reports. Please try again.');
        }
    }

    // ===== FILTERING & SEARCH =====
    function setupEventListeners() {
        const searchInput = document.getElementById('searchInput');
        let searchTimeout;
        
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    currentPage = 1;
                    applyFilters();
                }, 300);
            });
        }

        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', function() {
                currentPage = 1;
                applyFilters();
            });
        }

        const typeFilter = document.getElementById('typeFilter');
        if (typeFilter) {
            typeFilter.addEventListener('change', function() {
                currentPage = 1;
                applyFilters();
            });
        }

        const reasonFilter = document.getElementById('reasonFilter');
        if (reasonFilter) {
            reasonFilter.addEventListener('change', function() {
                currentPage = 1;
                applyFilters();
            });
        }

        const dateFrom = document.getElementById('dateFrom');
        if (dateFrom) {
            dateFrom.addEventListener('change', function() {
                currentPage = 1;
                applyFilters();
            });
        }

        const dateTo = document.getElementById('dateTo');
        if (dateTo) {
            dateTo.addEventListener('change', function() {
                currentPage = 1;
                applyFilters();
            });
        }
    }

    function populateReasonFilter() {
        const reasonFilter = document.getElementById('reasonFilter');
        if (!reasonFilter) return;
        
        // Clear existing options except "All Reasons"
        reasonFilter.innerHTML = '<option value="all">All Reasons</option>';
        
        Object.entries(REPORT_REASONS).forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            reasonFilter.appendChild(option);
        });
    }

    function applyFilters() {
        const searchInput = document.getElementById('searchInput');
        const statusFilter = document.getElementById('statusFilter');
        const typeFilter = document.getElementById('typeFilter');
        const reasonFilter = document.getElementById('reasonFilter');
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');

        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const status = statusFilter ? statusFilter.value : 'all';
        const type = typeFilter ? typeFilter.value : 'all';
        const reason = reasonFilter ? reasonFilter.value : 'all';
        const fromDate = dateFrom ? dateFrom.value : '';
        const toDate = dateTo ? dateTo.value : '';

        console.log('Applying filters:', { searchTerm, status, type, reason, fromDate, toDate });

        filteredReports = reports.filter(report => {
            // Status filter
            if (status !== 'all' && report.status !== status) return false;

            // Type filter
            if (type !== 'all') {
                if (type === 'ad' && !report.reported_ad_id) return false;
                if (type === 'user' && !report.reported_user_id) return false;
            }

            // Reason filter
            if (reason !== 'all' && report.reason !== reason) return false;

            // Date range filter
            if (fromDate) {
                const reportDate = new Date(report.created_at).toISOString().split('T')[0];
                if (reportDate < fromDate) return false;
            }
            if (toDate) {
                const reportDate = new Date(report.created_at).toISOString().split('T')[0];
                if (reportDate > toDate) return false;
            }

            // Search term
            if (searchTerm) {
                const searchableFields = [
                    report.id.toString(),
                    report.reason,
                    report.description || '',
                    report.reporter?.full_name || '',
                    report.reporter?.email || '',
                    report.reported_ad?.title || '',
                    report.reported_user?.full_name || ''
                ].join(' ').toLowerCase();

                if (!searchableFields.includes(searchTerm)) return false;
            }

            return true;
        });

        console.log(`Filtered reports: ${filteredReports.length}`);
        renderReports();
        updatePagination();
    }

    // ===== RENDER REPORTS =====
    function renderReports() {
        const reportsList = document.getElementById('reportsList');
        const emptyState = document.getElementById('emptyState');
        const pagination = document.getElementById('pagination');
        
        if (!reportsList || !emptyState || !pagination) return;
        
        if (filteredReports.length === 0) {
            reportsList.style.display = 'none';
            emptyState.style.display = 'block';
            pagination.style.display = 'none';
            return;
        }

        reportsList.style.display = 'flex';
        emptyState.style.display = 'none';
        
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedReports = filteredReports.slice(startIndex, endIndex);

        reportsList.innerHTML = paginatedReports.map(report => createReportItem(report)).join('');
        
        // Attach event listeners to the newly rendered buttons
        attachButtonListeners();
    }

    function createReportItem(report) {
        const reportId = formatReportId(report.id);
        const statusClass = `badge-${report.status || 'pending'}`;
        const statusText = (report.status || 'pending').charAt(0).toUpperCase() + (report.status || 'pending').slice(1);
        const reportType = report.reported_ad_id ? 'Ad' : 'User';
        const targetName = report.reported_ad?.title || report.reported_user?.full_name || 'Unknown';
        const reporterName = report.reporter?.full_name || 'Anonymous';
        const timeAgo = getTimeAgo(report.created_at);
        const reason = REPORT_REASONS[report.reason] || report.reason;

        return `
            <div class="report-item" data-report-id="${report.id}" data-report-status="${report.status || 'pending'}">
                <div class="report-header" onclick="reportsManager.openReportDetails(${report.id})">
                    <span class="report-id">${reportId}</span>
                    <div>
                        <span class="report-badge ${statusClass}">${statusText}</span>
                        <span class="report-type">${reportType}</span>
                    </div>
                </div>
                
                <div class="report-content" onclick="reportsManager.openReportDetails(${report.id})">
                    <div class="report-reason">${escapeHtml(reason)}</div>
                    <div class="report-description">
                        ${escapeHtml(report.description || 'No additional details provided.')}
                    </div>
                    <div class="report-meta">
                        <span><i class="fas fa-tag"></i> ${escapeHtml(targetName.substring(0, 30))}${targetName.length > 30 ? '...' : ''}</span>
                        <span><i class="fas fa-user"></i> ${escapeHtml(reporterName)}</span>
                        <span><i class="fas fa-clock"></i> ${timeAgo}</span>
                    </div>
                </div>
                
                <div class="report-footer">
                    <div class="reporter-info">
                        ${report.resolver ? `Resolved by: ${escapeHtml(report.resolver.full_name)}` : ''}
                    </div>
                    <div class="action-buttons">
                        ${renderActionButtons(report)}
                    </div>
                </div>
            </div>
        `;
    }

    function renderActionButtons(report) {
        if (report.status === 'resolved' || report.status === 'dismissed') {
            return `
                <button class="action-btn btn-outline view-details-btn" data-report-id="${report.id}">
                    <i class="fas fa-eye"></i> View
                </button>
            `;
        }

        return `
            <button class="action-btn btn-review status-btn" data-report-id="${report.id}" data-status="reviewed">
                <i class="fas fa-check"></i> Review
            </button>
            <button class="action-btn btn-resolve status-btn" data-report-id="${report.id}" data-status="resolved">
                <i class="fas fa-check-circle"></i> Resolve
            </button>
            <button class="action-btn btn-dismiss status-btn" data-report-id="${report.id}" data-status="dismissed">
                <i class="fas fa-times"></i> Dismiss
            </button>
        `;
    }

    // ===== ATTACH EVENT LISTENERS TO BUTTONS =====
    function attachButtonListeners() {
        console.log('Attaching button listeners...');
        
        // Status change buttons (Review, Resolve, Dismiss)
        document.querySelectorAll('.status-btn').forEach(btn => {
            // Remove existing listeners to prevent duplicates
            btn.removeEventListener('click', handleStatusClick);
            btn.addEventListener('click', handleStatusClick);
        });

        // View details buttons
        document.querySelectorAll('.view-details-btn').forEach(btn => {
            btn.removeEventListener('click', handleViewClick);
            btn.addEventListener('click', handleViewClick);
        });
    }

    function handleStatusClick(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const btn = e.currentTarget;
        const reportId = btn.dataset.reportId;
        const newStatus = btn.dataset.status;
        
        console.log(`Status button clicked: Report ID ${reportId}, New Status: ${newStatus}`);
        
        if (!reportId || !newStatus) {
            console.error('Missing report ID or status');
            return;
        }
        
        const report = reports.find(r => r.id == reportId);
        const statusDisplay = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
        
        if (confirm(`Are you sure you want to mark this report as "${statusDisplay}"?`)) {
            updateReportStatus(parseInt(reportId), newStatus);
        }
    }

    function handleViewClick(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const btn = e.currentTarget;
        const reportId = btn.dataset.reportId;
        
        console.log(`View button clicked: Report ID ${reportId}`);
        
        if (!reportId) {
            console.error('Missing report ID');
            return;
        }
        
        openReportDetails(parseInt(reportId));
    }

    // ===== UPDATE REPORT STATUS =====
    async function updateReportStatus(reportId, newStatus) {
        console.log(`Updating report ${reportId} to status: ${newStatus}`);
        
        try {
            if (!currentUser) {
                console.error('No current user found');
                showNotification('You must be logged in', 'error');
                return;
            }

            // Get admin notes if modal is open
            const adminNotes = document.getElementById('adminNotes')?.value || '';
            
            const updateData = {
                status: newStatus,
                admin_notes: adminNotes,
                updated_at: new Date().toISOString()
            };

            // Add resolution info if not pending
            if (newStatus !== 'pending') {
                updateData.resolved_by = currentUser.id;
                updateData.resolved_at = new Date().toISOString();
            } else {
                updateData.resolved_by = null;
                updateData.resolved_at = null;
            }

            console.log('Sending update:', updateData);

            const { data, error } = await sb
                .from('reports')
                .update(updateData)
                .eq('id', reportId)
                .select();

            if (error) {
                console.error('Supabase update error:', error);
                throw error;
            }

            console.log('Update successful:', data);

            // Log admin action
            await logAdminAction(reportId, newStatus);

            showNotification(`Report marked as ${newStatus}`, 'success');
            
            // Reload reports to get fresh data
            await loadReports();
            
            // Close modal if open
            closeModal();

        } catch (error) {
            console.error('Error updating report:', error);
            showNotification('Failed to update report: ' + error.message, 'error');
        }
    }

    // ===== REPORT DETAIL MODAL =====
    async function openReportDetails(reportId) {
        console.log(`Opening report details for ID: ${reportId}`);
        
        try {
            const report = reports.find(r => r.id === reportId);
            if (!report) {
                console.error('Report not found:', reportId);
                return;
            }

            currentReport = report;
            
            const modal = document.getElementById('reportModal');
            const modalBody = document.getElementById('modalBody');
            const modalReportId = document.getElementById('modalReportId');
            
            if (!modal || !modalBody || !modalReportId) {
                console.error('Modal elements not found');
                return;
            }
            
            modalReportId.textContent = `Report ${formatReportId(report.id)}`;
            
            modalBody.innerHTML = await generateReportDetails(report);
            modal.classList.add('active');
            
            // Attach modal button listeners
            attachModalButtonListeners();
            
        } catch (error) {
            console.error('Error opening report details:', error);
            showNotification('Failed to load report details', 'error');
        }
    }

    function attachModalButtonListeners() {
        console.log('Attaching modal button listeners...');
        
        // Mark as Reviewed
        const markReviewedBtn = document.getElementById('markReviewedBtn');
        if (markReviewedBtn) {
            markReviewedBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const reportId = this.dataset.reportId;
                if (reportId) updateReportStatus(parseInt(reportId), 'reviewed');
            });
        }

        // Resolve Report
        const resolveReportBtn = document.getElementById('resolveReportBtn');
        if (resolveReportBtn) {
            resolveReportBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const reportId = this.dataset.reportId;
                if (reportId) updateReportStatus(parseInt(reportId), 'resolved');
            });
        }

        // Dismiss Report
        const dismissReportBtn = document.getElementById('dismissReportBtn');
        if (dismissReportBtn) {
            dismissReportBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const reportId = this.dataset.reportId;
                if (reportId) updateReportStatus(parseInt(reportId), 'dismissed');
            });
        }

        // Reopen Report
        const reopenReportBtn = document.getElementById('reopenReportBtn');
        if (reopenReportBtn) {
            reopenReportBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const reportId = this.dataset.reportId;
                if (reportId) updateReportStatus(parseInt(reportId), 'pending');
            });
        }

        // Ban Ad
        const banAdBtn = document.getElementById('banAdBtn');
        if (banAdBtn) {
            banAdBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const adId = this.dataset.adId;
                if (adId) banAd(parseInt(adId));
            });
        }

        // Ban User
        const banUserBtn = document.getElementById('banUserBtn');
        if (banUserBtn) {
            banUserBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const userId = this.dataset.userId;
                if (userId) banUser(userId);
            });
        }
    }

    async function generateReportDetails(report) {
        const reportType = report.reported_ad_id ? 'Ad' : 'User';
        const reporter = report.reporter;
        const resolver = report.resolver;
        
        let targetHtml = '';
        
        if (report.reported_ad_id) {
            targetHtml = `
                <div class="detail-card">
                    <div style="display: flex; gap: var(--spacing-md); margin-bottom: var(--spacing-md);">
                        <img src="${report.reported_ad?.image_urls?.[0] || 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=200&auto=format&fit=crop'}" 
                             style="width: 80px; height: 80px; border-radius: var(--radius); object-fit: cover;"
                             onerror="this.src='https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=200&auto=format&fit=crop'">
                        <div>
                            <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(report.reported_ad?.title || 'Unknown Ad')}</div>
                            <div style="color: var(--primary); font-weight: 700;">${formatPrice(report.reported_ad?.price, report.reported_ad?.currency)}</div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">
                                <i class="fas fa-user"></i> Seller ID: ${report.reported_ad?.seller_id || 'N/A'}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: var(--spacing-sm);">
                        <button class="action-btn btn-outline" onclick="window.open('ad-detail.html?id=${report.reported_ad_id}', '_blank')">
                            <i class="fas fa-external-link-alt"></i> View Ad
                        </button>
                        <button class="action-btn btn-danger" id="banAdBtn" data-ad-id="${report.reported_ad_id}">
                            <i class="fas fa-ban"></i> Ban Ad
                        </button>
                    </div>
                </div>
            `;
        } else {
            targetHtml = `
                <div class="detail-card">
                    <div style="display: flex; gap: var(--spacing-md); align-items: center; margin-bottom: var(--spacing-md);">
                        <div class="user-avatar" style="width: 60px; height: 60px; font-size: 1.5rem; background: var(--primary); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white;">
                            ${getInitials(report.reported_user?.full_name || 'User')}
                        </div>
                        <div>
                            <div style="font-weight: 600; font-size: 1.1rem;">${escapeHtml(report.reported_user?.full_name || 'Anonymous User')}</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">
                                <i class="fas fa-envelope"></i> ${escapeHtml(report.reported_user?.email || 'No email')}
                            </div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 2px;">
                                ${report.reported_user?.is_verified ? 
                                    '<span style="color: var(--success);"><i class="fas fa-check-circle"></i> Verified</span>' : 
                                    '<span style="color: var(--text-light);"><i class="fas fa-clock"></i> Unverified</span>'}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: var(--spacing-sm);">
                        <button class="action-btn btn-outline" onclick="window.open('user-profile.html?id=${report.reported_user_id}', '_blank')">
                            <i class="fas fa-external-link-alt"></i> View Profile
                        </button>
                        <button class="action-btn btn-danger" id="banUserBtn" data-user-id="${report.reported_user_id}">
                            <i class="fas fa-ban"></i> Ban User
                        </button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="detail-section">
                <div class="detail-title">
                    <i class="fas fa-info-circle"></i> Report Information
                </div>
                <div class="detail-card">
                    <div class="detail-row">
                        <span class="detail-label">Report ID</span>
                        <span class="detail-value">${formatReportId(report.id)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Current Status</span>
                        <span class="detail-value">
                            <span class="report-badge badge-${report.status || 'pending'}">
                                ${(report.status || 'pending').charAt(0).toUpperCase() + (report.status || 'pending').slice(1)}
                            </span>
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Type</span>
                        <span class="detail-value">${reportType} Report</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Reason</span>
                        <span class="detail-value">${REPORT_REASONS[report.reason] || report.reason}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Submitted</span>
                        <span class="detail-value">${new Date(report.created_at).toLocaleString()}</span>
                    </div>
                    ${report.resolved_at ? `
                    <div class="detail-row">
                        <span class="detail-label">Resolved</span>
                        <span class="detail-value">${new Date(report.resolved_at).toLocaleString()}</span>
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-title">
                    <i class="fas fa-flag"></i> Reported ${reportType}
                </div>
                ${targetHtml}
            </div>

            <div class="detail-section">
                <div class="detail-title">
                    <i class="fas fa-user"></i> Reporter
                </div>
                <div class="detail-card">
                    <div class="detail-row">
                        <span class="detail-label">Name</span>
                        <span class="detail-value">${escapeHtml(reporter?.full_name || 'Anonymous')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Email</span>
                        <span class="detail-value">${escapeHtml(reporter?.email || 'No email')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Verified</span>
                        <span class="detail-value">${reporter?.is_verified ? 'Yes' : 'No'}</span>
                    </div>
                </div>
            </div>

            ${report.description ? `
            <div class="detail-section">
                <div class="detail-title">
                    <i class="fas fa-align-left"></i> Additional Details
                </div>
                <div class="detail-card" style="white-space: pre-line;">
                    ${escapeHtml(report.description)}
                </div>
            </div>
            ` : ''}

            <div class="detail-section">
                <div class="detail-title">
                    <i class="fas fa-clipboard-check"></i> Admin Actions
                </div>
                <div class="detail-card">
                    <div class="admin-actions">
                        <textarea 
                            class="admin-textarea" 
                            id="adminNotes" 
                            placeholder="Add admin notes or resolution details..."
                        >${escapeHtml(report.admin_notes || '')}</textarea>
                        
                        <div class="action-group">
                            ${report.status !== 'resolved' && report.status !== 'dismissed' ? `
                                <button class="btn btn-warning" id="markReviewedBtn" data-report-id="${report.id}">
                                    <i class="fas fa-check"></i> Mark as Reviewed
                                </button>
                                <button class="btn btn-success" id="resolveReportBtn" data-report-id="${report.id}">
                                    <i class="fas fa-check-circle"></i> Resolve Report
                                </button>
                                <button class="btn btn-outline" id="dismissReportBtn" data-report-id="${report.id}">
                                    <i class="fas fa-times"></i> Dismiss
                                </button>
                            ` : `
                                <button class="btn btn-outline" id="reopenReportBtn" data-report-id="${report.id}">
                                    <i class="fas fa-undo"></i> Reopen Report
                                </button>
                            `}
                        </div>
                    </div>
                </div>
            </div>

            ${resolver ? `
            <div class="detail-section">
                <div class="detail-title">
                    <i class="fas fa-user-shield"></i> Resolved By
                </div>
                <div class="detail-card">
                    <div class="detail-row">
                        <span class="detail-label">Admin</span>
                        <span class="detail-value">${escapeHtml(resolver.full_name)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">At</span>
                        <span class="detail-value">${new Date(report.resolved_at).toLocaleString()}</span>
                    </div>
                </div>
            </div>
            ` : ''}
        `;
    }

    // ===== ADMIN ACTIONS =====
    async function banAd(adId) {
        console.log(`Banning ad: ${adId}`);
        
        if (!confirm('Are you sure you want to ban this ad? The ad will no longer be visible to users.')) {
            return;
        }

        try {
            const { error } = await sb
                .from('ads')
                .update({ 
                    status: 'banned',
                    updated_at: new Date().toISOString()
                })
                .eq('id', adId);

            if (error) throw error;

            await sb.from('admin_actions').insert({
                admin_id: currentUser.id,
                action_type: 'ad_banned',
                target_ad_id: adId,
                performed_at: new Date().toISOString()
            });

            showNotification('Ad has been banned successfully', 'success');
            
            closeModal();
            await loadReports();

        } catch (error) {
            console.error('Error banning ad:', error);
            showNotification('Failed to ban ad: ' + error.message, 'error');
        }
    }

    async function banUser(userId) {
        console.log(`Banning user: ${userId}`);
        
        if (!confirm('Are you sure you want to ban this user? They will not be able to access their account or post ads.')) {
            return;
        }

        try {
            const { error } = await sb
                .from('profiles')
                .update({ 
                    is_banned: true,
                    updated_at: new Date().toISOString()
                })
                .eq('id', userId);

            if (error) throw error;

            await sb
                .from('ads')
                .update({ 
                    status: 'banned',
                    updated_at: new Date().toISOString()
                })
                .eq('seller_id', userId);

            await sb.from('admin_actions').insert({
                admin_id: currentUser.id,
                action_type: 'user_banned',
                target_user_id: userId,
                performed_at: new Date().toISOString()
            });

            showNotification('User has been banned successfully', 'success');
            
            closeModal();
            await loadReports();

        } catch (error) {
            console.error('Error banning user:', error);
            showNotification('Failed to ban user: ' + error.message, 'error');
        }
    }

    // ===== ADMIN ACTION LOGGING =====
    async function logAdminAction(reportId, action) {
        try {
            await sb.from('admin_actions').insert({
                admin_id: currentUser.id,
                action_type: 'report_resolved',
                target_report_id: reportId,
                details: { action: action },
                performed_at: new Date().toISOString()
            });
            console.log('Admin action logged:', action);
        } catch (error) {
            console.error('Error logging admin action:', error);
        }
    }

    // ===== STATISTICS =====
    function updateStats() {
        const pending = reports.filter(r => r.status === 'pending').length;
        const reviewed = reports.filter(r => r.status === 'reviewed').length;
        const resolved = reports.filter(r => r.status === 'resolved' || r.status === 'dismissed').length;
        
        const pendingEl = document.getElementById('pendingCount');
        const reviewedEl = document.getElementById('reviewedCount');
        const resolvedEl = document.getElementById('resolvedCount');
        const totalEl = document.getElementById('totalCount');
        
        if (pendingEl) pendingEl.textContent = pending;
        if (reviewedEl) reviewedEl.textContent = reviewed;
        if (resolvedEl) resolvedEl.textContent = resolved;
        if (totalEl) totalEl.textContent = reports.length;
        
        const badge = document.getElementById('pendingReportsBadge');
        if (badge) {
            badge.style.display = pending > 0 ? 'block' : 'none';
        }
        
        console.log('Stats updated:', { pending, reviewed, resolved, total: reports.length });
    }

    // ===== PAGINATION =====
    function updatePagination() {
        const pagination = document.getElementById('pagination');
        if (!pagination) return;
        
        const totalPages = Math.ceil(filteredReports.length / itemsPerPage);
        
        if (totalPages <= 1) {
            pagination.style.display = 'none';
            return;
        }

        pagination.style.display = 'flex';
        
        let html = '';
        
        html += `
            <button class="page-btn" onclick="reportsManager.changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
        
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
                html += `
                    <button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="reportsManager.changePage(${i})">
                        ${i}
                    </button>
                `;
            } else if (i === currentPage - 3 || i === currentPage + 3) {
                html += `<span class="page-btn" style="border: none; background: none;">...</span>`;
            }
        }
        
        html += `
            <button class="page-btn" onclick="reportsManager.changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
        
        pagination.innerHTML = html;
    }

    function changePage(page) {
        currentPage = page;
        renderReports();
        updatePagination();
        
        const container = document.querySelector('.reports-container');
        if (container) {
            container.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // ===== UI STATE MANAGEMENT =====
    function showLoading() {
        const loading = document.getElementById('loadingState');
        const reportsList = document.getElementById('reportsList');
        const emptyState = document.getElementById('emptyState');
        const pagination = document.getElementById('pagination');
        
        if (loading) loading.style.display = 'flex';
        if (reportsList) reportsList.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        if (pagination) pagination.style.display = 'none';
    }

    function hideLoading() {
        const loading = document.getElementById('loadingState');
        if (loading) loading.style.display = 'none';
    }

    function showEmptyState(message) {
        const emptyState = document.getElementById('emptyState');
        const emptyMessage = document.getElementById('emptyMessage');
        const reportsList = document.getElementById('reportsList');
        const pagination = document.getElementById('pagination');
        
        if (emptyState) emptyState.style.display = 'block';
        if (emptyMessage) emptyMessage.textContent = message || 'No reports found.';
        if (reportsList) reportsList.style.display = 'none';
        if (pagination) pagination.style.display = 'none';
    }

    function closeModal() {
        const modal = document.getElementById('reportModal');
        if (modal) modal.classList.remove('active');
        currentReport = null;
    }

    // ===== UTILITY FUNCTIONS =====
    function formatReportId(id) {
        return `#IB-${new Date().getFullYear()}-${String(id).padStart(4, '0')}`;
    }

    function formatPrice(price, currency = 'UGX') {
        if (!price) return 'Price on request';
        if (currency === 'UGX') {
            return new Intl.NumberFormat('en-UG', {
                style: 'currency',
                currency: 'UGX',
                minimumFractionDigits: 0
            }).format(price);
        }
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 0
        }).format(price);
    }

    function getTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        
        if (diffSec < 60) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHour < 24) return `${diffHour}h ago`;
        if (diffDay < 7) return `${diffDay}d ago`;
        return date.toLocaleDateString('en-UG', { month: 'short', day: 'numeric' });
    }

    function getInitials(name) {
        if (!name) return 'U';
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showNotification(message, type = 'success') {
        console.log(`Notification: [${type}] ${message}`);
        
        // Remove existing notifications
        const existing = document.querySelectorAll('.notification-toast');
        existing.forEach(n => n.remove());
        
        const container = document.getElementById('notification-container') || createNotificationContainer();
        
        const notification = document.createElement('div');
        notification.className = 'notification-toast';
        
        let icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        if (type === 'warning') icon = 'exclamation-triangle';
        if (type === 'info') icon = 'info-circle';
        
        notification.innerHTML = `<i class="fas fa-${icon}" style="margin-right: 8px;"></i>${message}`;
        
        if (type === 'error') notification.style.background = 'var(--danger)';
        if (type === 'warning') notification.style.background = 'var(--warning)';
        if (type === 'info') notification.style.background = 'var(--info)';
        
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 3000);
    }

    function createNotificationContainer() {
        const container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 3000;
            pointer-events: none;
        `;
        document.body.appendChild(container);
        return container;
    }

    function refreshData() {
        loadReports();
        showNotification('Refreshing data...', 'info');
    }

    async function logout() {
        try {
            await sb.auth.signOut();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    // ===== PUBLIC API =====
    return {
        openReportDetails,
        updateReportStatus,
        banAd,
        banUser,
        closeModal,
        changePage,
        refreshData,
        logout
    };
})();

// Assign to window for global access
window.reportsManager = reportsManager;