// script.js - Frontend logic for Simple YTD

// Move these to global scope (before DOMContentLoaded)
let ws;
let clientId = localStorage.getItem('ytdClientId');
let activeDownloader = localStorage.getItem('activeDownloader') || 'youtube';
let userSettings;
let downloadItemsState;
let isPowerSaveBlockerActive = false;

// Make WebSocket globally accessible
window.ws = ws;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize variables
    if (!clientId) {
        clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        localStorage.setItem('ytdClientId', clientId);
    }
    userSettings = loadSettings();
    downloadItemsState = new Map(); // To store item details and manage them

    // Make userSettings globally accessible
    window.userSettings = userSettings;
    window.managePowerSaveBlocker = managePowerSaveBlocker;
    window.isPowerSaveBlockerActive = isPowerSaveBlockerActive;

    // DOM Elements - These might not all exist on every page
    const youtubeUrlInput = document.getElementById('youtubeUrl');
    const formatSelect = document.getElementById('format');
    const qualitySelect = document.getElementById('quality'); // For YouTube
    const playlistOptionsDiv = document.getElementById('playlistOptions');
    const playlistActionSelect = document.getElementById('playlistAction');
    const playlistConcurrencySelect = document.getElementById('concurrency');
    const startYoutubeDownloadBtn = document.getElementById('startYoutubeDownloadBtn');
    const youtubeStatusDiv = document.getElementById('status');
    const youtubeDownloadLinksArea = document.getElementById('downloadLinksArea');

    const instagramUrlInput = document.getElementById('instagramUrl');
    const instagramQualitySelect = document.getElementById('instagramQuality');
    const startInstagramDownloadBtn = document.getElementById('startInstagramDownloadBtn');
    const instagramStatusDiv = document.getElementById('instagramStatus');
    const instagramDownloadLinksArea = document.getElementById('instagramDownloadLinksArea');

    const youtubeTab = document.getElementById('youtubeTab');
    const instagramTab = document.getElementById('instagramTab');
    const contactUsTab = document.querySelector('nav.main-nav a[href="contact.html"]');
    const historyTab = document.getElementById('historyTab');

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    const maxSpeedInput = document.getElementById('maxSpeed');
    const numerateFilesCheckbox = document.getElementById('numerateFiles');
    const skipDuplicatesCheckbox = document.getElementById('skipDuplicates');
    const searchTagsCheckbox = document.getElementById('searchTags');
    const removeCompletedCheckbox = document.getElementById('removeCompleted');
    const notificationSoundCheckbox = document.getElementById('notificationSound');
    const notificationPopupCheckbox = document.getElementById('notificationPopup');
    let keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
    const speedUnitDisplaySelect = document.getElementById('speedUnitDisplay');
    const resetSpeedBtn = document.getElementById('resetSpeedBtn');
    const downloadFolderInput = document.getElementById('downloadFolder');
    const chooseFolderBtn = document.getElementById('chooseFolderBtn');
    const defaultFolderBtn = document.getElementById('defaultFolderBtn');
    const openFolderBtn = document.getElementById('openFolderBtn');
    const skipDeleteConfirmationCheckbox = document.getElementById('skipDeleteConfirmation');
    const themePresetSelect = document.getElementById('themePreset');

    const completionSound = document.getElementById('completionSound');

    const pasteYoutubeUrlBtn = document.getElementById('pasteYoutubeUrlBtn');
    const pasteInstagramUrlBtn = document.getElementById('pasteInstagramUrlBtn');

    const clearYoutubeDownloadsBtn = document.getElementById('clearYoutubeDownloadsBtn');
    const clearInstagramDownloadsBtn = document.getElementById('clearInstagramDownloadsBtn');

    const compactModeCheckbox = document.getElementById('compactMode');

    const importCookiesBtn = document.getElementById('importCookiesBtn');
    if (importCookiesBtn) {
      importCookiesBtn.onclick = () => {
        if (window.electronAPI && window.electronAPI.openCookiesHelper) {
          window.electronAPI.openCookiesHelper();
        } else {
          window.open('public/cookies.html', 'ImportCookies', 'width=600,height=500');
        }
      };
    }

    function getDownloadFolder() {
        return downloadFolderInput && downloadFolderInput.value ? downloadFolderInput.value : '';
    }

    // --- WebSocket Connection ---
    // Only connect WebSocket if on index.html (where download functionality is)
    if (document.getElementById('youtubeDownloader') || document.getElementById('instagramDownloader')) {
        connectWebSocket();
    }

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.hostname}:9875?clientId=${clientId}`;
        console.log(`Attempting to connect to WebSocket: ${wsUrl}`);

        ws = new WebSocket(wsUrl);
        window.ws = ws; // Make it globally accessible

        ws.onopen = () => {
            console.log('WebSocket connection established.');
            // Show connected status immediately
            if (youtubeStatusDiv) showStatus('Connected to server.', 'youtube', 'success');
            if (instagramStatusDiv) showStatus('Connected to server.', 'instagram', 'success');
            
            // Also update any other UI elements that show connection status
            const connectionIndicators = document.querySelectorAll('.connection-status');
            connectionIndicators.forEach(indicator => {
                indicator.textContent = 'Connected';
                indicator.className = 'connection-status connected';
            });
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message received:', data);
                
                // Handle ready message specifically
                if (data.type === 'ready') {
                    console.log('Server ready message received');
                    const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                    if (currentStatusDiv) {
                        showStatus('Server ready - you can start downloading!', activeDownloader, 'success');
                    }
                    return;
                }
                
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                if (currentStatusDiv) {
                    showStatus('Error processing message from server.', activeDownloader, 'error');
                }
            }
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed. Attempting to reconnect...');
            if (youtubeStatusDiv) showStatus('Disconnected. Attempting to reconnect...', 'youtube', 'error');
            if (instagramStatusDiv) showStatus('Disconnected. Attempting to reconnect...', 'instagram', 'error');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (youtubeStatusDiv) showStatus('WebSocket connection error.', 'youtube', 'error');
            if (instagramStatusDiv) showStatus('WebSocket connection error.', 'instagram', 'error');
        };
    }

    function sendMessageToServer(type, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({ type, ...payload });
            ws.send(message);
            console.log('WebSocket message sent:', message);
        } else {
            console.error('WebSocket is not connected.');
            const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
            if (currentStatusDiv) {
                 showStatus('Not connected to server. Please wait.', activeDownloader, 'error');
            }
        }
    }

    // --- Message Handling ---
    function handleWebSocketMessage(data) {
        const { type, message, itemId, downloadUrl, filename, title, actualSize, percent, rawSpeed, speedBytesPerSec, source = activeDownloader, isPlaylistItem, playlistIndex, thumbnail, fullPath } = data;
        const currentItemState = downloadItemsState.get(itemId);

        // Hide playlist meta items (e.g., 'Fetching playlist: ...')
        if (type === 'queued' && title && title.startsWith('Fetching playlist:')) {
            return;
        }

        const linksArea = getLinksArea(source);
        // Only process download-specific UI updates if the linksArea for that source exists
        if (!linksArea && ['queued', 'item_info', 'progress', 'complete', 'error', 'cancel_confirm'].includes(type)) {
            console.warn(`Download links area for source "${source}" not found on this page. Skipping UI update for item ${itemId}, type ${type}.`);
            return;
        }

        switch (type) {
            case 'queued':
                createDownloadItemStructure(itemId, title || 'Processing...', source, isPlaylistItem);
                updateDownloadItemStatus(itemId, message || 'Queued...', source);
                // Show pause/play button and remove button immediately for queued items
                const queuedItemDiv = document.getElementById(`item-${itemId}`);
                if (queuedItemDiv) {
                    const pausePlayBtn = queuedItemDiv.querySelector('.item-pause-play-btn');
                    const removeBtn = queuedItemDiv.querySelector('.item-remove-btn');
                    if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                    if (removeBtn) removeBtn.style.display = 'inline-flex';
                }
                if (currentItemState) currentItemState.status = 'queued';
                updateDownloadStats();
                break;
            case 'item_info':
                if (!downloadItemsState.has(itemId)) {
                    createDownloadItemStructure(itemId, title || 'Fetching info...', source, isPlaylistItem);
                    // Show pause/play button and remove button for new items
                    const newItemDiv = document.getElementById(`item-${itemId}`);
                    if (newItemDiv) {
                        const pausePlayBtn = newItemDiv.querySelector('.item-pause-play-btn');
                        const removeBtn = newItemDiv.querySelector('.item-remove-btn');
                        if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                        if (removeBtn) removeBtn.style.display = 'inline-flex';
                    }
                }
                updateDownloadItemTitle(itemId, title, source);
                if (thumbnail) updateDownloadItemThumbnail(itemId, thumbnail);
                if (currentItemState) {
                    currentItemState.title = title;
                    if (thumbnail) currentItemState.thumbnail = thumbnail;
                    if (fullPath) currentItemState.fullPath = fullPath;
                }
                break;
            case 'progress':
                updateDownloadItemProgress(itemId, message, percent, rawSpeed, source, speedBytesPerSec);
                if (currentItemState) currentItemState.status = 'downloading';
                updateDownloadStats();
                break;
            case 'complete':
                // Use clean title from server if available, otherwise fall back to filename or title
                const displayTitle = data.title || title || filename || 'Download complete';
                updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, thumbnail, displayTitle);
                if (userSettings.notificationSound && completionSound) playNotificationSound();
                if (userSettings.notificationPopup) showDesktopNotification(displayTitle, message || 'Download complete!');
                if (userSettings.removeCompleted) {
                    setTimeout(() => handleRemoveDownloadItem(itemId, source), 5000);
                }
                if (currentItemState) currentItemState.status = 'complete';
                // Fix playlist categorization
                let subtabKey = source;
                if (source === 'youtube') {
                    if (currentItemState && currentItemState.isPlaylist) {
                        subtabKey = 'youtubePlaylists';
                    } else {
                        subtabKey = 'youtubeSingles';
                    }
                }
                scanDownloadFolderAndUpdateHistory();
                const history = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
                history.unshift({
                  name: displayTitle || filename, // Use clean title for history display
                  path: downloadUrl,
                  folder: data.downloadFolder || getDownloadFolder(), // <-- add this
                  type: subtabKey === 'youtube' ? 'youtubeSingles' : subtabKey,
                  size: actualSize || 'N/A',
                  mtime: new Date().toISOString(),
                  thumbnail: (thumbnail || currentItemState?.thumbnail) || null
                });
                localStorage.setItem('ytdHistory', JSON.stringify(history.slice(0, 500)));
                renderFromLocalStorage();
                updateDownloadStats();
                break;
            case 'error':
                updateDownloadItemError(itemId, message, source);
                if (currentItemState) currentItemState.status = 'error';
                break;
            case 'cancel_confirm':
                updateDownloadItemStatus(itemId, message || 'Download cancelled.', source, 'cancelled');
                disableCancelButton(itemId, source);
                if (currentItemState) currentItemState.status = 'cancelled';
                removeDownloadItemAfterDelay(itemId);
                break;
            case 'status':
                const statusDivForGeneral = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                if (statusDivForGeneral) {
                    showStatus(message, source, 'info');
                }
                // If this is a download status message, show the pause/play button and remove button
                if (message && message.includes('Downloading') && itemId) {
                    const itemDiv = document.getElementById(`item-${itemId}`);
                    if (itemDiv) {
                        const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
                        const removeBtn = itemDiv.querySelector('.item-remove-btn');
                        if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                        if (removeBtn) removeBtn.style.display = 'inline-flex';
                    }
                }
                break;
            case 'playlist_complete':
                 const statusDivForPlaylist = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                 if (statusDivForPlaylist) {
                    showStatus(message || `Playlist processing finished for ${source}.`, source, 'success');
                 }
                break;
            default:
                console.warn('Unknown WebSocket message type:', type);
        }
    }

    // --- UI Updates ---
    function showStatus(message, downloaderSource, type = 'info') {
        const statusDiv = downloaderSource === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
        if (statusDiv) {
            statusDiv.textContent = message;
            statusDiv.className = 'status-message';
            if (type === 'success') statusDiv.classList.add('success');
            else if (type === 'error') statusDiv.classList.add('error');
            else if (type === 'cancelled') statusDiv.classList.add('error');
        }
    }

    function getLinksArea(source) {
        return source === 'youtube' ? youtubeDownloadLinksArea : instagramDownloadLinksArea;
    }

    function createDownloadItemStructure(itemId, titleText, source, isPlaylistItem = false) {
        const linksArea = getLinksArea(source);
        if (!linksArea || downloadItemsState.has(itemId)) return;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'download-item';
        itemDiv.id = `item-${itemId}`;
        itemDiv.dataset.itemId = itemId;

        const thumbnailImg = document.createElement('img');
        thumbnailImg.className = 'item-thumbnail';
        thumbnailImg.src = `https://placehold.co/120x90/e0e0e0/7f7f7f?text=${source.charAt(0).toUpperCase()}`;
        thumbnailImg.alt = 'Video thumbnail';
        itemDiv.appendChild(thumbnailImg);

        const itemContentDiv = document.createElement('div');
        itemContentDiv.className = 'item-content';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'item-title';
        titleDiv.textContent = titleText;
        itemContentDiv.appendChild(titleDiv);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'item-status';
        statusDiv.textContent = 'Queued...';
        itemContentDiv.appendChild(statusDiv);

        const progressBarContainer = document.createElement('div');
        progressBarContainer.className = 'progress-bar-container';
        progressBarContainer.style.display = 'none';

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressBarContainer.appendChild(progressBar);
        itemContentDiv.appendChild(progressBarContainer);

        const linkDiv = document.createElement('div');
        linkDiv.className = 'item-link';
        itemContentDiv.appendChild(linkDiv);

        itemDiv.appendChild(itemContentDiv);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'item-buttons';

        // Control buttons row (pause, play, remove)
        const controlButtonsDiv = document.createElement('div');
        controlButtonsDiv.className = 'item-control-buttons';

        const pausePlayBtn = document.createElement('button');
        pausePlayBtn.className = 'item-control-btn item-pause-play-btn';
        pausePlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
        pausePlayBtn.title = 'Pause download';
        pausePlayBtn.style.display = 'none';
        pausePlayBtn.onclick = () => handlePausePlayToggle(itemId, source);
        controlButtonsDiv.appendChild(pausePlayBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'item-control-btn item-remove-btn';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.title = 'Remove this item';
        removeBtn.style.display = 'none';
        removeBtn.onclick = () => handleRemoveDownloadItem(itemId, source);
        controlButtonsDiv.appendChild(removeBtn);

        buttonsDiv.appendChild(controlButtonsDiv);

        // Cancel button (below control buttons)
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'item-cancel-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => handleCancelDownload(itemId, source);
        buttonsDiv.appendChild(cancelBtn);

        itemDiv.appendChild(buttonsDiv);
        linksArea.prepend(itemDiv);

        downloadItemsState.set(itemId, {
            title: titleText, 
            status: 'queued', 
            source: source,
            domElement: itemDiv,
            isPlaylist: isPlaylistItem, // Store the playlist flag
            thumbnailEl: thumbnailImg
        });
        
        updateDownloadStats();
    }

    function updateDownloadItemStatus(itemId, statusText, source, statusType = 'info') {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const statusEl = itemDiv.querySelector('.item-status');
            if (statusEl) {
                statusEl.textContent = statusText;
                statusEl.className = 'item-status';
                if (statusType === 'error') statusEl.classList.add('error-text');
                if (statusType === 'success') statusEl.classList.add('success-text');
                if (statusType === 'cancelled') statusEl.classList.add('cancelled-text');
            }
            const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
            if (progressBarContainer && (statusType === 'error' || statusType === 'cancelled' || statusType === 'success')) {
                progressBarContainer.style.display = 'none';
            }
        }
    }

    function updateDownloadItemTitle(itemId, newTitle, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const titleEl = itemDiv.querySelector('.item-title');
            if (titleEl) {
                titleEl.textContent = newTitle;
            }
        }
    }

    function updateDownloadItemThumbnail(itemId, thumbnailUrl) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv && thumbnailUrl) {
            const img = itemDiv.querySelector('.item-thumbnail');
            if (img) {
                img.src = thumbnailUrl;
            }
        }
    }

    function formatSpeed(speedBytesPerSec, unit) {
        if (typeof speedBytesPerSec !== 'number' || isNaN(speedBytesPerSec)) return '';
        if (unit === 'MBps') {
            return (speedBytesPerSec / 1e6).toFixed(2) + ' MB/s';
        } else if (unit === 'Mbps') {
            return ((speedBytesPerSec * 8) / 1e6).toFixed(2) + ' Mbps';
        } else {
            return speedBytesPerSec + ' B/s';
        }
    }

    function parseSpeedString(speedStr) {
        if (!speedStr || typeof speedStr !== 'string') return null;
        const match = speedStr.match(/([\d.]+)\s*(K|M|G)?i?B\/s/i);
        if (!match) return null;
        let value = parseFloat(match[1]);
        let unit = match[2] ? match[2].toUpperCase() : '';
        let bytes = value;
        if (unit === 'K') bytes *= 1024;
        else if (unit === 'M') bytes *= 1024 * 1024;
        else if (unit === 'G') bytes *= 1024 * 1024 * 1024;
        return bytes;
    }

    // Cache DOM elements for progress updates to avoid repeated queries
    const progressUpdateCache = new Map();
    
    // Throttled progress update for better performance
    const throttledProgressUpdate = throttle((itemId, progressData) => {
        requestAnimationFrame(() => {
            updateDownloadItemProgressInternal(itemId, progressData);
        });
    }, 100); // Update max every 100ms
    
    function updateDownloadItemProgress(itemId, message, percent, rawSpeed, source, speedBytesPerSec) {
        throttledProgressUpdate(itemId, { message, percent, rawSpeed, speedBytesPerSec });
    }
    
    function updateDownloadItemProgressInternal(itemId, { message, percent, rawSpeed, speedBytesPerSec }) {
        let itemDiv = progressUpdateCache.get(`div-${itemId}`);
        if (!itemDiv) {
            itemDiv = document.getElementById(`item-${itemId}`);
            if (itemDiv) {
                // Cache DOM elements for this item
                progressUpdateCache.set(`div-${itemId}`, itemDiv);
                progressUpdateCache.set(`status-${itemId}`, itemDiv.querySelector('.item-status'));
                progressUpdateCache.set(`progressBar-${itemId}`, itemDiv.querySelector('.progress-bar'));
                progressUpdateCache.set(`progressBarContainer-${itemId}`, itemDiv.querySelector('.progress-bar-container'));
            }
        }
        
        if (!itemDiv) return;
        
        const statusEl = progressUpdateCache.get(`status-${itemId}`);
        const progressBarContainer = progressUpdateCache.get(`progressBarContainer-${itemId}`);
        const progressBar = progressUpdateCache.get(`progressBar-${itemId}`);

        let progressText = '';
        if (typeof percent === 'number' && !isNaN(percent)) {
            progressText += percent.toFixed(1) + '%';
        }
        let speedText = '';
        let speedVal = null;
        if (typeof speedBytesPerSec === 'number' && !isNaN(speedBytesPerSec)) {
            speedVal = speedBytesPerSec;
        } else if (rawSpeed) {
            speedVal = parseSpeedString(rawSpeed);
        }
        if (speedVal !== null) {
            speedText = formatSpeed(speedVal, userSettings.speedUnitDisplay);
        }
        if (speedText) {
            if (progressText) progressText += ' at ';
            progressText += speedText;
        }
        if (!progressText && message) {
            progressText = message;
        }
        if (statusEl) statusEl.textContent = progressText || 'Processing...';
        if (progressBarContainer) progressBarContainer.style.display = 'block';
        if (progressBar && typeof percent === 'number' && !isNaN(percent)) {
            progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
        
        // Show pause/play button and remove button when download starts (when progress > 0)
        if (typeof percent === 'number' && percent > 0) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        }
    }

    function updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, thumb, cleanTitle) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            // Update title with clean title if provided
            if (cleanTitle) {
                updateDownloadItemTitle(itemId, cleanTitle, source);
                const currentItemState = downloadItemsState.get(itemId);
                if (currentItemState) {
                    currentItemState.title = cleanTitle;
                }
            }
            // Compact status message: "Download complete • filesize"
            const statusText = `Download complete${actualSize ? ' • ' + actualSize : ''}`;
            updateDownloadItemStatus(itemId, statusText, source, 'success');
            
            const linkEl = itemDiv.querySelector('.item-link');
            if (linkEl && downloadUrl && filename) {
                linkEl.innerHTML = '';
                
                const openFolderBtn = document.createElement('button');
                openFolderBtn.className = 'modern-folder-btn compact-folder-btn';
                openFolderBtn.title = 'Open containing folder';
                openFolderBtn.innerHTML = '<i class="fas fa-folder-open"></i> Open Folder';
                openFolderBtn.onclick = async () => {
                    if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                        try {
                            let targetPath = fullPath;
                            if (!targetPath && window.electronAPI?.resolvePath) {
                                const root = getDownloadFolder();
                                const rel = decodeURIComponent(downloadUrl.replace('/downloads/', ''));
                                targetPath = await window.electronAPI.resolvePath(root, rel);
                            }
                            const folderPath = window.electronAPI?.getDirname && targetPath
                                ? await window.electronAPI.getDirname(targetPath)
                                : getDownloadFolder();
                            await window.electronAPI.openPathInExplorer(folderPath);
                        } catch (e) {
                            console.error('Open folder failed:', e);
                            showAlert('Unable to open containing folder.', 'Error');
                        }
                    } else {
                        console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                        showAlert('Open folder not available. Make sure you are running in Electron.', 'Not Available');
                    }
                };
                linkEl.appendChild(openFolderBtn);
            }
            if (thumb) updateDownloadItemThumbnail(itemId, thumb);
            disableCancelButton(itemId, source);
            showActionButtons(itemId);
            
            // Hide pause/play and cancel buttons when download completes
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'none';
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
    }

    function updateDownloadItemError(itemId, errorMessage, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            updateDownloadItemStatus(itemId, `Error: ${errorMessage}`, source, 'error');
            disableCancelButton(itemId, source);
            showActionButtons(itemId);
        }
    }

    function disableCancelButton(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if (cancelBtn) {
                cancelBtn.disabled = true;
                cancelBtn.textContent = 'Done';
                cancelBtn.style.opacity = '0.6';
                cancelBtn.style.cursor = 'default';
            }
        }
    }

    function handleCancelDownload(itemId, source) {
        console.log(`Cancelling download for item: ${itemId}, source: ${source}`);
        sendMessageToServer('cancel', { itemId: itemId });
        updateDownloadItemStatus(itemId, 'Cancelling...', source);
        const itemDiv = document.getElementById(`item-${itemId}`);
        if(itemDiv){
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if(cancelBtn) cancelBtn.disabled = true;
        }
    }

    function handleRemoveDownloadItem(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) itemDiv.remove();
        downloadItemsState.delete(itemId);
        // Clear cache for removed item
        progressUpdateCache.delete(`div-${itemId}`);
        progressUpdateCache.delete(`status-${itemId}`);
        progressUpdateCache.delete(`progressBar-${itemId}`);
        progressUpdateCache.delete(`progressBarContainer-${itemId}`);
        updateDownloadStats();
        console.log(`Removed item ${itemId} from UI and state.`);
    }

    function showActionButtons(itemId) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        }
    }

    // Dynamic pause/play toggle function
    function handlePausePlayToggle(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            if (pausePlayBtn) {
                const isPaused = pausePlayBtn.innerHTML.includes('fa-play');
                
                if (isPaused) {
                    // Currently paused, resume download
                    console.log(`[Placeholder] Resuming download for item: ${itemId}, source: ${source}`);
                    pausePlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    pausePlayBtn.title = 'Pause download';
                    updateDownloadItemStatus(itemId, 'Resuming...', source);
                } else {
                    // Currently downloading, pause download
                    console.log(`[Placeholder] Pausing download for item: ${itemId}, source: ${source}`);
                    pausePlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                    pausePlayBtn.title = 'Resume download';
                    updateDownloadItemStatus(itemId, 'Paused', source);
                }
            }
        }
    }

    // --- Download Initiation ---
    async function fetchVideoInfo(url, source) {
        if (!youtubeUrlInput && !instagramUrlInput) return null;
        try {
            const response = await fetch('/video-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, clientId, source })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
                throw new Error(errorData.error || `HTTP error ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error fetching video info for ${url} (${source}):`, error);
            const statusDiv = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
            if (statusDiv) {
                 showStatus(`Error fetching info: ${error.message}`, source, 'error');
            }
            return null;
        }
    }

    async function startDownloadCommon(url, format, quality, source, playlistActionVal, concurrencyVal, singleConcurrencyVal) {
        const statusDiv = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
        if (!url) {
            if (statusDiv) showStatus('Please paste a URL.', source, 'error');
            return;
        }
        if (statusDiv) showStatus('Requesting download...', source, 'info');

        const payload = {
            url, format, quality, clientId, source,
            playlistAction: playlistActionVal,
            concurrency: concurrencyVal,
            singleConcurrency: singleConcurrencyVal,
            ...userSettings,
            downloadFolder: getDownloadFolder()
        };
        sendMessageToServer('download_request', payload);
    }

    if (startYoutubeDownloadBtn) {
        startYoutubeDownloadBtn.onclick = () => {
            const url = youtubeUrlInput.value.trim();
            const format = formatSelect.value;
            const qualityVal = qualitySelect.value;
            const singleConcurrencyRadio = document.querySelector('input[name="singleConcurrency"]:checked');
            const singleConcurrency = singleConcurrencyRadio ? singleConcurrencyRadio.value : '1';
            const isPlaylist = url.includes('list=') && playlistOptionsDiv && playlistOptionsDiv.style.display !== 'none';
            const playlistAction = isPlaylist && playlistActionSelect ? playlistActionSelect.value : 'single';
            const concurrency = isPlaylist && playlistAction === 'full' && playlistConcurrencySelect ? playlistConcurrencySelect.value : 1;

            startDownloadCommon(url, format, qualityVal, 'youtube', playlistAction, parseInt(concurrency), parseInt(singleConcurrency));
        };
    }

    if (startInstagramDownloadBtn) {
        startInstagramDownloadBtn.onclick = () => {
            const url = instagramUrlInput.value.trim();
            const qualityVal = instagramQualitySelect ? instagramQualitySelect.value : 'highest';
            startDownloadCommon(url, 'mp4', qualityVal, 'instagram', 'single', 1, 1);
        };
    }

    // --- Quality Options & Playlist Detection ---
    function populateQualityOptions(selectElement, format, source) {
        if (!selectElement) return;
        selectElement.innerHTML = '';

        let qualities = [];
        if (source === 'youtube') {
            if (format === 'mp4') {
                qualities = [
                    { value: 'highest', text: 'Highest Available MP4' },
                    { value: '2160', text: '4K' },
                    { value: '1440', text: '1440p' },
                    { value: '1080', text: '1080p' },
                    { value: '720', text: '720p' },
                    { value: '480', text: '480p' },
                    { value: '360', text: '360p' }
                ];
            } else if (format === 'mp3') {
                qualities = [
                    { value: 'highest', text: 'Highest Quality MP3' },
                    { value: '320', text: '320 kbps' },
                    { value: '256', text: '256 kbps' },
                    { value: '192', text: '192 kbps' },
                    { value: '128', text: '128 kbps' }
                ];
            }
        } else if (source === 'instagram') {
            qualities = [
                { value: 'highest', text: 'Highest Available' },
                { value: '1080', text: '1080p' },
                { value: '720', text: '720p' }
            ];
        }
        qualities.forEach(q => {
            const option = document.createElement('option');
            option.value = q.value;
            option.textContent = q.text;
            selectElement.appendChild(option);
        });
    }

    if (formatSelect && qualitySelect) {
        formatSelect.addEventListener('change', () => populateQualityOptions(qualitySelect, formatSelect.value, 'youtube'));
        populateQualityOptions(qualitySelect, formatSelect.value, 'youtube');
    }
    if (instagramQualitySelect) {
        populateQualityOptions(instagramQualitySelect, 'mp4', 'instagram');
    }

    function detectPlaylist() {
      if (!youtubeUrlInput || !playlistOptionsDiv) return;
      const url = youtubeUrlInput.value;
      playlistOptionsDiv.style.display = url.includes('list=') ? 'block' : 'none';
      if (playlistOptionsDiv.style.display === 'block' && playlistActionSelect) {
        playlistActionSelect.dispatchEvent(new Event('change'));
      }
    }
    if (youtubeUrlInput && playlistOptionsDiv && playlistActionSelect) {
      youtubeUrlInput.addEventListener('input', detectPlaylist);
      detectPlaylist();
    }
    if (playlistActionSelect) {
        playlistActionSelect.addEventListener('change', () => {
            const concurrencyGroup = document.getElementById('concurrencyGroup');
            if (concurrencyGroup) {
                concurrencyGroup.style.display = playlistActionSelect.value === 'full' ? 'block' : 'none';
            }
        });
        const initialConcurrencyGroup = document.getElementById('concurrencyGroup');
        if (initialConcurrencyGroup) {
            initialConcurrencyGroup.style.display = playlistActionSelect.value === 'full' ? 'block' : 'none';
        }
    }

    // --- Tab Management ---
    function showTab(tab) {
      ['youtubeDownloader', 'instagramDownloader', 'historyPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      ['youtubeTab', 'instagramTab', 'historyTab'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const panelId = tab === 'history' ? 'historyPanel' : `${tab}Downloader`;
      const navId   = `${tab}Tab`;
      const panel = document.getElementById(panelId);
      const nav = document.getElementById(navId);
      if (panel) panel.style.display = 'block';
      if (nav) nav.classList.add('active');
      activeDownloader = tab;
      localStorage.setItem('activeDownloader', tab);
      if (tab === 'youtube') {
        detectPlaylist();
        if (ws && ws.readyState === WebSocket.OPEN && youtubeStatusDiv) {
          showStatus('Connected to server.', 'youtube', 'success');
        }
      }
      if (tab === 'instagram') {
        if (ws && ws.readyState === WebSocket.OPEN && instagramStatusDiv) {
          showStatus('Connected to server.', 'instagram', 'success');
        }
      }
    }
    if (youtubeTab) youtubeTab.onclick = (e) => { e.preventDefault(); showTab('youtube'); };
    if (instagramTab) instagramTab.onclick = (e) => { e.preventDefault(); showTab('instagram'); };
    if (historyTab) historyTab.onclick = (e) => { e.preventDefault(); showTab('history'); };

    // --- Theme Management ---
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        const selectFields = document.querySelectorAll('.select-field');
        selectFields.forEach(select => {
            if (!select) return;
            const isDark = theme === 'dark';
            const arrowColorHex = isDark ? 'f8f9fa' : (getComputedStyle(document.documentElement).getPropertyValue('--text-color') || '#2d3436').trim().substring(1);
            select.style.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23${arrowColorHex}'%3E%3Cpath fill-rule='evenodd' d='M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z' clip-rule='evenodd'/%3E%3C/svg%3E")`;
        });
        document.querySelectorAll('.progress-bar').forEach(pb => {
             if (!pb) return;
            pb.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--progress-bar-bg').trim();
        });
    }

    // --- UI Scale Management ---
    function applyUIScale(scale) {
        document.documentElement.style.fontSize = `${scale}rem`;
        localStorage.setItem('uiScale', scale);
        console.log(`UI scale applied: ${scale}`);
    }

    // --- Settings Modal ---
    function loadSettings() {
        const defaults = {
            maxSpeed: 0, 
            numerateFiles: false, 
            skipDuplicates: false, 
            searchTags: false,
            removeCompleted: false, 
            notificationSound: true, 
            notificationPopup: true, 
            speedUnitDisplay: 'Mbps',
            downloadFolder: '', 
            compactMode: false,
            skipDeleteConfirmation: false,
            themePreset: 'light',
            keepPcAwake: true,
            uiScale: 1.0 // Add UI scale default
        };
        const storedSettings = localStorage.getItem('ytdUserSettings');
        let settings = storedSettings ? JSON.parse(storedSettings) : { ...defaults };
        for (const key in defaults) if (settings[key] === undefined) settings[key] = defaults[key];
        return settings;
    }

    function saveSettings() {
        // Ensure checkbox is found
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }
        
        userSettings = {
            maxSpeed: maxSpeedInput ? (parseInt(maxSpeedInput.value, 10) || 0) : 0,
            numerateFiles: numerateFilesCheckbox ? numerateFilesCheckbox.checked : false,
            skipDuplicates: skipDuplicatesCheckbox ? skipDuplicatesCheckbox.checked : false,
            searchTags: searchTagsCheckbox ? searchTagsCheckbox.checked : false,
            removeCompleted: removeCompletedCheckbox ? removeCompletedCheckbox.checked : false,
            notificationSound: notificationSoundCheckbox ? notificationSoundCheckbox.checked : true,
            notificationPopup: notificationPopupCheckbox ? notificationPopupCheckbox.checked : true,
            speedUnitDisplay: speedUnitDisplaySelect ? speedUnitDisplaySelect.value : 'Mbps',
            downloadFolder: downloadFolderInput ? downloadFolderInput.value : '',
            compactMode: compactModeCheckbox ? compactModeCheckbox.checked : false,
            skipDeleteConfirmation: skipDeleteConfirmationCheckbox ? skipDeleteConfirmationCheckbox.checked : false,
            themePreset: themePresetSelect ? themePresetSelect.value : 'light',
            keepPcAwake: keepPcAwakeCheckbox ? keepPcAwakeCheckbox.checked : true,
            uiScale: document.getElementById('uiScale') ? parseFloat(document.getElementById('uiScale').value) || 1.0 : 1.0
        };
        localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
        
        // Update global reference
        window.userSettings = userSettings;
        
        // Apply theme and UI scale immediately
        applyTheme(userSettings.themePreset);
        applyUIScale(userSettings.uiScale);
        
        if (settingsModal) settingsModal.style.display = 'none';
        
        const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
        if (currentStatusDiv) {
            showStatus('Settings saved!', activeDownloader, 'success');
        }
        console.log("Settings saved:", userSettings);
    }

    function populateSettingsModal() {
        if (!settingsModal) return;
        
        // Ensure checkbox is found
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }
        
        // If still not found, try to create it programmatically
        if (!keepPcAwakeCheckbox) {
            console.log('Creating keepPcAwake checkbox programmatically...');
            const notificationsSection = document.querySelector('.settings-section h3');
            if (notificationsSection && notificationsSection.textContent === 'Notifications') {
                const section = notificationsSection.parentElement;
                const notificationPopupDiv = section.querySelector('#notificationPopup').closest('.setting-item');
                
                if (notificationPopupDiv) {
                    const newCheckboxDiv = document.createElement('div');
                    newCheckboxDiv.className = 'setting-item checkbox-group';
                    newCheckboxDiv.innerHTML = `
                        <input type="checkbox" id="keepPcAwake" name="keepPcAwake">
                        <label for="keepPcAwake">Keep PC awake during downloads</label>
                    `;
                    
                    // Insert after notificationPopup
                    notificationPopupDiv.parentNode.insertBefore(newCheckboxDiv, notificationPopupDiv.nextSibling);
                    
                    // Update the reference
                    keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
                    console.log('Checkbox created and reference updated:', keepPcAwakeCheckbox);
                }
            }
        }
        
        if (maxSpeedInput) maxSpeedInput.value = userSettings.maxSpeed;
        if (numerateFilesCheckbox) numerateFilesCheckbox.checked = userSettings.numerateFiles;
        if (skipDuplicatesCheckbox) skipDuplicatesCheckbox.checked = userSettings.skipDuplicates;
        if (searchTagsCheckbox) searchTagsCheckbox.checked = userSettings.searchTags;
        if (removeCompletedCheckbox) removeCompletedCheckbox.checked = userSettings.removeCompleted;
        if (notificationSoundCheckbox) notificationSoundCheckbox.checked = userSettings.notificationSound;
        if (notificationPopupCheckbox) notificationPopupCheckbox.checked = userSettings.notificationPopup;
        if (keepPcAwakeCheckbox) keepPcAwakeCheckbox.checked = userSettings.keepPcAwake;
        if (speedUnitDisplaySelect) speedUnitDisplaySelect.value = userSettings.speedUnitDisplay;
        if (downloadFolderInput) downloadFolderInput.value = userSettings.downloadFolder || '';
        if (compactModeCheckbox) compactModeCheckbox.checked = userSettings.compactMode;
        if (skipDeleteConfirmationCheckbox) skipDeleteConfirmationCheckbox.checked = userSettings.skipDeleteConfirmation;
        if (themePresetSelect) themePresetSelect.value = userSettings.themePreset;
        
        // Add UI scale
        const uiScaleInput = document.getElementById('uiScale');
        const uiScaleValue = document.getElementById('uiScaleValue');
        if (uiScaleInput) {
            uiScaleInput.value = userSettings.uiScale || 1.0;
            if (uiScaleValue) uiScaleValue.textContent = `${Math.round((userSettings.uiScale || 1.0) * 100)}%`;
        }
        
        applyCompactMode(userSettings.compactMode);
        applyUIScale(userSettings.uiScale || 1.0);
    }

    if (settingsBtn) {
        settingsBtn.onclick = () => {
            populateSettingsModal();
            if (settingsModal) settingsModal.style.display = 'flex';
        };
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.onclick = () => {
            if (settingsModal) settingsModal.style.display = 'none';
        };
    }
    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = saveSettings;
    }
    
    // Tutorial button
    const openTutorialBtn = document.getElementById('openTutorialBtn');
    if (openTutorialBtn) {
        openTutorialBtn.onclick = () => {
            if (settingsModal) settingsModal.style.display = 'none';
            if (window.openTutorial) {
                window.openTutorial(0);
            }
        };
    }
    
    // Update tools button
    const updateToolsBtn = document.getElementById('updateToolsBtn');
    const updateStatusMessage = document.getElementById('updateToolsStatus');
    
    function showUpdateStatus(message, type) {
        if (!updateStatusMessage) return;
        updateStatusMessage.textContent = message;
        updateStatusMessage.className = 'status-message ' + (type || '');
        updateStatusMessage.style.display = 'flex';
        
        if (type === 'success') {
            setTimeout(() => {
                updateStatusMessage.style.display = 'none';
            }, 5000);
        }
    }
    
    if (updateToolsBtn) {
        updateToolsBtn.onclick = async () => {
            try {
                updateToolsBtn.disabled = true;
                updateToolsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
                showUpdateStatus('Checking for updates...', '');
                
                const result = await window.updateTools();
                
                if (result && result.error) {
                    showUpdateStatus(`Error: ${result.error}`, 'error');
                    updateToolsBtn.disabled = false;
                    updateToolsBtn.innerHTML = '<i class="fas fa-download"></i> Update Tools';
                    return;
                }
                
                if (result) {
                    let message = '';
                    let hasUpdates = false;
                    let hasErrors = false;
                    
                    // Check yt-dlp results
                    if (result.ytdlp) {
                        if (result.ytdlp.updated) {
                            message += `✅ yt-dlp updated: ${result.ytdlp.oldVersion} → ${result.ytdlp.newVersion}\n`;
                            hasUpdates = true;
                        } else if (result.ytdlp.error) {
                            message += `❌ yt-dlp update failed: ${result.ytdlp.error}\n`;
                            hasErrors = true;
                        } else {
                            message += `ℹ️ yt-dlp: ${result.ytdlp.reason || 'No update available'}\n`;
                        }
                    }
                    
                    // Check FFmpeg results
                    if (result.ffmpeg) {
                        if (result.ffmpeg.hasUpdate) {
                            message += `🔄 FFmpeg update available: ${result.ffmpeg.latestVersion}\n`;
                            message += '💡 Manual download required: https://ffmpeg.org/download.html\n';
                            hasUpdates = true;
                        } else if (result.ffmpeg.error) {
                            message += `❌ FFmpeg check failed: ${result.ffmpeg.error}\n`;
                            hasErrors = true;
                        } else {
                            message += `ℹ️ FFmpeg: ${result.ffmpeg.reason || 'No update available'}\n`;
                        }
                    }
                    
                    if (hasUpdates) {
                        showUpdateStatus(message.trim(), 'success');
                    } else if (hasErrors) {
                        showUpdateStatus(message.trim(), 'error');
                    } else {
                        showUpdateStatus(message.trim() || 'All tools are up to date.', '');
                    }
                } else {
                    showUpdateStatus('Unable to check for updates. Please try again.', 'error');
                }
            } catch (error) {
                console.error('Error updating tools:', error);
                showUpdateStatus(`Error: ${error.message || 'Failed to update tools. Please try again.'}`, 'error');
            } finally {
                updateToolsBtn.disabled = false;
                updateToolsBtn.innerHTML = '<i class="fas fa-download"></i> Update Tools';
            }
        };
    }
    
    // Reset speed button
    if (resetSpeedBtn) {
        resetSpeedBtn.onclick = () => {
            if (maxSpeedInput) maxSpeedInput.value = '0';
        };
    }

    window.onclick = (event) => {
        if (settingsModal && event.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    };

    // --- Notifications ---
    function playNotificationSound() {
        if (completionSound) completionSound.play().catch(e => console.warn("Error playing notification sound:", e));
    }
    function showDesktopNotification(title, body) {
        if (!("Notification" in window)) {
            console.log("This browser does not support desktop notification");
            return;
        }
        if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: './assets/Logo 1.png' });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (permission) {
                if (permission === "granted") {
                    new Notification(title, { body: body, icon: './assets/Logo 1.png' });
                }
            });
        }
    }
    if (("Notification" in window) && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // --- Helper Functions ---
    function shouldSkipDeleteConfirmation() {
        return userSettings.skipDeleteConfirmation === true;
    }

    // Aceternity UI Custom Confirmation Modal
    function confirmDelete(message, title = 'Confirm Deletion') {
        if (shouldSkipDeleteConfirmation()) {
            return true;
        }
        
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmationModal');
            const messageEl = document.getElementById('confirmationMessage');
            const titleEl = document.getElementById('confirmationTitle');
            const confirmBtn = document.getElementById('confirmationConfirmBtn');
            const cancelBtn = document.getElementById('confirmationCancelBtn');
            
            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;
            
            // Show modal
            modal.style.display = 'flex';
            
            // Remove existing listeners
            const newConfirmBtn = confirmBtn.cloneNode(true);
            const newCancelBtn = cancelBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            
            // Add new listeners
            newConfirmBtn.addEventListener('click', () => {
                modal.style.display = 'none';
                resolve(true);
            });
            
            newCancelBtn.addEventListener('click', () => {
                modal.style.display = 'none';
                resolve(false);
            });
            
            // Close on backdrop click
            modal.addEventListener('click', function backdropClick(e) {
                if (e.target === modal) {
                    modal.style.display = 'none';
                    modal.removeEventListener('click', backdropClick);
                    resolve(false);
                }
            });
            
            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.style.display = 'none';
                    document.removeEventListener('keydown', escapeHandler);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }
    
    // Aceternity UI Custom Alert Modal
    function showAlert(message, title = 'Notification') {
        return new Promise((resolve) => {
            const modal = document.getElementById('alertModal');
            const messageEl = document.getElementById('alertMessage');
            const titleEl = document.getElementById('alertTitle');
            const okBtn = document.getElementById('alertOkBtn');
            
            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;
            
            // Show modal
            modal.style.display = 'flex';
            
            // Remove existing listeners
            const newOkBtn = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);
            
            // Add new listener
            newOkBtn.addEventListener('click', () => {
                modal.style.display = 'none';
                resolve();
            });
            
            // Close on backdrop click
            modal.addEventListener('click', function backdropClick(e) {
                if (e.target === modal) {
                    modal.style.display = 'none';
                    modal.removeEventListener('click', backdropClick);
                    resolve();
                }
            });
            
            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.style.display = 'none';
                    document.removeEventListener('keydown', escapeHandler);
                    resolve();
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    // --- Logo Click Handler ---
    const logoContainer = document.querySelector('.logo-container');
    if (logoContainer) {
        logoContainer.style.cursor = 'pointer';
        logoContainer.addEventListener('click', () => {
            showTab('youtube');
        });
    }

    // --- Initializations ---
    applyTheme(userSettings.themePreset || 'light');
    applyUIScale(userSettings.uiScale || 1.0); // Add this line
    
    if (document.getElementById('youtubeDownloader') || document.getElementById('instagramDownloader')) {
        showTab(activeDownloader);
    } else if (contactUsTab) {
        showTab('youtube');
        document.body.classList.remove('instagram-theme-active');
    }
    
    // Ensure DOM is fully loaded before populating settings
    setTimeout(() => {
        // Re-find elements in case they weren't available initially
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }
        populateSettingsModal();
        
        // Final check - if checkbox still not found, log error
        if (!keepPcAwakeCheckbox) {
            console.error('Keep PC awake checkbox could not be found or created!');
            console.log('Available checkboxes:', document.querySelectorAll('input[type="checkbox"]'));
        } else {
            console.log('Keep PC awake checkbox successfully initialized:', keepPcAwakeCheckbox);
        }
    }, 100);

    // Folder picker logic
    if (chooseFolderBtn && downloadFolderInput) {
        chooseFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.openFolderDialog) {
                const folderPath = await window.electronAPI.openFolderDialog();
                if (folderPath) {
                    downloadFolderInput.value = folderPath;
                }
            } else {
                console.error('Folder picker not available. window.electronAPI:', window.electronAPI);
                showAlert('Folder picker not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (defaultFolderBtn && downloadFolderInput) {
        defaultFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
                const defaultPath = await window.electronAPI.getDefaultDownloadFolder();
                if (defaultPath) {
        downloadFolderInput.value = defaultPath;
                }
            } else {
                console.error('Default folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Default folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (openFolderBtn && downloadFolderInput) {
        openFolderBtn.onclick = async () => {
            const folderPath = downloadFolderInput.value;
            if (!folderPath) {
                showAlert('No folder selected.', 'No Selection');
                return;
            }
            if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(folderPath);
            } else {
                console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Open folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }

    // Paste button logic
    if (pasteYoutubeUrlBtn && youtubeUrlInput) {
        pasteYoutubeUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            youtubeUrlInput.value = t;
            setTimeout(() => {
                const url = youtubeUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'youtube');
            }, 50);
        });
    }
    if (pasteInstagramUrlBtn && instagramUrlInput) {
        pasteInstagramUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            instagramUrlInput.value = t;
            setTimeout(() => {
                const url = instagramUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'instagram');
            }, 50);
        });
    }

    // Delete all buttons with confirmation
    if (clearYoutubeDownloadsBtn && youtubeDownloadLinksArea) {
        clearYoutubeDownloadsBtn.onclick = async () => {
            const confirmed = await confirmDelete('Are you sure you want to clear all YouTube downloads from the list?', 'Clear All Downloads');
            if (confirmed) {
                youtubeDownloadLinksArea.replaceChildren(clearYoutubeDownloadsBtn);
            }
        };
    }
    if (clearInstagramDownloadsBtn && instagramDownloadLinksArea) {
        clearInstagramDownloadsBtn.onclick = async () => {
            const confirmed = await confirmDelete('Are you sure you want to clear all Instagram downloads from the list?', 'Clear All Downloads');
            if (confirmed) {
                instagramDownloadLinksArea.replaceChildren(clearInstagramDownloadsBtn);
            }
        };
    }

    // Mini-widgets DOM references
    const headerSpeedSlider = document.getElementById('headerSpeedSlider');
    const speedValue = document.getElementById('speedValue');
    const headerThemeSelect = document.getElementById('headerThemeSelect');
    const queuedCount = document.getElementById('queuedCount');
    const downloadingCount = document.getElementById('downloadingCount');
    const downloadedCount = document.getElementById('downloadedCount');

    // Update download stats widget
    function updateDownloadStats() {
        const queuedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'queued').length;
        const downloadingItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'downloading').length;
        const completedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'complete').length;
        if (queuedCount) queuedCount.textContent = queuedItems;
        if (downloadingCount) downloadingCount.textContent = downloadingItems;
        if (downloadedCount) downloadedCount.textContent = completedItems;
        
        // Manage power save blocker based on active downloads
        managePowerSaveBlocker();
    }

    async function managePowerSaveBlocker() {
        if (!userSettings.keepPcAwake || !window.electronAPI) {
            console.log("Power save blocker disabled or electronAPI missing");
            return;
        }
        
        const activeDownloads = Array.from(downloadItemsState.values()).filter(
            item => item.status === 'downloading' || item.status === 'queued'
        ).length;
        
        console.log("Active downloads count:", activeDownloads);
        console.log("Power save blocker currently active:", isPowerSaveBlockerActive);
        
        if (activeDownloads > 0 && !isPowerSaveBlockerActive) {
            // Start power save blocker
            try {
                console.log("Attempting to start power save blocker...");
                const result = await window.electronAPI.startPowerSaveBlocker();
                console.log("Start power save blocker result:", result);
                
                if (result.success) {
                    isPowerSaveBlockerActive = true;
                    console.log('✅ Power save blocker activated - keeping PC awake during downloads');
                } else {
                    console.warn('⚠️ Power save blocker start returned success=false:', result.message);
                    // Even if it says "already active", update our state to match
                    isPowerSaveBlockerActive = true;
                }
            } catch (error) {
                console.error('❌ Failed to start power save blocker:', error);
            }
        } else if (activeDownloads === 0 && isPowerSaveBlockerActive) {
            // Stop power save blocker
            try {
                console.log("Attempting to stop power save blocker...");
                const result = await window.electronAPI.stopPowerSaveBlocker();
                console.log("Stop power save blocker result:", result);
                
                if (result.success) {
                    isPowerSaveBlockerActive = false;
                    console.log('✅ Power save blocker deactivated - PC can sleep normally');
                } else {
                    console.warn('⚠️ Power save blocker stop returned success=false:', result.message);
                    // Even if there was an issue, update our state
                    isPowerSaveBlockerActive = false;
                }
            } catch (error) {
                console.error('❌ Failed to stop power save blocker:', error);
                // Reset state on error
                isPowerSaveBlockerActive = false;
            }
        } else {
            console.log("No state change needed - Downloads:", activeDownloads, "Blocker active:", isPowerSaveBlockerActive);
        }
    }





    // Speed Slider Widget
    if (headerSpeedSlider && speedValue) {
        headerSpeedSlider.value = userSettings.maxSpeed || 0;
        speedValue.textContent = userSettings.maxSpeed > 0 ? userSettings.maxSpeed : '∞';
        headerSpeedSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            speedValue.textContent = val > 0 ? val : '∞';
        });
        headerSpeedSlider.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (maxSpeedInput) maxSpeedInput.value = val;
            userSettings.maxSpeed = val;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
            saveSettings();
        });
    }

    // Theme Selector Widget
    if (headerThemeSelect) {
        headerThemeSelect.value = userSettings.themePreset || 'light';
        headerThemeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            if (themePresetSelect) themePresetSelect.value = theme;
            userSettings.themePreset = theme;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
            applyTheme(theme);
            saveSettings();
        });
    }

    // Download Badge Widget
    // function updateDownloadBadge() {
    //     const count = document.querySelectorAll('.download-item').length;
    //     if (downloadCount) downloadCount.textContent = count;
    //     if (downloadBadge) {
    //         if (count > 0) downloadBadge.classList.add('active');
    //         else downloadBadge.classList.remove('active');
    //     }
    // }
    // Call updateDownloadBadge after rendering download items
    // Example: after renderHistoryGroups, updateDownloadBadge();

    // Compact Mode Toggle
    function applyCompactMode(compact) {
        if (compact) {
            document.body.classList.add('compact-mode');
            console.log('Compact mode enabled');
        } else {
            document.body.classList.remove('compact-mode');
            console.log('Compact mode disabled');
        }
    }
    if (compactModeCheckbox) {
        compactModeCheckbox.addEventListener('change', () => {
            applyCompactMode(compactModeCheckbox.checked);
            userSettings.compactMode = compactModeCheckbox.checked;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
        });
    }
    applyCompactMode(userSettings.compactMode);





    // Tool update functions
    window.checkToolsStatus = async function() {
        console.log('=== Checking Tools Status ===');
        try {
            const response = await fetch('/tools-status');
            const status = await response.json();
            
            console.log('📋 Tools Status:', status);
            
            // Display in a nice format
            const ytdlpInfo = status.ytdlp;
            const ffmpegInfo = status.ffmpeg;
            
            console.log(`🎬 yt-dlp: ${ytdlpInfo.version} (last checked: ${ytdlpInfo.daysSinceLastCheck} days ago)`);
            console.log(`🎥 FFmpeg: ${ffmpegInfo.version} (last checked: ${ffmpegInfo.daysSinceLastCheck} days ago)`);
            
            return status;
        } catch (error) {
            console.error('❌ Error checking tools status:', error);
            return null;
        }
    };

    window.updateTools = async function() {
        console.log('=== Updating Tools ===');
        try {
            console.log('🔄 Starting tool updates...');
            
            const response = await fetch('/update-tools', { method: 'POST' });
            const result = await response.json();
            
            console.log('📊 Update Results:', result);
            
            // Display results
            if (result.ytdlp) {
                if (result.ytdlp.updated) {
                    console.log(`✅ yt-dlp updated: ${result.ytdlp.oldVersion} → ${result.ytdlp.newVersion}`);
                } else {
                    console.log(`ℹ️ yt-dlp: ${result.ytdlp.reason || result.ytdlp.error || 'No update needed'}`);
                }
            }
            
            if (result.ffmpeg) {
                if (result.ffmpeg.hasUpdate) {
                    console.log(`🔄 FFmpeg update available: ${result.ffmpeg.latestVersion}`);
                    console.log(`💡 Note: FFmpeg requires manual download from https://ffmpeg.org/download.html`);
                } else {
                    console.log(`ℹ️ FFmpeg: ${result.ffmpeg.reason || 'No update needed'}`);
                }
            }
            
            if (result.error) {
                console.error('❌ Update error:', result.error);
            }
            
            return result;
        } catch (error) {
            console.error('❌ Error updating tools:', error);
            return null;
        }
    };

    window.forceUpdateTools = async function() {
        console.log('=== Force Updating Tools ===');
        try {
            // Clear last update check to force update
            console.log('🔄 Clearing update check timestamps...');
            
            // Force update by clearing timestamps (this will be handled server-side)
            const response = await fetch('/force-update-tools', { method: 'POST' });
            const result = await response.json();
            
            console.log('📊 Force Update Results:', result);
            return result;
        } catch (error) {
            console.error('❌ Error force updating tools:', error);
            return null;
        }
    };









    // Fix playlist detection logic in handleWebSocketMessage and history categorization
    // ... ensure you use:
    // let subtabKey = source;
    // if (source === 'youtube') {
    //     if (currentItemState && currentItemState.isPlaylist) {
    //         subtabKey = 'youtubePlaylists';
    //     } else {
    //         subtabKey = 'youtubeSingles';
    //     }
    // }
    // ... and use the same logic when saving to history

    // After any download list change, call updateDownloadBadge()
    // For example, after adding/removing download items, call updateDownloadBadge();

    // Folder picker logic
    if (chooseFolderBtn && downloadFolderInput) {
        chooseFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.openFolderDialog) {
                const folderPath = await window.electronAPI.openFolderDialog();
                if (folderPath) {
                    downloadFolderInput.value = folderPath;
                }
            } else {
                console.error('Folder picker not available. window.electronAPI:', window.electronAPI);
                showAlert('Folder picker not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (defaultFolderBtn && downloadFolderInput) {
        defaultFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
                const defaultPath = await window.electronAPI.getDefaultDownloadFolder();
                if (defaultPath) {
        downloadFolderInput.value = defaultPath;
                }
            } else {
                console.error('Default folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Default folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (openFolderBtn && downloadFolderInput) {
        openFolderBtn.onclick = async () => {
            const folderPath = downloadFolderInput.value;
            if (!folderPath) {
                showAlert('No folder selected.', 'No Selection');
                return;
            }
            if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(folderPath);
            } else {
                console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Open folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }

    // Paste button logic
    if (pasteYoutubeUrlBtn && youtubeUrlInput) {
        pasteYoutubeUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            youtubeUrlInput.value = t;
            setTimeout(() => {
                const url = youtubeUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'youtube');
            }, 50);
        });
    }
    if (pasteInstagramUrlBtn && instagramUrlInput) {
        pasteInstagramUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            instagramUrlInput.value = t;
            setTimeout(() => {
                const url = instagramUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'instagram');
            }, 50);
        });
    }

    // Delete all buttons with confirmation
    if (clearYoutubeDownloadsBtn && youtubeDownloadLinksArea) {
        clearYoutubeDownloadsBtn.onclick = async () => {
            const confirmed = await confirmDelete('Are you sure you want to clear all YouTube downloads from the list?', 'Clear All Downloads');
            if (confirmed) {
                youtubeDownloadLinksArea.replaceChildren(clearYoutubeDownloadsBtn);
            }
        };
    }
    if (clearInstagramDownloadsBtn && instagramDownloadLinksArea) {
        clearInstagramDownloadsBtn.onclick = async () => {
            const confirmed = await confirmDelete('Are you sure you want to clear all Instagram downloads from the list?', 'Clear All Downloads');
            if (confirmed) {
                instagramDownloadLinksArea.replaceChildren(clearInstagramDownloadsBtn);
            }
        };
    }

    // Add this function to handle delayed removal
    function removeDownloadItemAfterDelay(itemId) {
        setTimeout(() => {
            const itemDiv = document.getElementById(`item-${itemId}`);
            if (itemDiv) {
                itemDiv.remove();
                downloadItemsState.delete(itemId);
                updateDownloadStats();
            }
        }, 3000);
    }

    // ===== HISTORY SUB-TABS =====
    const historyTabs = document.querySelectorAll('.history-tab');
    const historyLists = {
      youtubePlaylists: document.getElementById('historyYoutubePlaylists'),
      youtubeSingles:   document.getElementById('historyYoutubeSingles'),
      instagram:        document.getElementById('historyInstagram')
    };

    function activateHistoryTab(tabKey) {
      Object.values(historyLists).forEach(list => list && (list.style.display = 'none'));
      historyTabs.forEach(btn => btn.classList.remove('active'));
      const list = historyLists[tabKey];
      const btn  = document.querySelector(`.history-tab[data-history="${tabKey}"]`);
      if (list) list.style.display = 'grid';
      if (btn)  btn.classList.add('active');
    }

    // History Management Variables
    let historySearchTerm = '';
    let bulkSelectionMode = false;
    let selectedHistoryItems = new Set();
    let currentTimeFilter = 'all';
    let currentSort = 'newest';
    let allHistoryItems = [];
    
    // Performance: Debounce function
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Performance: Throttle function
    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    // Debounced history filter for better performance
    const debouncedFilterHistory = debounce(() => {
        filterAndRenderHistory();
    }, 300);

    // History Search and Filter Functions
    function setupHistoryManagement() {
        const historySearchInput = document.getElementById('historySearch');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        const timeFilter = document.getElementById('timeFilter');
        const sortBy = document.getElementById('sortBy');
        const bulkSelectBtn = document.getElementById('bulkSelectBtn');

        if (historySearchInput) {
            historySearchInput.addEventListener('input', (e) => {
                historySearchTerm = e.target.value.toLowerCase().trim();
                debouncedFilterHistory();
            });
            historySearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    historySearchInput.value = '';
                    historySearchTerm = '';
                    filterAndRenderHistory();
                }
            });
        }
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (historySearchInput) historySearchInput.value = '';
                historySearchTerm = '';
                filterAndRenderHistory();
            });
        }
        if (timeFilter) {
            timeFilter.addEventListener('change', (e) => {
                currentTimeFilter = e.target.value;
                filterAndRenderHistory();
            });
        }
        if (sortBy) {
            sortBy.addEventListener('change', (e) => {
                currentSort = e.target.value;
                filterAndRenderHistory();
            });
        }
        if (bulkSelectBtn) {
            bulkSelectBtn.addEventListener('click', toggleBulkSelectionMode);
        }
        setupBulkActionButtons();
    }

    function filterHistoryByTime(items) {
        if (currentTimeFilter === 'all') return items;
        const now = new Date();
        const cutoffTime = new Date();
        switch (currentTimeFilter) {
            case 'today':
                cutoffTime.setHours(0, 0, 0, 0);
                break;
            case 'week':
                cutoffTime.setDate(now.getDate() - 7);
                break;
            case 'month':
                cutoffTime.setDate(now.getDate() - 30);
                break;
            default:
                return items;
        }
        return items.filter(item => {
            const itemDate = new Date(item.mtime);
            return itemDate >= cutoffTime;
        });
    }

    function filterHistoryBySearch(items) {
        if (!historySearchTerm) return items;
        return items.filter(item => {
            const title = item.name.toLowerCase();
            const meta = new Date(item.mtime).toLocaleString().toLowerCase();
            return title.includes(historySearchTerm) || meta.includes(historySearchTerm);
        });
    }

    function sortHistoryItems(items) {
        const sorted = [...items];
        switch (currentSort) {
            case 'newest':
                return sorted.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
            case 'oldest':
                return sorted.sort((a, b) => new Date(a.mtime) - new Date(b.mtime));
            case 'name':
                return sorted.sort((a, b) => a.name.localeCompare(b.name));
            case 'size':
                return sorted.sort((a, b) => {
                    const sizeA = parseFloat(a.size) || 0;
                    const sizeB = parseFloat(b.size) || 0;
                    return sizeB - sizeA;
                });
            default:
                return sorted;
        }
    }

    function filterAndRenderHistory() {
        const allHistory = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
        let filteredItems = filterHistoryByTime(allHistory);
        filteredItems = filterHistoryBySearch(filteredItems);
        filteredItems = sortHistoryItems(filteredItems);
        const groupedItems = {
            youtubePlaylists: filteredItems.filter(item => item.type === 'youtubePlaylists'),
            youtubeSingles: filteredItems.filter(item => item.type === 'youtubeSingles'),
            instagram: filteredItems.filter(item => item.type === 'instagram')
        };
        renderHistoryGroups(groupedItems);
        updateItemCount(filteredItems.length);
    }

    async function renderHistoryGroups(groupedItems) {
        const rootFolder = getDownloadFolder();
        Object.values(historyLists).forEach(list => {
            if (list) list.innerHTML = '';
        });
        for (const [type, items] of Object.entries(groupedItems)) {
            const list = historyLists[type];
            if (!list) continue;
            for (const [index, item] of items.entries()) {
                // Check if this is a folder (playlist folder)
                if (item.isFolder && item.videos && item.videos.length > 0) {
                    const folderElement = await createFolderElement(item, index, rootFolder);
                    if (folderElement) {
                        list.appendChild(folderElement);
                    }
                } else {
                    const historyItem = await createHistoryItemElement(item, index, rootFolder);
                    if (historyItem) {
                        list.appendChild(historyItem);
                    }
                }
            }
        }
        if (bulkSelectionMode) {
            applyBulkMode();
        }
        updateDownloadStats(); // Update download badge after rendering history groups
    }

    async function createHistoryItemElement(item, index, rootFolder) {
        try {
            let absPath;
            const itemFolder = item.folder || rootFolder;
            if (item.path.startsWith('/downloads/')) {
                let relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                // If relativePath is already absolute, use it directly
                const isAbsolute = /^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith('/');
                if (isAbsolute) {
                    absPath = relativePath;
                } else if (window.electronAPI?.resolvePath) {
                    absPath = await window.electronAPI.resolvePath(itemFolder, relativePath);
                } else {
                    absPath = itemFolder + '\\' + relativePath.replace(/\//g, '\\');
                }
            } else if (item.path.startsWith('http')) {
                return null;
            } else {
                absPath = item.path;
            }
            let fileExists = true;
            if (window.electronAPI?.pathExists) {
                fileExists = await window.electronAPI.pathExists(absPath);
            }
            const div = document.createElement('div');
            div.className = 'history-item';
            div.dataset.index = index;
            div.dataset.originalIndex = findOriginalIndex(item);
            if (!fileExists) {
                div.classList.add('file-missing');
            }
            div.innerHTML = `
                    <img class="history-thumb" src="${item.thumbnail || 'https://placehold.co/120x90/e0e0e0/7f7f7f?text=Video'}" alt="Thumbnail" loading="lazy">
                    <div style="flex: 1; min-width: 0;">
                        <div class="history-title" title="${item.name.replace(/"/g, '&quot;')}">${item.name}${!fileExists ? ' (Missing)' : ''}</div>
                        <div class="history-meta">${new Date(item.mtime).toLocaleString()} • ${item.size}</div>
              </div>
              <div class="history-actions">
                        <button class="history-action-btn play" title="Play Video" data-action="play" data-path="${absPath}" data-index="${index}" ${!fileExists ? 'disabled' : ''}>
                  <i class="fas fa-play"></i>
                </button>
                        <button class="history-action-btn folder" title="Open Folder" data-action="folder" data-path="${absPath}" data-index="${index}">
                  <i class="fas fa-folder-open"></i>
                </button>
                        <button class="history-action-btn delete" title="Delete File" data-action="delete" data-path="${absPath}" data-index="${index}">
                  <i class="fas fa-trash"></i>
                </button>
              </div>`;
            return div;
        } catch (error) {
            console.error(`Error creating history item element:`, error);
            return null;
        }
    }

    async function createFolderElement(folderItem, index, rootFolder) {
        try {
            const folderPath = folderItem.path || folderItem.folder;
            let absPath = folderPath;
            
            // Resolve absolute path if needed
            if (folderPath && window.electronAPI?.resolvePath) {
                // Check if path is relative (doesn't start with drive letter or /)
                const isRelative = !/^[a-zA-Z]:[\\/]/.test(folderPath) && !folderPath.startsWith('/');
                if (isRelative) {
                    absPath = await window.electronAPI.resolvePath(rootFolder, folderPath);
                } else {
                    absPath = folderPath;
                }
            }
            
            let folderExists = true;
            if (window.electronAPI?.pathExists) {
                folderExists = await window.electronAPI.pathExists(absPath);
            }
            
            const folderDiv = document.createElement('div');
            folderDiv.className = 'history-folder';
            folderDiv.dataset.index = index;
            folderDiv.dataset.folderPath = absPath;
            folderDiv.dataset.expanded = 'false';
            
            const videoCount = folderItem.videoCount || (folderItem.videos ? folderItem.videos.length : 0);
            const folderName = folderItem.name || 'Playlist Folder';
            
            folderDiv.innerHTML = `
                <div class="history-folder-header" style="display: flex; align-items: center; padding: 12px; cursor: pointer; border-bottom: 1px solid #e0e0e0;">
                    <button class="history-folder-toggle" style="background: none; border: none; padding: 4px 8px; cursor: pointer; margin-right: 8px;">
                        <i class="fas fa-chevron-right" style="transition: transform 0.2s;"></i>
                    </button>
                    <i class="fas fa-folder" style="margin-right: 8px; color: #4a90e2;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div class="history-title" style="font-weight: 600;">${folderName}</div>
                        <div class="history-meta">${new Date(folderItem.mtime).toLocaleString()} • ${folderItem.size} • ${videoCount} video${videoCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="history-actions">
                        <button class="history-action-btn folder" title="Open Folder" data-action="folder" data-path="${absPath}" data-index="${index}">
                            <i class="fas fa-folder-open"></i>
                        </button>
                        <button class="history-action-btn delete" title="Delete Playlist Folder" data-action="delete-folder" data-path="${absPath}" data-index="${index}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="history-folder-content" style="display: none; padding-left: 20px;">
                    <!-- Videos will be inserted here when expanded -->
                </div>
            `;
            
            // Add expand/collapse functionality
            const toggleBtn = folderDiv.querySelector('.history-folder-toggle');
            const contentDiv = folderDiv.querySelector('.history-folder-content');
            const chevron = toggleBtn.querySelector('i');
            
            toggleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const isExpanded = folderDiv.dataset.expanded === 'true';
                
                if (!isExpanded && contentDiv.children.length === 0) {
                    // Load videos when first expanded
                    if (folderItem.videos && folderItem.videos.length > 0) {
                        for (let i = 0; i < folderItem.videos.length; i++) {
                            const video = folderItem.videos[i];
                            const videoElement = await createHistoryItemElement(video, `${index}_${i}`, rootFolder);
                            if (videoElement) {
                                videoElement.style.marginLeft = '20px';
                                contentDiv.appendChild(videoElement);
                            }
                        }
                    }
                }
                
                folderDiv.dataset.expanded = isExpanded ? 'false' : 'true';
                contentDiv.style.display = isExpanded ? 'none' : 'block';
                chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';
            });
            
            // Handle folder actions
            folderDiv.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('.history-action-btn');
                if (actionBtn) {
                    const action = actionBtn.dataset.action;
                    const path = actionBtn.dataset.path;
                    
                    if (action === 'folder' && window.electronAPI?.openPathInExplorer) {
                        window.electronAPI.openPathInExplorer(path);
                    } else if (action === 'delete-folder') {
                        confirmDelete(`Delete entire playlist folder "${folderName}" and all ${videoCount} videos?`, 'Delete Playlist Folder').then(async (confirmed) => {
                            if (confirmed) {
                                // Delete folder and all videos
                                if (window.electronAPI?.deleteFolder) {
                                    await window.electronAPI.deleteFolder(path);
                                    folderDiv.remove();
                                    scanDownloadFolderAndUpdateHistory();
                                }
                            }
                        });
                    }
                }
            });
            
            if (!folderExists) {
                folderDiv.classList.add('file-missing');
            }
            
            return folderDiv;
        } catch (error) {
            console.error(`Error creating folder element:`, error);
            return null;
        }
    }

    function findOriginalIndex(targetItem) {
        const allHistory = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
        return allHistory.findIndex(item => 
            item.name === targetItem.name && 
            item.mtime === targetItem.mtime && 
            item.path === targetItem.path
        );
    }

    function updateItemCount(count) {
        const itemCountEl = document.getElementById('itemCount');
        if (itemCountEl) {
            itemCountEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;
        }
    }

    // Bulk Selection Functions
    function toggleBulkSelectionMode() {
        bulkSelectionMode = !bulkSelectionMode;
        const bulkActionsDiv = document.getElementById('historyBulkActions');
        const bulkSelectBtn = document.getElementById('bulkSelectBtn');
        if (bulkSelectionMode) {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'flex';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = '<i class="fas fa-times"></i> Exit Bulk';
                bulkSelectBtn.classList.add('danger-btn');
            }
            applyBulkMode();
      } else {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'none';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = '<i class="fas fa-check-square"></i> Bulk Select';
                bulkSelectBtn.classList.remove('danger-btn');
            }
            removeBulkMode();
        }
    }

    function applyBulkMode() {
        selectedHistoryItems.clear();
        document.querySelectorAll('.history-item').forEach((item) => {
            item.classList.add('bulk-mode');
            const existingCheckbox = item.querySelector('.history-item-checkbox');
            if (existingCheckbox) existingCheckbox.remove();
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'history-item-checkbox';
            checkbox.dataset.originalIndex = item.dataset.originalIndex;
            checkbox.addEventListener('change', handleHistoryItemSelection);
            item.appendChild(checkbox);
        });
        updateSelectedCount();
    }

    function removeBulkMode() {
        selectedHistoryItems.clear();
        document.querySelectorAll('.history-item').forEach(item => {
            item.classList.remove('bulk-mode', 'selected');
            const checkbox = item.querySelector('.history-item-checkbox');
            if (checkbox) checkbox.remove();
        });
        updateSelectedCount();
    }

    function handleHistoryItemSelection(e) {
        const item = e.target.closest('.history-item');
        const originalIndex = parseInt(e.target.dataset.originalIndex);
        if (e.target.checked) {
            selectedHistoryItems.add(originalIndex);
            item.classList.add('selected');
      } else {
            selectedHistoryItems.delete(originalIndex);
            item.classList.remove('selected');
        }
        updateSelectedCount();
    }

    function updateSelectedCount() {
        const countSpan = document.getElementById('selectedCount');
        if (countSpan) {
            countSpan.textContent = `${selectedHistoryItems.size} selected`;
        }
    }

    function setupBulkActionButtons() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#selectAllHistoryBtn')) {
                selectAllItems();
            } else if (e.target.closest('#deselectAllHistoryBtn')) {
                deselectAllItems();
            } else if (e.target.closest('#deleteSelectedBtn')) {
                deleteSelectedItems();
            } else if (e.target.closest('#cancelSelectionBtn')) {
                toggleBulkSelectionMode();
            }
        });
    }

    function selectAllItems() {
        document.querySelectorAll('.history-item-checkbox').forEach(cb => {
            if (!cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
        });
    }

    function deselectAllItems() {
        document.querySelectorAll('.history-item-checkbox').forEach(cb => {
            if (cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
    }

    async function deleteSelectedItems() {
        if (selectedHistoryItems.size === 0) {
            await showAlert('No items selected for deletion.', 'No Selection');
            return;
        }
        const confirmMessage = `Delete ${selectedHistoryItems.size} selected item${selectedHistoryItems.size !== 1 ? 's' : ''} permanently?`;
        const confirmed = await confirmDelete(confirmMessage, 'Delete Selected Items');
        if (!confirmed) return;
        
      const history = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
        const indicesToDelete = Array.from(selectedHistoryItems).sort((a, b) => b - a);
        let deletedCount = 0;
        let removedCount = 0;
        for (const index of indicesToDelete) {
            if (index >= 0 && index < history.length) {
                const item = history[index];
                if (item && window.electronAPI?.deleteFile) {
                    try {
                        let absPath;
                        const rootFolder = getDownloadFolder();
                        if (item.path.startsWith('/downloads/')) {
                            const relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                            absPath = await window.electronAPI.resolvePath(rootFolder, relativePath);
                        } else {
                            absPath = item.path;
                        }
                        const result = await window.electronAPI.deleteFile(absPath);
                        if (result.success) deletedCount++;
                    } catch (error) {
                        console.error(`Failed to delete file for item ${index}:`, error);
                    }
                }
      history.splice(index, 1);
                removedCount++;
            }
        }
      localStorage.setItem('ytdHistory', JSON.stringify(history));
        selectedHistoryItems.clear();
        toggleBulkSelectionMode();
        filterAndRenderHistory();
        const message = deletedCount > 0 
            ? `Successfully deleted ${deletedCount} file${deletedCount !== 1 ? 's' : ''} and removed ${removedCount} item${removedCount !== 1 ? 's' : ''} from history.`
            : `Removed ${removedCount} item${removedCount !== 1 ? 's' : ''} from history.`;
        await showAlert(message, 'Deletion Complete');
    }

    // Clear History button with confirmation
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.onclick = async () => {
            const confirmed = await confirmDelete('Are you sure you want to clear all history?', 'Clear All History');
            if (confirmed) {
                localStorage.removeItem('ytdHistory');
                filterAndRenderHistory();
            }
        };
    }

    // History action buttons event listener
    document.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.history-action-btn');
        if (!actionBtn) return;
        
        const action = actionBtn.dataset.action;
        const filePath = actionBtn.dataset.path;
        const index = parseInt(actionBtn.dataset.index);
        
        if (action === 'play') {
            if (window.electronAPI?.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(filePath);
            }
        } else if (action === 'folder') {
            if (window.electronAPI?.getDirname && window.electronAPI?.openPathInExplorer) {
                const folderPath = await window.electronAPI.getDirname(filePath);
                await window.electronAPI.openPathInExplorer(folderPath);
            }
        } else if (action === 'delete') {
            const confirmed = await confirmDelete('Are you sure you want to delete this file?', 'Delete File');
            if (confirmed) {
                try {
                    if (window.electronAPI?.deleteFile) {
                        const result = await window.electronAPI.deleteFile(filePath);
                        if (result.success) {
                            // Remove from history
                            const history = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
                            const historyItem = actionBtn.closest('.history-item');
                            const originalIndex = parseInt(historyItem.dataset.originalIndex);
                            if (originalIndex >= 0 && originalIndex < history.length) {
                                history.splice(originalIndex, 1);
                                localStorage.setItem('ytdHistory', JSON.stringify(history));
                                filterAndRenderHistory();
                            }
                        } else {
                            await showAlert('Failed to delete file: ' + (result.error || 'Unknown error'), 'Deletion Failed');
                        }
                    }
                } catch (error) {
                    console.error('Error deleting file:', error);
                    await showAlert('Error deleting file: ' + error.message, 'Error');
                }
            }
        }
    });

    // Wire the history tabs
    historyTabs.forEach(btn =>
      btn.addEventListener('click', () => {
        activateHistoryTab(btn.dataset.history);
        filterAndRenderHistory();
      })
    );
    
    // Initial history setup
    activateHistoryTab('youtubeSingles');
    setupHistoryManagement();
    filterAndRenderHistory();

    async function scanDownloadFolderAndUpdateHistory() {
      if (!window.electronAPI || !window.electronAPI.listDownloadFolder) return;
      const folder = getDownloadFolder();
      const files = await window.electronAPI.listDownloadFolder(folder);
    }

    function renderFromLocalStorage() {
        filterAndRenderHistory();
    }
    
    if (downloadFolderInput) {
      downloadFolderInput.addEventListener('change', scanDownloadFolderAndUpdateHistory);
    }

    scanDownloadFolderAndUpdateHistory();

    // UI Scale slider event listener
    const uiScaleInput = document.getElementById('uiScale');
    const uiScaleValue = document.getElementById('uiScaleValue');

    if (uiScaleInput && uiScaleValue) {
        uiScaleInput.addEventListener('input', (e) => {
            const scaleValue = parseFloat(e.target.value);
            uiScaleValue.textContent = `${Math.round(scaleValue * 100)}%`;
            applyUIScale(scaleValue);
        });
        
        uiScaleInput.addEventListener('change', (e) => {
            const scaleValue = parseFloat(e.target.value);
            userSettings.uiScale = scaleValue;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
        });
    }

    // ===== TUTORIAL SYSTEM =====
    initTutorial();
});

// Tutorial System
function initTutorial() {
    const tutorialModal = document.getElementById('tutorialModal');
    const tutorialContent = document.getElementById('tutorialContent');
    const closeTutorialBtn = document.getElementById('closeTutorialBtn');
    
    if (!tutorialModal || !tutorialContent) return;
    
    let currentStep = 0;
    
    const tutorialSteps = [
        {
            number: 1,
            title: 'Set Download Location',
            subtitle: 'Choose where videos are saved',
            images: [
                './assets/Tutorial One 1-2.png',
                './assets/Tutorial One 2-2.png'
            ],
            content: `
                <div class="tutorial-content-box">
                    <h3><i class="fas fa-folder-open"></i> Quick Setup</h3>
                    <p>Change from the default app folder to a local folder for better access.</p>
                    <ol>
                        <li>Click <strong>Settings</strong> <i class="fas fa-cog"></i> (top-right)</li>
                        <li>Go to <strong>Download Location</strong></li>
                        <li>Click <strong>Choose</strong> or <strong>Default</strong></li>
                        <li>Click <strong>Save Settings</strong></li>
                    </ol>
                </div>
            `
        },
        {
            number: 2,
            title: 'Add Cookies (Optional)',
            subtitle: 'For age-restricted & private content',
            images: [
                './assets/Tutorial Two 1-3.png',
                './assets/Tutorial Two 2-3.png',
                './assets/Tutorial Two 3-3.png'
            ],
            content: `
                <div class="tutorial-content-box">
                    <h3><i class="fas fa-cookie-bite"></i> Why Cookies?</h3>
                    <p>Access age-restricted videos and improve download speeds. Optional but recommended.</p>
                    <ol>
                        <li>Click <strong>Import Cookies</strong> in Settings</li>
                        <li>Follow the instructions shown</li>
                        <li>Export cookies from your browser</li>
                        <li>Upload or paste cookies.txt</li>
                        <li>Click <strong>Save Cookies</strong></li>
                    </ol>
                </div>
            `
        },
        {
            number: 3,
            title: 'Download & History',
            subtitle: 'Start downloading and track your files',
            images: [
                './assets/Tutorial Three 1-1.png'
            ],
            content: `
                <div class="tutorial-content-box">
                    <h3><i class="fas fa-download"></i> Download Videos</h3>
                    <ol>
                        <li>Paste YouTube URL in <strong>Video</strong> tab</li>
                        <li>Choose <strong>Format</strong> (MP4/MP3) & <strong>Quality</strong></li>
                        <li>Click <strong>Download Now</strong></li>
                        <li>Watch progress in the right panel</li>
                    </ol>
                </div>
                <div class="tutorial-content-box" style="margin-top: 1rem;">
                    <h3><i class="fas fa-history"></i> View History</h3>
                    <ol>
                        <li>Click <strong>History</strong> tab</li>
                        <li>Browse: Singles, Playlists, Instagram</li>
                        <li>Search, filter, and sort your downloads</li>
                        <li>Use <strong>Play</strong> or <strong>Folder</strong> buttons</li>
                    </ol>
                </div>
            `
        }
    ];
    
    // Image popup modal functionality
    function createImagePopup() {
        const popup = document.createElement('div');
        popup.className = 'image-popup-modal';
        popup.innerHTML = `
            <div class="image-popup-content">
                <button class="image-popup-close" aria-label="Close image">&times;</button>
                <img class="image-popup-img" src="" alt="Full size image" />
                <button class="image-popup-prev" aria-label="Previous image">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <button class="image-popup-next" aria-label="Next image">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
        document.body.appendChild(popup);
        
        let currentImageIndex = 0;
        let currentImages = [];
        
        function openPopup(images, index) {
            currentImages = images;
            currentImageIndex = index;
            const img = popup.querySelector('.image-popup-img');
            img.src = images[index];
            popup.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
        
        function closePopup() {
            popup.style.display = 'none';
            document.body.style.overflow = '';
        }
        
        function showNext() {
            if (currentImages.length === 0) return;
            currentImageIndex = (currentImageIndex + 1) % currentImages.length;
            popup.querySelector('.image-popup-img').src = currentImages[currentImageIndex];
        }
        
        function showPrev() {
            if (currentImages.length === 0) return;
            currentImageIndex = (currentImageIndex - 1 + currentImages.length) % currentImages.length;
            popup.querySelector('.image-popup-img').src = currentImages[currentImageIndex];
        }
        
        popup.querySelector('.image-popup-close').onclick = closePopup;
        popup.querySelector('.image-popup-next').onclick = showNext;
        popup.querySelector('.image-popup-prev').onclick = showPrev;
        popup.onclick = (e) => {
            if (e.target === popup) closePopup();
        };
        
        document.addEventListener('keydown', (e) => {
            if (popup.style.display === 'flex') {
                if (e.key === 'Escape') closePopup();
                if (e.key === 'ArrowRight') showNext();
                if (e.key === 'ArrowLeft') showPrev();
            }
        });
        
        return { openPopup };
    }
    
    const imagePopup = createImagePopup();
    
    function createCarousel(images, stepIndex, stepTitle) {
        if (!images || images.length === 0) return '';
        
        const carouselId = `carousel-${stepIndex}`;
        const itemGroupId = `carousel-items-${stepIndex}`;
        const indicatorsId = `carousel-indicators-${stepIndex}`;
        
        const indicatorsHTML = images.map((_, idx) => 
            `<button class="carousel-indicator" data-index="${idx}" aria-label="Go to slide ${idx + 1}" ${idx === 0 ? 'data-active' : ''}></button>`
        ).join('');
        
        return `
            <div class="tutorial-carousel" data-carousel-id="${carouselId}">
                <div class="carousel-item-group" id="${itemGroupId}">
                    ${images.map((imgSrc, idx) => `
                        <div class="carousel-item" data-index="${idx}" ${idx === 0 ? 'data-active' : ''}>
                            <img 
                                src="${imgSrc}" 
                                alt="${stepTitle} - Image ${idx + 1}" 
                                class="carousel-image"
                                loading="lazy"
                                decoding="async"
                            />
                        </div>
                    `).join('')}
                </div>
                <div class="carousel-control">
                    <button class="carousel-prev-btn" aria-label="Previous slide">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <div class="carousel-indicator-group" id="${indicatorsId}">
                        ${indicatorsHTML}
                    </div>
                    <button class="carousel-next-btn" aria-label="Next slide">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
        `;
    }
    
    function initCarousel(carouselEl, images, stepIndex) {
        const items = carouselEl.querySelectorAll('.carousel-item');
        const indicators = carouselEl.querySelectorAll('.carousel-indicator');
        const prevBtn = carouselEl.querySelector('.carousel-prev-btn');
        const nextBtn = carouselEl.querySelector('.carousel-next-btn');
        const imagesEl = carouselEl.querySelectorAll('.carousel-image');
        
        let currentIndex = 0;
        
        function updateCarousel(index) {
            // Update items
            items.forEach((item, idx) => {
                if (idx === index) {
                    item.setAttribute('data-active', '');
                } else {
                    item.removeAttribute('data-active');
                }
            });
            
            // Update indicators
            indicators.forEach((indicator, idx) => {
                if (idx === index) {
                    indicator.setAttribute('data-active', '');
                } else {
                    indicator.removeAttribute('data-active');
                }
            });
            
            currentIndex = index;
        }
        
        function goToSlide(index) {
            if (index < 0) index = items.length - 1;
            if (index >= items.length) index = 0;
            updateCarousel(index);
        }
        
        function goNext() {
            goToSlide(currentIndex + 1);
        }
        
        function goPrev() {
            goToSlide(currentIndex - 1);
        }
        
        // Button events
        nextBtn?.addEventListener('click', goNext);
        prevBtn?.addEventListener('click', goPrev);
        
        // Indicator events
        indicators.forEach((indicator, idx) => {
            indicator.addEventListener('click', () => goToSlide(idx));
        });
        
        // Image click to open popup
        imagesEl.forEach((img, idx) => {
            img.style.cursor = 'pointer';
            img.addEventListener('click', () => {
                imagePopup.openPopup(images, idx);
            });
        });
        
        // Keyboard navigation
        carouselEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') goNext();
            if (e.key === 'ArrowLeft') goPrev();
        });
        
        // Touch/swipe support
        let touchStartX = 0;
        let touchEndX = 0;
        
        carouselEl.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });
        
        carouselEl.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        });
        
        function handleSwipe() {
            const swipeThreshold = 50;
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > swipeThreshold) {
                if (diff > 0) {
                    goNext();
                } else {
                    goPrev();
                }
            }
        }
    }
    
    function renderAllSteps() {
        const stepsHTML = tutorialSteps.map((step, index) => {
            // Create carousel for images
            const carouselHTML = step.images && step.images.length > 0 
                ? createCarousel(step.images, index, step.title)
                : '';
            
            return `
            <div class="tutorial-step-card" data-step="${index}">
                <div class="tutorial-step-number">${step.number}</div>
                <h2 class="tutorial-step-title">${step.title}</h2>
                <p class="tutorial-step-subtitle">${step.subtitle}</p>
                ${step.content}
                ${carouselHTML ? `<div class="tutorial-images-container">${carouselHTML}</div>` : ''}
            </div>
            `;
        }).join('');
        
        // Use innerHTML only once for better performance
        tutorialContent.innerHTML = `
            <div class="tutorial-header-bar">
                <div class="tutorial-header-title">
                    <i class="fas fa-graduation-cap"></i>
                    Getting Started Tutorial
                </div>
            </div>
            <div class="tutorial-steps-container">
                ${stepsHTML}
            </div>
            <div class="tutorial-footer">
                <button class="tutorial-action-btn primary" id="finishTutorialBtn">
                    Got it! Let's start <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        `;
        
        // Initialize carousels
        tutorialSteps.forEach((step, index) => {
            if (step.images && step.images.length > 0) {
                const carouselEl = tutorialContent.querySelector(`[data-carousel-id="carousel-${index}"]`);
                if (carouselEl) {
                    initCarousel(carouselEl, step.images, index);
                }
            }
        });
        
        // Remove existing listeners to prevent duplicates (performance optimization)
        const existingClickHandler = tutorialContent._tutorialClickHandler;
        const existingKeyHandler = tutorialContent._tutorialKeyHandler;
        if (existingClickHandler) {
            tutorialContent.removeEventListener('click', existingClickHandler);
        }
        if (existingKeyHandler) {
            tutorialContent.removeEventListener('keypress', existingKeyHandler);
        }
        
        // Add interactive card hover effects with event delegation for better performance
        const clickHandler = (e) => {
            const card = e.target.closest('.tutorial-step-card');
            if (card && !e.target.closest('.carousel-control') && !e.target.closest('.carousel-image')) {
                const cards = tutorialContent.querySelectorAll('.tutorial-step-card');
                cards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');
            }
        };
        tutorialContent._tutorialClickHandler = clickHandler;
        tutorialContent.addEventListener('click', clickHandler);
        
        // Add keyboard navigation
        const keyHandler = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const card = e.target.closest('.tutorial-step-card');
                if (card) {
                    e.preventDefault();
                    card.click();
                }
            }
        };
        tutorialContent._tutorialKeyHandler = keyHandler;
        tutorialContent.addEventListener('keypress', keyHandler);
        
        // Set tabindex for keyboard navigation
        const cards = tutorialContent.querySelectorAll('.tutorial-step-card');
        cards.forEach(card => card.setAttribute('tabindex', '0'));
        
        // Finish button
        const finishBtn = document.getElementById('finishTutorialBtn');
        if (finishBtn) {
            finishBtn.onclick = closeTutorial;
        }
    }
    
    function openTutorial(stepIndex = 0) {
        // Use requestAnimationFrame for smoother rendering
        requestAnimationFrame(() => {
            renderAllSteps();
            requestAnimationFrame(() => {
                tutorialModal.style.display = 'flex';
                document.body.style.overflow = 'hidden';
            });
        });
    }
    
    function closeTutorial() {
        tutorialModal.style.display = 'none';
        document.body.style.overflow = '';
        localStorage.setItem('ytdTutorialCompleted', 'true');
    }
    
    if (closeTutorialBtn) {
        closeTutorialBtn.onclick = closeTutorial;
    }
    
    // Close on outside click
    tutorialModal.onclick = (e) => {
        if (e.target === tutorialModal) {
            closeTutorial();
        }
    };
    
    // Check if first time user
    const tutorialCompleted = localStorage.getItem('ytdTutorialCompleted');
    if (!tutorialCompleted) {
        // Show tutorial after a short delay
        setTimeout(() => {
            openTutorial(0);
        }, 1000);
    }
    
    // Make tutorial accessible globally
    window.openTutorial = openTutorial;
}

// Ensure default download folder is set correctly on first launch
window.addEventListener('DOMContentLoaded', async () => {
    const downloadFolderInput = document.getElementById('downloadFolder');
    
    // Get the app's downloads folder (for first startup) and user's Downloads folder (for default button)
    let appDownloadsPath = '';
    let userDownloadsPath = '';
    
    // Try to get paths from Electron API
    if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
        try {
            userDownloadsPath = await window.electronAPI.getDefaultDownloadFolder();
        } catch (e) {
            console.error('Failed to get default download folder:', e);
        }
    }
    
    // Get app directory path for first startup
    if (window.electronAPI && window.electronAPI.getUserDataPath) {
        try {
            const userDataPath = await window.electronAPI.getUserDataPath();
            // Use a 'downloads' folder inside the app's userData directory
            appDownloadsPath = userDataPath.replace(/\\/g, '/') + '/downloads';
        } catch (e) {
            console.error('Failed to get userData path:', e);
            // Fallback: use userDownloadsPath if available
            appDownloadsPath = userDownloadsPath || '';
        }
    } else {
        // Fallback if no Electron API - will be set by userDownloadsPath if available
        appDownloadsPath = userDownloadsPath || '';
    }
    
    if (downloadFolderInput) {
        let savedFolder = localStorage.getItem('downloadFolder');
        let isFirstLaunch = !localStorage.getItem('hasLaunchedBefore');
        
        if (!savedFolder) {
            if (isFirstLaunch) {
                // First startup: use app's downloads folder
                downloadFolderInput.value = appDownloadsPath;
                localStorage.setItem('downloadFolder', appDownloadsPath);
                localStorage.setItem('hasLaunchedBefore', 'true');
            } else {
                // Subsequent launches but no saved folder: use user's Downloads
                downloadFolderInput.value = userDownloadsPath || appDownloadsPath;
                localStorage.setItem('downloadFolder', userDownloadsPath || appDownloadsPath);
            }
        } else {
            downloadFolderInput.value = savedFolder;
        }
    }
    
    // Update default folder button to use the user's Downloads folder
    const defaultFolderBtn = document.getElementById('defaultFolderBtn');
    if (defaultFolderBtn) {
        defaultFolderBtn.onclick = async () => {
            const downloadFolderInput = document.getElementById('downloadFolder');
            if (downloadFolderInput) {
                let defaultPath = userDownloadsPath;
                
                // If we don't have it yet, try to get it
                if (!defaultPath && window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
                    try {
                        defaultPath = await window.electronAPI.getDefaultDownloadFolder();
                    } catch (e) {
                        console.error('Failed to get default download folder:', e);
                        // Fallback for Windows - will be replaced by Electron API when available
                        defaultPath = 'C:/Users/User/Downloads';
                    }
                }
                
                if (!defaultPath) {
                    // Final fallback
                    defaultPath = 'C:/Users/User/Downloads';
                }
                
                downloadFolderInput.value = defaultPath;
                localStorage.setItem('downloadFolder', defaultPath);
            }
        };
    }
});