// ============================================
// PRODUCT VIDEO UPLOAD - COMPLETE FIXED VERSION
// ============================================

console.log('🎥 Product Video Upload loading...');

const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const VideoUploader = {
    currentUser: null,
    supplier: null,
    products: [],
    selectedFile: null,
    videoDuration: 0,
    
    async init() {
        try {
            await this.checkAuth();
            await this.loadSupplier();
            await this.diagnoseStorage(); // Optional: remove if not needed
            await this.loadProducts();
            this.setupEventListeners();
            this.checkUploadButton();
            
            // Hide loading state if exists
            const loadingEl = document.getElementById('loadingState');
            if (loadingEl) loadingEl.style.display = 'none';
            
            console.log('✅ Video uploader ready');
        } catch (error) {
            console.error('Error initializing:', error);
            this.showToast('Error loading uploader: ' + error.message, 'error');
        }
    },
    
    async checkAuth() {
        const { data: { user }, error } = await sb.auth.getUser();
        if (error || !user) {
            console.log('No user found, redirecting to login');
            window.location.href = 'login.html?redirect=upload-product-video.html';
            return;
        }
        this.currentUser = user;
        console.log('✅ User authenticated:', user.email);
    },
    
    async loadSupplier() {
        const { data, error } = await sb
            .from('suppliers')
            .select('*')
            .eq('profile_id', this.currentUser.id)
            .single();
        
        if (error) {
            console.error('Error loading supplier:', error);
            throw new Error('Could not load supplier profile');
        }
        
        this.supplier = data;
        console.log('✅ Supplier loaded:', this.supplier.business_name);
    },
    
    async diagnoseStorage() {
        console.log('🔍 Diagnosing storage...');
        try {
            const { data: buckets, error } = await sb.storage.listBuckets();
            if (error) {
                console.warn('Could not list buckets:', error);
                return;
            }
            
            const videoBucket = buckets.find(b => b.name === 'product-videos');
            if (videoBucket) {
                console.log('✅ product-videos bucket exists');
                console.log('Bucket public:', videoBucket.public);
            } else {
                console.warn('⚠️ product-videos bucket not found');
            }
        } catch (e) {
            console.warn('Storage diagnosis failed:', e);
        }
    },
    
    async loadProducts() {
        const { data, error } = await sb
            .from('ads')
            .select('id, title, image_urls')
            .eq('supplier_id', this.supplier.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('Error loading products:', error);
            throw new Error('Could not load products');
        }
        
        this.products = data || [];
        
        const select = document.getElementById('productSelect');
        if (select) {
            select.innerHTML = '<option value="">-- Select a product --</option>' +
                this.products.map(p => `<option value="${p.id}">${this.escapeHtml(p.title)}</option>`).join('');
        }
        
        console.log(`✅ Loaded ${this.products.length} products`);
    },
    
    setupEventListeners() {
        // Upload area click
        const uploadArea = document.getElementById('uploadArea');
        const videoInput = document.getElementById('videoInput');
        
        if (uploadArea && videoInput) {
            uploadArea.addEventListener('click', () => videoInput.click());
            
            videoInput.addEventListener('change', (e) => {
                this.handleFileSelect(e.target.files[0]);
            });
            
            // Drag and drop
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = 'var(--primary)';
                uploadArea.style.background = 'rgba(11, 79, 108, 0.05)';
            });
            
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.style.borderColor = 'var(--gray-300)';
                uploadArea.style.background = 'transparent';
            });
            
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = 'var(--gray-300)';
                uploadArea.style.background = 'transparent';
                const file = e.dataTransfer.files[0];
                if (file) this.handleFileSelect(file);
            });
        }
        
        // Product select change
        const productSelect = document.getElementById('productSelect');
        if (productSelect) {
            productSelect.addEventListener('change', () => this.checkUploadButton());
        }
        
        // Caption input
        const caption = document.getElementById('caption');
        if (caption) {
            caption.addEventListener('input', () => this.checkUploadButton());
        }
    },
    
    handleFileSelect(file) {
        if (!file) {
            console.log('No file selected');
            return;
        }
        
        console.log('File selected:', {
            name: file.name,
            type: file.type,
            size: Math.round(file.size / 1024 / 1024 * 100) / 100 + 'MB'
        });
        
        // Validate file type
        if (!file.type.startsWith('video/')) {
            this.showToast('Please select a video file (MP4, MOV, etc.)', 'error');
            return;
        }
        
        // Validate file size (100MB max)
        if (file.size > 100 * 1024 * 1024) {
            this.showToast('Video must be less than 100MB', 'error');
            return;
        }
        
        this.selectedFile = file;
        
        // Show preview
        const preview = document.getElementById('videoPreview');
        const previewVideo = document.getElementById('previewVideo');
        const uploadArea = document.getElementById('uploadArea');
        
        if (preview && previewVideo && uploadArea) {
            // Clean up old object URL
            if (previewVideo.src) {
                URL.revokeObjectURL(previewVideo.src);
            }
            
            previewVideo.src = URL.createObjectURL(file);
            preview.style.display = 'block';
            uploadArea.style.display = 'none';
            
            // Get video duration
            previewVideo.onloadedmetadata = () => {
                this.videoDuration = Math.round(previewVideo.duration);
                const thumbnailTime = document.getElementById('thumbnailTime');
                if (thumbnailTime) {
                    thumbnailTime.max = Math.max(1, this.videoDuration - 1);
                    thumbnailTime.value = Math.min(1, this.videoDuration - 1);
                }
                console.log('Video duration:', this.videoDuration, 'seconds');
            };
        }
        
        this.checkUploadButton();
        this.showToast('Video selected: ' + file.name, 'success');
    },
    
    checkUploadButton() {
        const uploadBtn = document.getElementById('uploadBtn');
        const productSelect = document.getElementById('productSelect');
        
        if (uploadBtn) {
            const hasVideo = this.selectedFile !== null;
            const hasProduct = productSelect && productSelect.value !== '';
            
            uploadBtn.disabled = !(hasVideo && hasProduct);
            console.log('Upload button state:', { hasVideo, hasProduct, enabled: hasVideo && hasProduct });
        }
    },
    
    async uploadVideo() {
        const productId = document.getElementById('productSelect')?.value;
        const caption = document.getElementById('caption')?.value || '';
        const category = document.getElementById('videoCategory')?.value || 'product_demo';
        const thumbnailTime = parseInt(document.getElementById('thumbnailTime')?.value) || 1;
        
        if (!productId) {
            this.showToast('Please select a product', 'error');
            return;
        }
        
        if (!this.selectedFile) {
            this.showToast('Please select a video', 'error');
            return;
        }
        
        try {
            this.showProgress(true);
            this.showToast('Uploading video...', 'info');
            
            console.log('Starting upload process...');
            console.log('Product ID:', productId);
            console.log('Category:', category);
            console.log('Thumbnail time:', thumbnailTime);
            
            // Generate thumbnail
            console.log('Generating thumbnail...');
            const thumbnailBlob = await this.generateThumbnail(this.selectedFile, thumbnailTime);
            console.log('Thumbnail generated, size:', thumbnailBlob.size, 'bytes');
            
            // Upload video
            console.log('Uploading video to storage...');
            const videoUrl = await this.uploadToStorage(this.selectedFile, 'videos');
            console.log('Video uploaded:', videoUrl);
            
            // Upload thumbnail
            console.log('Uploading thumbnail to storage...');
            const thumbnailUrl = await this.uploadToStorage(thumbnailBlob, 'thumbnails');
            console.log('Thumbnail uploaded:', thumbnailUrl);
            
            // Save to database
            console.log('Saving metadata to database...');
            await this.saveVideoMetadata(videoUrl, thumbnailUrl, productId, caption, category);
            
            this.showToast('Video uploaded successfully!', 'success');
            console.log('✅ Upload complete!');
            
            // Reset form and redirect after success
            setTimeout(() => {
                window.location.href = 'supplier-videos.html';
            }, 2000);
            
        } catch (error) {
            console.error('Upload error:', error);
            this.showToast('Error uploading video: ' + (error.message || 'Unknown error'), 'error');
        } finally {
            this.showProgress(false);
        }
    },
    
    async uploadToStorage(file, folder) {
        try {
            // Validate file object
            if (!file) {
                throw new Error('No file provided');
            }
            
            console.log('Uploading to folder:', folder);
            console.log('File type:', file.type || 'unknown');
            console.log('File size:', file.size, 'bytes');
            
            // Generate filename based on file type
            let fileName = '';
            let fileExt = '';
            
            if (file.name) {
                // Regular File object with name
                const nameParts = file.name.split('.');
                fileExt = nameParts.length > 1 ? nameParts.pop() : 'mp4';
                const baseName = nameParts.join('.').replace(/[^a-zA-Z0-9]/g, '_') || 'video';
                fileName = `${baseName}_${Date.now()}.${fileExt}`;
            } else {
                // Blob without name (thumbnail)
                fileExt = folder === 'videos' ? 'mp4' : 'jpg';
                fileName = `thumbnail_${Date.now()}.${fileExt}`;
            }
            
            // Create storage path
            const storagePath = `${this.supplier.id}/${folder}/${fileName}`;
            
            console.log('Storage path:', storagePath);
            
            // Determine content type
            let contentType = file.type;
            if (!contentType || contentType === 'application/octet-stream') {
                contentType = folder === 'videos' ? 'video/mp4' : 'image/jpeg';
            }
            
            // Upload the file
            const { data, error } = await sb.storage
                .from('product-videos')
                .upload(storagePath, file, {
                    cacheControl: '3600',
                    contentType: contentType,
                    upsert: false
                });
            
            if (error) {
                console.error('Storage upload error:', error);
                
                // Provide user-friendly error messages
                if (error.message?.includes('bucket')) {
                    throw new Error('Storage bucket not found. Please contact support.');
                } else if (error.message?.includes('permission')) {
                    throw new Error('Permission denied. Please check your login status.');
                } else if (error.message?.includes('CORS')) {
                    throw new Error('CORS error. Please configure CORS in Supabase dashboard.');
                } else {
                    throw error;
                }
            }
            
            // Get public URL
            const { data: { publicUrl } } = sb.storage
                .from('product-videos')
                .getPublicUrl(storagePath);
            
            console.log('Upload successful, public URL:', publicUrl);
            return publicUrl;
            
        } catch (error) {
            console.error('Upload to storage failed:', error);
            throw error;
        }
    },
    
    generateThumbnail(videoFile, timeInSeconds) {
        return new Promise((resolve, reject) => {
            try {
                // Validate input
                if (!videoFile) {
                    reject(new Error('No video file provided'));
                    return;
                }
                
                console.log('Generating thumbnail from video...');
                
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.src = URL.createObjectURL(videoFile);
                video.muted = true;
                video.crossOrigin = 'anonymous';
                
                // Set timeout
                const timeout = setTimeout(() => {
                    reject(new Error('Thumbnail generation timeout'));
                    URL.revokeObjectURL(video.src);
                }, 10000);
                
                video.onloadeddata = () => {
                    // Ensure time is within bounds
                    const safeTime = Math.min(
                        timeInSeconds, 
                        Math.max(0, video.duration - 0.5)
                    );
                    video.currentTime = safeTime;
                };
                
                video.onseeked = () => {
                    clearTimeout(timeout);
                    
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth || 640;
                        canvas.height = video.videoHeight || 480;
                        
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        
                        canvas.toBlob((blob) => {
                            if (blob) {
                                console.log('Thumbnail generated, size:', blob.size, 'bytes');
                                resolve(blob);
                            } else {
                                reject(new Error('Failed to generate thumbnail blob'));
                            }
                            URL.revokeObjectURL(video.src);
                        }, 'image/jpeg', 0.8);
                        
                    } catch (e) {
                        reject(e);
                        URL.revokeObjectURL(video.src);
                    }
                };
                
                video.onerror = (e) => {
                    clearTimeout(timeout);
                    console.error('Video error:', e);
                    reject(new Error('Failed to load video for thumbnail'));
                    URL.revokeObjectURL(video.src);
                };
                
            } catch (error) {
                reject(error);
            }
        });
    },
    
    async saveVideoMetadata(videoUrl, thumbnailUrl, productId, caption, category) {
        try {
            const videoData = {
                supplier_id: this.supplier.id,
                product_id: productId,
                video_url: videoUrl,
                thumbnail_url: thumbnailUrl,
                caption: caption,
                category: category,
                duration: this.videoDuration || 0,
                views: 0,
                likes: 0,
                comments: 0,
                inquiries: 0,
                is_active: true,
                created_at: new Date().toISOString()
            };
            
            console.log('Saving video metadata:', videoData);
            
            const { error } = await sb
                .from('product_videos')
                .insert(videoData);
            
            if (error) {
                console.error('Database insert error:', error);
                
                // Check for specific errors
                if (error.code === '42P01') {
                    throw new Error('Database table not found. Please create the product_videos table.');
                } else if (error.code === '23503') {
                    throw new Error('Invalid supplier or product ID.');
                } else {
                    throw error;
                }
            }
            
            console.log('✅ Video metadata saved successfully');
            
        } catch (error) {
            console.error('Error saving video metadata:', error);
            throw error;
        }
    },
    
    showProgress(show) {
        const progressBar = document.getElementById('progressBar');
        const uploadBtn = document.getElementById('uploadBtn');
        
        if (progressBar && uploadBtn) {
            if (show) {
                progressBar.style.display = 'block';
                uploadBtn.disabled = true;
                this.simulateProgress();
            } else {
                progressBar.style.display = 'none';
                uploadBtn.disabled = false;
                const fill = document.getElementById('progressFill');
                if (fill) fill.style.width = '0%';
            }
        }
    },
    
    simulateProgress() {
        let progress = 0;
        const fill = document.getElementById('progressFill');
        if (!fill) return;
        
        const interval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress >= 90) {
                progress = 90;
                clearInterval(interval);
            }
            fill.style.width = progress + '%';
        }, 500);
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },
    
    resetForm() {
        this.selectedFile = null;
        this.videoDuration = 0;
        
        const uploadArea = document.getElementById('uploadArea');
        const preview = document.getElementById('videoPreview');
        const previewVideo = document.getElementById('previewVideo');
        const productSelect = document.getElementById('productSelect');
        const caption = document.getElementById('caption');
        const thumbnailTime = document.getElementById('thumbnailTime');
        
        if (uploadArea) uploadArea.style.display = 'block';
        if (preview) preview.style.display = 'none';
        if (previewVideo) {
            URL.revokeObjectURL(previewVideo.src);
            previewVideo.src = '';
        }
        if (productSelect) productSelect.value = '';
        if (caption) caption.value = '';
        if (thumbnailTime) thumbnailTime.value = 1;
        
        this.checkUploadButton();
        console.log('Form reset');
    }
};

// ============================================
// MAKE FUNCTIONS GLOBALLY AVAILABLE
// ============================================

window.VideoUploader = VideoUploader;
window.uploadVideo = () => VideoUploader.uploadVideo();
window.resetForm = () => VideoUploader.resetForm();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VideoUploader.init());
} else {
    VideoUploader.init();
}